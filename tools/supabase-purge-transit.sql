-- Supabase transit purge
-- This script removes transit/cache-related tables from your Supabase database so only user-centric tables remain.
-- WARNING: This will DELETE data. Make a backup first (pg_dump).

BEGIN;

-- Remove transit cache tables that belong in local Postgres
DROP TABLE IF EXISTS public.transit_cache CASCADE;
DROP TABLE IF EXISTS public.route_geometry_lod CASCADE;
DROP TABLE IF EXISTS public.stop_translation CASCADE;
DROP TABLE IF EXISTS public.station_override CASCADE;
DROP TABLE IF EXISTS public.harvest_job_log CASCADE;
DROP TABLE IF EXISTS public.harvest_city_state CASCADE;
DROP TABLE IF EXISTS public.usage_log CASCADE;
DROP TABLE IF EXISTS public.route_override CASCADE;
DROP TABLE IF EXISTS public.route_review CASCADE;
DROP TABLE IF EXISTS public.agency_review CASCADE;

-- Keep user tables: profiles, user_station_visit, user_filter_presets

COMMIT;

-- After running, consider applying the `supabase/reset-user-only.sql` script to ensure RLS and triggers are configured correctly.
