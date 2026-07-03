# Foundation Audit — Phase 1

Summary:
- Local Postgres is the authoritative store for transit/cache data: `transit_cache`, `route_geometry_lod`, `stop_translation`, `station_override`, harvest and usage tables.
- Supabase is used only for user-centric data: `profiles`, `user_station_visit`, `user_filter_presets`.

Findings:
- Code writes to local Postgres via `localQuery` for all transit/cache related operations. See `server/db/index.js` for functions: `setCache`, `getRouteGeometryLod`, `upsertRouteGeometryLod`, `upsertStopTranslation`, and harvest-related helpers.
- Supabase is used via `serviceClient.from(...)` exclusively for `profiles`, `user_station_visit`, and `user_filter_presets` in `server/db/index.js`.
- The transitland service (`server/services/transitland/index.js`) reads/writes caches and calls `db.upsertStopTranslation` and `db.upsertRouteGeometryLod` which both use local Postgres.

Potential Violations Checked:
- Searched for `serviceClient.from(` across the repo — only Supabase user tables are targeted.
- Searched for `localQuery(` — used extensively in `server/db/index.js` for transit/cache tables as intended.

Recommendations:
- Before running any purge script, run `pg_dump` of Supabase to back up data.
- Run `tools/supabase-purge-transit.sql` in Supabase SQL editor to remove transit tables, then run `supabase/reset-user-only.sql` to recreate user tables and RLS.
- After local Postgres is set up and `initializeLocalPostgres()` has run, exercise endpoints to populate `transit_cache`, `route_geometry_lod`, and `stop_translation` locally.

Files of interest:
- `server/db/index.js` — local cache and Supabase integrations.
- `server/postgres.js` — SQL schema (tables and functions) used to initialize local database.
- `server/services/transitland/index.js` — where geometries are simplified and database LOD helpers are called.
- `tools/supabase-cleanup.sql`, `tools/supabase-purge-transit.sql`, `supabase/reset-user-only.sql` — scripts to manage Supabase contents.
