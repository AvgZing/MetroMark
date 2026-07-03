-- This is the script that is run when supabase gets setup. 
-- If changes are made to supabase in future, they will be reflected here for new database creations.
-- Future changes will also be tracked in supabase-changes.sql, which should be run as a migration on existing databases.
-- 1. SETUP EXTENSIONS
create extension if not exists postgis;
create extension if not exists "pgcrypto";

-- 2. CLEANUP (Ensures a fresh start)
drop trigger if exists on_auth_user_created_profile on auth.users;
drop function if exists public.handle_new_user_profile();
drop table if exists public.user_filter_presets cascade;
drop table if exists public.user_station_visit cascade;
drop table if exists public.profiles cascade;

-- 3. USER PROFILES TABLE
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default 'MetroMark User',
  role text not null default 'user',
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- 4. PROFILE AUTO-GENERATION TRIGGER
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'user'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- 5. USER STATION VISITS (The "Check-in" System)
create table public.user_station_visit (
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

create index idx_user_station_visit_user_line on public.user_station_visit (user_id, line_key, updated_at desc);

-- 6. USER FILTER PRESETS (Dashboard Settings)
create table public.user_filter_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  city_slug text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, city_slug, name)
);

-- 7. ENABLE RLS
alter table public.profiles enable row level security;
alter table public.user_station_visit enable row level security;
alter table public.user_filter_presets enable row level security;

-- 8. RLS POLICIES (Strictly Owner-Only)
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

create policy "Users can manage own visits" on public.user_station_visit for all using (auth.uid() = user_id);

create policy "Users can manage own presets" on public.user_filter_presets for all using (auth.uid() = user_id);

-- 9. DASHBOARD UTILITY: DB SIZE RPC
create or replace function public.metromark_database_size_bytes()
returns bigint
language sql
security definer
set search_path = public
as $$
  select pg_database_size(current_database())::bigint;
$$;