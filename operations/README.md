# MetroMark Operations

This directory is **maintenance/operations tooling** — it is not part of the
web app itself. It drives the data pipeline (harvesters + startup) on the
MetroMark host PC.

## Layout

```
operations/
  start-metromark.bat        # Host startup: web app + harvester loop (Startup shortcut)
  restart-metromark.bat      # Manual: stop both windows + restart MetroMark
  run-harvesters.bat         # Background loop: runs the harvesters, waits, repeats
  sync-from-github.bat       # Manual: pull latest stable code from GitHub (self-locating)
  maybe-backup.bat           # Called by run-harvesters: once-per-day nonrecoverable backup
  install-daily-restart.bat  # One-time: register daily Task Scheduler restart
  start-metromark-windows.ps1 # Launches + side-by-side snaps the two console windows
  README.md
  harvest/                   # Harvest engine (implementation)
    harvest-world.js         #   World quadtree harvester (geometry + headway + metadata)
    world-cities.js          #   Default world-city list (Phase 1 of harvest-world)
    harvest-log.js           #   Shared harvester log helper (console + file)
    harvest-phases.js        #   City + gap-fill phase logic
    harvest-grid.js          #   World quadtree geometry helpers
    harvest-routes.js        #   Route feature accumulation + metadata storage
    harvest-state.js         #   Resumable world-harvest state (operations/state/)
  sql/                       # Supabase setup/migration SQL (run in Supabase dashboard)
    supabase-baseline.sql    #   Baseline for a fresh Supabase project
    supabase-changes.sql     #   Migration for existing Supabase projects
  state/                     # Runtime progress state (gitignored, per-machine)
  Logs/                      # Server + harvester logs (gitignored)
```

## How it works

- **`harvest/harvest-world.js`** harvests the whole world in two phases:
  1. **Cities first**: walks the curated list in `harvest/world-cities.js`
     (360+ major cities, ordered by population and transit-network relevance,
     with the most comprehensive coverage for North America and Europe;
     includes Hong Kong; mainland China excluded pending a future
     non-Transitland source). Each city is harvested at full detail (all routes
     + headway + metadata).
  2. **Gap-fill**: once every default city is done, it walks a coarse-to-fine
     quadtree over the whole globe, subdividing only cells that contain transit
     (covers intercity corridors + rural areas).
  Each pass is **quota-budgeted** (stops when the daily REST/vector/routing caps
  are hit) and **resumable** via `state/world-harvest.json`. It stores route
  metadata (incl. headway) to Postgres and feeds route geometry into the PMTiles
  archive, so both the map and the frequency display fill in as passes run.
  - `WORLD_HARVEST_START_ZOOM` (default 4), `WORLD_HARVEST_MAX_ZOOM` (default 9),
    and `WORLD_CITY_SPAN_DEGREES` (default 0.7) env vars tune the grid/city box.
    No app-side slug list to maintain — `harvest/world-cities.js` is pure data.
- **`run-harvesters.bat`** loops `harvest/harvest-world.js` +
  `server/admin/harvest-headway.js` + `server/admin/harvest-stops.js` forever,
  waiting 10 minutes between passes (override `HARVEST_DELAY_SECONDS`). Each
  script self-stops on quota, so nothing hammers Transitland.
- **`start-metromark.bat`** starts the Express server and the harvester loop in
  two side-by-side console windows. Server and harvester log to `Logs/` via the
  shared logger (`server/admin/logger.js`); files rotate daily by date.
- **`maybe-backup.bat`** (invoked by `run-harvesters.bat`) runs the
  nonrecoverable backup once per UTC day, guarded by a date marker in
  `Logs/last-backup-day.txt`.

## SQL schema

- **Local Postgres is auto-provisioned at server startup** from
  `server/processors/postgres/schema.js` (`create if not exists` +
  idempotent migrations). There is no separate local schema file to run.
- **Supabase** cannot be auto-provisioned — run `sql/supabase-baseline.sql` in
  the Supabase SQL editor on a fresh project (auth profiles, station visits,
  filter presets + RLS). Schema changes to existing projects go in
  `sql/supabase-changes.sql`, which mirrors the baseline's migration workflow.

Backups from `maybe-backup.bat` / `npm run backup:nonrecoverable:prod` are
written to `data/backups` (see `BACKUP_OUTPUT_DIR` in `.env.production`), not to
this directory.

## Host PC setup (one-time)

1. Install Node.js >= 20.
2. Install tippecanoe and make it discoverable — see
   `docs/working/tippecanoe-setup.md`. The startup script defaults
   `TIPPECANOE_BIN` to the MSYS2 path used by this project's dev machine; set it
   explicitly if your host differs.
3. Provide `.env.production` (gitignored) with the real Postgres/Supabase/
   Transitland credentials, mirroring `.env.production.example`.
4. Confirm the local Postgres cache DB is reachable (auto-provisioned at
   startup) and run `sql/supabase-baseline.sql` once in the Supabase dashboard.
5. Put a shortcut to `operations\start-metromark.bat` in the Startup folder
   (`Win+R` → `shell:startup`), or create a Task Scheduler task (At startup,
   "restart on failure") for boot-time start + crash recovery.
6. Optional: run `operations\install-daily-restart.bat` (as admin) to register a
   daily Task Scheduler task that restarts MetroMark each morning — clean log
   rollover + process hygiene.

## Manual runs

```
npm run harvest:world        # one world-harvest pass (stops at daily caps)
npm run harvest:headway      # fill missing cached headway (dev)
npm run harvest:stops        # fill missing exact stop counts + cache route stops (dev)
npm run backup:nonrecoverable:prod
```

Add the `:prod` variants on the host (they load `.env.production`).
