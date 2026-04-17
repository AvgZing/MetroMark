# CHANGELOG

## 2026-04-11

### Milestone 1 - Prototype protection and repo safety
- Added repository ignore rules in .gitignore.
- Added prototypes folder and archived previous map prototype in prototypes/index.html.
- Removed API key usage from the archived prototype copy.
- Initialized CHANGELOG.md for persistent session tracking.

### Milestone 2 - MVP app scaffold and core implementation
- Added Node.js app scaffold with package.json, .env.example, and organized folders (server, public, docs, data).
- Replaced tracked root index with a safe startup page (removed hardcoded API key from tracked files).
- Implemented backend modules for config loading, city presets, auth middleware, spatial utilities, and Transitland integration.
- Implemented SQLite persistence with cache table, user accounts, station visit tracking, translation layer table, and station override table.
- Added seeded demo account support for immediate testing.
- Implemented API endpoints for health, city catalog, cached transit fetch by city, auth (register/login/demo), station progress toggle/read, and override cache invalidation.
- Built frontend map app with MapLibre globe, street/satellite toggle, city load flow, line filters, account UI, station click-to-toggle tracking, and progress display.

### Milestone 3 - Documentation and deployment guidance
- Added root README with stack rationale, MVP behavior, setup, env usage, caching strategy, security notes, and next development steps.
- Added architecture notes in docs/ARCHITECTURE.md.
- Added Windows local + spare-PC hosting guide in docs/WINDOWS-DEPLOYMENT.md.
- Added roadmap capture in docs/ROADMAP.md.

### Milestone 4 - Verification pass
- Ran VS Code diagnostics check (no static errors reported).
- Attempted runtime syntax checks via Node CLI, blocked because Node is not installed in this execution environment.
- Recorded blocker so next session can immediately continue from local runtime validation once Node is available.
- Fixed .gitignore config pattern so server source config file remains trackable while local secrets stay ignored.

### Milestone 5 - International bbox mode and matching precision improvements
- Added viewport-based transit endpoint (/api/transit/bbox) with strict normalized bbox cache keys.
- Added client-side visible-area loading controls and optional auto-fetch on map move.
- Added in-session client cache reuse for already-loaded area keys to avoid repeat requests.
- Upgraded route metadata extraction to prefer short names, preserve long names, and improve operator/mode fallback fields.
- Implemented station dedup clustering by line + normalized stop name + distance radius to collapse station exits.
- Added new config/env knobs: STOP_DEDUP_MAX_METERS, BBOX_MAX_SPAN_DEGREES, BBOX_DEFAULT_STEP_DEGREES.
- Updated default city presets to include Hong Kong and New York City naming.
- Added light/dark sidebar theme toggle with persisted preference.
- Updated docs to reflect international mode, cache strategy, and SQLite-first continuation.

### Milestone 6 - Verification after international mode upgrade
- VS Code diagnostics pass reports no static errors.
- Runtime validation executed using absolute Node path because shell PATH still does not resolve node/npm in this session.
- Verified installed runtime versions via absolute path: Node v22.22.2 and npm 10.9.7.
- Syntax checks passed for server/index.js, server/transitland.js, server/db.js, server/spatial.js, and public/app.js.

### Milestone 7 - Popup UX refinement and stop matching diagnostics
- Moved Account and Line Filters UI from sidebar into map popup panels with toolbar toggle buttons.
- Added popup open/close behavior (button toggles, outside click close, Escape close, and close buttons).
- Repositioned map toolbar and moved MapLibre navigation control to bottom-right to prevent overlap with map mode toggles.
- Added explicit session cache clear button and clearer cache status messaging to reduce stale-data confusion.
- Added station hover detail popup with line/operator/mode plus assignment diagnostics (feed match/fallback, distance, source count, feed IDs).
- Upgraded stop-to-route assignment to prefer same-feed routes before distance fallback.
- Added route feed/type metadata propagation into route/station payload properties for debugging.
- Updated operator extraction fallback to use nested agency.agency_name.
- Runtime smoke test: server startup ok; health, city catalog, and bbox transit endpoints all returned successful responses.

### Milestone 8 - Station hub centralization and filter behavior overhaul
- Reworked frontend data model to merge multiple loaded area payloads, so loading/refetching one area no longer wipes previously loaded overlays.
- Enabled auto-fetch by default (can be toggled off) to make pan/zoom exploration behavior more intuitive.
- Added filter controls for transport type, operator, and sorting (name/type/operator/stop count).
- Updated map/progress visibility to honor transport type/operator/search filters (not only manual checkbox selection).
- Updated Select All / Clear actions to operate on currently shown filtered lines only.
- Added line selection persistence logic so manual selection is preserved while new areas are loaded.
- Implemented cross-line station hub clustering with configurable radius and centralized hub marker coordinates.
- Added route-snapping for hub centers (within threshold) and emitted hub diagnostics (`hub_key`, `hub_member_count`, `hub_spread_m`, `centralization_method`).
- Added station hub tuning env/config values: `STATION_HUB_MAX_METERS`, `STATION_HUB_SNAP_MAX_METERS`.
- Added mode-hint scoring to reduce common bus-vs-rail assignment errors in mixed feeds.
- Bumped transit cache namespace to `transit-v3` so old cached payloads do not mask new logic.
- Runtime smoke test confirms updated health fields and bbox payload diagnostics (hub counts and centralization metadata).

### Milestone 9 - Always-on visible area loading and persistent route panel
- Replaced manual Load Preset Transit / Load Visible Area workflow with always-on viewport loading based on map movement.
- Added nearby tile request planning so the client loads what is on-screen plus adjacent areas, then fetches only missing tiles.
- Added bounded fetch queue with distance-priority and low parallelism to reduce timeout risk and API burst load.
- Added stale-queue trimming so rapid pans/zooms drop no-longer-relevant queued tiles instead of fetching far-away leftovers.
- Updated frontend merge logic to render only active nearby areas in the current view context, keeping route list/search locally relevant.
- Rebuilt filters UI into a persistent Transitland-style panel with mode chips and route search.
- Added route row click-to-isolate behavior and map fade treatment for non-focused routes/stops.
- Reworked status UX into user-friendly headline text, concise load/caching meta, and a separate small backend diagnostics line.
- Moved theme toggle next to top-bar profile button and kept account actions in a dropdown panel.
- Updated server bbox snap granularity and bbox-span-dependent route/stop limits to improve cache hit rates and lower fetch stress.

### Milestone 10 - Sidebar restoration and loading reliability follow-up
- Restored a full left sidebar layout and moved route filters, progress, and status back into the sidebar flow.
- Removed the Refresh Visible Area button to keep loading fully automatic and reduce UX confusion.
- Added stop visibility preset control in sidebar: default Transitland-style (0/1), add entrances (2), or all stop types (0-4).
- Threaded stop type selection through bbox API requests and cache keys so each preset stays logically consistent.
- Added `stop_location_type` metadata to stop features and hover diagnostics.
- Added first-load trigger after initial city fit so transit starts loading without extra user actions.
- Improved post-fetch status handling so failure cases no longer appear as endless "0 cached / 0 loading" states.
- Kept stale queue trimming so rapid pans/zooms avoid fetching irrelevant off-screen tiles.

### Milestone 11 - Route-first UX cleanup, slippy tile planning, and headway enrichment
- Removed obsolete sidebar controls that no longer matched route-first behavior (map view panel and stop-visibility selector).
- Simplified route-stop loading to fixed core stop types (0/1) so stops only appear after focusing a route.
- Reworked viewport fetch planning from ad-hoc bbox spans to explicit slippy tile keys (`tile:z:x:y`) with smaller initial fetch batches.
- Added Transitland request timeout and retry controls to avoid indefinite in-flight loading states.
- Reduced route catalog query limits by span to improve first-paint speed and reduce API overload risk.
- Added dedicated `/api/transit/route-headway` endpoint so headway retrieval runs asynchronously and does not block route-stop loading.
- Implemented headway parsing from Transitland route pages and cached the extracted values in SQLite.
- Wired client-side non-blocking headway enrichment for focused routes and updated frequency bucketing to prefer real headway values when available.
- Switched map mode controls to icon-first overlay buttons and removed stale UI affordances.
- Updated `.gitignore` to exclude temporary local probe scripts (`_tmp_*.js`).
