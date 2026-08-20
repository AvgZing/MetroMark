const {
  hasSupabaseConfig,
  requireSupabaseClients,
  initializeLocalPostgres,
  dbPath,
  assertConfigured,
  assertLocalConfigured
} = require("./core");
const {
  normalizeText,
  normalizeEmail,
  normalizeDisplayName,
  normalizeAuthError,
  normalizeProfileRow,
  nowIso
} = require("./utils");
const { loadStationOverridesCache } = require("./stations");

let initializePromise = null;

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

module.exports = {
  initializeStorage,
  registerAccount,
  loginAccount,
  getUserFromToken,
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  getAccountStats
};
