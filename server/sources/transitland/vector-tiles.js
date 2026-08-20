const config = require("../../admin/config");
const db = require("../../processors/data");
const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf").default;
const {
  sanitizeText,
  normalizeRouteTypes
} = require("./helpers");
const {
  parseVectorTileHeadwaySeconds
} = require("./headway");
const { TRANSIT_CACHE_PREFIX, TRANSITLAND_VECTOR_BASE_URL, transitlandMetrics } = require("./metrics");
const { enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lngToTileX(lng, zoom) {
  const n = 2 ** zoom;
  return clampNumber(Math.floor(((lng + 180) / 360) * n), 0, n - 1);
}

function latToTileY(lat, zoom) {
  const safeLat = clampNumber(Number(lat), -85.05112878, 85.05112878);
  const radians = (safeLat * Math.PI) / 180;
  const n = 2 ** zoom;
  const y =
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n;
  return clampNumber(Math.floor(y), 0, n - 1);
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function inferVectorTileZoom(bboxArray, mapZoom) {
  if (Number.isFinite(mapZoom)) {
    return clampNumber(Math.round(mapZoom + 1), 9, 13);
  }

  const lonSpan = Math.max(0, Number(bboxArray[2]) - Number(bboxArray[0]));
  const latSpan = Math.max(0, Number(bboxArray[3]) - Number(bboxArray[1]));
  const span = Math.max(lonSpan, latSpan);
  if (span > 1.6) return 9;
  if (span > 1.1) return 10;
  if (span > 0.7) return 11;
  return 12;
}

function tilesForBbox(bboxArray, zoom) {
  const west = Number(bboxArray[0]);
  const south = Number(bboxArray[1]);
  const east = Number(bboxArray[2]);
  const north = Number(bboxArray[3]);

  const minX = Math.min(lngToTileX(west, zoom), lngToTileX(east, zoom));
  const maxX = Math.max(lngToTileX(west, zoom), lngToTileX(east, zoom));
  const minY = Math.min(latToTileY(north, zoom), latToTileY(south, zoom));
  const maxY = Math.max(latToTileY(north, zoom), latToTileY(south, zoom));

  const tiles = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({ z: zoom, x, y });
    }
  }

  return tiles;
}

function parseVectorTileRouteType(properties) {
  const value = Number(properties?.route_type ?? properties?.routeType);
  return Number.isFinite(value) ? value : null;
}

function normalizeRouteLookupKey(value) {
  return sanitizeText(value).toLowerCase();
}

function routeLookupKeysFromObject(route) {
  const routeId = sanitizeText(route?.route_id || route?.id);
  const shortName = sanitizeText(
    route?.route_short_name || route?.short_name || route?.line_short_name || route?.lineShortName
  );
  const longName = sanitizeText(
    route?.route_long_name ||
      route?.long_name ||
      route?.line_long_name ||
      route?.lineLongName ||
      route?.route_name ||
      route?.line_name ||
      route?.lineName ||
      route?.name
  );
  const feedId = sanitizeText(
    route?.route_feed_id ||
      route?.routeFeedId ||
      route?.feed_onestop_id ||
      route?.feedOnestopId ||
      route?.feed?.onestop_id
  );

  const candidates = [
    route?.onestop_id,
    route?.route_onestop_id,
    routeId,
    route?.line_key,
    route?.lineKey,
    route?.id,
    route?.routeFeedId,
    route?.route_feed_id,
    shortName,
    longName,
    route?.route_name,
    route?.line_name,
    route?.lineName,
    route?.line_short_name,
    route?.lineShortName
  ];

  if (feedId && routeId) {
    candidates.push(`${feedId}:${routeId}`);
  }
  if (feedId && shortName) {
    candidates.push(`${feedId}:${shortName}`);
  }
  if (feedId && longName) {
    candidates.push(`${feedId}:${longName}`);
  }

  const unique = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeRouteLookupKey(candidate);
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }

  return Array.from(unique);
}

async function fetchRoutesVectorTile(z, x, y, options = {}) {
  const cacheKey = `${TRANSIT_CACHE_PREFIX}routes-tile:${z}:${x}:${y}`;
  if (!options.forceRefresh) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached?.payload) {
      return cached.payload;
    }
  }

  if (!config.TRANSITLAND_API_KEY) {
    throw new Error("Transitland API key is missing. Set TRANSITLAND_API_KEY in .env.");
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1500, Number(config.TRANSITLAND_REQUEST_TIMEOUT_MS || 15000));
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const searchParams = new URLSearchParams({
    api_key: config.TRANSITLAND_API_KEY
  });

  const url = `${TRANSITLAND_VECTOR_BASE_URL}/routes/tiles/${z}/${x}/${y}.pbf?${searchParams.toString()}`;

  await enforceDailyUsageCapsIfNeeded("vector", options);
  transitlandMetrics.vectorTileRequestCount += 1;
  transitlandMetrics.lastVectorTileRequestAt = new Date().toISOString();
  await recordUsage("vector", 1);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/x-protobuf"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      transitlandMetrics.vectorTileRequestFailureCount += 1;
      const detail = await response.text();
      throw new Error(
        `Transitland vector tile request failed (${response.status}): ${detail.slice(0, 220)}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tile = new VectorTile(new Pbf(buffer));
    const layer = tile.layers?.routes;
    const headwayByRouteKey = {};

    if (layer && Number.isFinite(layer.length) && layer.length > 0) {
      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const properties = feature?.properties || {};
        const routeKeys = routeLookupKeysFromObject(properties);
        if (!routeKeys.length) {
          continue;
        }

        const headwaySeconds = parseVectorTileHeadwaySeconds(properties);
        if (!headwaySeconds) {
          continue;
        }

        const routeType = parseVectorTileRouteType(properties);
        for (const routeKey of routeKeys) {
          const existing = headwayByRouteKey[routeKey];
          if (!existing || headwaySeconds < existing.headwaySeconds) {
            headwayByRouteKey[routeKey] = {
              headwaySeconds,
              routeType
            };
          }
        }
      }
    }

    const payload = {
      z,
      x,
      y,
      headwayByRouteKey,
      fetchedAt: new Date().toISOString()
    };

    const ttlHours = Math.max(1, Number(config.TRANSIT_CACHE_TTL_HOURS || 12));
    await db.setCache(cacheKey, payload, ttlHours * 3600, {
      cacheKind: "vector-tile"
    });
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      transitlandMetrics.vectorTileRequestFailureCount += 1;
      throw new Error(`Transitland vector tile request timed out after ${timeoutMs}ms.`);
    }

    if (!String(error?.message || "").includes("vector tile request failed")) {
      transitlandMetrics.vectorTileRequestFailureCount += 1;
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchVectorRouteHeadwaysForBbox(bboxArray, options = {}) {
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const allowedRouteTypes = routeTypes.length ? new Set(routeTypes) : null;
  const zoom = inferVectorTileZoom(bboxArray, Number(options.zoom));
  const allTiles = tilesForBbox(bboxArray, zoom);
  const maxTiles = Math.max(1, Number(config.VECTOR_TILE_MAX_PER_BBOX || 10));
  const center = bboxCenter(bboxArray);
  const centerTileX = lngToTileX(center[0], zoom);
  const centerTileY = latToTileY(center[1], zoom);

  const selectedTiles = [...allTiles]
    .sort((a, b) => {
      const adx = a.x - centerTileX;
      const ady = a.y - centerTileY;
      const bdx = b.x - centerTileX;
      const bdy = b.y - centerTileY;
      return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
    })
    .slice(0, maxTiles);
  const merged = new Map();

  for (const tile of selectedTiles) {
    let tilePayload = null;
    try {
      tilePayload = await fetchRoutesVectorTile(tile.z, tile.x, tile.y, {
        forceRefresh: Boolean(options.forceRefresh),
        enforceDailyCap: Boolean(options.enforceDailyCap),
        requestSource: options.requestSource
      });
    } catch {
      continue;
    }

    for (const [routeKey, value] of Object.entries(tilePayload?.headwayByRouteKey || {})) {
      const headwaySeconds = Number(value?.headwaySeconds);
      if (!Number.isFinite(headwaySeconds) || headwaySeconds <= 0) {
        continue;
      }

      const routeType = Number(value?.routeType);
      if (allowedRouteTypes && Number.isFinite(routeType) && !allowedRouteTypes.has(routeType)) {
        continue;
      }

      const existing = merged.get(routeKey);
      if (!existing || headwaySeconds < existing.headwaySeconds) {
        merged.set(routeKey, {
          headwaySeconds,
          routeType: Number.isFinite(routeType) ? routeType : null
        });
      }
    }
  }

  const headwayByRouteKey = {};
  for (const [routeKey, value] of merged.entries()) {
    headwayByRouteKey[routeKey] = value.headwaySeconds;
  }

  return {
    headwayByRouteKey,
    tileCount: selectedTiles.length,
    omittedTileCount: Math.max(0, allTiles.length - selectedTiles.length),
    zoom
  };
}

module.exports = {
  clampNumber,
  lngToTileX,
  latToTileY,
  bboxCenter,
  inferVectorTileZoom,
  tilesForBbox,
  parseVectorTileRouteType,
  normalizeRouteLookupKey,
  routeLookupKeysFromObject,
  fetchRoutesVectorTile,
  fetchVectorRouteHeadwaysForBbox
};
