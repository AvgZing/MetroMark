const dotenv = require("dotenv");

function resolveEnvFilePath() {
  const explicit = String(process.env.METROMARK_ENV_FILE || process.env.ENV_FILE || "").trim();
  if (explicit) {
    return explicit;
  }

  const appEnv = String(process.env.APP_ENV || "development").trim().toLowerCase();
  return appEnv === "production" ? ".env.production" : ".env.development";
}

const envFilePath = resolveEnvFilePath();
dotenv.config({ path: envFilePath });

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value, fallback = []) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  return raw
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

module.exports = {
  ENV_FILE: envFilePath,
  APP_ENV: String(process.env.APP_ENV || "development").trim().toLowerCase(),
  PORT: asInt(process.env.PORT, 8080),
  SUPABASE_URL: String(process.env.SUPABASE_URL || "").trim(),
  SUPABASE_ANON_KEY: String(process.env.SUPABASE_ANON_KEY || "").trim(),
  SUPABASE_SERVICE_ROLE_KEY: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  SUPABASE_DB_SIZE_RPC: String(process.env.SUPABASE_DB_SIZE_RPC || "metromark_database_size_bytes").trim(),
  LOCAL_PG_URL: String(process.env.METROMARK_LOCAL_PG_URL || process.env.LOCAL_PG_URL || "").trim(),
  LOCAL_PG_HOST: String(process.env.METROMARK_LOCAL_PGHOST || process.env.LOCAL_PG_HOST || "127.0.0.1").trim(),
  LOCAL_PG_PORT: asInt(process.env.METROMARK_LOCAL_PGPORT || process.env.LOCAL_PG_PORT, 5432),
  LOCAL_PG_USER: String(process.env.METROMARK_LOCAL_PGUSER || process.env.LOCAL_PG_USER || "postgres").trim(),
  LOCAL_PG_PASSWORD: String(process.env.METROMARK_LOCAL_PGPASSWORD || process.env.LOCAL_PG_PASSWORD || "").trim(),
  LOCAL_PG_DATABASE: String(process.env.METROMARK_LOCAL_PGDATABASE || process.env.LOCAL_PG_DATABASE || "metromark_cache").trim(),
  LOCAL_PG_SSL: String(process.env.METROMARK_LOCAL_PGSSL || process.env.LOCAL_PG_SSL || "disable").trim().toLowerCase(),
  TRANSITLAND_API_KEY: process.env.TRANSITLAND_API_KEY || "",
  TRANSITLAND_REQUEST_TIMEOUT_MS: asInt(process.env.TRANSITLAND_REQUEST_TIMEOUT_MS, 15000),
  TRANSITLAND_REQUEST_RETRIES: asInt(process.env.TRANSITLAND_REQUEST_RETRIES, 1),
  TRANSIT_CACHE_TTL_HOURS: asInt(process.env.TRANSIT_CACHE_TTL_HOURS, 2160),
  TRANSIT_CACHE_STALE_DAYS: asInt(process.env.TRANSIT_CACHE_STALE_DAYS, 30),
  LINE_VIEW_ORDERING_VOTE_THRESHOLD: asInt(process.env.LINE_VIEW_ORDERING_VOTE_THRESHOLD, 5),
  ROUTE_CATALOG_MAX_RESULTS: asInt(process.env.ROUTE_CATALOG_MAX_RESULTS, 220),
  ROUTE_STOP_PAGE_LIMIT: asInt(process.env.ROUTE_STOP_PAGE_LIMIT, 220),
  ROUTE_STOP_MAX_RESULTS: asInt(process.env.ROUTE_STOP_MAX_RESULTS, 1400),
  ROUTE_HEADWAY_TIMEOUT_MS: asInt(process.env.ROUTE_HEADWAY_TIMEOUT_MS, 22000),
  ROUTE_HEADWAY_CACHE_TTL_HOURS: asInt(process.env.ROUTE_HEADWAY_CACHE_TTL_HOURS, 72),
  VECTOR_TILE_MAX_PER_BBOX: asInt(process.env.VECTOR_TILE_MAX_PER_BBOX, 6),
  STOP_ASSIGNMENT_MAX_METERS: asInt(process.env.STOP_ASSIGNMENT_MAX_METERS, 140),
  STOP_DEDUP_MAX_METERS: asInt(process.env.STOP_DEDUP_MAX_METERS, 55),
  STATION_HUB_MAX_METERS: asInt(process.env.STATION_HUB_MAX_METERS, 220),
  STATION_HUB_SNAP_MAX_METERS: asInt(process.env.STATION_HUB_SNAP_MAX_METERS, 180),
  BBOX_MAX_SPAN_DEGREES: asFloat(process.env.BBOX_MAX_SPAN_DEGREES, 2.2),
  BBOX_DEFAULT_STEP_DEGREES: asFloat(process.env.BBOX_DEFAULT_STEP_DEGREES, 0.03),
  ADMIN_USERNAME: String(process.env.ADMIN_USERNAME || process.env.ADMIN_USER || process.env.ADMIN_EMAIL || "").trim(),
  ADMIN_PASSWORD: String(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || "").trim(),
  HARVEST_ENABLED: String(process.env.HARVEST_ENABLED || "1") === "1",
  HARVEST_DAILY_REST_LIMIT: asInt(process.env.HARVEST_DAILY_REST_LIMIT, 250),
  HARVEST_DAILY_VECTOR_LIMIT: asInt(process.env.HARVEST_DAILY_VECTOR_LIMIT, 2500),
  HARVEST_DAILY_ROUTING_LIMIT: asInt(process.env.HARVEST_DAILY_ROUTING_LIMIT, 250),
  HARVEST_BATCH_CITY_LIMIT: asInt(process.env.HARVEST_BATCH_CITY_LIMIT, 3),
  HARVEST_ROUTE_LIMIT_PER_CITY: asInt(process.env.HARVEST_ROUTE_LIMIT_PER_CITY, 150),
  HARVEST_ROUTE_STOP_BATCH_SIZE: asInt(process.env.HARVEST_ROUTE_STOP_BATCH_SIZE, 12),
  HARVEST_CORE_CITY_SLUGS: asStringArray(
    process.env.HARVEST_CORE_CITY_SLUGS,
    [
      "seattle",
      "new-york",
      "san-francisco",
      "paris",
      "london",
      "chicago",
      "minneapolis-st-paul",
      "vancouver-bc",
      "portland",
      "los-angeles"
    ]
  ),
  BACKUP_OUTPUT_DIR: String(process.env.BACKUP_OUTPUT_DIR || "data/backups").trim() || "data/backups"
};
