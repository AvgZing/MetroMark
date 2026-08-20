const db = require("../server/processors/data");
const { routeToFeature } = require("../server/sources/transitland/route-features");
const { isFallbackHeadwaySeconds } = require("../server/sources/transitland/headway");

async function storeRouteMetadata(route) {
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
    headwayChecked: hasHeadway ? 1 : 0
  });
}

function accumulateRoutes(routes, newFeatures) {
  for (const route of routes) {
    storeRouteMetadata(route).catch(() => {});
    const feature = routeToFeature(route);
    if (feature) {
      newFeatures.push(feature);
    }
  }
}

module.exports = {
  storeRouteMetadata,
  accumulateRoutes
};
