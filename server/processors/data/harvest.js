const { localQuery, dbPath, assertLocalConfigured } = require("./core");
const { normalizeText, normalizeHarvestState } = require("./utils");

async function ensureCityHarvestState(city, options = {}) {
  assertLocalConfigured();

  const slug = normalizeText(city?.slug);
  const cityName = normalizeText(city?.name, slug);
  if (!slug) {
    throw new Error("city slug is required.");
  }

  const existing = await getCityHarvestState(slug);
  const priority = Math.max(1, Number(options.priority || existing?.harvestPriority || 100));
  const initialStatus = normalizeText(options.initialStatus || existing?.harvestStatus || "pending", "pending");
  const pendingRefresh = options.pendingRefresh === false ? false : true;

  const payload = {
    city_slug: slug,
    city_name: cityName,
    harvest_priority: priority,
    harvest_status:
      existing?.harvestStatus === "in-progress" ? "in-progress" : initialStatus,
    pending_refresh: existing ? existing.pendingRefresh || pendingRefresh : pendingRefresh
  };

  await localQuery(
    `insert into public.harvest_city_state (
      city_slug,
      city_name,
      harvest_priority,
      harvest_status,
      pending_refresh,
      updated_at
    ) values ($1, $2, $3, $4, $5, now())
    on conflict (city_slug) do update set
      city_name = excluded.city_name,
      harvest_priority = excluded.harvest_priority,
      harvest_status = case
        when public.harvest_city_state.harvest_status = 'in-progress' then public.harvest_city_state.harvest_status
        else excluded.harvest_status
      end,
      pending_refresh = public.harvest_city_state.pending_refresh or excluded.pending_refresh,
      updated_at = excluded.updated_at`,
    [payload.city_slug, payload.city_name, payload.harvest_priority, payload.harvest_status, payload.pending_refresh]
  );

  return getCityHarvestState(slug);
}

async function getCityHarvestState(citySlug) {
  assertLocalConfigured();

  const slug = normalizeText(citySlug);
  if (!slug) {
    return null;
  }

  const result = await localQuery(
    "select city_slug,city_name,harvest_priority,harvest_status,last_geometry_harvest_at,last_stops_harvest_at,last_verified_at,last_feed_fingerprint,last_cache_key,pending_refresh,last_error,updated_at from public.harvest_city_state where city_slug = $1 limit 1",
    [slug]
  );

  return normalizeHarvestState(result.rows?.[0] || null);
}

async function listPendingHarvestCities(limit = 5) {
  assertLocalConfigured();

  const safeLimit = Math.max(1, Number(limit || 5));
  const result = await localQuery(
    `select city_slug,city_name,harvest_priority,harvest_status,last_geometry_harvest_at,last_stops_harvest_at,last_verified_at,last_feed_fingerprint,last_cache_key,pending_refresh,last_error,updated_at
     from public.harvest_city_state
     where harvest_status in ('pending','queued','retry') or pending_refresh = true
     order by harvest_priority asc, updated_at asc
     limit $1`,
    [safeLimit]
  );

  return (result.rows || []).map(normalizeHarvestState).filter(Boolean);
}

async function markHarvestInProgress(citySlug) {
  assertLocalConfigured();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  await localQuery(
    "update public.harvest_city_state set harvest_status = 'in-progress', last_error = null, updated_at = now() where city_slug = $1",
    [slug]
  );
}

async function markGeometryHarvested(citySlug, options = {}) {
  assertLocalConfigured();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  await localQuery(
    `update public.harvest_city_state
     set harvest_status = 'geometry-ready',
         last_geometry_harvest_at = now(),
         last_cache_key = $2,
         last_feed_fingerprint = $3,
         last_error = null,
         updated_at = now()
     where city_slug = $1`,
    [slug, normalizeText(options.cacheKey) || null, normalizeText(options.feedFingerprint) || null]
  );
}

async function markStopsHarvested(citySlug) {
  assertLocalConfigured();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  await localQuery(
    `update public.harvest_city_state
     set harvest_status = 'ready',
         last_stops_harvest_at = now(),
         pending_refresh = false,
         last_error = null,
         updated_at = now()
     where city_slug = $1`,
    [slug]
  );
}

async function queueCityRefresh(citySlug) {
  assertLocalConfigured();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  await localQuery(
    "update public.harvest_city_state set harvest_status = 'queued', pending_refresh = true, updated_at = now() where city_slug = $1",
    [slug]
  );
}

async function markCityVerified(citySlug, changed) {
  assertLocalConfigured();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  const hasChanged = Boolean(changed);
  await localQuery(
    `update public.harvest_city_state
     set last_verified_at = now(),
         pending_refresh = $2,
         harvest_status = case when $2 then 'queued' else 'ready' end,
         updated_at = now()
     where city_slug = $1`,
    [slug, hasChanged]
  );
}

async function markCityHarvestError(citySlug, errorDetail) {
  assertLocalConfigured();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  const detail = normalizeText(errorDetail, "Harvest failed").slice(0, 420);
  await localQuery(
    "update public.harvest_city_state set harvest_status = 'retry', last_error = $2, updated_at = now() where city_slug = $1",
    [slug, detail]
  );
}

async function logHarvestJob(citySlug, phase, status, detail = "") {
  assertLocalConfigured();

  await localQuery(
    `insert into public.harvest_job_log (city_slug, phase, status, detail, created_at)
     values ($1, $2, $3, $4, now())`,
    [
      normalizeText(citySlug, "unknown"),
      normalizeText(phase, "phase"),
      normalizeText(status, "info"),
      normalizeText(detail).slice(0, 1200) || null
    ]
  );
}

async function getHarvestSummary() {
  assertLocalConfigured();
  const result = await localQuery("select harvest_status,pending_refresh,last_cache_key from public.harvest_city_state limit 20000");
  const rows = result.rows || [];

  let activeCachedCities = 0;
  let pendingHarvests = 0;
  let inProgress = 0;
  let ready = 0;

  for (const row of rows) {
    const status = normalizeText(row.harvest_status);
    if (normalizeText(row.last_cache_key)) {
      activeCachedCities += 1;
    }
    if (["pending", "queued", "retry"].includes(status) || row.pending_refresh === true) {
      pendingHarvests += 1;
    }
    if (status === "in-progress") {
      inProgress += 1;
    }
    if (status === "ready") {
      ready += 1;
    }
  }

  return {
    activeCachedCities,
    pendingHarvests,
    inProgress,
    ready,
    totalCities: rows.length
  };
}

async function getDatabaseFileStats() {
  assertLocalConfigured();
  const result = await localQuery("select pg_database_size(current_database())::bigint as size_bytes");
  const bytesValue = Number(result.rows?.[0]?.size_bytes || 0);

  return {
    dbPath,
    exists: true,
    sizeBytes: Number.isFinite(bytesValue) ? Math.max(0, bytesValue) : 0,
    modifiedAtMs: Date.now()
  };
}

module.exports = {
  ensureCityHarvestState,
  getCityHarvestState,
  listPendingHarvestCities,
  markHarvestInProgress,
  markGeometryHarvested,
  markStopsHarvested,
  queueCityRefresh,
  markCityVerified,
  markCityHarvestError,
  logHarvestJob,
  getHarvestSummary,
  getDatabaseFileStats
};
