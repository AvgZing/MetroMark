-- MetroMark local PostgreSQL/PostGIS schema
-- Intended for the local cache/harvest database, not Supabase.

create extension if not exists postgis;
create extension if not exists pgcrypto;

create table if not exists public.transit_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cache_kind text not null default 'bbox',
  city_slug text,
  feed_fingerprint text,
  verified_at timestamptz,
  bbox_geom geometry(Polygon, 4326)
);

create index if not exists idx_transit_cache_expires_at on public.transit_cache (expires_at);
create index if not exists idx_transit_cache_kind on public.transit_cache (cache_kind);
create index if not exists idx_transit_cache_city_slug on public.transit_cache (city_slug);
create index if not exists idx_transit_cache_bbox_geom on public.transit_cache using gist (bbox_geom);

create table if not exists public.usage_log (
  day_key date primary key,
  rest_api_calls integer not null default 0,
  vector_tile_calls integer not null default 0,
  routing_api_calls integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.harvest_city_state (
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
);

create index if not exists idx_harvest_status_priority on public.harvest_city_state (harvest_status, harvest_priority, updated_at);
create index if not exists idx_harvest_pending_refresh on public.harvest_city_state (pending_refresh, updated_at);

create table if not exists public.harvest_job_log (
  id bigint generated always as identity primary key,
  city_slug text not null,
  phase text not null,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_harvest_job_city_created on public.harvest_job_log (city_slug, created_at desc);

create table if not exists public.stop_translation (
  input_stop_id text primary key,
  stable_key text not null,
  source text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.station_override (
  stable_key text primary key,
  manual_name text,
  manual_lat double precision,
  manual_lon double precision,
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.route_geometry_lod (
  line_key text not null,
  zoom_level integer not null,
  geometry geometry(MultiLineString, 4326) not null,
  source_hash text,
  updated_at timestamptz not null default now(),
  primary key (line_key, zoom_level)
);

create index if not exists idx_route_geometry_lod_geom on public.route_geometry_lod using gist (geometry);

create table if not exists public.route_metadata (
  line_key text primary key,
  route_onestop_id text not null default '',
  line_name text not null default '',
  line_short_name text not null default '',
  line_long_name text not null default '',
  operator_name text not null default '',
  mode text not null default '',
  route_type integer,
  route_feed_id text not null default '',
  service_tier text not null default '',
  frequency_bucket text not null default 'unknown',
  headway_best_minutes double precision,
  headway_source text not null default '',
  headway_checked integer not null default 0,
  color text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.route_override (
  line_key text primary key,
  city_slug text,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_route_override_city on public.route_override (city_slug);

create table if not exists public.route_ordering_vote (
  line_key text not null,
  user_id text not null,
  city_slug text,
  ordering_mode text not null,
  vote_source text not null default 'signed-in',
  updated_at timestamptz not null default now(),
  primary key (line_key, user_id)
);

create index if not exists idx_route_ordering_vote_line on public.route_ordering_vote (line_key);
create index if not exists idx_route_ordering_vote_city on public.route_ordering_vote (city_slug);

create or replace function public.metromark_zoom_tolerance(target_zoom integer)
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
$$;

create or replace function public.metromark_geometry_lod(input_geom geometry, target_zoom integer)
returns geometry
language sql
immutable
as $$
  select case
    when input_geom is null then null
    when target_zoom >= 15 then input_geom
    else ST_SimplifyPreserveTopology(input_geom, public.metromark_zoom_tolerance(target_zoom))
  end
$$;

create or replace function public.metromark_geometry_lod_visible(input_geom geometry, target_zoom integer)
returns boolean
language sql
immutable
as $$
  select case
    when input_geom is null then false
    when target_zoom >= 15 then true
    else ST_NPoints(public.metromark_geometry_lod(input_geom, target_zoom)) >= 2
  end
$$;