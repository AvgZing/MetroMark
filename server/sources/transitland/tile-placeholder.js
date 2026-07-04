const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf").default;
const db = require("../../processors/data");
const { TRANSITLAND_VECTOR_BASE_URL, transitlandMetrics } = require("./metrics");
const { enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");
const config = require("../../admin/config");

// Mercator projection helpers for converting MVT tile coordinates to lon/lat
function tileToLonLat(x, y, tileX, tileY, z, extent) {
  const size = 2 ** z;
  const worldX = (tileX * extent + x) / (size * extent);
  const worldY = (tileY * extent + y) / (size * extent);
  return [
    worldX * 360 - 180,
    Math.atan(Math.sinh(Math.PI - worldY * 2 * Math.PI)) * 180 / Math.PI
  ];
}

function decodeTileGeometry(tileData, tileX, tileY, z) {
  try {
    const tile = new VectorTile(new Pbf(tileData));
    const layer = tile.layers?.routes;
    if (!layer || !Number.isFinite(layer.length) || layer.length === 0) {
      return [];
    }

    const extent = layer.extent || 4096;
    const features = [];

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const props = feature?.properties || {};
      const lineKey = String(props?.line_key || props?.onestop_id || "").trim();
      if (!lineKey) continue;

      const rawGeometry = feature.loadGeometry();
      if (!rawGeometry || rawGeometry.length === 0) continue;

      // MVT returns geometry as arrays of rings (each ring is array of {x,y}).
      // A LineString has one ring, MultiLineString has multiple.
      const coords = [];
      for (const ring of rawGeometry) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        const lineCoords = ring.map((pt) => tileToLonLat(pt.x, pt.y, tileX, tileY, z, extent));
        coords.push(lineCoords);
      }

      if (coords.length === 0) continue;

      features.push({
        type: "Feature",
        id: lineKey,
        geometry: coords.length === 1
          ? { type: "LineString", coordinates: coords[0] }
          : { type: "MultiLineString", coordinates: coords },
        properties: {
          line_key: lineKey,
          route_type: Number.isFinite(Number(props.route_type)) ? Number(props.route_type) : null
        }
      });
    }

    return features;
  } catch {
    return [];
  }
}

async function fetchTileData(z, x, y, options = {}) {
  if (!config.TRANSITLAND_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : Math.max(1500, Number(config.TRANSITLAND_REQUEST_TIMEOUT_MS || 15000));
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${TRANSITLAND_VECTOR_BASE_URL}/routes/tiles/${z}/${x}/${y}.pbf?api_key=${config.TRANSITLAND_API_KEY}`;

  await enforceDailyUsageCapsIfNeeded("vector", options);
  transitlandMetrics.vectorTileRequestCount += 1;
  transitlandMetrics.lastVectorTileRequestAt = new Date().toISOString();
  await recordUsage("vector", 1);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/x-protobuf" },
      signal: controller.signal
    });

    if (!response.ok) {
      transitlandMetrics.vectorTileRequestFailureCount += 1;
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    transitlandMetrics.vectorTileRequestFailureCount += 1;
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// Tile coverage for a bbox at a given zoom
function coveringTiles(minLon, minLat, maxLon, maxLat, z) {
  const size = 2 ** z;
  const lonToX = (lon) => Math.floor((lon + 180) / 360 * size);
  const latToY = (lat) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return Math.floor((1 - Math.log(Math.tan(clamped * Math.PI / 180) + 1 / Math.cos(clamped * Math.PI / 180)) / Math.PI) / 2 * size);
  };

  const minX = Math.max(0, lonToX(minLon) - 1);
  const maxX = Math.min(size - 1, lonToX(maxLon) + 1);
  const minY = Math.max(0, latToY(maxLat) - 1);
  const maxY = Math.min(size - 1, latToY(minLat) + 1);

  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

async function getTilePlaceholderGeojson(bbox, zoom, routeTypes) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return emptyResponse();
  }

  // Camera-lens following user zoom: low zoom = minimal tiles for wide
  // country/globe coverage of the major transit skeleton.
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const userZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 5;
  const tileZoom = Math.max(5, Math.min(12, Math.round(userZoom)));
  const MAX_TILES = userZoom < 4 ? 40 : userZoom < 6 ? 30 : userZoom < 9 ? 20 : 10;

  // Snapped cache key using floor/ceil so small pans within a cell don't
  // change the key. Wider cells at low zoom prevent boundary-crossing
  // cache misses during typical browsing.
  const step = userZoom < 5 ? 20 : userZoom < 8 ? 5 : 1;
  const cacheKey = `tile-placeholder:${tileZoom}:${Math.floor(minLon / step) * step}:${Math.floor(minLat / step) * step}:${Math.ceil(maxLon / step) * step}:${Math.ceil(maxLat / step) * step}`;

  // Check Postgres cache first — Transitland API is never served directly
  try {
    var cached = await db.getCacheAny(cacheKey);
    if (cached?.payload?.routesGeoJson) {
      return cached.payload;
    }
  } catch {
    // Fall through to fetch
  }

  const tiles = coveringTiles(minLon, minLat, maxLon, maxLat, tileZoom);

  // Sort tiles by distance to viewport center
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const size = 2 ** tileZoom;
  const centerTileX = Math.max(0, Math.min(size - 1, Math.floor((centerLon + 180) / 360 * size)));
  const centerTileY = Math.max(0, Math.min(size - 1, Math.floor(
    (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * size
  )));
  tiles.sort(function (a, b) {
    return (
      Math.abs(a.x - centerTileX) + Math.abs(a.y - centerTileY) -
      Math.abs(b.x - centerTileX) - Math.abs(b.y - centerTileY)
    );
  });

  // Limit tile fetches to protect vector tile quota
  const limitedTiles = tiles.slice(0, MAX_TILES);
  const seen = new Set();
  const features = [];

  for (const { z, x, y } of limitedTiles) {
    const data = await fetchTileData(z, x, y);
    if (!data) continue;

    const tileFeatures = decodeTileGeometry(data, x, y, z);
    for (const f of tileFeatures) {
      const lk = f?.properties?.line_key;
      if (lk && !seen.has(lk)) {
        seen.add(lk);
        features.push(f);
      }
    }
  }

  const result = {
    routesGeoJson: { type: "FeatureCollection", features },
    routeCount: features.length,
    source: "tile-placeholder",
    tileZoom,
    tilesLoaded: limitedTiles.length
  };

  // Store in Postgres before serving — Transitland never feeds the frontend directly
  try {
    await db.setCache(cacheKey, result, 90 * 86400, {
      cacheKind: "tile-placeholder"
    });
  } catch {
    // Non-critical
  }
  return result;
}

async function getMvtLineKeyCount(bbox, zoom) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;

  // Use a single tile at the viewport center
  const centerLon = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const tileZoom = Math.min(12, Math.max(10, Math.round(Number(zoom) || 10)));
  const size = 2 ** tileZoom;
  const tx = Math.floor((centerLon + 180) / 360 * size);
  const ty = Math.floor(
    (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * size
  );

  // Check cached headway tile data first — this is free and instant
  const cacheKey = `transit-v4:routes-tile:${tileZoom}:${tx}:${Math.max(0, Math.min(size - 1, ty))}`;
  try {
    const cached = await db.getCacheAny(cacheKey);
    if (cached?.payload?.headwayByRouteKey) {
      return Object.keys(cached.payload.headwayByRouteKey).length;
    }
  } catch { /* Cache miss — try fresh fetch below */ }

  // Fallback: fetch the raw MVT tile (expensive, uses vector tile quota)
  const data = await fetchTileData(tileZoom, Math.max(0, Math.min(size - 1, tx)), Math.max(0, Math.min(size - 1, ty)), { timeoutMs: 4000 });
  if (!data) return null;

  var features = decodeTileGeometry(data, tx, ty, tileZoom);
  var seen = new Set();
  for (var i = 0; i < features.length; i++) {
    var lk = features[i]?.properties?.line_key;
    if (lk) seen.add(lk);
  }
  return seen.size;
}

function emptyResponse() {
  return {
    routesGeoJson: { type: "FeatureCollection", features: [] },
    routeCount: 0,
    source: "tile-placeholder-empty"
  };
}

module.exports = { getTilePlaceholderGeojson, getMvtLineKeyCount };
