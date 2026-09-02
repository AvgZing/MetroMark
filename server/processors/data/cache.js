const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeCacheRow, normalizeText, nowSeconds, toEpochSeconds } = require("./utils");
const { createLogger } = require("../../admin/logger");

const log = createLogger("server");

async function getCache(cacheKey) {
  assertLocalConfigured();
  const { rows } = await localQuery(
    "select cache_key,payload,fetched_at,expires_at,cache_kind,city_slug,feed_fingerprint,verified_at from public.transit_cache where cache_key = $1 and expires_at > now() limit 1",
    [cacheKey]
  );

  return normalizeCacheRow(rows?.[0] || null);
}

async function getCacheAny(cacheKey) {
  assertLocalConfigured();
  const t0 = Date.now();
  const { rows } = await localQuery(
    "select cache_key,payload,fetched_at,expires_at,cache_kind,city_slug,feed_fingerprint,verified_at from public.transit_cache where cache_key = $1 limit 1",
    [cacheKey]
  );
  const elapsed = Date.now() - t0;
  if (elapsed > 50) {
    // Slow cache reads are diagnostic detail, not console noise: they'd spam
    // the server console on every route load. File-only via debug().
    log.debug(`getCacheAny(${cacheKey.slice(0, 60)}): ${elapsed}ms`);
  }
  return normalizeCacheRow(rows?.[0] || null);
}

// Query cache by spatial bbox intersection - finds overlapping cached data
async function getCacheByBbox(minLon, minLat, maxLon, maxLat, options = {}) {
  assertLocalConfigured();
  const includeExpired = Boolean(options.includeExpired);
  const whereClause = includeExpired ? "" : "AND c.expires_at > now()";

  // Phase 1: find matching cache keys (fast — no payload column)
  const { rows: keyRows } = await localQuery(
    `SELECT c.cache_key
     FROM public.transit_cache c
     WHERE c.bbox_geom IS NOT NULL 
       AND ST_Intersects(
             c.bbox_geom,
             ST_MakeEnvelope($1, $2, $3, $4, 4326)
           )
       ${whereClause}
     LIMIT 30`,
    [minLon, minLat, maxLon, maxLat]
  );

  if (!Array.isArray(keyRows) || keyRows.length === 0) {
    return [];
  }

  // Phase 2: fetch full payloads for matching keys using PK lookups
  const cacheKeys = keyRows.map((r) => r.cache_key);
  const payloads = [];
  for (const key of cacheKeys) {
    const cached = await getCacheAny(key);
    if (cached) {
      payloads.push(cached);
    }
  }

  return payloads;
}

async function setCache(cacheKey, payload, ttlSeconds, options = {}) {
  assertLocalConfigured();
  const fetchedAt = nowSeconds();
  const expiresAt = fetchedAt + Math.max(60, Number(ttlSeconds || 0));

  // Extract bbox from payload to populate bbox_geom for spatial queries
  let bboxGeomParam = null;
  const area = payload?.area;
  if (Array.isArray(area?.bbox) && area.bbox.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = area.bbox;
    bboxGeomParam = `SRID=4326;POLYGON((${minLon} ${minLat}, ${maxLon} ${minLat}, ${maxLon} ${maxLat}, ${minLon} ${maxLat}, ${minLon} ${minLat}))`;
  }

  await localQuery(
    `insert into public.transit_cache (
      cache_key,
      payload,
      fetched_at,
      expires_at,
      cache_kind,
      city_slug,
      feed_fingerprint,
      verified_at,
      bbox_geom
    ) values ($1, $2::jsonb, to_timestamp($3), to_timestamp($4), $5, $6, $7, to_timestamp($8), ${bboxGeomParam ? 'ST_GeomFromEWKT($9)' : 'NULL'})
    on conflict (cache_key) do update set
      payload = excluded.payload,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      cache_kind = excluded.cache_kind,
      city_slug = excluded.city_slug,
      feed_fingerprint = excluded.feed_fingerprint,
      verified_at = excluded.verified_at,
      bbox_geom = excluded.bbox_geom`,
    [
      cacheKey,
      JSON.stringify(payload),
      fetchedAt,
      expiresAt,
      normalizeText(options.cacheKind, "bbox"),
      normalizeText(options.citySlug) || null,
      normalizeText(options.feedFingerprint) || null,
      Number.isFinite(Number(options.verifiedAt)) ? Number(options.verifiedAt) : fetchedAt,
      ...(bboxGeomParam ? [bboxGeomParam] : [])
    ]
  );
}

async function clearCacheByPrefix(prefix) {
  assertLocalConfigured();
  await localQuery("delete from public.transit_cache where cache_key like $1", [`${prefix}%`]);
}

async function getCacheStats() {
  assertLocalConfigured();
  const totalQuery = await localQuery("select count(*)::bigint as count from public.transit_cache");
  const rowsQuery = await localQuery("select cache_kind, city_slug from public.transit_cache limit 50000");

  const byKind = {};
  let withCitySlug = 0;

  for (const row of rowsQuery.rows || []) {
    const kind = normalizeText(row.cache_kind, "bbox");
    byKind[kind] = Number(byKind[kind] || 0) + 1;
    if (normalizeText(row.city_slug)) {
      withCitySlug += 1;
    }
  }

  return {
    total: Number(totalQuery.rows?.[0]?.count || 0),
    byKind,
    withCitySlug
  };
}

module.exports = {
  getCache,
  getCacheAny,
  getCacheByBbox,
  setCache,
  clearCacheByPrefix,
  getCacheStats
};
