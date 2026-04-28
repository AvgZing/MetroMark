-- MetroMark production schema migration
-- Target: Supabase Postgres + PostGIS

create extension if not exists postgis;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'MetroMark User',
  role text not null default 'user',
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role, is_active, created_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    'user',
    true,
    coalesce(new.created_at, now())
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

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

create index if not exists idx_transit_cache_expires_at
  on public.transit_cache (expires_at);

create index if not exists idx_transit_cache_kind
  on public.transit_cache (cache_kind);

create index if not exists idx_transit_cache_city_slug
  on public.transit_cache (city_slug);

create index if not exists idx_transit_cache_bbox_geom
  on public.transit_cache using gist (bbox_geom);

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

create index if not exists idx_harvest_status_priority
  on public.harvest_city_state (harvest_status, harvest_priority, updated_at);

create index if not exists idx_harvest_pending_refresh
  on public.harvest_city_state (pending_refresh, updated_at);

create table if not exists public.harvest_job_log (
  id bigint generated always as identity primary key,
  city_slug text not null,
  phase text not null,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_harvest_job_city_created
  on public.harvest_job_log (city_slug, created_at desc);

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

create table if not exists public.user_station_visit (
  user_id uuid not null references auth.users(id) on delete cascade,
  line_key text not null,
  station_key text not null,
  station_name text not null,
  lat double precision not null,
  lon double precision not null,
  visited boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, line_key, station_key)
);

create index if not exists idx_user_station_visit_user_line
  on public.user_station_visit (user_id, line_key, updated_at desc);

alter table public.profiles enable row level security;
alter table public.user_station_visit enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists user_station_visit_read_own on public.user_station_visit;
create policy user_station_visit_read_own
  on public.user_station_visit
  for select
  using (auth.uid() = user_id);

drop policy if exists user_station_visit_mutate_own on public.user_station_visit;
create policy user_station_visit_mutate_own
  on public.user_station_visit
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.metromark_increment_usage(p_kind text, p_amount integer default 1)
returns table (
  day_key date,
  rest_api_calls integer,
  vector_tile_calls integer,
  routing_api_calls integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_day date := (now() at time zone 'utc')::date;
  safe_amount integer := greatest(coalesce(p_amount, 1), 0);
begin
  insert into public.usage_log (day_key, updated_at)
  values (target_day, now())
  on conflict (day_key) do update set updated_at = excluded.updated_at;

  if p_kind = 'rest' then
    update public.usage_log
      set rest_api_calls = rest_api_calls + safe_amount,
          updated_at = now()
      where usage_log.day_key = target_day;
  elsif p_kind = 'vector' then
    update public.usage_log
      set vector_tile_calls = vector_tile_calls + safe_amount,
          updated_at = now()
      where usage_log.day_key = target_day;
  elsif p_kind = 'routing' then
    update public.usage_log
      set routing_api_calls = routing_api_calls + safe_amount,
          updated_at = now()
      where usage_log.day_key = target_day;
  else
    raise exception 'Unknown usage kind: %', p_kind;
  end if;

  return query
    select
      u.day_key,
      u.rest_api_calls,
      u.vector_tile_calls,
      u.routing_api_calls,
      u.updated_at
    from public.usage_log u
    where u.day_key = target_day;
end;
$$;

create or replace function public.metromark_database_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database())::bigint;
$$;
