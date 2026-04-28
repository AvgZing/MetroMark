# Changelog

## 2026-04-17 - Supabase/PostGIS Final Migration

### Added
- Supabase client bootstrap module at server/supabase.js.
- Supabase/Postgres storage facade replacing SQLite runtime data flow at server/db/index.js.
- Supabase/PostGIS schema migration at supabase/migrations/20260417_metromark_core.sql.
- Dedicated admin web console at public/admin.html with styling and scripts.
- Admin manual action endpoints for harvest, backup, city queue refresh, and station overrides.
- Admin harvest queue endpoint for tracking pending refreshes.

### Changed
- Auth middleware now validates Supabase access tokens.
- Auth routes now register/login/demo-login through Supabase Auth flows.
- Progress routes now read/write Supabase-backed user progress.
- Transit caching, usage logging, and harvest queue interactions now use async Supabase-backed operations.
- Harvest script exports a callable runner for admin manual trigger and uses async storage calls.
- Nonrecoverable backup script now exports a callable runner and reads data from Supabase tables/admin auth users.
- Startup now initializes Supabase storage before serving requests.
- Environment templates now use Supabase keys and Postgres size RPC settings.
- Dependency graph updated for @supabase/supabase-js runtime use.

### Removed
- Runtime reliance on local SQLite DB modules for accounts/cache/usage/harvest/progress.
- Legacy SQLite-oriented DB module files under server/db/*.js except server/db/index.js.

### Docs
- README updated for Supabase/PostGIS architecture and admin console usage.
- Architecture document updated to reflect current production storage/auth model.
- Windows migration guide rewritten for final Supabase/PostGIS rollout flow.
