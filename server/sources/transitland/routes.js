const { geometryBbox } = require("../../processors/postgres/spatial");
const {
  sanitizeText,
  extractOperatorName,
  extractRouteMode,
  sanitizeColor,
  extractFeedId
} = require("./helpers");
const {
  isFallbackHeadwaySeconds,
  frequencyBucketFromHeadwayMinutes,
  fallbackFrequencyBucketForRoute
} = require("./headway");
const vectorTiles = require("./vector-tiles");

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
  ...vectorTiles,
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
