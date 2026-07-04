const config = require("../../admin/config");
const db = require("../../processors/data");
const {
  normalizeName,
  stableStationKey,
  geometryBbox
} = require("../../processors/postgres/spatial");
const {
  resolveGeometryForZoom
} = require("./geometry");
const {
  TRANSITLAND_BASE_URL,
  transitlandMetrics
} = require("./metrics");
const {
  sanitizeText,
  extractFeedId,
  extractParentStopId,
  extractParentStopName,
  canonicalStationName,
  normalizeStopLocationTypes,
  normalizeRouteTypes
} = require("./helpers");
const {
  normalizeRoutes,
  extractStopPoint,
  extractStopLocationType,
  routeServiceTier,
  routeSortWeight,
  routeFeatureFromLine
} = require("./routes");
const {
  assignStopToClosestRoute,
  applyStopOverride,
  deduplicateStopsByLineAndName,
  buildStationHubs
} = require("./stops");
const {
  frequencyBucketFromHeadwayMinutes
} = require("./headway");
const { wait, enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");

function asFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
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

module.exports = {
  transitlandRequest,
  buildTransitPayload,
  buildDirectionStopSequencesForRoute,
  buildRouteStopsPayload
};
