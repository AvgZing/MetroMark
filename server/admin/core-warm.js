const config = require("./config");
const db = require("../processors/data");
const { getRouteStopsTransit } = require("../processors/transitland");
const { routeStopsCacheKey, isRouteStopsCacheStale } = require("./core-queue");

async function warmRouteStops(lineSummaries) {
  const maxLines = Math.max(0, Number(config.HARVEST_ROUTE_STOP_BATCH_SIZE || 12));
  const perCityRouteLimit = Math.max(1, Number(config.HARVEST_ROUTE_LIMIT_PER_CITY || 150));
  if (maxLines <= 0) {
    return 0;
  }

  const limitedSummaries = Array.isArray(lineSummaries)
    ? lineSummaries.slice(0, perCityRouteLimit)
    : [];

  const uniqueLineKeys = [];
  const seen = new Set();

  for (const line of limitedSummaries) {
    const lineKey = String(line?.lineKey || "").trim();
    if (!lineKey || seen.has(lineKey)) {
      continue;
    }

    seen.add(lineKey);
    uniqueLineKeys.push(lineKey);

    if (uniqueLineKeys.length >= maxLines) {
      break;
    }
  }

  let warmed = 0;
  for (const lineKey of uniqueLineKeys) {
    try {
      const cache = await db.getCacheAny(routeStopsCacheKey(lineKey));
      const forceRefresh = !cache || isRouteStopsCacheStale(cache);
      await getRouteStopsTransit(lineKey, {
        forceRefresh,
        enforceDailyCap: true,
        requestSource: "harvest"
      });
      warmed += 1;
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        throw error;
      }
    }
  }

  return warmed;
}

module.exports = {
  warmRouteStops
};
