-- Local PostgreSQL schema changes (migration for existing databases).
--
-- This file tracks changes to be applied to EXISTING local PostgreSQL
-- databases that were created from an earlier version of
-- local-postgres-schema.sql. Statements are idempotent (create ... if not
-- exists), so running this file repeatedly is safe. New databases should be
-- created from local-postgres-schema.sql (the current baseline) instead and do
-- not need this file.
--
-- Mirror of the supabase-changes.sql workflow for the local cache/harvest DB.

-- 2026-08-19: add admin review tables (previously missing from the baseline;
-- the db layer has queried/written them since the review UI landed).
create table if not exists public.route_review (
  line_key text primary key,
  city_slug text,
  problematic_override boolean,
  updated_at timestamptz not null default now()
);

create index if not exists idx_route_review_city on public.route_review (city_slug);

create table if not exists public.agency_review (
  city_slug text not null,
  operator_name text not null,
  allowed_override boolean,
  updated_at timestamptz not null default now(),
  primary key (city_slug, operator_name)
);
