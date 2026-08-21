const config = require("../../admin/config");
const db = require("../../processors/data");
const {
  normalizeName,
  stableStationKey
} = require("../../processors/postgres/spatial");
const {
  sanitizeText,
  extractFeedId,
  extractParentStopId,
  extractParentStopName,
  canonicalStationName,
  normalizeStopLocationTypes
} = require("./helpers");
const {
  extractStopPoint,
  extractStopLocationType,
  routeServiceTier,
  routeFeatureFromLine
} = require("./routes");
const {
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
  buildDirectionStopSequencesForRoute,
  buildRouteStopsPayload
};
