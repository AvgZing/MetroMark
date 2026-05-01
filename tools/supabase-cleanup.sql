-- Supabase cleanup helper
-- USAGE: Review the variables below, set run := true when ready, then execute with psql or via Supabase SQL editor.
-- WARNING: This script will DELETE rows. Back up your database before running.

-- CONFIGURATION
-- retention for lightweight user artifacts (days)
\set retention_presets 90
-- retention for user_station_visit (days)
\set retention_visits 365
-- Set to true to actually perform deletions. Leave false to do a dry-run via NOTICE messages.
DO $$
DECLARE
  run boolean := false; -- set to true AFTER you have a backup and reviewed this file
  deleted_count bigint := 0;
BEGIN
  IF NOT run THEN
    RAISE NOTICE 'Dry run mode. To apply changes set run := true in this script and re-run.';
    RAISE NOTICE 'Planned operations:';
    RAISE NOTICE ' - delete from user_filter_presets older than % days', current_setting('retention_presets');
    RAISE NOTICE ' - delete from user_station_visit older than % days', current_setting('retention_visits');
    RETURN;
  END IF;

  RAISE NOTICE 'Starting cleanup transaction...';

  -- Delete old filter presets (user-side snapshots)
  EXECUTE format('delete from public.user_filter_presets where updated_at < now() - interval ''%s days''', current_setting('retention_presets'));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % rows from user_filter_presets', deleted_count;

  -- Delete old visited station rows
  EXECUTE format('delete from public.user_station_visit where updated_at < now() - interval ''%s days''', current_setting('retention_visits'));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % rows from user_station_visit', deleted_count;

  RAISE NOTICE 'Cleanup complete.';
END$$;

-- Optional: uncomment and run ad-hoc queries below for additional housekeeping AFTER backups and manual review.
-- Example: remove orphaned presets for non-existent users (careful!)
-- delete from public.user_filter_presets where user_id not in (select id from auth.users);
