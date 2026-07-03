#!/usr/bin/env node

const config = require("./config");
const db = require("../processors/db");
const { defaultCoreHarvestCitySlugs, getCityBySlug } = require("../processors/city-presets");
const {
  TRANSIT_CACHE_PREFIX,
  getCityTransit,
  getCityFeedFingerprint,
  getRouteStopsTransit
} = require("../processors/transitland");

function nowIso() {
  return new Date().toISOString();
}

function log(message, details = null) {
  const prefix = `[harvest-core ${nowIso()}]`;
  if (details === null || details === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, details);
}

function normalizeCoreCitySlugs() {
  const configured = Array.isArray(config.HARVEST_CORE_CITY_SLUGS)
    ? config.HARVEST_CORE_CITY_SLUGS
    : [];
  const source = configured.length ? configured : defaultCoreHarvestCitySlugs;

  return source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((slug, index, all) => all.indexOf(slug) === index);
}

function cityCacheKey(slug, routeTypes = []) {
  const routeTypeKey = routeTypes.length ? routeTypes.join("-") : "all";
  return `${TRANSIT_CACHE_PREFIX}city:${slug}:route-catalog:route-types:${routeTypeKey}`;
}

function routeStopsCacheKey(lineKey, stopLocationTypes = [0, 1]) {
  const typeKey = Array.isArray(stopLocationTypes) && stopLocationTypes.length ? stopLocationTypes.join("-") : "0-1";
  return `${TRANSIT_CACHE_PREFIX}route:${String(lineKey || "").trim()}:types:${typeKey}`;
}

function isCityCacheStale(cacheRow) {
  if (!cacheRow) {
    return true;
  }

  const staleDays = Math.max(1, Number(config.TRANSIT_CACHE_STALE_DAYS || 30));
  const staleSeconds = staleDays * 86400;
  const sourceTimestamp = Number(cacheRow.verifiedAt || cacheRow.fetchedAt || 0);
  if (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0) {
    return true;
  }

  return Math.floor(Date.now() / 1000) - sourceTimestamp >= staleSeconds;
}

function isRouteStopsCacheStale(cacheRow) {
  return isCityCacheStale(cacheRow);
}

async function getUsageCapState() {
  return db.getDailyUsageCapsState({
    rest: config.HARVEST_DAILY_REST_LIMIT,
    vector: config.HARVEST_DAILY_VECTOR_LIMIT,
    routing: config.HARVEST_DAILY_ROUTING_LIMIT
  });
}

function summarizeUsage(state) {
  return {
    dayKey: state.usage.dayKey,
    rest: `${state.usage.restApiCalls}/${state.limits.rest}`,
    vector: `${state.usage.vectorTileCalls}/${state.limits.vector}`,
    routing: `${state.usage.routingApiCalls}/${state.limits.routing}`,
    backgroundAllowed: state.backgroundAllowed
  };
}

async function seedCoreCityQueue() {
  const slugs = normalizeCoreCitySlugs();
  let created = 0;

  for (let index = 0; index < slugs.length; index += 1) {
    const slug = slugs[index];
    const city = getCityBySlug(slug);
    if (!city) {
      log(`Skipping unknown city slug during seed: ${slug}`);
      continue;
    }

    const existing = await db.getCityHarvestState(city.slug);
    if (existing) {
      continue;
    }

    await db.ensureCityHarvestState(city, {
      priority: (index + 1) * 10,
      initialStatus: "queued",
      pendingRefresh: true
    });
    created += 1;
  }

  return {
    slugs,
    created
  };
}

async function queueStaleCoreCities(slugs) {
  let queued = 0;

  for (const slug of slugs) {
    const city = getCityBySlug(slug);
    if (!city) {
      continue;
    }

    const cache = await db.getCacheAny(cityCacheKey(slug));
    if (!cache || isCityCacheStale(cache)) {
      await db.queueCityRefresh(slug);
      queued += 1;
    }
  }

  return queued;
}

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

async function runHarvestCore(options = {}) {
  if (!config.HARVEST_ENABLED) {
    log("Harvest is disabled by HARVEST_ENABLED=0.");
    return {
      skipped: true,
      reason: "harvest-disabled"
    };
  }

  await db.initializeStorage();

  const seedResult = await seedCoreCityQueue();
  log("Core city queue prepared.", seedResult);
  const staleQueued = await queueStaleCoreCities(seedResult.slugs);
  if (staleQueued > 0) {
    log(`Queued ${staleQueued} stale core cities for verification.`);
  }

  const beforeState = await getUsageCapState();
  log("Usage state before run.", summarizeUsage(beforeState));
  if (!beforeState.backgroundAllowed) {
    log("Daily API cap reached. Harvest skipped.");
    return {
      skipped: true,
      reason: "daily-cap-reached"
    };
  }

  const batchSize = Math.max(1, Number(config.HARVEST_BATCH_CITY_LIMIT || 3));
  const candidates = await db.listPendingHarvestCities(batchSize);

  if (!candidates.length) {
    log("No pending cities in harvest queue.");
    return {
      skipped: true,
      reason: "no-pending-cities"
    };
  }

  const summary = {
    refreshed: 0,
    skipped: 0,
    errors: 0,
    stoppedByCap: false,
    processed: []
  };

  for (const cityState of candidates) {
    const capState = await getUsageCapState();
    if (!capState.backgroundAllowed) {
      summary.stoppedByCap = true;
      log("Stopping harvest due to daily cap.", summarizeUsage(capState));
      break;
    }

    try {
      const result = await harvestCity(cityState);
      summary.processed.push(result);
      if (result.status === "refreshed") {
        summary.refreshed += 1;
      } else if (result.status === "skipped") {
        summary.skipped += 1;
      } else {
        summary.errors += 1;
      }
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        summary.stoppedByCap = true;
        await db.queueCityRefresh(cityState.citySlug);
        await db.logHarvestJob(
          cityState.citySlug,
          "cap",
          "blocked",
          error.message || "Daily cap reached"
        );
        log(`Cap reached while harvesting ${cityState.citySlug}.`);
        break;
      }

      await db.markCityHarvestError(cityState.citySlug, error?.message || "Harvest failed");
      await db.logHarvestJob(
        cityState.citySlug,
        "error",
        "failed",
        error?.message || "Harvest failed"
      );
      summary.errors += 1;
      summary.processed.push({
        status: "error",
        citySlug: cityState.citySlug,
        reason: error?.message || "Harvest failed"
      });
    }
  }

  const afterState = await getUsageCapState();
  log("Harvest run complete.", {
    ...summary,
    usageAfter: summarizeUsage(afterState)
  });

  return {
    ...summary,
    staleQueued,
    usageAfter: summarizeUsage(afterState),
    triggerSource: String(options.triggerSource || "script")
  };
}

module.exports = {
  runHarvestCore
};

if (require.main === module) {
  runHarvestCore()
    .then(() => {})
    .catch((error) => {
      console.error("[harvest-core] Unhandled error", error);
      process.exitCode = 1;
    });
}
