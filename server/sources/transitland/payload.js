const config = require("../../admin/config");
const db = require("../../processors/data");
const {
  normalizeName,
  stableStationKey,
  geometryBbox
} = require("../../processors/postgres/spatial");
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
const { transitlandRequest } = require("./transport");
const { buildDirectionStopSequencesForRoute } = require("./trips");

function asFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
}

async function buildTransitPayload(area, rawRoutes, rawStops, options = {}) {
  const normalizedRoutes = normalizeRoutes(rawRoutes, options);
  const resolvedRoutes = [];
  for (const route of normalizedRoutes) {
    const resolvedGeometry = route.geometry || null;

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
