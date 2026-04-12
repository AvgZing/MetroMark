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
