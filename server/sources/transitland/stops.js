const config = require("../../admin/config");
const db = require("../../processors/data");
const {
  normalizeName,
  stableStationKey,
  distanceBetweenPointsMeters,
  geometryDistanceMeters,
  nearestPointOnGeometry,
  pointInExpandedBbox
} = require("../../processors/postgres/spatial");
const { sanitizeText } = require("./helpers");
const { isRailLikeRouteType } = require("./routes");

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
          stopLocationType: stop.stopLocationType,
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
      if (!Number.isFinite(closest.stopLocationType) && Number.isFinite(stop.stopLocationType)) {
        closest.stopLocationType = stop.stopLocationType;
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

module.exports = {
  inferStopModeHint,
  assignStopToClosestRoute,
  applyStopOverride,
  deduplicateStopsByLineAndName,
  buildStationHubs
};
