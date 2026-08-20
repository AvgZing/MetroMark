# MetroMark Operations

This directory is **maintenance/operations tooling** — it is not part of the
web app itself. It drives the data pipeline (harvesters + startup) on the
MetroMark host PC, and holds the SQL schema + Windows helper scripts.

## Layout

```
operations/
  harvest-world.js       # World quadtree harvester (geometry + headway + metadata)
  world-cities.js        # Default world-city list (Phase 1 of harvest-world)
  run-harvesters.bat     # Background loop: runs the harvesters, waits, repeats
  start-metromark.bat    # Host startup: web app + harvester loop (Startup shortcut)
  README.md
  windows/               # Windows/PowerShell helper scripts
  local-postgres-schema.sql / local-postgres-changes.sql  # Local DB baseline + migrations
  supabase-baseline.sql / supabase-changes.sql            # Supabase baseline + migrations
  state/world-harvest.json # Resumable world-harvest progress (gitignored)
  Logs/                  # Server + harvester logs (gitignored)
```

## How it works

- **`harvest-world.js`** harvests the whole world in two phases:
  1. **Cities first**: walks the curated list in `world-cities.js` (360+ major
     cities, ordered by population and transit-network relevance, with the most
     comprehensive coverage for North America and Europe; includes Hong Kong;
     mainland China excluded pending a future non-Transitland source). Each
     city is harvested at full detail (all routes + headway + metadata).
  2. **Gap-fill**: once every default city is done, it walks a coarse-to-fine
     quadtree over the whole globe, subdividing only cells that contain transit
     (covers intercity corridors + rural areas).
  Each pass is **quota-budgeted** (stops when the daily REST/vector/routing caps
  are hit) and **resumable** via `state/world-harvest.json`. It stores route
  metadata (incl. headway) to Postgres and feeds route geometry into the PMTiles
  archive, so both the map and the frequency display fill in as passes run.
  - `WORLD_HARVEST_START_ZOOM` (default 4), `WORLD_HARVEST_MAX_ZOOM` (default 9),
    and `WORLD_CITY_SPAN_DEGREES` (default 0.7) env vars tune the grid/city box.
    No app-side slug list to maintain — `world-cities.js` is pure data.
- **`run-harvesters.bat`** loops `harvest-world.js` + `server/admin/harvest-headway.js`
  forever, waiting 10 minutes between passes (override `HARVEST_DELAY_SECONDS`).
  Each script self-stops on quota, so nothing hammers Transitland.
- **`start-metromark.bat`** starts the Express server and the harvester loop,
  logging to `Logs/`.

## SQL schema files

- `local-postgres-schema.sql` — **baseline** for the local cache/harvest
  PostgreSQL database. Run once on a fresh DB (includes PostGIS + the LOD
  functions). Tables match `server/processors/data` exactly.
- `local-postgres-changes.sql` — **migration** for existing local DBs. When the
  baseline gains tables/columns after a DB already exists, add the delta here
  (idempotent statements) and run this file on that DB. Fresh DBs don't need it.
- `supabase-baseline.sql` — baseline for a fresh Supabase project (auth
  profiles, station visits, filter presets + RLS).
- `supabase-changes.sql` — migration for existing Supabase projects; same
  workflow as `local-postgres-changes.sql`.

Backups from `npm run backup:nonrecoverable:prod` are written to
`data/backups/prod` (see `BACKUP_OUTPUT_DIR` in `.env.production`), not to this
directory.

## Host PC setup (one-time)

1. Install Node.js >= 20.
2. Install tippecanoe and make it discoverable — see
   `docs/working/tippecanoe-setup.md`. The startup script defaults
   `TIPPECANOE_BIN` to the MSYS2 path used by this project's dev machine; set it
   explicitly if your host differs.
3. Provide `.env.production` (gitignored) with the real Postgres/Supabase/
   Transitland credentials, mirroring `.env.production.example`.
4. Confirm Postgres (the `10.0.0.197:5432` cache or a local instance) is
   reachable.
5. Put a shortcut to `operations\start-metromark.bat` in the Startup folder
   (`Win+R` → `shell:startup`), or create a Task Scheduler task (At startup,
   "restart on failure") for boot-time start + crash recovery.

## Manual runs

```
npm run harvest:world        # one world-harvest pass (stops at daily caps)
npm run harvest:core         # targeted city-preset harvest (dev)
npm run harvest:headway      # fill missing cached headway (dev)
npm run backup:nonrecoverable:prod
```

Add the `:prod` variants on the host (they load `.env.production`).
