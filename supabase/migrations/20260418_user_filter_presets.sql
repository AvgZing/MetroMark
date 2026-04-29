-- User filter presets

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

alter table public.user_filter_presets enable row level security;

drop policy if exists user_filter_presets_rw_own on public.user_filter_presets;
create policy user_filter_presets_rw_own
  on public.user_filter_presets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
