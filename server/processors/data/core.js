const config = require("../../admin/config");
const { hasSupabaseConfig, requireSupabaseClients } = require("../supabase");
const {
  hasLocalPostgresConfig,
  initializeLocalPostgres,
  query: localQuery,
  localDbLabel
} = require("../postgres");

const dbPath = localDbLabel();

const stationOverrideCache = new Map();

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

module.exports = {
  config,
  hasSupabaseConfig,
  requireSupabaseClients,
  hasLocalPostgresConfig,
  initializeLocalPostgres,
  localQuery,
  localDbLabel,
  dbPath,
  stationOverrideCache,
  assertConfigured,
  assertLocalConfigured
};
