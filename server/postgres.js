const { Pool } = require("pg");

const config = require("./config");

let pool = null;
let initializePromise = null;

function hasLocalPostgresConfig() {
  return Boolean(config.LOCAL_PG_URL || config.LOCAL_PG_HOST || config.LOCAL_PG_DATABASE);
}

function localDbLabel() {
  if (config.LOCAL_PG_URL) {
    return "local-postgres://configured";
  }

  const host = config.LOCAL_PG_HOST || "127.0.0.1";
  const port = config.LOCAL_PG_PORT || 5432;
  const database = config.LOCAL_PG_DATABASE || "metromark_cache";
  return `postgres://${host}:${port}/${database}`;
}

function buildPoolOptions() {
  if (config.LOCAL_PG_URL) {
    return {
      connectionString: config.LOCAL_PG_URL,
      max: 8
    };
  }

  const ssl = config.LOCAL_PG_SSL === "require" ? { rejectUnauthorized: false } : false;

  return {
    host: config.LOCAL_PG_HOST || "127.0.0.1",
    port: config.LOCAL_PG_PORT || 5432,
    user: config.LOCAL_PG_USER || "postgres",
    password: config.LOCAL_PG_PASSWORD || "",
    database: config.LOCAL_PG_DATABASE || "metromark_cache",
    ssl,
    max: 8
  };
}

function getPool() {
  if (!hasLocalPostgresConfig()) {
    throw new Error(
      "Local PostgreSQL is not configured. Set METROMARK_LOCAL_PG_URL or METROMARK_LOCAL_PGHOST/METROMARK_LOCAL_PGDATABASE."
    );
  }

  if (!pool) {
    pool = new Pool(buildPoolOptions());
    pool.on("error", (error) => {
      console.error("[local-postgres] pool error", error.message);
    });
  }

  return pool;
}

async function query(text, params = []) {
  const client = getPool();
  return client.query(text, params);
}

async function initializeLocalPostgres() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    if (!hasLocalPostgresConfig()) {
      throw new Error(
        "Local PostgreSQL is not configured. Set METROMARK_LOCAL_PG_URL or METROMARK_LOCAL_PGHOST/METROMARK_LOCAL_PGDATABASE."
      );
    }

    const statements = [
      "create extension if not exists postgis",
      "create extension if not exists pgcrypto",
      `create table if not exists public.transit_cache (
        cache_key text primary key,
        payload jsonb not null,
        fetched_at timestamptz not null default now(),
        expires_at timestamptz not null,
        cache_kind text not null default 'bbox',
        city_slug text,
        feed_fingerprint text,
        verified_at timestamptz,
        bbox_geom geometry(Polygon, 4326)
      )`,
      "create index if not exists idx_transit_cache_expires_at on public.transit_cache (expires_at)",
      "create index if not exists idx_transit_cache_kind on public.transit_cache (cache_kind)",
      "create index if not exists idx_transit_cache_city_slug on public.transit_cache (city_slug)",
      "create index if not exists idx_transit_cache_bbox_geom on public.transit_cache using gist (bbox_geom)",
      `create table if not exists public.usage_log (
        day_key date primary key,
        rest_api_calls integer not null default 0,
        vector_tile_calls integer not null default 0,
        routing_api_calls integer not null default 0,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists public.harvest_city_state (
        city_slug text primary key,
        city_name text not null,
        harvest_priority integer not null default 100,
        harvest_status text not null default 'pending',
        last_geometry_harvest_at timestamptz,
        last_stops_harvest_at timestamptz,
        last_verified_at timestamptz,
        last_feed_fingerprint text,
        last_cache_key text,
        pending_refresh boolean not null default true,
        last_error text,
        updated_at timestamptz not null default now()
      )`,
      "create index if not exists idx_harvest_status_priority on public.harvest_city_state (harvest_status, harvest_priority, updated_at)",
      "create index if not exists idx_harvest_pending_refresh on public.harvest_city_state (pending_refresh, updated_at)",
      `create table if not exists public.harvest_job_log (
        id bigint generated always as identity primary key,
        city_slug text not null,
        phase text not null,
        status text not null,
        detail text,
        created_at timestamptz not null default now()
      )`,
      "create index if not exists idx_harvest_job_city_created on public.harvest_job_log (city_slug, created_at desc)",
      `create table if not exists public.stop_translation (
        input_stop_id text primary key,
        stable_key text not null,
        source text not null,
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists public.route_geometry_lod (
        line_key text not null,
        zoom_level integer not null,
        geometry geometry(MultiLineString, 4326) not null,
        source_hash text,
        updated_at timestamptz not null default now(),
        primary key (line_key, zoom_level)
      )`,
      "create index if not exists idx_route_geometry_lod_geom on public.route_geometry_lod using gist (geometry)",
      `create or replace function public.metromark_zoom_tolerance(target_zoom integer)
       returns double precision
       language sql
       immutable
       as $$
         select case
           when target_zoom >= 15 then 0.00001
           when target_zoom >= 14 then 0.00002
           when target_zoom >= 13 then 0.00004
           when target_zoom >= 12 then 0.00008
           when target_zoom >= 11 then 0.00015
           when target_zoom >= 10 then 0.0003
           when target_zoom >= 9 then 0.00055
           when target_zoom >= 8 then 0.0009
           else 0.0015
         end
       $$`,
      `create or replace function public.metromark_geometry_lod(input_geom geometry, target_zoom integer)
       returns geometry
       language sql
       immutable
       as $$
         select case
           when input_geom is null then null
           when target_zoom >= 15 then input_geom
           else ST_SimplifyPreserveTopology(input_geom, public.metromark_zoom_tolerance(target_zoom))
         end
       $$`,
      `create or replace function public.metromark_geometry_lod_visible(input_geom geometry, target_zoom integer)
       returns boolean
       language sql
       immutable
       as $$
         select case
           when input_geom is null then false
           when target_zoom >= 15 then true
           else ST_NPoints(public.metromark_geometry_lod(input_geom, target_zoom)) >= 2
         end
      $$`
    ];

    for (const statement of statements) {
      await query(statement);
    }

    return {
      backend: "local-postgres-postgis",
      endpoint: localDbLabel()
    };
  })();

  try {
    return await initializePromise;
  } catch (error) {
    initializePromise = null;
    throw error;
  }
}

module.exports = {
  hasLocalPostgresConfig,
  initializeLocalPostgres,
  query,
  localDbLabel
};