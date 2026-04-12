const config = require("./config");
const db = require("./db");
const { getCityBySlug } = require("./city-presets");
const {
  stableStationKey,
  geometryDistanceMeters,
  geometryBbox,
  pointInExpandedBbox
} = require("./spatial");

const TRANSITLAND_BASE_URL = "https://transit.land/api/v2/rest";

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

function toBboxString(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function asFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
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
  const lineKey =
    route.onestop_id ||
    route.id ||
    `${route.operator_onestop_id || "operator"}:${route.route_short_name || route.route_long_name || index}`;

  const lineName =
    route.route_name || route.route_long_name || route.route_short_name || `Line ${index + 1}`;

  const geometry = route.geometry || null;
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return null;
  }

  return {
    lineKey,
    lineName,
    color: sanitizeColor(route.route_color, lineKey),
    operatorName: route.operator_name || "",
    geometry,
    bbox: geometryBbox(geometry)
  };
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

async function fetchCityRoutesAndStops(city) {
  const bbox = toBboxString(city.bbox);

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

function buildTransitPayload(city, rawRoutes, rawStops) {
  const normalizedRoutes = rawRoutes
    .map((route, index) => normalizeRoute(route, index))
    .filter((route) => route !== null);

  const routeFeatures = normalizedRoutes.map((route) => ({
    type: "Feature",
    geometry: route.geometry,
    properties: {
      line_key: route.lineKey,
      line_name: route.lineName,
      operator_name: route.operatorName,
      color: route.color
    }
  }));

  const stopFeatures = [];
  const stopCountsByLine = new Map();

  for (const stop of rawStops) {
    const stopPoint = extractStopPoint(stop);
    if (!stopPoint) {
      continue;
    }

    const assignment = assignStopToClosestRoute(stopPoint, normalizedRoutes);
    if (!assignment) {
      continue;
    }

    const baseStationName = stop.stop_name || stop.name || "Unnamed Stop";
    const stationKey = stableStationKey(baseStationName, stopPoint[0], stopPoint[1]);

    db.upsertStopTranslation(
      stop.onestop_id || stop.id || `${baseStationName}:${stopPoint[0]}:${stopPoint[1]}`,
      stationKey,
      "transitland"
    );

    const overridden = applyStopOverride(stationKey, baseStationName, stopPoint[0], stopPoint[1]);

    stopFeatures.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [overridden.lon, overridden.lat]
      },
      properties: {
        station_key: stationKey,
        source_stop_id: stop.onestop_id || stop.id || null,
        line_key: assignment.route.lineKey,
        line_name: assignment.route.lineName,
        station_name: overridden.stationName,
        distance_m: assignment.distanceMeters
      }
    });

    const currentCount = stopCountsByLine.get(assignment.route.lineKey) || 0;
    stopCountsByLine.set(assignment.route.lineKey, currentCount + 1);
  }

  const lineSummaries = normalizedRoutes
    .map((route) => ({
      lineKey: route.lineKey,
      lineName: route.lineName,
      operatorName: route.operatorName,
      color: route.color,
      stopCount: stopCountsByLine.get(route.lineKey) || 0
    }))
    .sort((a, b) => a.lineName.localeCompare(b.lineName));

  return {
    city: {
      slug: city.slug,
      name: city.name,
      country: city.country,
      center: city.center,
      bbox: city.bbox
    },
    fetchedAt: new Date().toISOString(),
    routesGeoJson: asFeatureCollection(routeFeatures),
    stopsGeoJson: asFeatureCollection(stopFeatures),
    lineSummaries
  };
}

async function getCityTransit(slug, options = {}) {
  const city = getCityBySlug(slug);
  if (!city) {
    return null;
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = `city-transit-v1:${city.slug}`;

  if (!forceRefresh) {
    const cached = db.getCache(cacheKey);
    if (cached) {
      return {
        payload: cached.payload,
        cacheStatus: "hit",
        cacheExpiresAt: cached.expiresAt
      };
    }
  }

  const { routes, stops } = await fetchCityRoutesAndStops(city);
  const payload = buildTransitPayload(city, routes, stops);

  db.setCache(cacheKey, payload, config.TRANSIT_CACHE_TTL_HOURS * 3600);

  return {
    payload,
    cacheStatus: "miss"
  };
}

module.exports = {
  getCityTransit
};
