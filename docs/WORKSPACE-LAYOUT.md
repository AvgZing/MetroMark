# MetroMark Workspace Layout

## Source Code

### Frontend (`public/`)
- `index.html`, `admin.html`, `admin-override.html`
- `Styles/` — styles.css, lineview.css, admin.css, admin-override.css
- `Scripts/UI/` — bootstrap.js, core-state-ui.js, formatters.js, storage.js
  - `UI/line-view/` — stop-ordering.js
  - `UI/sidebar/` — filters-routes.js, filter-presets.js
- `Scripts/Map/` — interactions.js, transit-loading.js, viewport-cache.js
- `Scripts/Admin/` — admin.js, admin-override.js
- `Assets/` — images, icons, fonts (future)

### Server (`server/`)
- `index.js`, `app.js`
- `admin/` — config.js, harvest-core.js, backup-nonrecoverable.js
- `routes/` — Express route handlers (admin, auth, catalog, health, helpers, presets, progress, transit)
- `processors/db/` — Postgres+Supabase data access layer (cache, client, index, progress, stations, users)
- `processors/postgres/` — Postgres connection (index.js) + spatial helpers (spatial.js)
- `processors/supabase/` — Supabase client (index.js) + auth middleware (auth.js)
- `processors/` — city-presets.js, transitland.js (reexport to sources/)
- `sources/transitland/` — Transitland API interface (index.js, metrics.js)

## Non-critical (`operations/`)
- `windows/` — PowerShell helper scripts
- SQL schema files (postgres, supabase)
- `Logs/`, `Backups/` (gitignored)

## Documentation (`docs/`)
- `ARCHITECTURE.md` — project architecture
- `OPERATIONS_GUIDE.md` — admin console, deployment, production runbook
- `VARIABLES.md` — variable and state reference
- `WORKSPACE-LAYOUT.md` — this file

## Generated / Installed
- `node_modules/`, `package-lock.json`
