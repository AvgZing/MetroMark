# MetroMark Workspace Layout

## Source Code

### Frontend (`public/`)
- `index.html`, `admin.html`, `admin-override.html`
- `Styles/` — map.css, styles.css, lineview.css, admin.css, admin-override.css, theme.css
- `Scripts/UI/` — bootstrap.js, state.js, dom-cache.js, api.js, formatters.js, storage.js,
  theme.js, preferences.js, status-bar.js, map-helpers.js, route-ui.js, route-popups.js,
  lineview.js, auth-panel.js
  - `UI/line-view/` — stop-ordering.js, stop-helpers.js, branch-detection.js, method-auto.js,
    method-loop.js, method-main.js, method-ushape.js, ranking.js, spatial.js
  - `UI/sidebar/` — filters-routes.js, filter-bar.js, filter-presets.js, map-data.js,
    progress-panel.js, route-list.js, routes-focus.js
- `Scripts/Map/` — interactions.js, transit-loading.js, map-sources.js, map-stops.js,
  vector-metadata.js, tile-backfill.js, placeholder-overlay.js, viewport-cache.js,
  geometry-utils.js, zoom-readout.js
- `Scripts/Admin/` — admin.js, admin-override.js
- `Assets/` — images, icons, fonts

### Server (`server/`)
- `index.js`, `app.js`
- `admin/` — config.js, harvest-core.js, harvest-headway.js, backup-nonrecoverable.js
- `routes/` — Express route handlers (admin, auth, catalog, health, helpers, presets,
  progress, tiles, tiles-backfill, transit)
- `processors/` — Postgres+Supabase data access layer, spatial, city-presets, transitland
  (reexport), postgres/, supabase/
- `sources/transitland/` — Transitland API interface (index.js, fetch.js, routes.js,
  headway.js, payload.js, stops.js, geometry.js, backfill.js, bbox.js, route-features.js,
  helpers.js, metrics.js, network.js, tile-placeholder.js)
- `scripts/build/` — build-pmtiles.js (tippecanoe archive build), export-transitland-geojson.js

## Non-critical (`operations/`)
- `harvest-world.js`, `world-cities.js` — world harvester (Phase 1 cities, Phase 2 gaps)
- `run-harvesters.bat`, `start-metromark.bat` — background harvester loop + host startup
- `windows/` — Windows/PowerShell helper scripts
- SQL schema files (postgres, supabase baselines + changes)
- `state/` — resumable world-harvest progress (gitignored)
- `Logs/` — server + harvester logs (gitignored; written by `start-metromark.bat`)

## Documentation (`docs/`)
- `ARCHITECTURE.md` — project architecture
- `OPERATIONS_GUIDE.md` — admin console, deployment, production runbook
- `VARIABLES.md` — variable and state reference
- `WORKSPACE-LAYOUT.md` — this file
- `working/` — working notes (gitignored)

## Generated / Installed
- `node_modules/`, `package-lock.json`
- `data/tiles/geo/*.ndjson` — durable route-geometry source of truth
- `data/tiles/routes.pmtiles` — derived PMTiles archive (rebuilt by tippecanoe)
