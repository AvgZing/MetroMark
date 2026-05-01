const { hasSupabaseConfig, requireSupabaseClients } = require('../../supabase');
const { normalizeText, normalizeEmail, nowIso, toEpochSeconds } = require('./helpers');

function assertConfigured() {
  if (!hasSupabaseConfig) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
}

function normalizeDisplayName(value) {
  return normalizeText(value, 'MetroMark User');
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
    row?.display_name || authMetadata.display_name || authUser?.email?.split('@')[0],
    'MetroMark User'
  );

  const createdAtIso = row?.created_at || authUser?.created_at || nowIso();
  const lastLoginIso = row?.last_login_at || authUser?.last_sign_in_at || null;

  return {
    id: normalizeText(row?.id || authUser?.id),
    email: normalizeEmail(row?.email || authUser?.email || ''),
    displayName,
    role: normalizeText(row?.role, 'user'),
    isActive: row?.is_active === false ? false : true,
    lastLoginAt: toEpochSeconds(lastLoginIso),
    createdAt: toEpochSeconds(createdAtIso) || Math.floor(Date.now() / 1000)
  };
}

async function ensureProfile(user, options = {}) {
  const { serviceClient } = requireSupabaseClients();
  const userId = normalizeText(user?.id);
  if (!userId) {
    throw new Error('Cannot ensure profile without user id.');
  }

  const displayName = normalizeDisplayName(options.displayName || user?.user_metadata?.display_name);

  const payload = {
    id: userId,
    email: normalizeEmail(user?.email),
    display_name: displayName,
    created_at: options.createdAtIso || user?.created_at || nowIso()
  };

  if (Object.prototype.hasOwnProperty.call(options, 'role')) {
    payload.role = normalizeText(options.role, 'user');
  }

  if (Object.prototype.hasOwnProperty.call(options, 'isActive')) {
    payload.is_active = options.isActive === false ? false : true;
  }

  const { error } = await serviceClient.from('profiles').upsert(payload, { onConflict: 'id' });
  if (error) {
    throw normalizeAuthError(error, 'Unable to initialize profile.');
  }
}

async function getProfileById(userId) {
  const { serviceClient } = requireSupabaseClients();
  if (!userId) {
    return null;
  }

  const { data, error } = await serviceClient
    .from('profiles')
    .select('id,email,display_name,role,is_active,last_login_at,created_at')
    .eq('id', userId)
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
    .from('profiles')
    .update({ last_login_at: nowIso() })
    .eq('id', userId);
}

async function registerAccount(email, password, displayName) {
  assertConfigured();
  const normalizedEmail = normalizeEmail(email);
  const safeName = normalizeDisplayName(displayName);

  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required.');
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
    throw normalizeAuthError(signUpResult.error, 'Registration failed.');
  }

  let authUser = signUpResult.data.user;
  let session = signUpResult.data.session;

  if (!authUser) {
    throw new Error('Registration failed: user payload is empty.');
  }

  await ensureProfile(authUser, {
    displayName: safeName,
    role: 'user',
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
        'Account created, but no active session was returned. Check Supabase email confirmation settings.'
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
    throw new Error('Invalid email or password.');
  }

  const authUser = signInResult.data.user;
  await ensureProfile(authUser, {
    displayName: authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'MetroMark User',
    createdAtIso: authUser.created_at
  });

  const profile = await getProfileById(authUser.id);
  if (profile?.is_active === false) {
    throw new Error('Account is disabled.');
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
    displayName: authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'MetroMark User',
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

module.exports = {
  assertConfigured,
  normalizeDisplayName,
  normalizeAuthError,
  normalizeProfileRow,
  ensureProfile,
  getProfileById,
  markProfileLogin,
  registerAccount,
  loginAccount,
  getUserFromToken,
  getUserById,
  getUserByEmail,
  createUser,
  verifyUser
};
