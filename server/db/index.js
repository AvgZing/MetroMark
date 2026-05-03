const config = require("../config");
const { hasSupabaseConfig, requireSupabaseClients } = require("../supabase");
const {
  hasLocalPostgresConfig,
  initializeLocalPostgres,
  query: localQuery,
  localDbLabel
} = require("../postgres");

const dbPath = localDbLabel();

const stationOverrideCache = new Map();
let initializePromise = null;

function assertConfigured() {
  if (!hasSupabaseConfig) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
}

function assertLocalConfigured() {
  if (!hasLocalPostgresConfig()) {
    throw new Error(
      "Local PostgreSQL is not configured. Set METROMARK_LOCAL_PG_URL or METROMARK_LOCAL_PGHOST/METROMARK_LOCAL_PGDATABASE."
    );
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function toIsoFromEpoch(epochSeconds) {
  const numeric = Number(epochSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(numeric * 1000).toISOString();
}

function toEpochSeconds(isoText) {
  if (!isoText) {
    return null;
  }

  const parsed = Date.parse(String(isoText));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

function utcDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDisplayName(value) {
  return normalizeText(value, "MetroMark User");
}

function normalizeAuthError(error, fallbackMessage) {
  if (!error) {
    return new Error(fallbackMessage);
  }

  const message = normalizeText(error.message, fallbackMessage);
  const wrapped = new Error(message);
  wrapped.code = error.code;
  wrapped.status = error.status;
  return wrapped;
}

function normalizeProfileRow(row, authUser = null) {
  if (!row && !authUser) {
    return null;
  }

  const authMetadata = authUser?.user_metadata || {};
  const displayName = normalizeText(
    row?.display_name || authMetadata.display_name || authUser?.email?.split("@")[0],
    "MetroMark User"
  );

  const createdAtIso = row?.created_at || authUser?.created_at || nowIso();
  const lastLoginIso = row?.last_login_at || authUser?.last_sign_in_at || null;

  return {
    id: normalizeText(row?.id || authUser?.id),
    email: normalizeEmail(row?.email || authUser?.email || ""),
    displayName,
    role: normalizeText(row?.role, "user"),
    isActive: row?.is_active === false ? false : true,
    lastLoginAt: toEpochSeconds(lastLoginIso),
    createdAt: toEpochSeconds(createdAtIso) || nowSeconds()
  };
}

function normalizeCacheRow(row) {
  if (!row) {
    return null;
  }

  return {
    payload: row.payload,
    fetchedAt: toEpochSeconds(row.fetched_at),
    expiresAt: toEpochSeconds(row.expires_at),
    cacheKind: normalizeText(row.cache_kind, "bbox"),
    citySlug: normalizeText(row.city_slug),
    feedFingerprint: normalizeText(row.feed_fingerprint),
    verifiedAt: toEpochSeconds(row.verified_at)
  };
}

function normalizeBboxArray(value) {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every((entry) => Number.isFinite(entry))) {
    return null;
  }

  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (minLon >= maxLon || minLat >= maxLat) {
    return null;
  }

  return bbox;
}

function bboxIntersects(a, b) {
  return !(
    a[2] < b[0] ||
    a[0] > b[2] ||
    a[3] < b[1] ||
    a[1] > b[3]
  );
}

function normalizeGeometryForStorage(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates.filter((line) => Array.isArray(line) && line.length >= 2);
    if (!lines.length) {
      return null;
    }
    return {
      type: "MultiLineString",
      coordinates: lines
    };
  }

  if (geometry.type === "LineString") {
    if (geometry.coordinates.length < 2) {
      return null;
    }
    return {
      type: "MultiLineString",
      coordinates: [geometry.coordinates]
    };
  }

  return null;
}

function normalizeGeometryFromStorageRow(row) {
  if (!row) {
    return null;
  }

  const geometry = row.geometry_geojson || row.geometry || null;
  if (!geometry) {
    return null;
  }

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }

  return geometry;
}

function normalizeUsageRow(row, dayKey) {
  return {
    dayKey,
    restApiCalls: Number(row?.rest_api_calls || 0),
    vectorTileCalls: Number(row?.vector_tile_calls || 0),
    routingApiCalls: Number(row?.routing_api_calls || 0),
    updatedAt: toEpochSeconds(row?.updated_at) || 0
  };
}

function normalizeHarvestState(row) {
  if (!row) {
    return null;
  }

  return {
    citySlug: normalizeText(row.city_slug),
    cityName: normalizeText(row.city_name),
    harvestPriority: Number(row.harvest_priority || 100),
    harvestStatus: normalizeText(row.harvest_status, "pending"),
    lastGeometryHarvestAt: toEpochSeconds(row.last_geometry_harvest_at),
    lastStopsHarvestAt: toEpochSeconds(row.last_stops_harvest_at),
    lastVerifiedAt: toEpochSeconds(row.last_verified_at),
    lastFeedFingerprint: normalizeText(row.last_feed_fingerprint),
    lastCacheKey: normalizeText(row.last_cache_key),
    pendingRefresh: row.pending_refresh === true,
    lastError: normalizeText(row.last_error),
    updatedAt: toEpochSeconds(row.updated_at) || 0
  };
}

async function ensureProfile(user, options = {}) {
  const { serviceClient } = requireSupabaseClients();
  const userId = normalizeText(user?.id);
  if (!userId) {
    throw new Error("Cannot ensure profile without user id.");
  }

  const displayName = normalizeDisplayName(options.displayName || user?.user_metadata?.display_name);

  const payload = {
    id: userId,
    email: normalizeEmail(user?.email),
    display_name: displayName,
    created_at: options.createdAtIso || user?.created_at || nowIso()
  };

  if (Object.prototype.hasOwnProperty.call(options, "role")) {
    payload.role = normalizeText(options.role, "user");
  }

  if (Object.prototype.hasOwnProperty.call(options, "isActive")) {
    payload.is_active = options.isActive === false ? false : true;
  }

  const { error } = await serviceClient.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) {
    throw normalizeAuthError(error, "Unable to initialize profile.");
  }
}

async function getProfileById(userId) {
  const { serviceClient } = requireSupabaseClients();
  if (!userId) {
    return null;
  }

  const { data, error } = await serviceClient
    .from("profiles")
    .select("id,email,display_name,role,is_active,last_login_at,created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load profile: ${error.message}`);
  }

  return data || null;
}

async function markProfileLogin(userId) {
  const { serviceClient } = requireSupabaseClients();
  if (!userId) {
    return;
  }

  await serviceClient
    .from("profiles")
    .update({ last_login_at: nowIso() })
    .eq("id", userId);
}

async function loadStationOverridesCache() {
  assertLocalConfigured();
  const result = await localQuery(
    "select stable_key,manual_name,manual_lat,manual_lon,note,updated_at from public.station_override limit 20000"
  );

  stationOverrideCache.clear();

  for (const row of result.rows || []) {
    stationOverrideCache.set(row.stable_key, {
      stableKey: row.stable_key,
      manualName: row.manual_name,
      manualLat: Number.isFinite(Number(row.manual_lat)) ? Number(row.manual_lat) : null,
      manualLon: Number.isFinite(Number(row.manual_lon)) ? Number(row.manual_lon) : null,
      note: row.note,
      updatedAt: toEpochSeconds(row.updated_at) || 0
    });
  }
}

async function initializeStorage() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    assertLocalConfigured();
    await initializeLocalPostgres();
    await loadStationOverridesCache();
    return {
      backend: "local-postgres-postgis",
      endpoint: dbPath,
      authBackend: hasSupabaseConfig ? "supabase" : "unconfigured"
    };
  })();

  try {
    return await initializePromise;
  } catch (error) {
    initializePromise = null;
    throw error;
  }
}

async function registerAccount(email, password, displayName) {
  assertConfigured();
  const normalizedEmail = normalizeEmail(email);
  const safeName = normalizeDisplayName(displayName);

  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }

  const { anonClient } = requireSupabaseClients();
  const signUpResult = await anonClient.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        display_name: safeName
      }
    }
  });

  if (signUpResult.error) {
    throw normalizeAuthError(signUpResult.error, "Registration failed.");
  }

  let authUser = signUpResult.data.user;
  let session = signUpResult.data.session;

  if (!authUser) {
    throw new Error("Registration failed: user payload is empty.");
  }

  await ensureProfile(authUser, {
    displayName: safeName,
    role: "user",
    isActive: true,
    createdAtIso: authUser.created_at
  });

  if (!session) {
    const signInResult = await anonClient.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (signInResult.error || !signInResult.data?.session || !signInResult.data?.user) {
      throw new Error(
        "Account created, but no active session was returned. Check Supabase email confirmation settings."
      );
    }

    session = signInResult.data.session;
    authUser = signInResult.data.user;
  }

  await markProfileLogin(authUser.id);
  const profile = await getProfileById(authUser.id);

  return {
    user: normalizeProfileRow(profile, authUser),
    token: session.access_token
  };
}

async function loginAccount(email, password) {
  assertConfigured();
  const normalizedEmail = normalizeEmail(email);
  const { anonClient } = requireSupabaseClients();

  const signInResult = await anonClient.auth.signInWithPassword({
    email: normalizedEmail,
    password
  });

  if (signInResult.error || !signInResult.data?.session || !signInResult.data?.user) {
    throw new Error("Invalid email or password.");
  }

  const authUser = signInResult.data.user;
  await ensureProfile(authUser, {
    displayName: authUser.user_metadata?.display_name || authUser.email?.split("@")[0] || "MetroMark User",
    createdAtIso: authUser.created_at
  });

  const profile = await getProfileById(authUser.id);
  if (profile?.is_active === false) {
    throw new Error("Account is disabled.");
  }

  await markProfileLogin(authUser.id);

  return {
    user: normalizeProfileRow(profile, authUser),
    token: signInResult.data.session.access_token
  };
}

async function getUserFromToken(accessToken) {
  assertConfigured();
  const token = normalizeText(accessToken);
  if (!token) {
    return null;
  }

  const { serviceClient } = requireSupabaseClients();
  const userResult = await serviceClient.auth.getUser(token);

  if (userResult.error || !userResult.data?.user) {
    return null;
  }

  const authUser = userResult.data.user;
  await ensureProfile(authUser, {
    displayName: authUser.user_metadata?.display_name || authUser.email?.split("@")[0] || "MetroMark User",
    createdAtIso: authUser.created_at
  });

  const profile = await getProfileById(authUser.id);
  return normalizeProfileRow(profile, authUser);
}

async function getUserById(userId) {
  const profile = await getProfileById(userId);
  return normalizeProfileRow(profile, null);
}

async function getUserByEmail(email) {
  assertConfigured();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const { serviceClient } = requireSupabaseClients();
  const { data, error } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });

  if (error) {
    throw new Error(`Unable to query users: ${error.message}`);
  }

  const user = (data?.users || []).find((entry) => normalizeEmail(entry.email) === normalizedEmail);
  if (!user) {
    return null;
  }

  const profile = await getProfileById(user.id);
  return normalizeProfileRow(profile, user);
}

async function createUser(email, password, displayName) {
  const result = await registerAccount(email, password, displayName);
  return result.user;
}

async function verifyUser(email, password) {
  const result = await loginAccount(email, password);
  return result.user;
}

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
  const { rows } = await localQuery(
    "select cache_key,payload,fetched_at,expires_at,cache_kind,city_slug,feed_fingerprint,verified_at from public.transit_cache where cache_key = $1 limit 1",
    [cacheKey]
  );

  return normalizeCacheRow(rows?.[0] || null);
}

// Query cache by spatial bbox intersection - finds overlapping cached data
async function getCacheByBbox(minLon, minLat, maxLon, maxLat, options = {}) {
  assertLocalConfigured();
  const includeExpired = Boolean(options.includeExpired);
  const whereClause = includeExpired ? "" : "AND c.expires_at > now()";
  
  const { rows } = await localQuery(
    `SELECT c.cache_key, c.payload, c.fetched_at, c.expires_at, c.cache_kind, 
            c.city_slug, c.feed_fingerprint, c.verified_at
     FROM public.transit_cache c
     WHERE c.bbox_geom IS NOT NULL 
       AND ST_Intersects(
             c.bbox_geom,
             ST_MakeEnvelope($1, $2, $3, $4, 4326)
           )
       ${whereClause}
     ORDER BY c.cache_kind DESC, c.fetched_at DESC
     LIMIT 200`,
    [minLon, minLat, maxLon, maxLat]
  );

  if (Array.isArray(rows) && rows.length > 0) {
    return rows.map((r) => normalizeCacheRow(r));
  }

  // Fallback for legacy rows that may not have bbox_geom populated.
  // Use payload.area.bbox for overlap checks in application code.
  const { rows: fallbackRows } = await localQuery(
    `SELECT c.cache_key, c.payload, c.fetched_at, c.expires_at, c.cache_kind,
            c.city_slug, c.feed_fingerprint, c.verified_at
     FROM public.transit_cache c
     WHERE c.bbox_geom IS NULL
       ${whereClause}
     ORDER BY c.cache_kind DESC, c.fetched_at DESC
     LIMIT 5000`,
    []
  );

  const viewportBbox = [minLon, minLat, maxLon, maxLat];
  const matchedFallbackRows = (fallbackRows || []).filter((row) => {
    const payloadBbox = normalizeBboxArray(row?.payload?.area?.bbox);
    if (!payloadBbox) {
      return false;
    }
    return bboxIntersects(viewportBbox, payloadBbox);
  });

  return matchedFallbackRows.slice(0, 200).map((row) => normalizeCacheRow(row));
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

async function getRouteGeometryLod(lineKey, zoomLevel, options = {}) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  const numericZoom = Number(zoomLevel);
  if (!normalizedLineKey || !Number.isFinite(numericZoom)) {
    return null;
  }

  const bbox = Array.isArray(options.bbox) && options.bbox.length === 4
    ? options.bbox.map((value) => Number(value))
    : null;

  const selectColumns = bbox
    ? `case
        when ST_IsEmpty(
          ST_CollectionExtract(
            ST_Intersection(
              geometry,
              ST_MakeEnvelope($3, $4, $5, $6, 4326)
            ),
            2
          )
        ) then null
        else ST_AsGeoJSON(
          ST_CollectionExtract(
            ST_Intersection(
              geometry,
              ST_MakeEnvelope($3, $4, $5, $6, 4326)
            ),
            2
          )
        )::json
      end as geometry_geojson`
    : `ST_AsGeoJSON(geometry)::json as geometry_geojson`;

  const params = bbox
    ? [normalizedLineKey, Math.round(numericZoom), bbox[0], bbox[1], bbox[2], bbox[3]]
    : [normalizedLineKey, Math.round(numericZoom)];

  // Prefer the highest stored zoom_level that is <= requested zoomLevel
  const whereClause = bbox
    ? `where line_key = $1 and zoom_level <= $2`
    : `where line_key = $1 and zoom_level <= $2`;

  const orderClause = `order by zoom_level desc limit 1`;

  const { rows } = await localQuery(
    `select line_key, zoom_level, source_hash, updated_at, ${selectColumns}
     from public.route_geometry_lod
     ${whereClause}
     ${orderClause}`,
    params
  );

  const row = rows?.[0] || null;
  const geometry = normalizeGeometryFromStorageRow(row);
  if (!geometry) {
    return null;
  }

  return {
    lineKey: normalizeText(row.line_key),
    zoomLevel: Number(row.zoom_level),
    sourceHash: normalizeText(row.source_hash),
    updatedAt: toEpochSeconds(row.updated_at),
    geometry
  };
}

async function getFractionOnRoute(lineKey, lon, lat, options = {}) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  const zg = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : null;
  const numericLon = Number(lon);
  const numericLat = Number(lat);

  if (!normalizedLineKey || !Number.isFinite(numericLon) || !Number.isFinite(numericLat)) {
    return null;
  }

  const params = zg !== null ? [normalizedLineKey, Math.round(zg), numericLon, numericLat] : [normalizedLineKey, 1000, numericLon, numericLat];

  // Select the best available geometry (highest zoom_level <= requested zoom)
  // and compute ST_LineLocatePoint fraction for the provided point.
  const sql = `select
      line_key,
      zoom_level,
      source_hash,
      updated_at,
      ST_LineLocatePoint(ST_LineMerge(geometry), ST_SetSRID(ST_MakePoint($3, $4), 4326)) as fraction
    from public.route_geometry_lod
    where line_key = $1 and zoom_level <= $2
    order by zoom_level desc
    limit 1`;

  const result = await localQuery(sql, params);
  const row = result.rows?.[0] || null;
  if (!row || row.fraction === null || row.fraction === undefined) {
    return null;
  }

  return {
    lineKey: normalizeText(row.line_key),
    zoomLevel: Number(row.zoom_level),
    sourceHash: normalizeText(row.source_hash),
    updatedAt: toEpochSeconds(row.updated_at),
    fraction: Number(row.fraction)
  };
}

async function upsertRouteGeometryLod(lineKey, zoomLevel, geometry, options = {}) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  const numericZoom = Number(zoomLevel);
  const geometryForStorage = normalizeGeometryForStorage(geometry);
  if (!normalizedLineKey || !Number.isFinite(numericZoom) || !geometryForStorage) {
    return null;
  }

  const sourceHash = normalizeText(options.sourceHash) || null;

  await localQuery(
    `insert into public.route_geometry_lod (
      line_key,
      zoom_level,
      geometry,
      source_hash,
      updated_at
    ) values (
      $1,
      $2,
      ST_SetSRID(ST_GeomFromGeoJSON($3::text), 4326),
      $4,
      now()
    )
    on conflict (line_key, zoom_level) do update set
      geometry = excluded.geometry,
      source_hash = excluded.source_hash,
      updated_at = excluded.updated_at`,
    [
      normalizedLineKey,
      Math.round(numericZoom),
      JSON.stringify(geometryForStorage),
      sourceHash
    ]
  );

  return {
    lineKey: normalizedLineKey,
    zoomLevel: Math.round(numericZoom),
    geometry: geometryForStorage,
    sourceHash
  };
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

async function getAccountStats() {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const profileTotalQuery = await serviceClient
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (profileTotalQuery.error) {
    throw new Error(`Unable to read profile count: ${profileTotalQuery.error.message}`);
  }

  const profileActiveQuery = await serviceClient
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (profileActiveQuery.error) {
    throw new Error(`Unable to read active profile count: ${profileActiveQuery.error.message}`);
  }

  const visitsTotalQuery = await serviceClient
    .from("user_station_visit")
    .select("station_key", { count: "exact", head: true })
    .eq("visited", true);

  if (visitsTotalQuery.error) {
    throw new Error(`Unable to read visit count: ${visitsTotalQuery.error.message}`);
  }

  const recentProfilesQuery = await serviceClient
    .from("profiles")
    .select("last_login_at")
    .order("last_login_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (recentProfilesQuery.error) {
    throw new Error(`Unable to read latest login timestamp: ${recentProfilesQuery.error.message}`);
  }

  const latestLoginIso = recentProfilesQuery.data?.[0]?.last_login_at || null;

  return {
    profilesTotal: Number(profileTotalQuery.count || 0),
    profilesActive: Number(profileActiveQuery.count || 0),
    visitedStationRows: Number(visitsTotalQuery.count || 0),
    latestLoginAtMs: latestLoginIso ? Date.parse(latestLoginIso) : null
  };
}

function upsertStopTranslation(inputStopId, stableKey, source = "transitland") {
  const safeInput = normalizeText(inputStopId);
  const safeStable = normalizeText(stableKey);
  const safeSource = normalizeText(source, "transitland");

  if (!safeInput || !safeStable) {
    return;
  }

  if (!hasLocalPostgresConfig()) {
    return;
  }

  localQuery(
    `insert into public.stop_translation (input_stop_id, stable_key, source, updated_at)
     values ($1, $2, $3, now())
     on conflict (input_stop_id) do update set
       stable_key = excluded.stable_key,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    [safeInput, safeStable, safeSource]
  ).catch(() => {});
}

function getStationOverride(stableKey) {
  return stationOverrideCache.get(normalizeText(stableKey)) || null;
}

async function upsertStationOverride(stableKey, manualName, manualLat, manualLon, note) {
  assertLocalConfigured();

  const safeKey = normalizeText(stableKey);
  if (!safeKey) {
    throw new Error("stableKey is required.");
  }

  const payload = {
    stable_key: safeKey,
    manual_name: normalizeText(manualName) || null,
    manual_lat: Number.isFinite(Number(manualLat)) ? Number(manualLat) : null,
    manual_lon: Number.isFinite(Number(manualLon)) ? Number(manualLon) : null,
    note: normalizeText(note) || null
  };

  await localQuery(
    `insert into public.station_override (stable_key, manual_name, manual_lat, manual_lon, note, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (stable_key) do update set
       manual_name = excluded.manual_name,
       manual_lat = excluded.manual_lat,
       manual_lon = excluded.manual_lon,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [payload.stable_key, payload.manual_name, payload.manual_lat, payload.manual_lon, payload.note]
  );

  stationOverrideCache.set(safeKey, {
    stableKey: safeKey,
    manualName: payload.manual_name,
    manualLat: payload.manual_lat,
    manualLon: payload.manual_lon,
    note: payload.note,
    updatedAt: nowSeconds()
  });
}

async function setVisitedState(userId, payload) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  const lineKey = normalizeText(payload.lineKey);
  const stationKey = normalizeText(payload.stationKey);
  const stationName = normalizeText(payload.stationName, "Unnamed Stop");
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const visited = Boolean(payload.visited);

  if (!safeUserId || !lineKey || !stationKey || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid station payload.");
  }

  if (!visited) {
    const { error } = await serviceClient
      .from("user_station_visit")
      .delete()
      .eq("user_id", safeUserId)
      .eq("line_key", lineKey)
      .eq("station_key", stationKey);

    if (error) {
      throw new Error(`Unable to remove visited station: ${error.message}`);
    }

    return;
  }

  const { error } = await serviceClient.from("user_station_visit").upsert(
    {
      user_id: safeUserId,
      line_key: lineKey,
      station_key: stationKey,
      station_name: stationName,
      lat,
      lon,
      visited: true,
      updated_at: nowIso()
    },
    {
      onConflict: "user_id,line_key,station_key"
    }
  );

  if (error) {
    throw new Error(`Unable to save visited station: ${error.message}`);
  }
}

async function getVisitedStations(userId, lineKey = "") {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  if (!safeUserId) {
    return [];
  }

  let query = serviceClient
    .from("user_station_visit")
    .select("line_key,station_key,station_name,lat,lon,updated_at")
    .eq("user_id", safeUserId)
    .eq("visited", true)
    .order("updated_at", { ascending: false });

  const normalizedLineKey = normalizeText(lineKey);
  if (normalizedLineKey) {
    query = query.eq("line_key", normalizedLineKey);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to read progress: ${error.message}`);
  }

  return (data || []).map((row) => ({
    lineKey: row.line_key,
    stationKey: row.station_key,
    stationName: row.station_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    updatedAt: toEpochSeconds(row.updated_at) || 0
  }));
}

async function clearVisitedStationsForLine(userId, lineKey) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  const normalizedLineKey = normalizeText(lineKey);
  if (!safeUserId || !normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  const existing = await serviceClient
    .from("user_station_visit")
    .select("station_key", { count: "exact", head: true })
    .eq("user_id", safeUserId)
    .eq("line_key", normalizedLineKey)
    .eq("visited", true);

  if (existing.error) {
    throw new Error(`Unable to read progress count: ${existing.error.message}`);
  }

  const { error } = await serviceClient
    .from("user_station_visit")
    .delete()
    .eq("user_id", safeUserId)
    .eq("line_key", normalizedLineKey);

  if (error) {
    throw new Error(`Unable to clear route progress: ${error.message}`);
  }

  return Number(existing.count || 0);
}

function normalizePresetRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: normalizeText(row.id),
    name: normalizeText(row.name),
    citySlug: normalizeText(row.city_slug),
    snapshot: row.snapshot || {},
    createdAt: toEpochSeconds(row.created_at) || 0,
    updatedAt: toEpochSeconds(row.updated_at) || 0
  };
}

async function listFilterPresets(userId, citySlug = "") {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  if (!safeUserId) {
    return [];
  }

  let query = serviceClient
    .from("user_filter_presets")
    .select("id,name,city_slug,snapshot,created_at,updated_at")
    .eq("user_id", safeUserId)
    .order("name", { ascending: true });

  const normalizedCitySlug = normalizeText(citySlug);
  if (normalizedCitySlug) {
    query = query.eq("city_slug", normalizedCitySlug);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to load presets: ${error.message}`);
  }

  return (data || []).map((row) => normalizePresetRow(row)).filter(Boolean);
}

async function upsertFilterPreset(userId, payload) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  const name = normalizeText(payload?.name);
  const citySlug = normalizeText(payload?.citySlug);
  const snapshot = payload?.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null;

  if (!safeUserId || !name || !citySlug || !snapshot) {
    throw new Error("Invalid preset payload.");
  }

  const record = {
    user_id: safeUserId,
    name,
    city_slug: citySlug,
    snapshot,
    updated_at: nowIso()
  };

  const { data, error } = await serviceClient
    .from("user_filter_presets")
    .upsert(record, { onConflict: "user_id,city_slug,name" })
    .select("id,name,city_slug,snapshot,created_at,updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to save preset: ${error.message}`);
  }

  return normalizePresetRow(data);
}

async function deleteFilterPreset(userId, presetId) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  const normalizedPresetId = normalizeText(presetId);
  if (!safeUserId || !normalizedPresetId) {
    throw new Error("presetId is required.");
  }

  const { error } = await serviceClient
    .from("user_filter_presets")
    .delete()
    .eq("id", normalizedPresetId)
    .eq("user_id", safeUserId);

  if (error) {
    throw new Error(`Unable to delete preset: ${error.message}`);
  }
}

function dayKeyFromTimestamp(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  return utcDateKey(date);
}

async function ensureUsageDay(dayKey) {
  assertLocalConfigured();
  await localQuery(
    `insert into public.usage_log (day_key, updated_at)
     values ($1, now())
     on conflict (day_key) do update set updated_at = excluded.updated_at`,
    [dayKey]
  );
}

async function getUsageForDay(dayKey) {
  assertLocalConfigured();
  const normalized = normalizeText(dayKey) || utcDateKey();
  await ensureUsageDay(normalized);

  const result = await localQuery(
    "select day_key,rest_api_calls,vector_tile_calls,routing_api_calls,updated_at from public.usage_log where day_key = $1 limit 1",
    [normalized]
  );

  return normalizeUsageRow(result.rows?.[0] || null, normalized);
}

async function getTodayUsage() {
  return getUsageForDay(utcDateKey());
}

async function incrementUsage(kind, amount = 1) {
  assertLocalConfigured();
  const safeKind = normalizeText(kind).toLowerCase();
  const safeAmount = Math.max(0, Number(amount || 0));
  if (!safeAmount) {
    return getTodayUsage();
  }

  const dayKey = utcDateKey();
  if (safeKind === "rest") {
    await localQuery(
      `insert into public.usage_log (day_key, rest_api_calls, updated_at)
       values ($1, $2, now())
       on conflict (day_key) do update set
         rest_api_calls = public.usage_log.rest_api_calls + excluded.rest_api_calls,
         updated_at = excluded.updated_at`,
      [dayKey, safeAmount]
    );
  } else if (safeKind === "vector") {
    await localQuery(
      `insert into public.usage_log (day_key, vector_tile_calls, updated_at)
       values ($1, $2, now())
       on conflict (day_key) do update set
         vector_tile_calls = public.usage_log.vector_tile_calls + excluded.vector_tile_calls,
         updated_at = excluded.updated_at`,
      [dayKey, safeAmount]
    );
  } else if (safeKind === "routing") {
    await localQuery(
      `insert into public.usage_log (day_key, routing_api_calls, updated_at)
       values ($1, $2, now())
       on conflict (day_key) do update set
         routing_api_calls = public.usage_log.routing_api_calls + excluded.routing_api_calls,
         updated_at = excluded.updated_at`,
      [dayKey, safeAmount]
    );
  } else {
    throw new Error(`Unknown usage kind: ${safeKind}`);
  }

  return getUsageForDay(dayKey);
}

async function getDailyUsageCapsState(limits) {
  const usage = await getTodayUsage();
  const restLimit = Math.max(1, Number(limits?.rest || 250));
  const vectorLimit = Math.max(1, Number(limits?.vector || 2500));
  const routingLimit = Math.max(1, Number(limits?.routing || 250));

  const restRemaining = Math.max(0, restLimit - usage.restApiCalls);
  const vectorRemaining = Math.max(0, vectorLimit - usage.vectorTileCalls);
  const routingRemaining = Math.max(0, routingLimit - usage.routingApiCalls);

  return {
    usage,
    limits: {
      rest: restLimit,
      vector: vectorLimit,
      routing: routingLimit
    },
    remaining: {
      rest: restRemaining,
      vector: vectorRemaining,
      routing: routingRemaining
    },
    reached: {
      rest: usage.restApiCalls >= restLimit,
      vector: usage.vectorTileCalls >= vectorLimit,
      routing: usage.routingApiCalls >= routingLimit
    },
    backgroundAllowed: !(
      usage.restApiCalls >= restLimit ||
      usage.vectorTileCalls >= vectorLimit ||
      usage.routingApiCalls >= routingLimit
    )
  };
}

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

async function getRouteOverride(lineKey) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) return null;
  const result = await localQuery(
    "select line_key, city_slug, payload, updated_at from public.route_override where line_key = $1 limit 1",
    [key]
  );
  return result.rows?.[0] || null;
}

async function listRouteOverrides(citySlug = "") {
  assertLocalConfigured();
  if (normalizeText(citySlug)) {
    const result = await localQuery(
      "select line_key, city_slug, payload, updated_at from public.route_override where city_slug = $1 limit 5000",
      [normalizeText(citySlug)]
    );
    return result.rows || [];
  }

  const result = await localQuery("select line_key, city_slug, payload, updated_at from public.route_override limit 5000");
  return result.rows || [];
}

async function upsertRouteOverride(lineKey, citySlug, payload) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) throw new Error("lineKey is required");
  const city = normalizeText(citySlug) || null;
  const jsonPayload = payload && typeof payload === "object" ? payload : JSON.parse(JSON.stringify(payload || {}));

  await localQuery(
    `insert into public.route_override (line_key, city_slug, payload, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (line_key) do update set
       city_slug = excluded.city_slug,
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
    [key, city, JSON.stringify(jsonPayload)]
  );

  return getRouteOverride(key);
}

async function deleteRouteOverride(lineKey) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) return;
  await localQuery("delete from public.route_override where line_key = $1", [key]);
}

async function getRouteReview(lineKey) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) return null;
  const result = await localQuery(
    "select line_key, city_slug, problematic_override, updated_at from public.route_review where line_key = $1 limit 1",
    [key]
  );
  return result.rows?.[0] || null;
}

async function listRouteReviews(citySlug = "") {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  if (city) {
    const result = await localQuery(
      "select line_key, city_slug, problematic_override, updated_at from public.route_review where city_slug = $1 limit 10000",
      [city]
    );
    return result.rows || [];
  }

  const result = await localQuery(
    "select line_key, city_slug, problematic_override, updated_at from public.route_review limit 10000"
  );
  return result.rows || [];
}

async function upsertRouteReview(lineKey, citySlug, problematicOverride) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) throw new Error("lineKey is required");
  const city = normalizeText(citySlug) || null;
  const normalizedValue =
    problematicOverride === null || problematicOverride === undefined
      ? null
      : Boolean(problematicOverride);

  await localQuery(
    `insert into public.route_review (line_key, city_slug, problematic_override, updated_at)
     values ($1, $2, $3, now())
     on conflict (line_key) do update set
       city_slug = excluded.city_slug,
       problematic_override = excluded.problematic_override,
       updated_at = excluded.updated_at`,
    [key, city, normalizedValue]
  );

  return getRouteReview(key);
}

async function getAgencyReview(citySlug, operatorName) {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  const operator = normalizeText(operatorName);
  if (!city || !operator) return null;

  const result = await localQuery(
    "select city_slug, operator_name, allowed_override, updated_at from public.agency_review where city_slug = $1 and operator_name = $2 limit 1",
    [city, operator]
  );
  return result.rows?.[0] || null;
}

async function listAgencyReviews(citySlug = "") {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  if (city) {
    const result = await localQuery(
      "select city_slug, operator_name, allowed_override, updated_at from public.agency_review where city_slug = $1 order by operator_name asc limit 10000",
      [city]
    );
    return result.rows || [];
  }

  const result = await localQuery(
    "select city_slug, operator_name, allowed_override, updated_at from public.agency_review order by city_slug asc, operator_name asc limit 20000"
  );
  return result.rows || [];
}

async function upsertAgencyReview(citySlug, operatorName, allowedOverride) {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  const operator = normalizeText(operatorName);
  if (!city) throw new Error("citySlug is required");
  if (!operator) throw new Error("operatorName is required");

  const normalizedValue =
    allowedOverride === null || allowedOverride === undefined ? null : Boolean(allowedOverride);

  await localQuery(
    `insert into public.agency_review (city_slug, operator_name, allowed_override, updated_at)
     values ($1, $2, $3, now())
     on conflict (city_slug, operator_name) do update set
       allowed_override = excluded.allowed_override,
       updated_at = excluded.updated_at`,
    [city, operator, normalizedValue]
  );

  return getAgencyReview(city, operator);
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
  dbPath,
  initializeStorage,
  registerAccount,
  loginAccount,
  getUserFromToken,
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  getCache,
  getCacheAny,
  getCacheByBbox,
  setCache,
  getRouteGeometryLod,
  upsertRouteGeometryLod,
  getFractionOnRoute,
  clearCacheByPrefix,
  getCacheStats,
  getAccountStats,
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride,
  getRouteOverride,
  listRouteOverrides,
  upsertRouteOverride,
  deleteRouteOverride,
  getRouteReview,
  listRouteReviews,
  upsertRouteReview,
  getAgencyReview,
  listAgencyReviews,
  upsertAgencyReview,
  setVisitedState,
  getVisitedStations,
  clearVisitedStationsForLine,
  listFilterPresets,
  upsertFilterPreset,
  deleteFilterPreset,
  dayKeyFromTimestamp,
  getUsageForDay,
  getTodayUsage,
  incrementUsage,
  getDailyUsageCapsState,
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
