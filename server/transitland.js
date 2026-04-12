const config = require("./config");
const db = require("./db");
const { getCityBySlug } = require("./city-presets");
const {
  normalizeName,
  stableStationKey,
  distanceBetweenPointsMeters,
  geometryDistanceMeters,
  geometryBbox,
  pointInExpandedBbox
} = require("./spatial");

const TRANSITLAND_BASE_URL = "https://transit.land/api/v2/rest";
const TRANSIT_CACHE_PREFIX = "transit-v2:";

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
    sanitizeText(route?.agency_name),
    sanitizeText(route?.operated_by_name),
    operatorsArray,
    sanitizeText(route?.operator_onestop_id)
  ]);
}

function extractRouteMode(route) {
  return firstTruthy([
    sanitizeText(route?.route_type_name),
    gtfsRouteTypeLabel(route?.route_type)
  ]);
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

function assignStopToClosestRoute(stopPoint, routes) {
  let bestRoute = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const route of routes) {
    if (!pointInExpandedBbox(stopPoint, route.bbox, config.STOP_ASSIGNMENT_MAX_METERS * 2)) {
      continue;
    }

    const distance = geometryDistanceMeters(stopPoint, route.geometry);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRoute = route;
    }
  }

  if (!bestRoute || bestDistance > config.STOP_ASSIGNMENT_MAX_METERS) {
    return null;
  }

  return {
    route: bestRoute,
    distanceMeters: Math.round(bestDistance)
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
    const key = `${stop.lineKey}|${stop.normalizedName}`;
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
          stationName: stop.stationName,
          normalizedName: stop.normalizedName,
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

      if (stop.sourceStopId) {
        closest.sourceStopIds.push(stop.sourceStopId);
      }
    }

    deduped.push(...clusters);
  }

  return deduped;
}

function buildTransitPayload(area, rawRoutes, rawStops) {
  const normalizedRoutes = normalizeRoutes(rawRoutes);

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
      color: route.color
    }
  }));

  const assignedStops = [];

  for (const stop of rawStops) {
    const stopPoint = extractStopPoint(stop);
    if (!stopPoint) {
      continue;
    }

    const assignment = assignStopToClosestRoute(stopPoint, normalizedRoutes);
    if (!assignment) {
      continue;
    }

    const stationName = sanitizeText(stop.stop_name || stop.name) || "Unnamed Stop";
    assignedStops.push({
      lineKey: assignment.route.lineKey,
      lineName: assignment.route.lineName,
      lineShortName: assignment.route.lineShortName,
      lineLongName: assignment.route.lineLongName,
      operatorName: assignment.route.operatorName,
      mode: assignment.route.mode,
      stationName,
      normalizedName: normalizeName(stationName) || "station",
      point: stopPoint,
      sourceStopId: sanitizeText(stop.onestop_id || stop.id),
      distanceMeters: assignment.distanceMeters
    });
  }

  const dedupedStops = deduplicateStopsByLineAndName(assignedStops);

  const stopFeatures = [];
  const stopCountsByLine = new Map();

  for (const stop of dedupedStops) {
    const stationKey = stableStationKey(stop.stationName, stop.lon, stop.lat);
    const overridden = applyStopOverride(stationKey, stop.stationName, stop.lon, stop.lat);

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
        station_name: overridden.stationName,
        source_count: stop.pointCount,
        distance_m: Math.round(stop.minDistanceMeters)
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
      dedupedStops: stopFeatures.length,
      dedupRadiusMeters: config.STOP_DEDUP_MAX_METERS
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
