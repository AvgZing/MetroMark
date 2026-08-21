const db = require("../server/processors/data");
const { routeToFeature } = require("../server/sources/transitland/route-features");
const { isFallbackHeadwaySeconds } = require("../server/sources/transitland/headway");
const { extractStopPoint } = require("../server/sources/transitland/routes");
const { assignStopToClosestRoute } = require("../server/sources/transitland/stops");
const { extractFeedId } = require("../server/sources/transitland/helpers");

async function storeRouteMetadata(route, stopCount) {
  const headwaySeconds = Number(route.headway_secs);
  const hasHeadway = Number.isFinite(headwaySeconds) && headwaySeconds > 0;
  const fallback = hasHeadway && isFallbackHeadwaySeconds(headwaySeconds);

  await db.setRouteMetadata(route.lineKey, {
    routeOnestopId: route.routeOnestopId,
    lineName: route.lineName,
    lineShortName: route.lineShortName,
    lineLongName: route.lineLongName,
    operatorName: route.operatorName,
    mode: route.mode,
    routeType: route.routeType,
    routeFeedId: route.routeFeedId,
    color: route.color,
    frequencyBucket: route.frequency_bucket || "unknown",
    headwayBestMinutes: fallback || !hasHeadway ? null : Number((headwaySeconds / 60).toFixed(1)),
    headwaySource: hasHeadway ? String(route.headway_source || "transitland-vector-tiles") : "",
    headwayChecked: hasHeadway ? 1 : 0,
    stopCount: Number.isFinite(Number(stopCount)) ? Number(stopCount) : 0
  });
}

// Approximate per-line stop counts by assigning each bbox stop to its closest
// route. The exact route-membership count overwrites this when a route's stops
// are fetched on demand (getRouteStopsTransit promotes route_metadata).
function countStopsPerLine(rawStops, routes) {
  const counts = new Map();
  for (const stop of Array.isArray(rawStops) ? rawStops : []) {
    const point = extractStopPoint(stop);
    if (!point) {
      continue;
    }
    const assignment = assignStopToClosestRoute(point, routes, {
      stopFeedId: extractFeedId(stop),
      stopName: String(stop?.stop_name || stop?.name || "")
    });
    const lineKey = assignment?.route?.lineKey;
    if (lineKey) {
      counts.set(lineKey, (counts.get(lineKey) || 0) + 1);
    }
  }
  return counts;
}

function accumulateRoutes(routes, newFeatures, stopCountsByLine = new Map()) {
  for (const route of routes) {
    storeRouteMetadata(route, stopCountsByLine.get(route.lineKey)).catch(() => {});
    const feature = routeToFeature(route);
    if (feature) {
      newFeatures.push(feature);
    }
  }
}

module.exports = {
  storeRouteMetadata,
  countStopsPerLine,
  accumulateRoutes
};
