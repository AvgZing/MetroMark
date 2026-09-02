const db = require("../../server/processors/data");
const { routeToFeature } = require("../../server/sources/transitland/route-features");
const { isFallbackHeadwaySeconds } = require("../../server/sources/transitland/headway");
const { detectProblematicGeometry } = require("../../server/sources/transitland/problematic-geometry");

async function storeRouteMetadata(route) {
  const headwaySeconds = Number(route.headway_secs);
  const hasHeadway = Number.isFinite(headwaySeconds) && headwaySeconds > 0;
  const fallback = hasHeadway && isFallbackHeadwaySeconds(headwaySeconds);

  // Auto-detect synthesized stop-to-stop geometry (no real routing geometry).
  // Geometry-only at this stage; the route-stops fetch refines it with the
  // actual stop positions, and the admin manual override always wins.
  const problematicGeometry = detectProblematicGeometry(route.geometry, []);

  // Headway fields are only written when this response actually carries
  // headway; otherwise existing stored headway is preserved (setRouteMetadata
  // is a partial merge). Stop counts are never written here — the exact
  // post-dedup count comes from a route-stops fetch (harvest:stops or a user
  // opening the route).
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
