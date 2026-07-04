const config = require("../../admin/config");
const { normalizeRouteTypes } = require("./helpers");
const { transitlandRequest } = require("./payload");
const {
  fetchVectorRouteHeadwaysForBbox,
  routeLookupKeysFromObject,
  normalizeRoutes
} = require("./routes");
const {
  isFallbackHeadwaySeconds,
  fallbackFrequencyBucketForRoute,
  frequencyBucketFromHeadwayMinutes
} = require("./headway");
const { toBboxString } = require("./bbox");

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

  // Page through /routes results following Transitland pagination to its
  // natural end. MAX_PAGES is a safety cap against hypothetical infinite
  // pagination glitches — at 20 pages × 200 routes/page = 4000 routes,
  // it would never be hit in normal operation (dense cities are <1000
  // routes) but limits a worst-case bug to 20 REST calls (0.2% of
  // the 10,000/month quota).
  const fetchedRoutes = [];
  let afterCursor = null;
  const pageLimit = Math.max(40, Math.min(routeLimit, 500));
  const MAX_PAGES = 20;
  let pagesFetched = 0;

  while (pagesFetched < MAX_PAGES) {
    const params = {
      ...routeParams,
      limit: String(pageLimit)
    };
    if (afterCursor !== null) {
      params.after = String(afterCursor);
    }

    const pageResponse = await transitlandRequest("/routes", params, {
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    const pageRoutes = Array.isArray(pageResponse.routes) ? pageResponse.routes : [];
    for (const r of pageRoutes) {
      fetchedRoutes.push(r);
    }

    pagesFetched += 1;

    const nextAfter = Number(pageResponse?.meta?.after);
    const hasNext = Boolean(pageResponse?.meta?.next) && Number.isFinite(nextAfter);
    if (!hasNext || pageRoutes.length === 0) {
      break;
    }
    afterCursor = nextAfter;
  }
  const filteredRoutes = routeTypes.length
    ? fetchedRoutes.filter((route) => allowedRouteTypes.has(Number(route?.route_type)))
    : fetchedRoutes;

  const vectorHeadways = await fetchVectorRouteHeadwaysForBbox(bboxArray, {
    routeTypes,
    zoom: options.zoom,
    forceRefresh: options.forceRefresh,
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  const headwayByRouteKey = vectorHeadways.headwayByRouteKey || {};
  for (const route of filteredRoutes) {
    const lookupKeys = routeLookupKeysFromObject(route);
    let vectorHeadwaySeconds = null;
    for (const lookupKey of lookupKeys) {
      const candidate = Number(headwayByRouteKey[lookupKey]);
      if (Number.isFinite(candidate) && candidate > 0) {
        vectorHeadwaySeconds = candidate;
        break;
      }
    }

    if (Number.isFinite(vectorHeadwaySeconds) && vectorHeadwaySeconds > 0) {
      if (isFallbackHeadwaySeconds(vectorHeadwaySeconds)) {
        route.headway_secs = null;
        route.headwayFallback = 1;
        route.frequency_bucket = fallbackFrequencyBucketForRoute(route);
      } else {
        route.headway_secs = Math.round(vectorHeadwaySeconds);
        route.headwayFallback = 0;
        route.frequency_bucket = frequencyBucketFromHeadwayMinutes(vectorHeadwaySeconds / 60);
      }
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
    ,
    diagnostics: {
      pagesFetched,
      fetchedRoutes: fetchedRoutes.length,
      filteredRoutes: filteredRoutes.length,
      requestedRouteLimit: routeLimit,
      pageLimit
    }
  };
}

async function fetchRouteByLineKey(lineKey, options = {}) {
  const response = await transitlandRequest("/routes", {
    onestop_id: lineKey,
    include_geometry: "true",
    limit: "1"
  }, {
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  let normalized = normalizeRoutes(Array.isArray(response.routes) ? response.routes : []);
  if (normalized[0]) {
    return normalized[0];
  }

  try {
    const fallbackResponse = await transitlandRequest(`/routes/${encodeURIComponent(lineKey)}`, {
      include_geometry: "true"
    }, {
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
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

async function fetchStopsForRoute(lineKey, options = {}) {
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

    const response = await transitlandRequest("/stops", params, {
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });
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

module.exports = {
  fetchRoutesAndStopsForBbox,
  fetchRouteByLineKey,
  fetchStopsForRoute
};
