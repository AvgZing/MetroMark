const config = require("./config");
const db = require("../processors/data");
const { defaultCoreHarvestCitySlugs, getCityBySlug } = require("../processors/city-presets");
const {
  TRANSIT_CACHE_PREFIX
} = require("../processors/transitland");
const { log } = require("./core-log");

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

module.exports = {
  normalizeCoreCitySlugs,
  cityCacheKey,
  routeStopsCacheKey,
  isCityCacheStale,
  isRouteStopsCacheStale,
  seedCoreCityQueue,
  queueStaleCoreCities
};
