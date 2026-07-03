const { createClient } = require("@supabase/supabase-js");

const config = require("../../admin/config");

const hasSupabaseConfig = Boolean(
  config.SUPABASE_URL && config.SUPABASE_ANON_KEY && config.SUPABASE_SERVICE_ROLE_KEY
);

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
};

const anonClient = hasSupabaseConfig
  ? createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, clientOptions)
  : null;

const serviceClient = hasSupabaseConfig
  ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, clientOptions)
  : null;

function requireSupabaseClients() {
  if (!hasSupabaseConfig || !anonClient || !serviceClient) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return {
    anonClient,
    serviceClient
  };
}

module.exports = {
  hasSupabaseConfig,
  anonClient,
  serviceClient,
  requireSupabaseClients
};
