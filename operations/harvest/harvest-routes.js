const db = require("../../server/processors/data");
const { routeToFeature } = require("../../server/sources/transitland/route-features");
const { isFallbackHeadwaySeconds } = require("../../server/sources/transitland/headway");
const { detectProblematicGeometry } = require("../../server/sources/transitland/problematic-geometry");

async function storeRouteMetadata(route) {
  const headwaySeconds = Number(route.headway_secs);
  const hasHeadway = Number.isFinite(headwaySeconds) && headwaySeconds > 0;
  const fallback = hasHeadway && isFallbackHeadwaySeconds(headwaySeconds);

  // Geometry-only detection here; route-stops refines with stop positions.
  const problematicGeometry = detectProblematicGeometry(route.geometry, []);

  // Only write headway when this response carries it (setRouteMetadata is a
  // partial merge). Stop counts come from harvest:stops, never here.
  const metadata = {
    routeOnestopId: route.routeOnestopId,
    lineName: route.lineName,
    lineShortName: route.lineShortName,
    lineLongName: route.lineLongName,
    operatorName: route.operatorName,
    mode: route.mode,
    routeType: route.routeType,
    routeFeedId: route.routeFeedId,
    color: route.color,
    problematicGeometry
  };

  if (hasHeadway) {
    metadata.frequencyBucket = route.frequency_bucket || "unknown";
    metadata.headwayBestMinutes = fallback ? null : Number((headwaySeconds / 60).toFixed(1));
    metadata.headwaySource = String(route.headway_source || "transitland-vector-tiles");
    metadata.headwayChecked = 1;
  }

  await db.setRouteMetadata(route.lineKey, metadata);
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
