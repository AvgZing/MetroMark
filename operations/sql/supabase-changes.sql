-- Any changes made to the supabase database schema should be added here.
-- Supabase-baseline.sql is the initial setup script for new databases. For any databases whose baseline was run BEFORE a change below, the changes below should be run in that database to bring it up-to-date with the latest baseline.
-- Future changes will continue to be tracked here, along with updates to the baseline. All changes should have a date and a brief description of the change so users know to run it.

-- EXAMPLE DATE: 
-- EXAMPLE DESC:
-- This is where the actual script sql would go.

-- DATE: 2026-09-09
-- DESC: Add a JSON preferences column to profiles so signed-in preferences (theme, filters, last-seen changelog version) can sync across devices. Run in the Supabase SQL editor, then update supabase-baseline.sql if you rebuild a database from scratch.
-- alter table public.profiles add column if not exists preferences jsonb;
