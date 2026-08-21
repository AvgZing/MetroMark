const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf").default;
const db = require("../../processors/data");
const { TRANSITLAND_VECTOR_BASE_URL, transitlandMetrics } = require("./metrics");
const { enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");
const config = require("../../admin/config");

// Underlay coverage probe: cheaply enumerates Transitland's routes in a
// viewport by sampling its vector tiles. The client uses the route count to
// decide whether the PMTiles archive is missing routes (full or partial gap),
// and — when includeGeometry is set — the faint line features as a visual
// "underlay" of Transitland's network beneath the archive's rendered routes.
// The underlay is never called an overlay: it renders below the archive.

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

function extractTileFeatures(tileData, tileX, tileY, z) {
  try {
    const tile = new VectorTile(new Pbf(tileData));
    const layer = tile.layers?.routes;
    if (!layer || !Number.isFinite(layer.length) || layer.length === 0) {
      return [];
    }

    const extent = layer.extent || 4096;
    const features = [];

    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      const props = feature?.properties || {};
      const lineKey = String(props?.line_key || props?.onestop_id || "").trim();
      if (!lineKey) {
        continue;
      }

      const rawGeometry = feature.loadGeometry();
      if (!rawGeometry || rawGeometry.length === 0) {
        continue;
      }

      const coords = [];
      for (const ring of rawGeometry) {
        if (!Array.isArray(ring) || ring.length < 2) {
          continue;
        }
        const lineCoords = ring.map((pt) => tileToLonLat(pt.x, pt.y, tileX, tileY, z, extent));
        coords.push(lineCoords);
      }

      if (coords.length === 0) {
        continue;
      }

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

function extractTileLineKeys(tileData) {
  try {
    const tile = new VectorTile(new Pbf(tileData));
    const layer = tile.layers?.routes;
    if (!layer || !Number.isFinite(layer.length) || layer.length === 0) {
      return [];
    }

    const keys = [];
    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      const props = feature?.properties || {};
      const lineKey = String(props?.line_key || props?.onestop_id || "").trim();
      if (lineKey) {
        keys.push(lineKey);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

// Tiles covering a bbox at a given zoom (with a 1-tile halo)
function coveringTiles(minLon, minLat, maxLon, maxLat, z) {
  const size = 2 ** z;
  const lonToX = (lon) => Math.floor(((lon + 180) / 360) * size);
  const latToY = (lat) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return Math.floor(
      ((1 - Math.log(Math.tan((clamped * Math.PI) / 180) + 1 / Math.cos((clamped * Math.PI) / 180)) / Math.PI) / 2) * size
    );
  };

  const minX = Math.max(0, lonToX(minLon) - 1);
  const maxX = Math.min(size - 1, lonToX(maxLon) + 1);
  const minY = Math.max(0, latToY(maxLat) - 1);
  const maxY = Math.min(size - 1, latToY(minLat) + 1);

  const tiles = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

async function getTransitCoverageForBbox(bbox, zoom, options = {}) {
  const includeGeometry = Boolean(options.includeGeometry);
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return emptyCoverageResponse(includeGeometry);
  }

  const [minLon, minLat, maxLon, maxLat] = bbox;
  const userZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 5;
  const tileZoom = Math.max(5, Math.min(12, Math.round(userZoom)));
  const maxTiles = userZoom < 4 ? 40 : userZoom < 6 ? 30 : userZoom < 9 ? 20 : 10;

  // Snapped cache key using floor/ceil so small pans within a cell don't
  // change the key. Wider cells at low zoom prevent boundary-crossing cache
  // misses during typical browsing. Count-only and geometry responses use
  // separate keys so the small probe payloads are never replaced by geometry.
  const step = userZoom < 5 ? 20 : userZoom < 8 ? 5 : 1;
  const mode = includeGeometry ? "geo" : "count";
  const cacheKey = `coverage:${mode}:${tileZoom}:${Math.floor(minLon / step) * step}:${Math.floor(minLat / step) * step}:${Math.ceil(maxLon / step) * step}:${Math.ceil(maxLat / step) * step}`;

  // Check Postgres cache first — Transitland API is never served directly.
  try {
    const cached = await db.getCacheAny(cacheKey);
    if (cached?.payload && Number.isFinite(Number(cached.payload.routeCount))) {
      if (!includeGeometry || Array.isArray(cached.payload.routesGeoJson?.features)) {
        return cached.payload;
      }
    }
  } catch {
    // Fall through to fetch
  }

  const tiles = coveringTiles(minLon, minLat, maxLon, maxLat, tileZoom);
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const size = 2 ** tileZoom;
  const centerTileX = Math.max(0, Math.min(size - 1, Math.floor(((centerLon + 180) / 360) * size)));
  const centerTileY = Math.max(0, Math.min(size - 1, Math.floor(
    ((1 - Math.log(Math.tan((centerLat * Math.PI) / 180) + 1 / Math.cos((centerLat * Math.PI) / 180)) / Math.PI) / 2) * size
  )));

  tiles.sort((a, b) =>
    Math.abs(a.x - centerTileX) + Math.abs(a.y - centerTileY) -
    Math.abs(b.x - centerTileX) - Math.abs(b.y - centerTileY)
  );

  const limitedTiles = tiles.slice(0, maxTiles);
  const seen = new Set();
  const features = [];
  for (const { z, x, y } of limitedTiles) {
    const data = await fetchTileData(z, x, y);
    if (!data) {
      continue;
    }
    if (includeGeometry) {
      for (const feature of extractTileFeatures(data, x, y, z)) {
        const lk = feature?.properties?.line_key;
        if (lk && !seen.has(lk)) {
          seen.add(lk);
          features.push(feature);
        }
      }
    } else {
      for (const key of extractTileLineKeys(data)) {
        seen.add(key);
      }
    }
  }

  const result = {
    routeCount: seen.size,
    source: "coverage",
    tileZoom,
    tilesLoaded: limitedTiles.length,
    maxTiles
  };

  if (includeGeometry) {
    result.routesGeoJson = {
      type: "FeatureCollection",
      features
    };
  }

  try {
    await db.setCache(cacheKey, result, 90 * 86400, {
      cacheKind: includeGeometry ? "coverage-geo" : "coverage"
    });
  } catch {
    // Non-critical
  }

  return result;
}

function emptyCoverageResponse(includeGeometry) {
  const response = {
    routeCount: 0,
    source: "coverage",
    tileZoom: null,
    tilesLoaded: 0,
    maxTiles: 0
  };
  if (includeGeometry) {
    response.routesGeoJson = { type: "FeatureCollection", features: [] };
  }
  return response;
}

module.exports = {
  getTransitCoverageForBbox
};
