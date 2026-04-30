-- Recreate Supabase so it stores user accounts and user data only.
-- Run this after migrating route/cache data to the local PostgreSQL/PostGIS database.

create extension if not exists "pgcrypto";

drop policy if exists user_filter_presets_rw_own on public.user_filter_presets;
drop policy if exists user_station_visit_mutate_own on public.user_station_visit;
drop policy if exists user_station_visit_read_own on public.user_station_visit;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_own on public.profiles;

drop trigger if exists on_auth_user_created_profile on auth.users;

drop table if exists public.route_geometry_lod cascade;
drop table if exists public.station_override cascade;
drop table if exists public.stop_translation cascade;
drop table if exists public.harvest_job_log cascade;
drop table if exists public.harvest_city_state cascade;
drop table if exists public.usage_log cascade;
drop table if exists public.transit_cache cascade;

drop function if exists public.metromark_increment_usage(text, integer);
drop function if exists public.metromark_database_size_bytes();

drop table if exists public.user_filter_presets cascade;
drop table if exists public.user_station_visit cascade;
drop table if exists public.profiles cascade;

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

create extension if not exists "pgcrypto";

create table if not exists public.user_filter_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  city_slug text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_user_filter_presets_unique
  on public.user_filter_presets (user_id, city_slug, name);

create index if not exists idx_user_filter_presets_user_city
  on public.user_filter_presets (user_id, city_slug, updated_at desc);

alter table public.profiles enable row level security;
alter table public.user_station_visit enable row level security;
alter table public.user_filter_presets enable row level security;

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

drop policy if exists user_filter_presets_rw_own on public.user_filter_presets;
create policy user_filter_presets_rw_own
  on public.user_filter_presets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);