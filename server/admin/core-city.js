const db = require("../processors/data");
const { getCityBySlug } = require("../processors/city-presets");
const {
  getCityTransit,
  getCityFeedFingerprint
} = require("../processors/transitland");
const { cityCacheKey, isCityCacheStale } = require("./core-queue");
const { warmRouteStops } = require("./core-warm");
const { log } = require("./core-log");

async function shouldRefreshCity(city, cityState) {
  const routeTypes = [];
  const cacheKey = cityCacheKey(city.slug, routeTypes);
  const cache = await db.getCacheAny(cacheKey);
  const stale = isCityCacheStale(cache);

  if (!cache) {
    return {
      refresh: true,
      reason: "cold-start",
      cache,
      cacheKey
    };
  }

  if (!cityState.pendingRefresh && !stale) {
    return {
      refresh: false,
      reason: "cache-fresh",
      cache,
      cacheKey
    };
  }

  const previousFingerprint = String(cache.feedFingerprint || cityState.lastFeedFingerprint || "").trim();
  const verification = await getCityFeedFingerprint(city.slug, {
    routeTypes,
    enforceDailyCap: true,
    requestSource: "harvest"
  });
  const latestFingerprint = String(verification?.feedFingerprint || "").trim();

  if (previousFingerprint && latestFingerprint && previousFingerprint === latestFingerprint) {
    await db.markCityVerified(city.slug, false);
    await db.logHarvestJob(
      city.slug,
      "verify",
      "unchanged",
      `fingerprint=${latestFingerprint.slice(0, 12)} routes=${verification.routeCount}`
    );

    return {
      refresh: false,
      reason: "feed-unchanged",
      cache,
      cacheKey
    };
  }

  return {
    refresh: true,
    reason: latestFingerprint ? "feed-changed" : "fingerprint-unavailable",
    cache,
    cacheKey
  };
}

async function harvestCity(cityState) {
  const city = getCityBySlug(cityState.citySlug);
  if (!city) {
    await db.markCityHarvestError(cityState.citySlug, "City preset not found.");
    await db.logHarvestJob(cityState.citySlug, "resolve", "error", "City preset not found.");
    return {
      status: "error",
      citySlug: cityState.citySlug,
      reason: "unknown-city"
    };
  }

  await db.markHarvestInProgress(city.slug);
  await db.logHarvestJob(city.slug, "start", "running", "Harvest started.");

  const decision = await shouldRefreshCity(city, cityState);
  if (!decision.refresh) {
    await db.logHarvestJob(city.slug, "complete", "skipped", `reason=${decision.reason}`);
    return {
      status: "skipped",
      citySlug: city.slug,
      reason: decision.reason
    };
  }

  const result = await getCityTransit(city.slug, {
    forceRefresh: true,
    enforceDailyCap: true,
    requestSource: "harvest",
    harvestPriority: cityState.harvestPriority,
    routeTypes: []
  });

  const fingerprint = String(result?.feedFingerprint || "").trim();
  await db.markGeometryHarvested(city.slug, {
    cacheKey: result?.cacheKey || decision.cacheKey,
    feedFingerprint: fingerprint
  });

  let warmedRoutes = 0;
  try {
    warmedRoutes = await warmRouteStops(result?.payload?.lineSummaries || []);
  } finally {
    await db.markStopsHarvested(city.slug);
  }

  await db.logHarvestJob(
    city.slug,
    "complete",
    "success",
    `reason=${decision.reason} lines=${Array.isArray(result?.payload?.lineSummaries) ? result.payload.lineSummaries.length : 0} warmedRoutes=${warmedRoutes}`
  );

  return {
    status: "refreshed",
    citySlug: city.slug,
    reason: decision.reason,
    warmedRoutes,
    fingerprint
  };
}

module.exports = {
  shouldRefreshCity,
  harvestCity
};
