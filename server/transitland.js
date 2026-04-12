const config = require("./config");
const db = require("./db");
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
const TRANSIT_CACHE_PREFIX = "transit-v3:";

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
    if (zoom >= 13) return 0.01;
    if (zoom >= 11) return 0.02;
    if (zoom >= 9) return 0.03;
  }
  return Math.max(0.005, config.BBOX_DEFAULT_STEP_DEGREES);
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

async function transitlandRequest(path, params) {
  if (!config.TRANSITLAND_API_KEY) {
    throw new Error("Transitland API key is missing. Set TRANSITLAND_API_KEY in .env.");
  }

  const searchParams = new URLSearchParams({
    ...params,
    api_key: config.TRANSITLAND_API_KEY
  });

  const url = `${TRANSITLAND_BASE_URL}${path}?${searchParams.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Transitland request failed (${response.status}): ${detail.slice(0, 220)}`);
  }

  return response.json();
}

function normalizeRoute(route, index) {
  const shortName = sanitizeText(route.route_short_name || route.short_name);
  const longName = sanitizeText(route.route_long_name || route.route_name || route.name);
  const operatorName = extractOperatorName(route);
  const mode = extractRouteMode(route);

  const lineKey =
    route.onestop_id ||
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
    lineName,
    lineShortName: shortName,
    lineLongName: longName,
    color: sanitizeColor(route.route_color, lineKey),
    operatorName,
    mode,
    routeType: Number.isFinite(Number(route.route_type)) ? Number(route.route_type) : null,
    routeFeedId: extractFeedId(route),
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

function isRailLikeRouteType(routeType) {
  return routeType === 0 || routeType === 1 || routeType === 2 || routeType === 12;
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

async function fetchRoutesAndStopsForBbox(bboxArray) {
  const bbox = toBboxString(bboxArray);

  const [routesResponse, stopsResponse] = await Promise.all([
    transitlandRequest("/routes", {
      bbox,
      include_geometry: "true",
      limit: "450"
    }),
    transitlandRequest("/stops", {
      bbox,
      limit: "2400"
    })
  ]);

  return {
    routes: Array.isArray(routesResponse.routes) ? routesResponse.routes : [],
    stops: Array.isArray(stopsResponse.stops) ? stopsResponse.stops : []
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

function buildTransitPayload(area, rawRoutes, rawStops) {
  const normalizedRoutes = normalizeRoutes(rawRoutes);
  const routesByLineKey = new Map(normalizedRoutes.map((route) => [route.lineKey, route]));

  const routeFeatures = normalizedRoutes.map((route) => ({
    type: "Feature",
    geometry: route.geometry,
    properties: {
      line_key: route.lineKey,
      line_name: route.lineName,
      line_short_name: route.lineShortName,
      line_long_name: route.lineLongName,
      operator_name: route.operatorName,
      mode: route.mode,
      route_type: route.routeType,
      route_feed_id: route.routeFeedId,
      color: route.color
    }
  }));

  const assignedStops = [];

  for (const stop of rawStops) {
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
    .map((route) => ({
      lineKey: route.lineKey,
      lineName: route.lineName,
      lineShortName: route.lineShortName,
      lineLongName: route.lineLongName,
      operatorName: route.operatorName,
      mode: route.mode,
      routeType: route.routeType,
      routeFeedId: route.routeFeedId,
      color: route.color,
      stopCount: stopCountsByLine.get(route.lineKey) || 0
    }))
    .sort((a, b) => (a.lineShortName || a.lineName).localeCompare(b.lineShortName || b.lineName));

  return {
    area,
    city: area.kind === "city" ? area : null,
    fetchedAt: new Date().toISOString(),
    matchingStats: {
      routeCount: routeFeatures.length,
      assignedStops: assignedStops.length,
      lineDedupedStops: dedupedStops.length,
      centralizedStops: stopFeatures.length,
      dedupRadiusMeters: config.STOP_DEDUP_MAX_METERS,
      hubClusterRadiusMeters: config.STATION_HUB_MAX_METERS,
      hubSnapMaxMeters: config.STATION_HUB_SNAP_MAX_METERS,
      hubCount: new Set(hubStops.map((stop) => stop.hubKey)).size,
      feedMatchedAssignments: assignedStops.filter((stop) => stop.feedMatch === 1).length,
      fallbackAssignments: assignedStops.filter((stop) => stop.feedMatch !== 1).length
    },
    routesGeoJson: asFeatureCollection(routeFeatures),
    stopsGeoJson: asFeatureCollection(stopFeatures),
    lineSummaries
  };
}

async function getTransitForArea(area, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = `${TRANSIT_CACHE_PREFIX}${area.key}`;

  if (!forceRefresh) {
    const cached = db.getCache(cacheKey);
    if (cached) {
      return {
        payload: cached.payload,
        cacheStatus: "hit",
        cacheKey: area.key,
        cacheExpiresAt: cached.expiresAt
      };
    }
  }

  const { routes, stops } = await fetchRoutesAndStopsForBbox(area.bbox);
  const payload = buildTransitPayload(area, routes, stops);

  db.setCache(cacheKey, payload, config.TRANSIT_CACHE_TTL_HOURS * 3600);

  return {
    payload,
    cacheStatus: "miss",
    cacheKey: area.key
  };
}

async function getCityTransit(slug, options = {}) {
  const city = getCityBySlug(slug);
  if (!city) {
    return null;
  }

  const area = {
    key: `city:${city.slug}`,
    kind: "city",
    slug: city.slug,
    name: city.name,
    country: city.country,
    center: city.center,
    bbox: city.bbox
  };

  return getTransitForArea(area, options);
}

async function getBboxTransit(rawBbox, options = {}) {
  const zoom = Number(options.zoom);
  const bboxInfo = normalizeBboxForCache(rawBbox, zoom);

  const area = {
    key: bboxInfo.areaKey,
    kind: "bbox",
    name: "Visible Area",
    country: "",
    center: bboxCenter(bboxInfo.bbox),
    bbox: bboxInfo.bbox,
    snapStep: bboxInfo.step
  };

  const result = await getTransitForArea(area, options);
  return {
    ...result,
    normalizedBbox: bboxInfo.bbox,
    snapStep: bboxInfo.step
  };
}

module.exports = {
  getCityTransit,
  getBboxTransit,
  TRANSIT_CACHE_PREFIX
};
