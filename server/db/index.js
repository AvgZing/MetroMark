const config = require("../config");
const { hasSupabaseConfig, requireSupabaseClients } = require("../supabase");

const DEMO_DEFAULT_NAME = String(config.DEMO_USER_NAME || "Demo Rider").trim() || "Demo Rider";
const dbPath = config.SUPABASE_URL || "supabase://not-configured";

const stationOverrideCache = new Map();
let initializePromise = null;

function assertConfigured() {
  if (!hasSupabaseConfig) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
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
  const { serviceClient } = requireSupabaseClients();
  const { data, error } = await serviceClient
    .from("station_override")
    .select("stable_key,manual_name,manual_lat,manual_lon,note,updated_at")
    .limit(20000);

  if (error) {
    throw new Error(`Unable to load station overrides: ${error.message}`);
  }

  stationOverrideCache.clear();

  for (const row of data || []) {
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

async function ensureDemoUser() {
  const email = normalizeEmail(config.DEMO_USER_EMAIL);
  const password = String(config.DEMO_USER_PASSWORD || "").trim();
  if (!email || !password) {
    return null;
  }

  const { anonClient, serviceClient } = requireSupabaseClients();
  const signInAttempt = await anonClient.auth.signInWithPassword({
    email,
    password
  });

  let authUser = signInAttempt?.data?.user || null;

  if (signInAttempt.error || !authUser) {
    const createResult = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: DEMO_DEFAULT_NAME
      }
    });

    if (createResult.error) {
      const message = String(createResult.error.message || "").toLowerCase();
      if (!message.includes("already") && !message.includes("exists")) {
        throw normalizeAuthError(createResult.error, "Unable to create demo account.");
      }
    }

    const secondSignIn = await anonClient.auth.signInWithPassword({
      email,
      password
    });

    if (secondSignIn.error || !secondSignIn.data?.user) {
      return null;
    }

    authUser = secondSignIn.data.user;
  }

  await ensureProfile(authUser, {
    displayName: DEMO_DEFAULT_NAME,
    role: "user",
    isActive: true
  });

  return authUser;
}

async function initializeStorage() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    assertConfigured();
    await loadStationOverridesCache();
    await ensureDemoUser();
    return {
      backend: "supabase-postgis",
      endpoint: dbPath
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

async function loginDemoAccount() {
  await ensureDemoUser();
  return loginAccount(config.DEMO_USER_EMAIL, config.DEMO_USER_PASSWORD);
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

async function seedDemoUser() {
  const demo = await ensureDemoUser();
  if (!demo) {
    return null;
  }
  const profile = await getProfileById(demo.id);
  return normalizeProfileRow(profile, demo);
}

async function getCache(cacheKey) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const { data, error } = await serviceClient
    .from("transit_cache")
    .select("cache_key,payload,fetched_at,expires_at,cache_kind,city_slug,feed_fingerprint,verified_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", nowIso())
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read cache: ${error.message}`);
  }

  return normalizeCacheRow(data);
}

async function getCacheAny(cacheKey) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const { data, error } = await serviceClient
    .from("transit_cache")
    .select("cache_key,payload,fetched_at,expires_at,cache_kind,city_slug,feed_fingerprint,verified_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read cache: ${error.message}`);
  }

  return normalizeCacheRow(data);
}

async function setCache(cacheKey, payload, ttlSeconds, options = {}) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const fetchedAt = nowSeconds();
  const expiresAt = fetchedAt + Math.max(60, Number(ttlSeconds || 0));

  const row = {
    cache_key: cacheKey,
    payload,
    fetched_at: toIsoFromEpoch(fetchedAt),
    expires_at: toIsoFromEpoch(expiresAt),
    cache_kind: normalizeText(options.cacheKind, "bbox"),
    city_slug: normalizeText(options.citySlug) || null,
    feed_fingerprint: normalizeText(options.feedFingerprint) || null,
    verified_at: toIsoFromEpoch(
      Number.isFinite(Number(options.verifiedAt)) ? Number(options.verifiedAt) : fetchedAt
    )
  };

  const { error } = await serviceClient.from("transit_cache").upsert(row, {
    onConflict: "cache_key"
  });

  if (error) {
    throw new Error(`Unable to write cache: ${error.message}`);
  }
}

async function clearCacheByPrefix(prefix) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const { error } = await serviceClient.from("transit_cache").delete().like("cache_key", `${prefix}%`);

  if (error) {
    throw new Error(`Unable to clear cache: ${error.message}`);
  }
}

async function getCacheStats() {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const totalQuery = await serviceClient
    .from("transit_cache")
    .select("cache_key", { count: "exact", head: true });

  if (totalQuery.error) {
    throw new Error(`Unable to read cache stats: ${totalQuery.error.message}`);
  }

  const rowsQuery = await serviceClient
    .from("transit_cache")
    .select("cache_kind,city_slug")
    .limit(50000);

  if (rowsQuery.error) {
    throw new Error(`Unable to read cache kind stats: ${rowsQuery.error.message}`);
  }

  const byKind = {};
  let withCitySlug = 0;

  for (const row of rowsQuery.data || []) {
    const kind = normalizeText(row.cache_kind, "bbox");
    byKind[kind] = Number(byKind[kind] || 0) + 1;
    if (normalizeText(row.city_slug)) {
      withCitySlug += 1;
    }
  }

  return {
    total: Number(totalQuery.count || 0),
    byKind,
    withCitySlug
  };
}

function upsertStopTranslation(inputStopId, stableKey, source = "transitland") {
  const safeInput = normalizeText(inputStopId);
  const safeStable = normalizeText(stableKey);
  const safeSource = normalizeText(source, "transitland");

  if (!safeInput || !safeStable || !hasSupabaseConfig) {
    return;
  }

  const { serviceClient } = requireSupabaseClients();
  const payload = {
    input_stop_id: safeInput,
    stable_key: safeStable,
    source: safeSource,
    updated_at: nowIso()
  };

  serviceClient
    .from("stop_translation")
    .upsert(payload, { onConflict: "input_stop_id" })
    .then(() => {})
    .catch(() => {});
}

function getStationOverride(stableKey) {
  return stationOverrideCache.get(normalizeText(stableKey)) || null;
}

async function upsertStationOverride(stableKey, manualName, manualLat, manualLon, note) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeKey = normalizeText(stableKey);
  if (!safeKey) {
    throw new Error("stableKey is required.");
  }

  const payload = {
    stable_key: safeKey,
    manual_name: normalizeText(manualName) || null,
    manual_lat: Number.isFinite(Number(manualLat)) ? Number(manualLat) : null,
    manual_lon: Number.isFinite(Number(manualLon)) ? Number(manualLon) : null,
    note: normalizeText(note) || null,
    updated_at: nowIso()
  };

  const { error } = await serviceClient
    .from("station_override")
    .upsert(payload, { onConflict: "stable_key" });

  if (error) {
    throw new Error(`Unable to store station override: ${error.message}`);
  }

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

function dayKeyFromTimestamp(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  return utcDateKey(date);
}

async function ensureUsageDay(dayKey) {
  const { serviceClient } = requireSupabaseClients();
  const { error } = await serviceClient
    .from("usage_log")
    .upsert({ day_key: dayKey, updated_at: nowIso() }, { onConflict: "day_key" });

  if (error) {
    throw new Error(`Unable to ensure usage day: ${error.message}`);
  }
}

async function getUsageForDay(dayKey) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const normalized = normalizeText(dayKey) || utcDateKey();
  await ensureUsageDay(normalized);

  const { data, error } = await serviceClient
    .from("usage_log")
    .select("day_key,rest_api_calls,vector_tile_calls,routing_api_calls,updated_at")
    .eq("day_key", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read usage state: ${error.message}`);
  }

  return normalizeUsageRow(data, normalized);
}

async function getTodayUsage() {
  return getUsageForDay(utcDateKey());
}

async function incrementUsage(kind, amount = 1) {
  assertConfigured();
  const safeKind = normalizeText(kind).toLowerCase();
  const safeAmount = Math.max(0, Number(amount || 0));
  if (!safeAmount) {
    return getTodayUsage();
  }

  const { serviceClient } = requireSupabaseClients();

  const rpcResult = await serviceClient.rpc("metromark_increment_usage", {
    p_kind: safeKind,
    p_amount: safeAmount
  });

  if (!rpcResult.error) {
    return getTodayUsage();
  }

  const dayKey = utcDateKey();
  const current = await getUsageForDay(dayKey);
  const next = {
    day_key: dayKey,
    rest_api_calls: current.restApiCalls,
    vector_tile_calls: current.vectorTileCalls,
    routing_api_calls: current.routingApiCalls,
    updated_at: nowIso()
  };

  if (safeKind === "rest") {
    next.rest_api_calls += safeAmount;
  } else if (safeKind === "vector") {
    next.vector_tile_calls += safeAmount;
  } else if (safeKind === "routing") {
    next.routing_api_calls += safeAmount;
  } else {
    throw new Error(`Unknown usage kind: ${safeKind}`);
  }

  const upsert = await serviceClient.from("usage_log").upsert(next, {
    onConflict: "day_key"
  });

  if (upsert.error) {
    throw new Error(`Unable to increment usage: ${upsert.error.message}`);
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
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

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
    pending_refresh: existing ? existing.pendingRefresh || pendingRefresh : pendingRefresh,
    updated_at: nowIso()
  };

  const { error } = await serviceClient
    .from("harvest_city_state")
    .upsert(payload, { onConflict: "city_slug" });

  if (error) {
    throw new Error(`Unable to ensure harvest state: ${error.message}`);
  }

  return getCityHarvestState(slug);
}

async function getCityHarvestState(citySlug) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const slug = normalizeText(citySlug);
  if (!slug) {
    return null;
  }

  const { data, error } = await serviceClient
    .from("harvest_city_state")
    .select(
      "city_slug,city_name,harvest_priority,harvest_status,last_geometry_harvest_at,last_stops_harvest_at,last_verified_at,last_feed_fingerprint,last_cache_key,pending_refresh,last_error,updated_at"
    )
    .eq("city_slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read city harvest state: ${error.message}`);
  }

  return normalizeHarvestState(data);
}

async function listPendingHarvestCities(limit = 5) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeLimit = Math.max(1, Number(limit || 5));
  const { data, error } = await serviceClient
    .from("harvest_city_state")
    .select(
      "city_slug,city_name,harvest_priority,harvest_status,last_geometry_harvest_at,last_stops_harvest_at,last_verified_at,last_feed_fingerprint,last_cache_key,pending_refresh,last_error,updated_at"
    )
    .or("harvest_status.in.(pending,queued,retry),pending_refresh.eq.true")
    .order("harvest_priority", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Unable to list pending harvest cities: ${error.message}`);
  }

  return (data || []).map(normalizeHarvestState).filter(Boolean);
}

async function markHarvestInProgress(citySlug) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  await serviceClient
    .from("harvest_city_state")
    .update({ harvest_status: "in-progress", last_error: null, updated_at: nowIso() })
    .eq("city_slug", slug);
}

async function markGeometryHarvested(citySlug, options = {}) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  const now = nowIso();
  await serviceClient
    .from("harvest_city_state")
    .update({
      harvest_status: "geometry-ready",
      last_geometry_harvest_at: now,
      last_cache_key: normalizeText(options.cacheKey) || null,
      last_feed_fingerprint: normalizeText(options.feedFingerprint) || null,
      last_error: null,
      updated_at: now
    })
    .eq("city_slug", slug);
}

async function markStopsHarvested(citySlug) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  const now = nowIso();
  await serviceClient
    .from("harvest_city_state")
    .update({
      harvest_status: "ready",
      last_stops_harvest_at: now,
      pending_refresh: false,
      last_error: null,
      updated_at: now
    })
    .eq("city_slug", slug);
}

async function queueCityRefresh(citySlug) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  await serviceClient
    .from("harvest_city_state")
    .update({
      harvest_status: "queued",
      pending_refresh: true,
      updated_at: nowIso()
    })
    .eq("city_slug", slug);
}

async function markCityVerified(citySlug, changed) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  const hasChanged = Boolean(changed);
  const now = nowIso();

  await serviceClient
    .from("harvest_city_state")
    .update({
      last_verified_at: now,
      pending_refresh: hasChanged,
      harvest_status: hasChanged ? "queued" : "ready",
      updated_at: now
    })
    .eq("city_slug", slug);
}

async function markCityHarvestError(citySlug, errorDetail) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();
  const slug = normalizeText(citySlug);
  if (!slug) {
    return;
  }

  const detail = normalizeText(errorDetail, "Harvest failed").slice(0, 420);
  await serviceClient
    .from("harvest_city_state")
    .update({
      harvest_status: "retry",
      last_error: detail,
      updated_at: nowIso()
    })
    .eq("city_slug", slug);
}

async function logHarvestJob(citySlug, phase, status, detail = "") {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const payload = {
    city_slug: normalizeText(citySlug, "unknown"),
    phase: normalizeText(phase, "phase"),
    status: normalizeText(status, "info"),
    detail: normalizeText(detail).slice(0, 1200) || null,
    created_at: nowIso()
  };

  await serviceClient.from("harvest_job_log").insert(payload);
}

async function getHarvestSummary() {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const { data, error } = await serviceClient
    .from("harvest_city_state")
    .select("harvest_status,pending_refresh,last_cache_key")
    .limit(20000);

  if (error) {
    throw new Error(`Unable to read harvest summary: ${error.message}`);
  }

  const rows = data || [];

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
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const rpcName = normalizeText(config.SUPABASE_DB_SIZE_RPC, "metromark_database_size_bytes");
  const result = await serviceClient.rpc(rpcName);

  const rawValue = Array.isArray(result.data)
    ? result.data[0]
    : result.data;

  const bytesValue =
    typeof rawValue === "number"
      ? rawValue
      : rawValue && typeof rawValue === "object"
        ? Number(rawValue.size_bytes || rawValue.db_size || 0)
        : Number(rawValue || 0);

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
  loginDemoAccount,
  getUserFromToken,
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  seedDemoUser,
  getCache,
  getCacheAny,
  setCache,
  clearCacheByPrefix,
  getCacheStats,
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride,
  setVisitedState,
  getVisitedStations,
  clearVisitedStationsForLine,
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
