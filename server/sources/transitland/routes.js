const config = require("../../admin/config");
const db = require("../../processors/data");
const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf").default;
const { geometryBbox } = require("../../processors/postgres/spatial");
const {
  sanitizeText,
  extractOperatorName,
  extractRouteMode,
  sanitizeColor,
  extractFeedId,
  normalizeRouteTypes
} = require("./helpers");
const {
  parseVectorTileHeadwaySeconds,
  isFallbackHeadwaySeconds,
  frequencyBucketFromHeadwayMinutes,
  fallbackFrequencyBucketForRoute
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

function normalizeRoute(route, index, options = {}) {
  const shortName = sanitizeText(route.route_short_name || route.short_name);
  const longName = sanitizeText(route.route_long_name || route.route_name || route.name);
  const operatorName = extractOperatorName(route);
  const mode = extractRouteMode(route);
  const routeOnestopId = sanitizeText(route.onestop_id);
  const parsedHeadwaySeconds = Number(route.headway_secs);
  const headwayFallback = isFallbackHeadwaySeconds(parsedHeadwaySeconds) ? 1 : 0;
  const headwaySeconds = Number.isFinite(parsedHeadwaySeconds) && parsedHeadwaySeconds > 0 && !headwayFallback
    ? Math.round(parsedHeadwaySeconds)
    : null;
  const frequencyBucket = headwayFallback
    ? fallbackFrequencyBucketForRoute(route)
    : headwaySeconds
      ? frequencyBucketFromHeadwayMinutes(headwaySeconds / 60)
      : "unknown";

  const lineKey =
    routeOnestopId ||
    route.id ||
    `${route.operator_onestop_id || operatorName || "operator"}:${shortName || longName || index}`;

  let lineName = shortName || longName || `Line ${index + 1}`;
  if (shortName && longName && !longName.toLowerCase().includes(shortName.toLowerCase())) {
    lineName = `${shortName} | ${longName}`;
  }

  const geometry = route.geometry || null;
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return null;
  }

  return {
    lineKey,
    routeOnestopId,
    lineName,
    lineShortName: shortName,
    lineLongName: longName,
    color: sanitizeColor(route.route_color, lineKey),
    operatorName,
    mode,
    routeType: Number.isFinite(Number(route.route_type)) ? Number(route.route_type) : null,
    routeFeedId: extractFeedId(route),
    headwaySeconds,
    headwaySource: sanitizeText(route.headway_source || (headwaySeconds ? "transitland-vector-tiles" : "")),
    headwayFallback,
    frequencyBucket,
    geometry,
    bbox: geometryBbox(geometry)
  };
}

function normalizeRoutes(rawRoutes, options = {}) {
  const unique = new Map();

  rawRoutes.forEach((route, index) => {
    const normalized = normalizeRoute(route, index, options);
    if (!normalized) {
      return;
    }

    if (!unique.has(normalized.lineKey)) {
      unique.set(normalized.lineKey, normalized);
      return;
    }

    const existing = unique.get(normalized.lineKey);
    if (!existing.lineShortName && normalized.lineShortName) {
      existing.lineShortName = normalized.lineShortName;
    }
    if (!existing.lineLongName && normalized.lineLongName) {
      existing.lineLongName = normalized.lineLongName;
    }
    if (!existing.operatorName && normalized.operatorName) {
      existing.operatorName = normalized.operatorName;
    }
    if (!existing.mode && normalized.mode) {
      existing.mode = normalized.mode;
    }
    if (!existing.routeOnestopId && normalized.routeOnestopId) {
      existing.routeOnestopId = normalized.routeOnestopId;
    }
    if (!existing.headwaySeconds && normalized.headwaySeconds) {
      existing.headwaySeconds = normalized.headwaySeconds;
      existing.headwaySource = normalized.headwaySource;
    }
  });

  return Array.from(unique.values());
}

function extractStopPoint(stop) {
  if (stop?.geometry?.type === "Point" && Array.isArray(stop.geometry.coordinates)) {
    return stop.geometry.coordinates;
  }

  if (stop?.location?.type === "Point" && Array.isArray(stop.location.coordinates)) {
    return stop.location.coordinates;
  }

  if (Number.isFinite(stop?.stop_lon) && Number.isFinite(stop?.stop_lat)) {
    return [Number(stop.stop_lon), Number(stop.stop_lat)];
  }

  if (Number.isFinite(stop?.lon) && Number.isFinite(stop?.lat)) {
    return [Number(stop.lon), Number(stop.lat)];
  }

  return null;
}

function extractStopLocationType(stop) {
  const locationType = Number(stop?.location_type);
  return Number.isFinite(locationType) ? locationType : 0;
}

function isRailLikeRouteType(routeType) {
  return routeType === 0 || routeType === 1 || routeType === 2 || routeType === 12;
}

function isBusLikeRouteType(routeType) {
  return routeType === 3 || routeType === 11;
}

function routeServiceTier(routeType) {
  if (isRailLikeRouteType(routeType)) {
    return "rail";
  }

  if (isBusLikeRouteType(routeType)) {
    return "bus";
  }

  if (routeType === 4 || routeType === 5 || routeType === 6 || routeType === 7) {
    return "special";
  }

  return "other";
}

function routeSortWeight(routeType) {
  const tier = routeServiceTier(routeType);
  if (tier === "rail") return 0;
  if (tier === "special") return 1;
  if (tier === "other") return 2;
  return 3;
}

function routeFeatureFromLine(line) {
  const frequencyBucket = sanitizeText(line?.frequencyBucket) || "unknown";
  const headwayBestMinutes = Number(line?.headwayBestMinutes);

  return {
    type: "Feature",
    geometry: line.geometry,
    properties: {
      line_key: line.lineKey,
      route_onestop_id: line.routeOnestopId,
      line_name: line.lineName,
      line_short_name: line.lineShortName,
      line_long_name: line.lineLongName,
      operator_name: line.operatorName,
      mode: line.mode,
      route_type: line.routeType,
      route_feed_id: line.routeFeedId,
      service_tier: routeServiceTier(line.routeType),
      frequency_bucket: frequencyBucket,
      headway_best_minutes: Number.isFinite(headwayBestMinutes)
        ? Number(headwayBestMinutes.toFixed(1))
        : null,
      headway_checked: Number(line?.headwayChecked || 0) === 1 ? 1 : 0,
      color: line.color
    }
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
  fetchVectorRouteHeadwaysForBbox,
  normalizeRoute,
  normalizeRoutes,
  extractStopPoint,
  extractStopLocationType,
  isRailLikeRouteType,
  isBusLikeRouteType,
  routeServiceTier,
  routeSortWeight,
  routeFeatureFromLine
};
