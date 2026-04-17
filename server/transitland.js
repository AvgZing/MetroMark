const config = require("./config");
const db = require("./db");
const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf");
const { getCityBySlug } = require("./city-presets");
const {
  normalizeName,
  stableStationKey,
  distanceBetweenPointsMeters,
  geometryDistanceMeters,
  nearestPointOnGeometry,
  geometryBbox,
  pointInExpandedBbox
} = require("./spatial");

const TRANSITLAND_BASE_URL = "https://transit.land/api/v2/rest";
const TRANSITLAND_VECTOR_BASE_URL = "https://transit.land/api/v2/tiles";
const TRANSIT_CACHE_PREFIX = "transit-v3:";
const transitlandMetrics = {
  restApiRequestCount: 0,
  restApiRequestFailureCount: 0,
  vectorTileRequestCount: 0,
  vectorTileRequestFailureCount: 0,
  routingApiRequestCount: 0,
  routingApiRequestFailureCount: 0,
  lastRestRequestAt: "",
  lastVectorTileRequestAt: "",
  lastRoutingRequestAt: ""
};

const fallbackColors = [
  "#3f7cff",
  "#eb4f2d",
  "#0f9d58",
  "#f4b400",
  "#0b7285",
  "#912ca7",
  "#cd5c08",
  "#7d3c98"
];

function colorFromString(input) {
  const value = String(input || "line");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return fallbackColors[Math.abs(hash) % fallbackColors.length];
}

function sanitizeColor(rawColor, fallbackSeed) {
  const text = String(rawColor || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(text)) {
    return `#${text.toLowerCase()}`;
  }
  return colorFromString(fallbackSeed);
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function firstTruthy(values) {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return "";
}

function gtfsRouteTypeLabel(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "";
  }

  const map = {
    0: "Tram",
    1: "Subway",
    2: "Rail",
    3: "Bus",
    4: "Ferry",
    5: "Cable Tram",
    6: "Aerial",
    7: "Funicular",
    11: "Trolleybus",
    12: "Monorail"
  };

  return map[numeric] || "";
}

function extractOperatorName(route) {
  const operatorsArray = Array.isArray(route?.operators)
    ? route.operators
        .map((entry) => sanitizeText(entry?.name || entry?.operator_name))
        .filter(Boolean)
        .join(", ")
    : "";

  return firstTruthy([
    sanitizeText(route?.operator_name),
    sanitizeText(route?.operator?.name),
    sanitizeText(route?.agency?.agency_name),
    sanitizeText(route?.agency_name),
    sanitizeText(route?.operated_by_name),
    operatorsArray,
    sanitizeText(route?.operator_onestop_id)
  ]);
}

function extractFeedId(entity) {
  return sanitizeText(entity?.feed_version?.feed?.onestop_id || entity?.feed?.onestop_id);
}

function extractParentStopId(stop) {
  return sanitizeText(stop?.parent?.onestop_id || stop?.parent?.stop_id || stop?.parent_stop_id);
}

function extractParentStopName(stop) {
  return sanitizeText(stop?.parent?.stop_name || stop?.parent?.name);
}

function extractRouteMode(route) {
  return firstTruthy([
    sanitizeText(route?.route_type_name),
    gtfsRouteTypeLabel(route?.route_type)
  ]);
}

function canonicalStationName(name) {
  const normalized = normalizeName(name);
  if (!normalized) {
    return "station";
  }

  const trimmed = normalized
    .replace(/\b(station|stn|stop|platform|entrance|exit|transit center|transit ctr|tc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return trimmed || normalized;
}

function normalizeStopLocationTypes(rawValue) {
  const allowed = new Set([0, 1, 2, 3, 4]);

  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const parsed = source
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && allowed.has(entry));

  const uniqueSorted = Array.from(new Set(parsed)).sort((a, b) => a - b);
  return uniqueSorted.length ? uniqueSorted : [0, 1];
}

function normalizeRouteTypes(rawValue) {
  const allowed = new Set([0, 1, 2, 3, 4, 5, 6, 7, 11, 12]);

  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const parsed = source
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && allowed.has(entry));

  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function getTransitlandMetrics() {
  return {
    ...transitlandMetrics
  };
}

function parseBboxArray(rawBbox) {
  if (!Array.isArray(rawBbox) || rawBbox.length !== 4) {
    throw new Error("bbox must contain four comma-separated coordinates.");
  }

  const values = rawBbox.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("bbox includes invalid coordinates.");
  }

  const [west, south, east, north] = values;
  if (west >= east || south >= north) {
    throw new Error("bbox min values must be lower than max values.");
  }

  if (west < -180 || east > 180 || south < -85 || north > 85) {
    throw new Error("bbox coordinates are out of range.");
  }

  const width = east - west;
  const height = north - south;

  if (width > config.BBOX_MAX_SPAN_DEGREES || height > config.BBOX_MAX_SPAN_DEGREES) {
    throw new Error(
      `bbox span is too large. Zoom in so width/height are under ${config.BBOX_MAX_SPAN_DEGREES} degrees.`
    );
  }

  return [west, south, east, north];
}

function bboxStepFromZoom(zoom) {
  if (Number.isFinite(zoom)) {
    if (zoom >= 13) return 0.025;
    if (zoom >= 11) return 0.04;
    if (zoom >= 9) return 0.06;
    if (zoom >= 7) return 0.09;
    if (zoom >= 5) return 0.12;
  }
  return Math.max(0.06, config.BBOX_DEFAULT_STEP_DEGREES);
}

function snapBboxToGrid(bbox, step) {
  const [west, south, east, north] = bbox;
  const snappedWest = Math.floor(west / step) * step;
  const snappedSouth = Math.floor(south / step) * step;
  const snappedEast = Math.ceil(east / step) * step;
  const snappedNorth = Math.ceil(north / step) * step;

  return [
    Math.max(-180, snappedWest),
    Math.max(-85, snappedSouth),
    Math.min(180, snappedEast),
    Math.min(85, snappedNorth)
  ];
}

function normalizeBboxForCache(rawBbox, zoom) {
  const parsed = parseBboxArray(rawBbox);
  const step = bboxStepFromZoom(zoom);
  const snapped = snapBboxToGrid(parsed, step);
  const [west, south, east, north] = snapped;

  if (west >= east || south >= north) {
    throw new Error("bbox normalization failed. Try zooming in and loading again.");
  }

  const keyPart = snapped.map((value) => value.toFixed(4)).join(",");
  return {
    bbox: snapped,
    step,
    areaKey: `bbox:${step.toFixed(3)}:${keyPart}`
  };
}

function toBboxString(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function asFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function transitlandRequest(path, params) {
  if (!config.TRANSITLAND_API_KEY) {
    throw new Error("Transitland API key is missing. Set TRANSITLAND_API_KEY in .env.");
  }

  const searchParams = new URLSearchParams({
    ...params,
    api_key: config.TRANSITLAND_API_KEY
  });

  const url = `${TRANSITLAND_BASE_URL}${path}?${searchParams.toString()}`;
  const retries = Math.max(0, Number(config.TRANSITLAND_REQUEST_RETRIES || 0));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = Math.max(1500, Number(config.TRANSITLAND_REQUEST_TIMEOUT_MS || 15000));
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    transitlandMetrics.restApiRequestCount += 1;
    transitlandMetrics.lastRestRequestAt = new Date().toISOString();

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        transitlandMetrics.restApiRequestFailureCount += 1;

        if (retryable && attempt < retries) {
          await wait(280 * (attempt + 1));
          continue;
        }

        const requestError = new Error(
          `Transitland request failed (${response.status}): ${detail.slice(0, 220)}`
        );
        requestError.alreadyCounted = true;
        throw requestError;
      }

      return response.json();
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      if (!error?.alreadyCounted) {
        transitlandMetrics.restApiRequestFailureCount += 1;
      }

      if (timedOut && attempt < retries) {
        await wait(220 * (attempt + 1));
        continue;
      }

      if (timedOut) {
        throw new Error(`Transitland request timed out after ${timeoutMs}ms.`);
      }

      if (attempt < retries) {
        await wait(220 * (attempt + 1));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error("Transitland request failed after retries.");
}

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

function parseVectorTileHeadwaySeconds(properties) {
  const candidates = [
    properties?.headway_secs,
    properties?.headway_seconds,
    properties?.headway
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }

  return null;
}

function parseVectorTileRouteType(properties) {
  const value = Number(properties?.route_type ?? properties?.routeType);
  return Number.isFinite(value) ? value : null;
}

async function fetchRoutesVectorTile(z, x, y, options = {}) {
  const cacheKey = `${TRANSIT_CACHE_PREFIX}routes-tile:${z}:${x}:${y}`;
  if (!options.forceRefresh) {
    const cached = db.getCache(cacheKey);
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
  transitlandMetrics.vectorTileRequestCount += 1;
  transitlandMetrics.lastVectorTileRequestAt = new Date().toISOString();

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
    const headwayByOnestopId = {};

    if (layer && Number.isFinite(layer.length) && layer.length > 0) {
      for (let index = 0; index < layer.length; index += 1) {
        const feature = layer.feature(index);
        const properties = feature?.properties || {};
        const onestopId = sanitizeText(
          properties.onestop_id || properties.route_onestop_id || properties.route_id || properties.id
        );
        if (!onestopId) {
          continue;
        }

        const headwaySeconds = parseVectorTileHeadwaySeconds(properties);
        if (!headwaySeconds) {
          continue;
        }

        const routeType = parseVectorTileRouteType(properties);
        const existing = headwayByOnestopId[onestopId];
        if (!existing || headwaySeconds < existing.headwaySeconds) {
          headwayByOnestopId[onestopId] = {
            headwaySeconds,
            routeType
          };
        }
      }
    }

    const payload = {
      z,
      x,
      y,
      headwayByOnestopId,
      fetchedAt: new Date().toISOString()
    };

    const ttlHours = Math.max(1, Number(config.TRANSIT_CACHE_TTL_HOURS || 12));
    db.setCache(cacheKey, payload, ttlHours * 3600);
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
  const selectedTiles = allTiles.slice(0, maxTiles);
  const merged = new Map();

  for (const tile of selectedTiles) {
    let tilePayload = null;
    try {
      tilePayload = await fetchRoutesVectorTile(tile.z, tile.x, tile.y, {
        forceRefresh: Boolean(options.forceRefresh)
      });
    } catch {
      continue;
    }

    for (const [onestopId, value] of Object.entries(tilePayload?.headwayByOnestopId || {})) {
      const headwaySeconds = Number(value?.headwaySeconds);
      if (!Number.isFinite(headwaySeconds) || headwaySeconds <= 0) {
        continue;
      }

      const routeType = Number(value?.routeType);
      if (allowedRouteTypes && Number.isFinite(routeType) && !allowedRouteTypes.has(routeType)) {
        continue;
      }

      const existing = merged.get(onestopId);
      if (!existing || headwaySeconds < existing.headwaySeconds) {
        merged.set(onestopId, {
          headwaySeconds,
          routeType: Number.isFinite(routeType) ? routeType : null
        });
      }
    }
  }

  const headwayByOnestopId = {};
  for (const [onestopId, value] of merged.entries()) {
    headwayByOnestopId[onestopId] = value.headwaySeconds;
  }

  return {
    headwayByOnestopId,
    tileCount: selectedTiles.length,
    omittedTileCount: Math.max(0, allTiles.length - selectedTiles.length),
    zoom
  };
}

function normalizeRoute(route, index) {
  const shortName = sanitizeText(route.route_short_name || route.short_name);
  const longName = sanitizeText(route.route_long_name || route.route_name || route.name);
  const operatorName = extractOperatorName(route);
  const mode = extractRouteMode(route);
  const routeOnestopId = sanitizeText(route.onestop_id);
  const parsedHeadwaySeconds = Number(route.headway_secs);
  const headwaySeconds = Number.isFinite(parsedHeadwaySeconds) && parsedHeadwaySeconds > 0
    ? Math.round(parsedHeadwaySeconds)
    : null;

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
    geometry,
    bbox: geometryBbox(geometry)
  };
}

function normalizeRoutes(rawRoutes) {
  const unique = new Map();

  rawRoutes.forEach((route, index) => {
    const normalized = normalizeRoute(route, index);
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

function routeFrequencyBucket(routeType) {
  return "unknown";
}

function routeSortWeight(routeType) {
  const tier = routeServiceTier(routeType);
  if (tier === "rail") return 0;
  if (tier === "special") return 1;
  if (tier === "other") return 2;
  return 3;
}

function frequencyBucketFromHeadwayMinutes(minutes) {
  const numeric = Number(minutes);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "unknown";
  }

  if (numeric <= 10) {
    return "frequent";
  }

  if (numeric < 30) {
    return "regular";
  }

  return "local";
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlTags(text) {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseHeadwayCellMinutes(cellText) {
  const text = String(cellText || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!text || /\b(no service|none|n\/a)\b/.test(text)) {
    return null;
  }

  const hasTripWord = /\btrips?\b/.test(text);
  const minuteValues = [];

  const rangeRegex = /(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)(?:\s*(?:min|mins|minute|minutes))?/g;
  let rangeMatch = rangeRegex.exec(text);
  while (rangeMatch) {
    const low = Number(rangeMatch[1]);
    const high = Number(rangeMatch[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      minuteValues.push(Number(((low + high) / 2).toFixed(1)));
    }
    rangeMatch = rangeRegex.exec(text);
  }

  const explicitMinutesRegex = /(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/g;
  let minutesMatch = explicitMinutesRegex.exec(text);
  while (minutesMatch) {
    const value = Number(minutesMatch[1]);
    if (Number.isFinite(value)) {
      minuteValues.push(value);
    }
    minutesMatch = explicitMinutesRegex.exec(text);
  }

  const explicitHoursRegex = /(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/g;
  let hoursMatch = explicitHoursRegex.exec(text);
  while (hoursMatch) {
    const value = Number(hoursMatch[1]);
    if (Number.isFinite(value)) {
      minuteValues.push(Number((value * 60).toFixed(1)));
    }
    hoursMatch = explicitHoursRegex.exec(text);
  }

  const everyRegex = /every\s+(\d+(?:\.\d+)?)/g;
  let everyMatch = everyRegex.exec(text);
  while (everyMatch) {
    const value = Number(everyMatch[1]);
    if (Number.isFinite(value)) {
      minuteValues.push(value);
    }
    everyMatch = everyRegex.exec(text);
  }

  if (minuteValues.length) {
    return Number(Math.min(...minuteValues).toFixed(1));
  }

  if (hasTripWord) {
    return null;
  }

  const values = text
    .match(/\d+(?:\.\d+)?/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 5 && value <= 240);

  if (!values || !values.length) {
    return null;
  }

  if (values.length === 1) {
    return values[0];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  return Number(((min + max) / 2).toFixed(1));
}

function parseHeadwaySummaryFromRoutePageHtml(html) {
  const pageHtml = String(html || "");
  const tableMatch = pageHtml.match(/<table[^>]*>[\s\S]*?<th>[\s\S]*?Headways[\s\S]*?<\/th>[\s\S]*?<\/table>/i);
  const tableHtml = tableMatch ? tableMatch[0] : pageHtml;

  const rowRegex =
    /<tr>[\s\S]*?<td[^>]*>\s*(Weekday|Saturday|Sunday)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

  const windows = ["7-9am", "9am-4pm", "4-6pm", "6pm-7am"];
  const rows = {};
  const allMinutes = [];

  let match = rowRegex.exec(tableHtml);
  while (match) {
    const dayKey = String(match[1] || "").toLowerCase();
    const cellsRaw = [match[2], match[3], match[4], match[5]];

    const cells = cellsRaw.map((entry) => {
      const text = stripHtmlTags(entry);
      const minutes = parseHeadwayCellMinutes(text);
      if (Number.isFinite(minutes)) {
        allMinutes.push(minutes);
      }
      return {
        text,
        minutes
      };
    });

    rows[dayKey] = {
      label: stripHtmlTags(match[1]),
      cells
    };

    match = rowRegex.exec(tableHtml);
  }

  if (!Object.keys(rows).length) {
    return null;
  }

  const bestMinutes = allMinutes.length ? Math.min(...allMinutes) : null;

  return {
    source: "transitland-route-page",
    windows,
    rows,
    bestMinutes: Number.isFinite(bestMinutes) ? Number(bestMinutes.toFixed(1)) : null,
    frequencyBucket: frequencyBucketFromHeadwayMinutes(bestMinutes)
  };
}

async function fetchRouteHeadwaySummary(routeLookupKey, options = {}) {
  const key = sanitizeText(routeLookupKey);
  if (!key) {
    return null;
  }

  const cacheKey = `${TRANSIT_CACHE_PREFIX}headway:${key}`;
  if (!options.forceRefresh) {
    const cached = db.getCache(cacheKey);
    if (cached && cached.payload) {
      return cached.payload;
    }
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1500, Number(config.ROUTE_HEADWAY_TIMEOUT_MS || 9000));
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://www.transit.land/routes/${encodeURIComponent(key)}`, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MetroMark/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const summary = parseHeadwaySummaryFromRoutePageHtml(html);
    if (!summary) {
      return null;
    }

    const ttlHours = Math.max(1, Number(config.ROUTE_HEADWAY_CACHE_TTL_HOURS || 72));
    db.setCache(cacheKey, summary, ttlHours * 3600);
    return summary;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function inferStopModeHint(stopName) {
  const normalized = normalizeName(stopName);
  if (!normalized) {
    return "";
  }

  if (/\b(station|stn|subway|metro|lightrail|light rail|rail)\b/.test(normalized)) {
    return "rail";
  }

  if (/\b(bay|stop|bus|route|transit center|tc)\b/.test(normalized) || /&|\d{3,}/.test(stopName)) {
    return "bus";
  }

  return "";
}

function assignStopToClosestRoute(stopPoint, routes, stopContext = {}) {
  const stopFeedId = sanitizeText(stopContext.stopFeedId);
  const stopModeHint = inferStopModeHint(stopContext.stopName || "");
  const feedMatchedRoutes = stopFeedId
    ? routes.filter((route) => route.routeFeedId && route.routeFeedId === stopFeedId)
    : [];

  const candidateRoutes = feedMatchedRoutes.length > 0 ? feedMatchedRoutes : routes;
  const assignmentMethod = feedMatchedRoutes.length > 0 ? "feed+distance" : "distance-fallback";

  let bestRoute = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestRawDistance = Number.POSITIVE_INFINITY;

  for (const route of candidateRoutes) {
    if (!pointInExpandedBbox(stopPoint, route.bbox, config.STOP_ASSIGNMENT_MAX_METERS * 2)) {
      continue;
    }

    const baseDistance = geometryDistanceMeters(stopPoint, route.geometry);
    let scoredDistance = baseDistance;

    // Use a small mode-aware bias to reduce common rail-vs-bus misassignments in mixed feeds.
    if (stopModeHint === "rail" && route.routeType === 3) {
      scoredDistance += 55;
    }
    if (stopModeHint === "rail" && isRailLikeRouteType(route.routeType)) {
      scoredDistance -= 10;
    }
    if (stopModeHint === "bus" && isRailLikeRouteType(route.routeType)) {
      scoredDistance += 38;
    }

    if (scoredDistance < bestDistance) {
      bestDistance = scoredDistance;
      bestRawDistance = baseDistance;
      bestRoute = route;
    }
  }

  if (!bestRoute || bestRawDistance > config.STOP_ASSIGNMENT_MAX_METERS) {
    return null;
  }

  return {
    route: bestRoute,
    distanceMeters: Math.round(bestRawDistance),
    assignmentMethod,
    feedMatch: feedMatchedRoutes.length > 0 ? 1 : 0
  };
}

async function fetchRoutesAndStopsForBbox(bboxArray, options = {}) {
  const bbox = toBboxString(bboxArray);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const allowedRouteTypes = new Set(routeTypes);
  const lonSpan = Math.max(0, Number(bboxArray[2]) - Number(bboxArray[0]));
  const latSpan = Math.max(0, Number(bboxArray[3]) - Number(bboxArray[1]));
  const span = Math.max(lonSpan, latSpan);

  let routeLimit = Math.max(80, Number(config.ROUTE_CATALOG_MAX_RESULTS || 220));

  if (span > 1.6) {
    routeLimit = Math.max(80, Math.round(routeLimit * 0.55));
  } else if (span > 1.2) {
    routeLimit = Math.max(90, Math.round(routeLimit * 0.68));
  } else if (span > 0.8) {
    routeLimit = Math.max(100, Math.round(routeLimit * 0.82));
  }

  const routeParams = {
    bbox,
    include_geometry: "true",
    limit: String(routeLimit)
  };

  if (routeTypes.length) {
    routeParams.route_types = routeTypes.join(",");
  }

  const routesResponse = await transitlandRequest("/routes", routeParams);
  const fetchedRoutes = Array.isArray(routesResponse.routes) ? routesResponse.routes : [];
  const filteredRoutes = routeTypes.length
    ? fetchedRoutes.filter((route) => allowedRouteTypes.has(Number(route?.route_type)))
    : fetchedRoutes;

  const vectorHeadways = await fetchVectorRouteHeadwaysForBbox(bboxArray, {
    routeTypes,
    zoom: options.zoom,
    forceRefresh: options.forceRefresh
  });

  const headwayByOnestopId = vectorHeadways.headwayByOnestopId || {};
  for (const route of filteredRoutes) {
    const routeOnestopId = sanitizeText(route?.onestop_id);
    if (!routeOnestopId) {
      continue;
    }

    const vectorHeadwaySeconds = Number(headwayByOnestopId[routeOnestopId]);
    if (Number.isFinite(vectorHeadwaySeconds) && vectorHeadwaySeconds > 0) {
      route.headway_secs = Math.round(vectorHeadwaySeconds);
      route.headway_source = "transitland-vector-tiles";
    }
  }

  return {
    routes: filteredRoutes,
    stops: [],
    vectorHeadwayMeta: {
      tileCount: vectorHeadways.tileCount,
      omittedTileCount: vectorHeadways.omittedTileCount,
      zoom: vectorHeadways.zoom
    }
  };
}

function applyStopOverride(stationKey, stationName, lon, lat) {
  const override = db.getStationOverride(stationKey);
  if (!override) {
    return {
      stationName,
      lon,
      lat
    };
  }

  return {
    stationName: override.manualName || stationName,
    lon: Number.isFinite(override.manualLon) ? override.manualLon : lon,
    lat: Number.isFinite(override.manualLat) ? override.manualLat : lat
  };
}

function deduplicateStopsByLineAndName(stops) {
  const groups = new Map();

  for (const stop of stops) {
    const key = `${stop.lineKey}|${stop.dedupSeed || stop.normalizedName}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(stop);
  }

  const deduped = [];

  for (const groupStops of groups.values()) {
    const clusters = [];

    for (const stop of groupStops) {
      let closest = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const cluster of clusters) {
        const distance = distanceBetweenPointsMeters(stop.point, [cluster.lon, cluster.lat]);
        if (distance <= config.STOP_DEDUP_MAX_METERS && distance < closestDistance) {
          closest = cluster;
          closestDistance = distance;
        }
      }

      if (!closest) {
        clusters.push({
          lineKey: stop.lineKey,
          lineName: stop.lineName,
          lineShortName: stop.lineShortName,
          lineLongName: stop.lineLongName,
          operatorName: stop.operatorName,
          mode: stop.mode,
          routeType: stop.routeType,
          routeFeedId: stop.routeFeedId,
          stopFeedId: stop.stopFeedId,
          stopLocationType: stop.stopLocationType,
          assignmentMethod: stop.assignmentMethod,
          feedMatchCount: stop.feedMatch ? 1 : 0,
          fallbackCount: stop.feedMatch ? 0 : 1,
          stationName: stop.stationName,
          normalizedName: stop.normalizedName,
          hubName: stop.hubName,
          parentStopId: stop.parentStopId,
          lon: stop.point[0],
          lat: stop.point[1],
          sourceStopIds: stop.sourceStopId ? [stop.sourceStopId] : [],
          pointCount: 1,
          minDistanceMeters: stop.distanceMeters
        });
        continue;
      }

      const nextCount = closest.pointCount + 1;
      closest.lon = (closest.lon * closest.pointCount + stop.point[0]) / nextCount;
      closest.lat = (closest.lat * closest.pointCount + stop.point[1]) / nextCount;
      closest.pointCount = nextCount;
      closest.minDistanceMeters = Math.min(closest.minDistanceMeters, stop.distanceMeters);

      closest.feedMatchCount += stop.feedMatch ? 1 : 0;
      closest.fallbackCount += stop.feedMatch ? 0 : 1;

      if (!closest.stopFeedId && stop.stopFeedId) {
        closest.stopFeedId = stop.stopFeedId;
      }
      if (!closest.routeFeedId && stop.routeFeedId) {
        closest.routeFeedId = stop.routeFeedId;
      }
      if (!Number.isFinite(closest.stopLocationType) && Number.isFinite(stop.stopLocationType)) {
        closest.stopLocationType = stop.stopLocationType;
      }
      if (!closest.parentStopId && stop.parentStopId) {
        closest.parentStopId = stop.parentStopId;
      }

      if (stop.sourceStopId) {
        closest.sourceStopIds.push(stop.sourceStopId);
      }
    }

    deduped.push(...clusters);
  }

  return deduped;
}

function buildStationHubs(stops, routesByLineKey) {
  const groups = new Map();

  for (const stop of stops) {
    const key = stop.hubName || stop.normalizedName || "station";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(stop);
  }

  const hubStops = [];

  for (const groupStops of groups.values()) {
    const clusters = [];

    for (const stop of groupStops) {
      let closestCluster = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (const cluster of clusters) {
        const distance = distanceBetweenPointsMeters([stop.lon, stop.lat], [cluster.lon, cluster.lat]);
        if (distance <= config.STATION_HUB_MAX_METERS && distance < closestDistance) {
          closestCluster = cluster;
          closestDistance = distance;
        }
      }

      if (!closestCluster) {
        clusters.push({
          hubName: stop.hubName || stop.normalizedName || "station",
          lon: stop.lon,
          lat: stop.lat,
          members: [stop]
        });
        continue;
      }

      const nextCount = closestCluster.members.length + 1;
      closestCluster.lon = (closestCluster.lon * closestCluster.members.length + stop.lon) / nextCount;
      closestCluster.lat = (closestCluster.lat * closestCluster.members.length + stop.lat) / nextCount;
      closestCluster.members.push(stop);
    }

    for (const cluster of clusters) {
      const centroid = [cluster.lon, cluster.lat];

      let bestSnapPoint = centroid;
      let bestSnapDistance = Number.POSITIVE_INFINITY;

      for (const member of cluster.members) {
        const route = routesByLineKey.get(member.lineKey);
        if (!route) {
          continue;
        }

        const candidate = nearestPointOnGeometry(centroid, route.geometry);
        if (candidate.distanceMeters < bestSnapDistance) {
          bestSnapDistance = candidate.distanceMeters;
          bestSnapPoint = candidate.point;
        }
      }

      const useSnappedPoint = bestSnapDistance <= config.STATION_HUB_SNAP_MAX_METERS;
      const hubPoint = useSnappedPoint ? bestSnapPoint : centroid;

      let spreadMeters = 0;
      for (const member of cluster.members) {
        const distance = distanceBetweenPointsMeters([member.lon, member.lat], hubPoint);
        if (distance > spreadMeters) {
          spreadMeters = distance;
        }
      }

      const hubKey = stableStationKey(cluster.hubName, hubPoint[0], hubPoint[1]);
      const centralizationMethod = useSnappedPoint ? "snapped-to-route" : "centroid";

      for (const member of cluster.members) {
        hubStops.push({
          ...member,
          hubKey,
          hubLon: hubPoint[0],
          hubLat: hubPoint[1],
          hubSpreadMeters: Math.round(spreadMeters),
          hubMemberCount: cluster.members.length,
          centralizationMethod
        });
      }
    }
  }

  return hubStops;
}

function buildTransitPayload(area, rawRoutes, rawStops, options = {}) {
  const normalizedRoutes = normalizeRoutes(rawRoutes);
  const routesByLineKey = new Map(normalizedRoutes.map((route) => [route.lineKey, route]));
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const allowedStopLocationTypes = new Set(stopLocationTypes);
  const vectorHeadwayMeta = options.vectorHeadwayMeta || {};

  const routeFeatures = normalizedRoutes.map((route) => {
    const headwayBestMinutes = Number.isFinite(route.headwaySeconds)
      ? Number((route.headwaySeconds / 60).toFixed(1))
      : null;
    const frequencyBucket = Number.isFinite(headwayBestMinutes)
      ? frequencyBucketFromHeadwayMinutes(headwayBestMinutes)
      : "unknown";

    return {
      type: "Feature",
      geometry: route.geometry,
      properties: {
        line_key: route.lineKey,
        route_onestop_id: route.routeOnestopId,
        line_name: route.lineName,
        line_short_name: route.lineShortName,
        line_long_name: route.lineLongName,
        operator_name: route.operatorName,
        mode: route.mode,
        route_type: route.routeType,
        route_feed_id: route.routeFeedId,
        service_tier: routeServiceTier(route.routeType),
        frequency_bucket: frequencyBucket,
        headway_best_minutes: headwayBestMinutes,
        headway_checked: Number.isFinite(headwayBestMinutes) ? 1 : 0,
        color: route.color
      }
    };
  });

  const assignedStops = [];

  for (const stop of rawStops) {
    const stopLocationType = extractStopLocationType(stop);
    if (!allowedStopLocationTypes.has(stopLocationType)) {
      continue;
    }

    const stopPoint = extractStopPoint(stop);
    if (!stopPoint) {
      continue;
    }

    const stopFeedId = extractFeedId(stop);
    const parentStopId = extractParentStopId(stop);
    const parentStopName = extractParentStopName(stop);
    const stationNameHint = parentStopName || sanitizeText(stop.stop_name || stop.name) || "";

    const assignment = assignStopToClosestRoute(stopPoint, normalizedRoutes, {
      stopFeedId,
      stopName: stationNameHint
    });
    if (!assignment) {
      continue;
    }

    const stationName = stationNameHint || "Unnamed Stop";
    const normalizedStationName = normalizeName(stationName) || "station";

    assignedStops.push({
      lineKey: assignment.route.lineKey,
      lineName: assignment.route.lineName,
      lineShortName: assignment.route.lineShortName,
      lineLongName: assignment.route.lineLongName,
      operatorName: assignment.route.operatorName,
      mode: assignment.route.mode,
      routeType: assignment.route.routeType,
      routeFeedId: assignment.route.routeFeedId,
      stopFeedId,
      stopLocationType,
      assignmentMethod: assignment.assignmentMethod,
      feedMatch: assignment.feedMatch,
      stationName,
      normalizedName: normalizedStationName,
      hubName: canonicalStationName(stationName),
      parentStopId,
      dedupSeed: parentStopId || normalizedStationName,
      point: stopPoint,
      sourceStopId: sanitizeText(stop.onestop_id || stop.id),
      distanceMeters: assignment.distanceMeters
    });
  }

  const dedupedStops = deduplicateStopsByLineAndName(assignedStops);
  const hubStops = buildStationHubs(dedupedStops, routesByLineKey);

  const stopFeatures = [];
  const stopCountsByLine = new Map();

  for (const stop of hubStops) {
    const stationKey = stableStationKey(stop.stationName, stop.hubLon, stop.hubLat);
    const overridden = applyStopOverride(stationKey, stop.stationName, stop.hubLon, stop.hubLat);

    for (const sourceStopId of stop.sourceStopIds) {
      db.upsertStopTranslation(sourceStopId, stationKey, "transitland");
    }

    stopFeatures.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [overridden.lon, overridden.lat]
      },
      properties: {
        station_key: stationKey,
        line_key: stop.lineKey,
        line_name: stop.lineName,
        line_short_name: stop.lineShortName,
        line_long_name: stop.lineLongName,
        operator_name: stop.operatorName,
        mode: stop.mode,
        route_type: stop.routeType,
        route_feed_id: stop.routeFeedId,
        stop_feed_id: stop.stopFeedId,
        stop_location_type: stop.stopLocationType,
        assignment_method: stop.feedMatchCount > 0 ? "feed+distance" : "distance-fallback",
        feed_match: stop.feedMatchCount > 0 ? 1 : 0,
        station_name: overridden.stationName,
        hub_key: stop.hubKey,
        hub_member_count: stop.hubMemberCount,
        hub_spread_m: stop.hubSpreadMeters,
        centralization_method: stop.centralizationMethod,
        source_count: stop.pointCount,
        distance_m: Math.round(stop.minDistanceMeters),
        source_sample_id: stop.sourceStopIds[0] || null
      }
    });

    const currentCount = stopCountsByLine.get(stop.lineKey) || 0;
    stopCountsByLine.set(stop.lineKey, currentCount + 1);
  }

  const lineSummaries = normalizedRoutes
    .map((route) => {
      const headwayBestMinutes = Number.isFinite(route.headwaySeconds)
        ? Number((route.headwaySeconds / 60).toFixed(1))
        : null;
      const frequencyBucket = Number.isFinite(headwayBestMinutes)
        ? frequencyBucketFromHeadwayMinutes(headwayBestMinutes)
        : "unknown";

      return {
        lineKey: route.lineKey,
        routeOnestopId: route.routeOnestopId,
        lineName: route.lineName,
        lineShortName: route.lineShortName,
        lineLongName: route.lineLongName,
        operatorName: route.operatorName,
        mode: route.mode,
        routeType: route.routeType,
        routeFeedId: route.routeFeedId,
        serviceTier: routeServiceTier(route.routeType),
        frequencyBucket,
        headwayBestMinutes,
        headwaySource: route.headwaySource || "",
        headwayChecked: Number.isFinite(headwayBestMinutes) ? 1 : 0,
        color: route.color,
        stopCount: stopCountsByLine.get(route.lineKey) || 0
      };
    })
    .sort((a, b) => {
      const tierDiff = routeSortWeight(a.routeType) - routeSortWeight(b.routeType);
      if (tierDiff !== 0) {
        return tierDiff;
      }
      return (a.lineShortName || a.lineName).localeCompare(b.lineShortName || b.lineName);
    });

  return {
    area,
    city: area.kind === "city" ? area : null,
    fetchedAt: new Date().toISOString(),
    fetchStrategy: rawStops.length > 0 ? "bbox-stop-assignment" : "route-first-catalog",
    stopLocationTypes,
    matchingStats: {
      routeCount: routeFeatures.length,
      assignedStops: assignedStops.length,
      lineDedupedStops: dedupedStops.length,
      centralizedStops: stopFeatures.length,
      stopLocationTypes,
      dedupRadiusMeters: config.STOP_DEDUP_MAX_METERS,
      hubClusterRadiusMeters: config.STATION_HUB_MAX_METERS,
      hubSnapMaxMeters: config.STATION_HUB_SNAP_MAX_METERS,
      hubCount: new Set(hubStops.map((stop) => stop.hubKey)).size,
      routeTypes,
      feedMatchedAssignments: assignedStops.filter((stop) => stop.feedMatch === 1).length,
      fallbackAssignments: assignedStops.filter((stop) => stop.feedMatch !== 1).length,
      fetchStrategy: rawStops.length > 0 ? "bbox-stop-assignment" : "route-first-catalog",
      vectorHeadwayTileCount: Number(vectorHeadwayMeta.tileCount || 0),
      vectorHeadwayOmittedTileCount: Number(vectorHeadwayMeta.omittedTileCount || 0),
      vectorHeadwayZoom: Number.isFinite(Number(vectorHeadwayMeta.zoom))
        ? Number(vectorHeadwayMeta.zoom)
        : null
    },
    routesGeoJson: asFeatureCollection(routeFeatures),
    stopsGeoJson: asFeatureCollection(stopFeatures),
    lineSummaries
  };
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

async function fetchRouteByLineKey(lineKey) {
  const response = await transitlandRequest("/routes", {
    onestop_id: lineKey,
    include_geometry: "true",
    limit: "1"
  });

  let normalized = normalizeRoutes(Array.isArray(response.routes) ? response.routes : []);
  if (normalized[0]) {
    return normalized[0];
  }

  try {
    const fallbackResponse = await transitlandRequest(`/routes/${encodeURIComponent(lineKey)}`, {
      include_geometry: "true"
    });

    if (fallbackResponse?.route) {
      normalized = normalizeRoutes([fallbackResponse.route]);
      return normalized[0] || null;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchStopsForRoute(lineKey) {
  const pageLimit = Math.max(20, Math.min(config.ROUTE_STOP_PAGE_LIMIT, 500));
  const maxResults = Math.max(pageLimit, Math.min(config.ROUTE_STOP_MAX_RESULTS, 5000));

  const stops = [];
  let afterCursor = null;
  let truncated = false;

  while (stops.length < maxResults) {
    const params = {
      served_by_onestop_ids: lineKey,
      limit: String(pageLimit)
    };

    if (Number.isFinite(afterCursor)) {
      params.after = String(afterCursor);
    }

    const response = await transitlandRequest("/stops", params);
    const pageStops = Array.isArray(response.stops) ? response.stops : [];

    for (const stop of pageStops) {
      if (stops.length >= maxResults) {
        truncated = true;
        break;
      }
      stops.push(stop);
    }

    const nextAfter = Number(response?.meta?.after);
    const hasNext = Boolean(response?.meta?.next) && Number.isFinite(nextAfter);
    if (!hasNext || pageStops.length === 0 || truncated) {
      break;
    }

    afterCursor = nextAfter;
  }

  return {
    stops,
    truncated
  };
}

function buildRouteStopsPayload(line, rawStops, options = {}) {
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const allowedStopLocationTypes = new Set(stopLocationTypes);
  const headwaySummary = options.headwaySummary || null;
  const headwayBestMinutes = Number(headwaySummary?.bestMinutes);
  const normalizedHeadwayBestMinutes = Number.isFinite(headwayBestMinutes)
    ? Number(headwayBestMinutes.toFixed(1))
    : null;
  const frequencyBucket = normalizedHeadwayBestMinutes
    ? frequencyBucketFromHeadwayMinutes(normalizedHeadwayBestMinutes)
    : "unknown";

  const routeStops = [];

  for (const stop of rawStops) {
    const stopLocationType = extractStopLocationType(stop);
    if (!allowedStopLocationTypes.has(stopLocationType)) {
      continue;
    }

    const stopPoint = extractStopPoint(stop);
    if (!stopPoint) {
      continue;
    }

    const parentStopId = extractParentStopId(stop);
    const parentStopName = extractParentStopName(stop);
    const stationName =
      parentStopName || sanitizeText(stop.stop_name || stop.name || stop.stop_id) || "Unnamed Stop";
    const normalizedStationName = normalizeName(stationName) || "station";

    routeStops.push({
      lineKey: line.lineKey,
      lineName: line.lineName,
      lineShortName: line.lineShortName,
      lineLongName: line.lineLongName,
      operatorName: line.operatorName,
      mode: line.mode,
      routeType: line.routeType,
      routeFeedId: line.routeFeedId,
      stopFeedId: extractFeedId(stop),
      stopLocationType,
      assignmentMethod: "route-membership",
      feedMatch: 1,
      stationName,
      normalizedName: normalizedStationName,
      hubName: canonicalStationName(stationName),
      parentStopId,
      dedupSeed: parentStopId || normalizedStationName,
      point: stopPoint,
      sourceStopId: sanitizeText(stop.onestop_id || stop.id),
      distanceMeters: 0
    });
  }

  const dedupedStops = deduplicateStopsByLineAndName(routeStops);
  const hubStops = buildStationHubs(dedupedStops, new Map([[line.lineKey, line]]));

  const stopFeatures = [];
  for (const stop of hubStops) {
    const stationKey = stableStationKey(stop.stationName, stop.hubLon, stop.hubLat);
    const overridden = applyStopOverride(stationKey, stop.stationName, stop.hubLon, stop.hubLat);

    for (const sourceStopId of stop.sourceStopIds) {
      db.upsertStopTranslation(sourceStopId, stationKey, "transitland");
    }

    stopFeatures.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [overridden.lon, overridden.lat]
      },
      properties: {
        station_key: stationKey,
        line_key: stop.lineKey,
        line_name: stop.lineName,
        line_short_name: stop.lineShortName,
        line_long_name: stop.lineLongName,
        operator_name: stop.operatorName,
        mode: stop.mode,
        route_type: stop.routeType,
        route_feed_id: stop.routeFeedId,
        stop_feed_id: stop.stopFeedId,
        stop_location_type: stop.stopLocationType,
        assignment_method: "route-membership",
        feed_match: 1,
        station_name: overridden.stationName,
        hub_key: stop.hubKey,
        hub_member_count: stop.hubMemberCount,
        hub_spread_m: stop.hubSpreadMeters,
        centralization_method: stop.centralizationMethod,
        source_count: stop.pointCount,
        distance_m: 0,
        source_sample_id: stop.sourceStopIds[0] || null
      }
    });
  }

  const lineSummary = {
    lineKey: line.lineKey,
    routeOnestopId: line.routeOnestopId,
    lineName: line.lineName,
    lineShortName: line.lineShortName,
    lineLongName: line.lineLongName,
    operatorName: line.operatorName,
    mode: line.mode,
    routeType: line.routeType,
    routeFeedId: line.routeFeedId,
    serviceTier: routeServiceTier(line.routeType),
    frequencyBucket,
    headwayBestMinutes: normalizedHeadwayBestMinutes,
    headwaySource: headwaySummary?.source || "",
    headwayChecked: headwaySummary ? 1 : 0,
    color: line.color,
    stopCount: stopFeatures.length
  };

  return {
    fetchedAt: new Date().toISOString(),
    fetchStrategy: "route-first-membership",
    stopLocationTypes,
    matchingStats: {
      routeCount: 1,
      assignedStops: routeStops.length,
      lineDedupedStops: dedupedStops.length,
      centralizedStops: stopFeatures.length,
      stopLocationTypes,
      dedupRadiusMeters: config.STOP_DEDUP_MAX_METERS,
      hubClusterRadiusMeters: config.STATION_HUB_MAX_METERS,
      hubSnapMaxMeters: config.STATION_HUB_SNAP_MAX_METERS,
      hubCount: new Set(hubStops.map((stop) => stop.hubKey)).size,
      fetchStrategy: "route-first-membership",
      headwaySource: headwaySummary?.source || "",
      sourceStopsTruncated: options.sourceStopsTruncated ? 1 : 0
    },
    headwaySummary,
    routesGeoJson: asFeatureCollection([
      routeFeatureFromLine({
        ...line,
        frequencyBucket,
        headwayBestMinutes: normalizedHeadwayBestMinutes
      })
    ]),
    stopsGeoJson: asFeatureCollection(stopFeatures),
    lineSummaries: [lineSummary]
  };
}

async function getRouteStopsTransit(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const stopTypeKey = stopLocationTypes.join("-");
  const cacheKey = `${TRANSIT_CACHE_PREFIX}route:${normalizedLineKey}:types:${stopTypeKey}`;

  if (!forceRefresh) {
    const cached = db.getCache(cacheKey);
    if (cached) {
      return {
        payload: cached.payload,
        cacheStatus: "hit",
        cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
        cacheExpiresAt: cached.expiresAt,
        stopLocationTypes
      };
    }
  }

  const line = await fetchRouteByLineKey(normalizedLineKey);
  if (!line) {
    throw new Error(`No route found for ${normalizedLineKey}.`);
  }

  const membershipRouteKey = sanitizeText(line.routeOnestopId || normalizedLineKey);
  const routeStops = await fetchStopsForRoute(membershipRouteKey);
  const payload = buildRouteStopsPayload(line, routeStops.stops, {
    stopLocationTypes,
    sourceStopsTruncated: routeStops.truncated
  });

  db.setCache(cacheKey, payload, config.TRANSIT_CACHE_TTL_HOURS * 3600);

  return {
    payload,
    cacheStatus: "miss",
    cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
    stopLocationTypes
  };
}

async function getRouteHeadway(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  const line = await fetchRouteByLineKey(normalizedLineKey);
  if (!line) {
    throw new Error(`No route found for ${normalizedLineKey}.`);
  }

  const lookupKey = sanitizeText(line.routeOnestopId || normalizedLineKey);
  const bbox = Array.isArray(line.bbox) && line.bbox.length === 4 ? line.bbox : null;
  let summary = null;
  let normalizedBestMinutes = null;

  if (bbox) {
    const vectorHeadways = await fetchVectorRouteHeadwaysForBbox(bbox, {
      routeTypes: Number.isFinite(line.routeType) ? [line.routeType] : [],
      zoom: options.zoom,
      forceRefresh: Boolean(options.forceRefresh)
    });

    const headwaySeconds = Number(vectorHeadways?.headwayByOnestopId?.[lookupKey]);
    if (Number.isFinite(headwaySeconds) && headwaySeconds > 0) {
      normalizedBestMinutes = Number((headwaySeconds / 60).toFixed(1));
      summary = {
        source: "transitland-vector-tiles",
        headwaySeconds,
        bestMinutes: normalizedBestMinutes,
        frequencyBucket: frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
      };
    }
  }

  return {
    lineKey: normalizedLineKey,
    routeOnestopId: lookupKey,
    headwaySummary: summary,
    headwayBestMinutes: normalizedBestMinutes,
    headwaySource: summary?.source || "",
    headwayChecked: summary ? 1 : 0,
    frequencyBucket: normalizedBestMinutes
      ? frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
      : "unknown"
  };
}

async function getTransitForArea(area, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = `${TRANSIT_CACHE_PREFIX}${area.key}`;
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes || area.routeTypes);

  if (!forceRefresh) {
    const cached = db.getCache(cacheKey);
    if (cached) {
      return {
        payload: cached.payload,
        cacheStatus: "hit",
        cacheKey: area.key,
        cacheExpiresAt: cached.expiresAt,
        stopLocationTypes
      };
    }
  }

  const { routes, stops, vectorHeadwayMeta } = await fetchRoutesAndStopsForBbox(area.bbox, {
    routeTypes,
    zoom: options.zoom,
    forceRefresh
  });
  const payload = buildTransitPayload(area, routes, stops, {
    stopLocationTypes,
    routeTypes,
    vectorHeadwayMeta
  });

  db.setCache(cacheKey, payload, config.TRANSIT_CACHE_TTL_HOURS * 3600);

  return {
    payload,
    cacheStatus: "miss",
    cacheKey: area.key,
    stopLocationTypes
  };
}

async function getCityTransit(slug, options = {}) {
  const city = getCityBySlug(slug);
  if (!city) {
    return null;
  }

  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const routeTypeKey = routeTypes.length ? routeTypes.join("-") : "all";

  const area = {
    key: `city:${city.slug}:route-catalog:route-types:${routeTypeKey}`,
    kind: "city",
    slug: city.slug,
    name: city.name,
    country: city.country,
    center: city.center,
    bbox: city.bbox,
    routeTypes
  };

  return getTransitForArea(area, {
    ...options,
    stopLocationTypes,
    routeTypes
  });
}

async function getBboxTransit(rawBbox, options = {}) {
  const zoom = Number(options.zoom);
  const bboxInfo = normalizeBboxForCache(rawBbox, zoom);
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const routeTypeKey = routeTypes.length ? routeTypes.join("-") : "all";

  const area = {
    key: `${bboxInfo.areaKey}:route-catalog:route-types:${routeTypeKey}`,
    kind: "bbox",
    name: "Visible Area",
    country: "",
    center: bboxCenter(bboxInfo.bbox),
    bbox: bboxInfo.bbox,
    snapStep: bboxInfo.step,
    routeTypes
  };

  const result = await getTransitForArea(area, {
    ...options,
    stopLocationTypes,
    routeTypes
  });
  return {
    ...result,
    normalizedBbox: bboxInfo.bbox,
    snapStep: bboxInfo.step,
    stopLocationTypes,
    routeTypes
  };
}

module.exports = {
  getCityTransit,
  getBboxTransit,
  getRouteStopsTransit,
  getRouteHeadway,
  getTransitlandMetrics,
  TRANSIT_CACHE_PREFIX
};
