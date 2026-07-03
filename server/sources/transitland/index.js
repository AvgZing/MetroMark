const crypto = require("crypto");
const config = require("../../admin/config");
const db = require("../../processors/data");
const { getCityBySlug } = require("../../processors/city-presets");
const {
  normalizeName,
  stableStationKey,
  geometryBbox
} = require("../../processors/postgres/spatial");
const {
  simplifyGeometryForZoom,
  resolveGeometryForZoom
} = require("./geometry");
const {
  TRANSITLAND_BASE_URL,
  TRANSITLAND_VECTOR_BASE_URL,
  TRANSIT_CACHE_PREFIX,
  transitlandMetrics
} = require("./metrics");
const {
  sanitizeText,
  extractOperatorName,
  extractRouteMode,
  sanitizeColor,
  extractFeedId,
  extractParentStopId,
  extractParentStopName,
  canonicalStationName,
  normalizeStopLocationTypes,
  normalizeRouteTypes,
  isCacheExpiredRow,
  getTransitlandMetrics,
  colorFromString,
  firstTruthy
} = require("./helpers");
const {
  routeLookupKeysFromObject,
  fetchVectorRouteHeadwaysForBbox,
  normalizeRoutes,
  extractStopPoint,
  extractStopLocationType,
  routeServiceTier,
  routeSortWeight,
  routeFeatureFromLine
} = require("./routes");
const {
  inferStopModeHint,
  assignStopToClosestRoute,
  applyStopOverride,
  deduplicateStopsByLineAndName,
  buildStationHubs
} = require("./stops");
const {
  frequencyBucketFromHeadwayMinutes,
  isFallbackHeadwaySeconds,
  isFallbackHeadwayMinutes,
  fallbackFrequencyBucketForRoute,
  fetchRouteHeadwaySummary
} = require("./headway");
const { wait, enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");

function parseBboxArray(rawBbox, options = {}) {
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

  const allowWideBbox = Boolean(options.allowWideBbox);
  if (!allowWideBbox && (width > config.BBOX_MAX_SPAN_DEGREES || height > config.BBOX_MAX_SPAN_DEGREES)) {
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

function normalizeBboxForCache(rawBbox, zoom, options = {}) {
  const parsed = parseBboxArray(rawBbox, {
    allowWideBbox: Boolean(options.allowWideBbox)
  });
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

async function transitlandRequest(path, params, options = {}) {
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

    await enforceDailyUsageCapsIfNeeded("rest", options);
    transitlandMetrics.restApiRequestCount += 1;
    transitlandMetrics.lastRestRequestAt = new Date().toISOString();
    await recordUsage("rest", 1);

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

  // Page through /routes results to avoid missing routes when a single page
  // is truncated by Transitland limits. Respect routeLimit as the per-request
  // page size and stop when we reach a reasonable maxResults cap.
  const fetchedRoutes = [];
  let afterCursor = null;
  const pageLimit = Math.max(40, Math.min(routeLimit, 500));
  const maxResults = Math.max(routeLimit, Number(config.ROUTE_CATALOG_MAX_RESULTS || 220));

  let pagesFetched = 0;
  while (fetchedRoutes.length < maxResults) {
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
      if (fetchedRoutes.length >= maxResults) break;
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

async function buildTransitPayload(area, rawRoutes, rawStops, options = {}) {
  const normalizedRoutes = normalizeRoutes(rawRoutes, options);
  const resolvedRoutes = [];
  for (const route of normalizedRoutes) {
    const resolvedGeometry = await resolveGeometryForZoom(route, {
      zoom: options.zoom,
      bbox: area?.bbox
    });

    if (!resolvedGeometry) {
      continue;
    }

    resolvedRoutes.push({
      ...route,
      geometry: resolvedGeometry,
      bbox: geometryBbox(resolvedGeometry)
    });
  }

  const routesByLineKey = new Map(resolvedRoutes.map((route) => [route.lineKey, route]));
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const allowedStopLocationTypes = new Set(stopLocationTypes);
  const vectorHeadwayMeta = options.vectorHeadwayMeta || {};

  const routeFeatures = resolvedRoutes.map((route) => {
    const headwayBestMinutes = Number.isFinite(route.headwaySeconds)
      ? Number((route.headwaySeconds / 60).toFixed(1))
      : null;
    const frequencyBucket = Number.isFinite(headwayBestMinutes)
      ? frequencyBucketFromHeadwayMinutes(headwayBestMinutes)
      : "unknown";

    return {
      type: "Feature",
      id: route.lineKey,
      geometry: route.geometry,
      properties: {
        feature_id: route.lineKey,
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
    const featureId = `${stop.lineKey}|${stationKey}`;

    for (const sourceStopId of stop.sourceStopIds) {
      db.upsertStopTranslation(sourceStopId, stationKey, "transitland");
    }

    stopFeatures.push({
      type: "Feature",
      id: featureId,
      geometry: {
        type: "Point",
        coordinates: [overridden.lon, overridden.lat]
      },
      properties: {
        feature_id: featureId,
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

  const lineSummaries = resolvedRoutes
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

async function fetchRouteStopPatternsForRoute(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    return null;
  }

  try {
    return await transitlandRequest(
      "/route_stop_patterns",
      {
        traversed_by: normalizedLineKey,
        per_page: "1000"
      },
      {
        enforceDailyCap: Boolean(options.enforceDailyCap),
        requestSource: options.requestSource
      }
    );
  } catch {
    return null;
  }
}

function extractTripStopTimes(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const candidates = [
    trip?.stop_times,
    trip?.stopTimes,
    tripResponse?.trips?.[0]?.stop_times,
    tripResponse?.trips?.[0]?.stopTimes,
    tripResponse?.stop_times,
    tripResponse?.stopTimes
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function extractTripDirectionId(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const value = trip?.direction_id ?? tripResponse?.direction_id ?? trip?.directionId;
  const directionId = Number(value);
  return Number.isFinite(directionId) ? directionId : null;
}

function extractTripPatternId(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const value = trip?.stop_pattern_id ?? tripResponse?.stop_pattern_id ?? trip?.stopPatternId;
  const patternId = Number(value);
  return Number.isFinite(patternId) ? patternId : null;
}

function extractTripInternalId(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const value = trip?.id ?? tripResponse?.id ?? trip?.trip_id ?? tripResponse?.trip_id;
  const internalId = Number(value);
  return Number.isFinite(internalId) ? internalId : null;
}

function extractStopIdFromTripStopTime(stopTime) {
  const stop = stopTime?.stop || stopTime || {};
  return sanitizeText(
    stop?.onestop_id ||
      stop?.stop_onestop_id ||
      stop?.id ||
      stop?.stop_id ||
      stopTime?.stop_id ||
      stopTime?.stop_onestop_id
  );
}

async function fetchRouteTripsForRoute(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    return [];
  }

  const trips = [];
  let afterCursor = null;
  let truncated = false;
  const pageLimit = Math.max(20, Math.min(200, Number(config.ROUTE_STOP_PAGE_LIMIT || 200)));
  const maxResults = Math.max(pageLimit, Math.min(1200, Number(config.ROUTE_STOP_MAX_RESULTS || 1200)));

  while (trips.length < maxResults) {
    const params = {
      limit: String(pageLimit),
      include_geometry: "false"
    };

    if (Number.isFinite(afterCursor)) {
      params.after = String(afterCursor);
    }

    const response = await transitlandRequest(
      `/routes/${encodeURIComponent(normalizedLineKey)}/trips`,
      params,
      {
        enforceDailyCap: Boolean(options.enforceDailyCap),
        requestSource: options.requestSource
      }
    );

    const pageTrips = Array.isArray(response?.trips) ? response.trips : [];
    for (const trip of pageTrips) {
      if (trips.length >= maxResults) {
        truncated = true;
        break;
      }
      trips.push(trip);
    }

    const nextAfter = Number(response?.meta?.after);
    const hasNext = Boolean(response?.meta?.next) && Number.isFinite(nextAfter);
    if (!hasNext || pageTrips.length === 0 || truncated) {
      break;
    }

    afterCursor = nextAfter;
  }

  return trips;
}

async function fetchTripDetailById(routeKey, tripId, options = {}) {
  const normalizedRouteKey = sanitizeText(routeKey);
  const normalizedTripId = sanitizeText(tripId);
  if (!normalizedRouteKey || !normalizedTripId) {
    return null;
  }

  try {
    return await transitlandRequest(
      `/routes/${encodeURIComponent(normalizedRouteKey)}/trips/${encodeURIComponent(normalizedTripId)}`,
      {
        include_geometry: "true"
      },
      {
        enforceDailyCap: Boolean(options.enforceDailyCap),
        requestSource: options.requestSource
      }
    );
  } catch {
    return null;
  }
}

async function buildDirectionStopSequencesForRoute(routeKey, options = {}) {
  const routeTrips = await fetchRouteTripsForRoute(routeKey, options);
  if (!routeTrips.length) {
    return null;
  }

  const representativeTrips = new Map();
  for (const trip of routeTrips) {
    const directionId = extractTripDirectionId(trip);
    if (!Number.isFinite(directionId) || (directionId !== 0 && directionId !== 1)) {
      continue;
    }

    const patternId = extractTripPatternId(trip);
    const tripId = extractTripInternalId(trip);
    if (!Number.isFinite(tripId)) {
      continue;
    }

    const groupingKey = `${directionId}:${Number.isFinite(patternId) ? patternId : tripId}`;
    if (!representativeTrips.has(groupingKey)) {
      representativeTrips.set(groupingKey, {
        directionId,
        tripId,
        trip
      });
    }
  }

  const bestByDirection = new Map();
  const patternsByDirection = new Map([[0, []], [1, []]]);
  for (const representative of representativeTrips.values()) {
    const detail = await fetchTripDetailById(routeKey, representative.tripId, options);
    const stopTimes = extractTripStopTimes(detail);
    if (!stopTimes.length) {
      continue;
    }

    const stopEntries = stopTimes
      .map((stopTime) => {
        const stop = stopTime?.stop || stopTime || {};
        return {
          id: extractStopIdFromTripStopTime(stopTime),
          stopId: sanitizeText(stop?.stop_id || stopTime?.stop_id),
          name: sanitizeText(stop?.stop_name || stopTime?.stop_name)
        };
      })
      .filter((entry) => Boolean(entry.id || entry.stopId || entry.name));

    if (!stopEntries.length) {
      continue;
    }

    const payload = {
      tripId: representative.tripId,
      patternId: extractTripPatternId(detail) ?? extractTripPatternId(representative.trip),
      stopEntries
    };

    const existing = bestByDirection.get(representative.directionId);
    if (!existing || stopEntries.length > existing.stopEntries.length) {
      bestByDirection.set(representative.directionId, payload);
    }

    const list = patternsByDirection.get(representative.directionId) || [];
    list.push(payload);
    patternsByDirection.set(representative.directionId, list);
  }

  if (!bestByDirection.size) {
    return null;
  }

  return {
    0: bestByDirection.get(0)?.stopEntries || [],
    1: bestByDirection.get(1)?.stopEntries || [],
    patterns: {
      0: patternsByDirection.get(0) || [],
      1: patternsByDirection.get(1) || []
    }
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
    const featureId = `${line.lineKey}|${stationKey}`;

    for (const sourceStopId of stop.sourceStopIds) {
      db.upsertStopTranslation(sourceStopId, stationKey, "transitland");
    }

    stopFeatures.push({
      type: "Feature",
      id: featureId,
      geometry: {
        type: "Point",
        coordinates: [overridden.lon, overridden.lat]
      },
      properties: {
        feature_id: featureId,
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
  const cacheOnly = Boolean(options.cacheOnly);
  const summaryOnly = Boolean(options.summaryOnly);
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const stopTypeKey = stopLocationTypes.join("-");
  const cacheKey = `${TRANSIT_CACHE_PREFIX}route:${normalizedLineKey}:types:${stopTypeKey}`;

  if (!forceRefresh) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached) {
      const cacheStatus = isCacheExpiredRow(cached) ? "stale-hit" : "hit";
      const cachedLineSummary = Array.isArray(cached.payload?.lineSummaries) ? cached.payload.lineSummaries[0] || null : null;
      if (summaryOnly) {
        return {
          payload: {
            lineSummaries: [{
              lineKey: normalizedLineKey,
              stopCount: Number(cachedLineSummary?.stopCount || 0)
            }]
          },
          cacheStatus,
          cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
          cacheExpiresAt: cached.expiresAt,
          stopLocationTypes
        };
      }

      return {
        payload: cached.payload,
        cacheStatus,
        cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
        cacheExpiresAt: cached.expiresAt,
        stopLocationTypes
      };
    }
  }

  if (cacheOnly) {
    return {
      payload: null,
      cacheStatus: "miss",
      cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
      stopLocationTypes
    };
  }

  const line = await fetchRouteByLineKey(normalizedLineKey, options);
  if (!line) {
    throw new Error(`No route found for ${normalizedLineKey}.`);
  }

  const membershipRouteKey = sanitizeText(line.routeOnestopId || normalizedLineKey);
  const routeStops = await fetchStopsForRoute(membershipRouteKey, options);
  const directionStopSequences = await buildDirectionStopSequencesForRoute(membershipRouteKey, options);
  const payload = buildRouteStopsPayload(line, routeStops.stops, {
    stopLocationTypes,
    sourceStopsTruncated: routeStops.truncated
  });

  if (directionStopSequences) {
    payload.directionStopSequences = directionStopSequences;
    if (directionStopSequences.patterns) {
      payload.directionStopPatterns = directionStopSequences.patterns;
    }
  }

  await db.setCache(cacheKey, payload, config.TRANSIT_CACHE_TTL_HOURS * 3600, {
    cacheKind: "route-stops"
  });

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

  const line = await fetchRouteByLineKey(normalizedLineKey, options);
  if (!line) {
    throw new Error(`No route found for ${normalizedLineKey}.`);
  }

  const lookupKey = sanitizeText(line.routeOnestopId || normalizedLineKey);
  const cacheKey = `${TRANSIT_CACHE_PREFIX}headway:${lookupKey}`;
  const bbox = Array.isArray(line.bbox) && line.bbox.length === 4 ? line.bbox : null;
  let summary = null;
  let normalizedBestMinutes = null;

  if (bbox) {
    const vectorHeadways = await fetchVectorRouteHeadwaysForBbox(bbox, {
      routeTypes: Number.isFinite(line.routeType) ? [line.routeType] : [],
      zoom: options.zoom,
      forceRefresh: Boolean(options.forceRefresh),
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    const lookupKeys = routeLookupKeysFromObject({
      onestop_id: lookupKey,
      route_onestop_id: line.routeOnestopId,
      line_key: line.lineKey,
      routeFeedId: line.routeFeedId
    });

    let headwaySeconds = null;
    for (const routeKey of lookupKeys) {
      const candidate = Number(vectorHeadways?.headwayByRouteKey?.[routeKey]);
      if (Number.isFinite(candidate) && candidate > 0) {
        headwaySeconds = candidate;
        break;
      }
    }

    if (Number.isFinite(headwaySeconds) && headwaySeconds > 0) {
      const fallbackHeadway = isFallbackHeadwaySeconds(headwaySeconds);
      normalizedBestMinutes = fallbackHeadway ? null : Number((headwaySeconds / 60).toFixed(1));
      summary = {
        source: "transitland-vector-tiles",
        headwaySeconds: fallbackHeadway ? null : headwaySeconds,
        bestMinutes: normalizedBestMinutes,
        frequencyBucket: fallbackHeadway ? fallbackFrequencyBucketForRoute(line) : frequencyBucketFromHeadwayMinutes(normalizedBestMinutes),
        headwayFallback: fallbackHeadway ? 1 : 0,
        routeType: Number.isFinite(Number(line.routeType)) ? Number(line.routeType) : null
      };
    }
  }

  if (!summary) {
    const routePageSummary = await fetchRouteHeadwaySummary(lookupKey, {
      forceRefresh: Boolean(options.forceRefresh),
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    if (routePageSummary) {
      const summaryBestMinutes = Number(routePageSummary.bestMinutes);
      const fallbackHeadway = isFallbackHeadwayMinutes(summaryBestMinutes);
      normalizedBestMinutes = Number.isFinite(summaryBestMinutes) && summaryBestMinutes > 0 && !fallbackHeadway
        ? Number(summaryBestMinutes.toFixed(1))
        : null;

      summary = {
        ...routePageSummary,
        bestMinutes: normalizedBestMinutes,
        frequencyBucket: fallbackHeadway ? fallbackFrequencyBucketForRoute(line) : routePageSummary.frequencyBucket,
        headwayFallback: fallbackHeadway ? 1 : 0,
        routeType: Number.isFinite(Number(line.routeType)) ? Number(line.routeType) : null
      };
    }
  }

  if (summary && Number(summary.headwayFallback || 0) === 1) {
    try {
      const ttlHours = Math.max(1, Number(config.ROUTE_HEADWAY_CACHE_TTL_HOURS || 72));
      await db.setCache(cacheKey, summary, ttlHours * 3600, {
        cacheKind: "route-headway"
      });
    } catch {
      // Keep the response clean even if cache rewrite fails.
    }
  }

  return {
    lineKey: normalizedLineKey,
    routeOnestopId: lookupKey,
    headwaySummary: summary,
    headwayBestMinutes: normalizedBestMinutes,
    headwaySource: summary?.source || "",
    headwayFallback: Number(summary?.headwayFallback || 0) === 1 ? 1 : 0,
    headwayChecked: 1,
    frequencyBucket: summary?.frequencyBucket || (normalizedBestMinutes
      ? frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
      : "unknown")
  };
}

function buildFeedFingerprint(payload) {
  const lineSummaries = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries : [];
  if (!lineSummaries.length) {
    return "";
  }

  const stableLines = lineSummaries
    .map((line) => {
      const lineKey = sanitizeText(line?.lineKey || line?.routeOnestopId);
      const feedId = sanitizeText(line?.routeFeedId);
      if (!lineKey) {
        return "";
      }

      return `${feedId || "no-feed"}:${lineKey}`;
    })
    .filter(Boolean)
    .sort();

  if (!stableLines.length) {
    return "";
  }

  return crypto.createHash("sha1").update(stableLines.join("|"), "utf8").digest("hex");
}

function buildFeedFingerprintFromRoutes(routes) {
  const stableRoutes = Array.isArray(routes)
    ? routes
      .map((route) => {
        const routeId = sanitizeText(route?.onestop_id || route?.route_onestop_id);
        const feedId = sanitizeText(route?.route_feed_onestop_id || route?.feed_onestop_id);
        if (!routeId) {
          return "";
        }

        return `${feedId || "no-feed"}:${routeId}`;
      })
      .filter(Boolean)
      .sort()
    : [];

  if (!stableRoutes.length) {
    return "";
  }

  return crypto.createHash("sha1").update(stableRoutes.join("|"), "utf8").digest("hex");
}

async function applyRouteOrderingMetadataToPayload(payload) {
  const lineSummaries = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries : [];
  if (!lineSummaries.length) {
    return payload;
  }

  const lineKeys = Array.from(
    new Set(lineSummaries.map((line) => sanitizeText(line?.lineKey)).filter(Boolean))
  );

  if (!lineKeys.length) {
    return payload;
  }

  const metadataByLineKey = await db.getRouteOrderingMetadataByLineKeys(lineKeys);
  if (!metadataByLineKey || metadataByLineKey.size === 0) {
    return payload;
  }

  const decorateLine = (line) => {
    const lineKey = sanitizeText(line?.lineKey);
    if (!lineKey || !metadataByLineKey.has(lineKey)) {
      return line;
    }

    const metadata = metadataByLineKey.get(lineKey) || {};
    return {
      ...line,
      lineViewOrderingDefaultMode: sanitizeText(metadata.orderingModeDefaultMode || "auto") || "auto",
      lineViewOrderingDefaultSource: sanitizeText(metadata.orderingModeDefaultSource || "auto") || "auto",
      lineViewOrderingAdminMode: sanitizeText(metadata.orderingModeAdminMode || ""),
      lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
      lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
    };
  };

  const nextRoutesGeoJson =
    payload?.routesGeoJson && Array.isArray(payload.routesGeoJson.features)
      ? {
          ...payload.routesGeoJson,
          features: payload.routesGeoJson.features.map((feature) => {
            const lineKey = sanitizeText(feature?.properties?.line_key);
            if (!lineKey || !metadataByLineKey.has(lineKey)) {
              return feature;
            }

            const metadata = metadataByLineKey.get(lineKey) || {};
            return {
              ...feature,
              properties: {
                ...feature.properties,
                line_view_ordering_default_mode: sanitizeText(metadata.orderingModeDefaultMode || "auto") || "auto",
                line_view_ordering_default_source: sanitizeText(metadata.orderingModeDefaultSource || "auto") || "auto",
                line_view_ordering_admin_mode: sanitizeText(metadata.orderingModeAdminMode || ""),
                line_view_ordering_vote_total: Number(metadata.orderingModeVoteTotal || 0)
              }
            };
          })
        }
      : payload?.routesGeoJson;

  return {
    ...payload,
    lineSummaries: lineSummaries.map(decorateLine),
    routesGeoJson: nextRoutesGeoJson
  };
}

async function queueCityReverifyIfStale(area, cached) {
  if (!area || area.kind !== "city" || !area.slug || !cached) {
    return;
  }
  const staleDays = Math.max(1, Number(config.TRANSIT_CACHE_STALE_DAYS || 30));
  const ageSeconds =
    Math.floor(Date.now() / 1000) - Number(cached.verifiedAt || cached.fetchedAt || 0);

  if (!Number.isFinite(ageSeconds) || ageSeconds < staleDays * 86400) {
    return;
  }

  await db.ensureCityHarvestState(
    {
      slug: area.slug,
      name: area.name
    },
    {
      priority: Number(area.harvestPriority || 100),
      initialStatus: "queued",
      pendingRefresh: true
    }
  );
  await db.queueCityRefresh(area.slug);
}

async function getTransitForArea(area, options = {}) {
  const t0 = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = `${TRANSIT_CACHE_PREFIX}${area.key}`;
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes || area.routeTypes);
  const summaryOnly = Boolean(options.summaryOnly);

  const summaryOnlyPayload = (routesGeoJson, lineSummaries) => ({
    routesGeoJson: routesGeoJson && Array.isArray(routesGeoJson.features)
      ? routesGeoJson
      : { type: "FeatureCollection", features: [] },
    lineSummaries: Array.isArray(lineSummaries) ? lineSummaries : [],
    area: { bbox: area.bbox }
  });

  function logGetTransitTiming(detail) {
    const elapsed = Date.now() - t0;
    if (elapsed > 200) {
      console.log(`[perf] getTransitForArea(${area.key.slice(0, 60)}): ${elapsed}ms - ${detail}`);
    }
  }

  if (summaryOnly && Boolean(options.cacheOnly)) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached) {
      return {
        payload: summaryOnlyPayload(cached.payload?.routesGeoJson, cached.payload?.lineSummaries || []),
        cacheStatus: isCacheExpiredRow(cached) ? "stale-hit" : "hit",
        cacheKey: area.key,
        cacheExpiresAt: cached.expiresAt,
        cacheVerifiedAt: cached.verifiedAt,
        feedFingerprint: cached.feedFingerprint || "",
        stopLocationTypes
      };
    }

    const [minLon, minLat, maxLon, maxLat] = area.bbox;
    const overlappingCaches = await db.getCacheByBbox(minLon, minLat, maxLon, maxLat, {
      includeExpired: true
    });

    if (overlappingCaches && overlappingCaches.length > 0) {
      const mergedLines = new Map();

      for (const cacheEntry of overlappingCaches) {
        const payload = cacheEntry.payload || {};

        for (const line of payload?.lineSummaries || []) {
          const lineKey = line?.lineKey;
          if (lineKey && !mergedLines.has(lineKey)) {
            mergedLines.set(lineKey, line);
          }
        }
      }

      logGetTransitTiming('summaryOnly+cacheOnly:spatial-partial');
      return {
        payload: summaryOnlyPayload(
          { type: "FeatureCollection", features: [] },
          Array.from(mergedLines.values())
        ),
        cacheStatus: "partial-hit",
        cacheKey: area.key,
        stopLocationTypes
      };
    }

    return {
      payload: summaryOnlyPayload([]),
      cacheStatus: "miss",
      cacheKey: area.key,
      stopLocationTypes
    };
  }

  if (!forceRefresh) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached) {
      const cacheStatus = isCacheExpiredRow(cached) ? "stale-hit" : "hit";
      if (!summaryOnly) {
        await queueCityReverifyIfStale(area, cached);
      }

      if (summaryOnly) {
        return {
          payload: summaryOnlyPayload(cached.payload?.lineSummaries || []),
          cacheStatus,
          cacheKey: area.key,
          cacheExpiresAt: cached.expiresAt,
          cacheVerifiedAt: cached.verifiedAt,
          feedFingerprint: cached.feedFingerprint || "",
          stopLocationTypes
        };
      }

      logGetTransitTiming('cache-hit');
      return {
        payload: await applyRouteOrderingMetadataToPayload(cached.payload || {}),
        cacheStatus,
        cacheKey: area.key,
        cacheExpiresAt: cached.expiresAt,
        cacheVerifiedAt: cached.verifiedAt,
        feedFingerprint: cached.feedFingerprint || "",
        stopLocationTypes
      };
    }

    if (options.cacheOnly) {
      const [minLon, minLat, maxLon, maxLat] = area.bbox;
      const overlappingCaches = await db.getCacheByBbox(minLon, minLat, maxLon, maxLat, {
        includeExpired: true
      });

      if (overlappingCaches && overlappingCaches.length > 0) {
        const mergedRoutes = new Map();
        const mergedStops = new Map();
        const mergedLines = new Map();

        for (const cacheEntry of overlappingCaches) {
          const payload = cacheEntry.payload || {};

          for (const feature of payload?.routesGeoJson?.features || []) {
            const lineKey = feature?.properties?.line_key;
            if (lineKey && !mergedRoutes.has(lineKey)) {
              mergedRoutes.set(lineKey, feature);
            }
          }

          for (const line of payload?.lineSummaries || []) {
            const lineKey = line?.lineKey;
            if (lineKey && !mergedLines.has(lineKey)) {
              mergedLines.set(lineKey, line);
            }
          }

          for (const feature of payload?.stopsGeoJson?.features || []) {
            const stopId = feature?.properties?.stop_id || feature?.id;
            if (stopId && !mergedStops.has(stopId)) {
              mergedStops.set(stopId, feature);
            }
          }
        }

        if (summaryOnly) {
          return {
            payload: summaryOnlyPayload({ type: "FeatureCollection", features: [] }, Array.from(mergedLines.values())),
            cacheStatus: "partial-hit",
            cacheKey: area.key,
            stopLocationTypes
          };
        }

        return {
          payload: {
            routesGeoJson: { type: "FeatureCollection", features: Array.from(mergedRoutes.values()) },
            stopsGeoJson: { type: "FeatureCollection", features: Array.from(mergedStops.values()) },
            lineSummaries: Array.from(mergedLines.values()),
            area: { bbox: area.bbox }
          },
          cacheStatus: "partial-hit",
          cacheKey: area.key,
          stopLocationTypes
        };
      }

      return {
        payload: summaryOnly
          ? summaryOnlyPayload({ type: "FeatureCollection", features: [] }, [])
          : { routesGeoJson: { type: "FeatureCollection", features: [] }, stopsGeoJson: { type: "FeatureCollection", features: [] }, lineSummaries: [], area: { bbox: area.bbox } },
        cacheStatus: "miss",
        cacheKey: area.key,
        stopLocationTypes
      };
    }
  }

  logGetTransitTiming('fetching-from-transitland');
  const fetchResult = await fetchRoutesAndStopsForBbox(area.bbox, {
    ...options,
    stopLocationTypes,
    routeTypes
  });

  const payload = await buildTransitPayload(area, fetchResult.routes || [], fetchResult.stops || [], {
    zoom: Number(options.zoom),
    stopLocationTypes,
    routeTypes,
    vectorHeadwayMeta: fetchResult.vectorHeadwayMeta,
    requestSource: options.requestSource
  });

  const enrichedPayload = await applyRouteOrderingMetadataToPayload(payload);
  const ttlSeconds = Math.max(60, Number(config.TRANSIT_CACHE_TTL_HOURS || 2160) * 3600);
  const fetchedAt = Math.floor(Date.now() / 1000);
  const feedFingerprint = buildFeedFingerprint(enrichedPayload);

  await db.setCache(cacheKey, enrichedPayload, ttlSeconds, {
    cacheKind: area.kind || "bbox",
    citySlug: area.slug || null,
    feedFingerprint,
    verifiedAt: fetchedAt
  });

  const result = {
    payload: enrichedPayload,
    cacheStatus: "miss",
    cacheKey: area.key,
    cacheExpiresAt: fetchedAt + ttlSeconds,
    cacheVerifiedAt: fetchedAt,
    feedFingerprint,
    stopLocationTypes
  };

  if (options.debug) {
    result.debug = {
      fetchDiagnostics: fetchResult.diagnostics || null,
      areaBbox: area.bbox,
      requestedRouteTypes: routeTypes,
      vectorHeadwayMeta: fetchResult.vectorHeadwayMeta || null
    };
  }

  return result;
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
    routeTypes,
    harvestPriority: Number(options.harvestPriority || 100)
  };

  const result = await getTransitForArea(area, {
    ...options,
    stopLocationTypes,
    routeTypes
  });

  return {
    ...result,
    stopLocationTypes,
    routeTypes
  };
}

async function getCityFeedFingerprint(slug, options = {}) {
  const city = getCityBySlug(slug);
  if (!city) {
    return null;
  }

  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const routeLimit = Math.max(80, Number(config.ROUTE_CATALOG_MAX_RESULTS || 220));
  const params = {
    bbox: toBboxString(city.bbox),
    include_geometry: "false",
    limit: String(routeLimit)
  };

  if (routeTypes.length) {
    params.route_types = routeTypes.join(",");
  }

  const routesResponse = await transitlandRequest("/routes", params, {
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  const routes = Array.isArray(routesResponse?.routes) ? routesResponse.routes : [];
  return {
    citySlug: city.slug,
    routeCount: routes.length,
    feedFingerprint: buildFeedFingerprintFromRoutes(routes)
  };
}

async function getBboxTransit(rawBbox, options = {}) {
  const zoom = Number(options.zoom);
  const bboxInfo = normalizeBboxForCache(rawBbox, zoom, {
    // Cache-only requests are Postgres overlap lookups and should work for broad views.
    // Transitland-fetching requests still obey BBOX_MAX_SPAN_DEGREES.
    allowWideBbox: Boolean(options.cacheOnly)
  });
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
  getCityFeedFingerprint,
  getBboxTransit,
  getRouteStopsTransit,
  getRouteHeadway,
  getTransitlandMetrics,
  TRANSIT_CACHE_PREFIX
};
