const { simplifyGeometryForZoom, resolveGeometryForZoom } = require("./geometry");
const db = require("../../processors/data");
const config = require("../../admin/config");

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

  const geometry = simplifyGeometryForZoom(route.geometry || null, options.zoom);
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
