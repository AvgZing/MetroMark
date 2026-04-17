# MetroMark MVP

MetroMark is a transit exploration tracker.

Current MVP goal:
- Show transit lines and station points on a global map.
- Automatically load transit by current visible map area (international mode) with nearby-area prefetch.
- Filter by line short name, long name, operator, and mode.
- Create/login account and mark stations as visited.
- Preserve progress per user.
- Minimize external API calls with local caching.

## Tech Stack

- Frontend: Vanilla JavaScript + MapLibre GL JS
- Backend: Node.js + Express
- Local persistence: SQLite (better-sqlite3)
- Transit source: Transitland v2 REST API (server-side only)

This stack keeps the MVP easy to understand while preserving flexibility for future upgrades.

## What Is Already Implemented

- Server-side proxy to Transitland (API key never sent to browser).
- Strictly normalized cache keys for city and viewport bbox fetches.
- City presets used for initial fit-to-region defaults (Seattle, Hong Kong, London, Paris, New York City, Tokyo).
- International visible-area loading is always on (no manual load mode switch).
- Route-first rendering on a MapLibre globe (routes load first, stops load on focused route).
- Sidebar-first controls with integrated route filters, progress, and status messaging.
- Transitland-style route filtering with mode chips, frequency chips, route search, and per-route isolate/fade behavior.
- Core stop rendering fixed to Transitland-style station/platform types (0/1) for route-focused clarity.
- Light and dark UI themes with a simple toggle next to profile controls.
- Floating icon-based map overlay controls for streets/satellite toggles.
- Profile dropdown for demo login, login/register, and logout.
- Account auth (register/login) + seeded demo user.
- Station click-to-toggle completion tracking.
- Station hover diagnostics showing line/operator/mode, matching method, feed IDs, and merge counts.
- Progress summary for visible filtered stations.
- Station exit dedup clustering by distance + name.
- Cross-line station hub centralization with route snapping and spread metadata.
- Foundation tables for translation and manual station overrides.

## Demo Account

A demo account is automatically created at server startup using env values.

Default values from .env.example:
- Email: demo@metromark.local
- Password: demo1234
- Name: Demo Rider

In the UI, click Use Demo Account.

## Quick Start (Local)

1. Install Node.js 20+.
2. Copy .env.example to .env.
3. Add your Transitland key in .env.
4. Install dependencies.
5. Start server.
6. Open the app in browser.

Commands:

- npm install
- npm start

App URL:
- http://localhost:8080

## Environment Variables

See .env.example.

Required for transit loading:
- TRANSITLAND_API_KEY

Important defaults:
- TRANSITLAND_REQUEST_TIMEOUT_MS=15000
- TRANSITLAND_REQUEST_RETRIES=1
- TRANSIT_CACHE_TTL_HOURS=168 (7 days)
- ROUTE_CATALOG_MAX_RESULTS=220
- ROUTE_STOP_PAGE_LIMIT=220
- ROUTE_STOP_MAX_RESULTS=1400
- ROUTE_HEADWAY_TIMEOUT_MS=22000
- ROUTE_HEADWAY_CACHE_TTL_HOURS=72
- STOP_ASSIGNMENT_MAX_METERS=140
- STOP_DEDUP_MAX_METERS=55
- BBOX_MAX_SPAN_DEGREES=2.2
- BBOX_DEFAULT_STEP_DEGREES=0.03

## Caching and API-Limit Strategy

- Transit requests are done server-side only.
- Per-city and per-bbox data is cached in SQLite for the configured TTL.
- Viewport loads are planned on a slippy-tile grid (Uber-style tile keys), then translated to bbox API requests.
- Client keeps a session cache of tile payloads and only fetches missing nearby tiles for the current viewport.
- Focused-route stop payloads are cached separately per line (core stop types 0/1) and reused across pans/zooms.
- Nearby tile fetches are queue-limited and distance-prioritized to reduce timeouts and API spikes when zooming/panning.
- Initial city fit triggers visible-area loading automatically.
- Clear Local Cache remains available for rare refresh scenarios (for example, newly published transit updates).
- Route headway metadata is fetched asynchronously per focused route and cached separately.

Result: normal use should not repeatedly consume Transitland calls.

## Current Constraints

- Dateline-wrapping viewport bbox fetches are not enabled yet (around the 180-degree meridian).
- Very wide world zooms are intentionally blocked from fetch to avoid expensive global pulls; zoom in for reliable loading.
- Route-level headway data is currently parsed from Transitland route pages because REST route payloads do not expose headway fields directly.

## Data Model Notes (Future-Proofing)

Current schema includes:
- users
- user_station_visit
- api_cache
- stop_translation
- station_override

stop_translation and station_override are the beginning of your translation layer strategy:
- External stop identifiers can map to a stable internal station key.
- Manual name/coordinate overrides can be applied without losing ingest compatibility.

## Supabase Path (Planned, Deferred)

This MVP intentionally remains fully local using SQLite for fast iteration on your local PC.
Supabase migration is deferred for now so you can keep debugging core matching quality first.

When you move to Supabase/PostGIS, keep the same conceptual model:
- user_station_visit for progress
- stop_translation for source-to-stable ID mapping
- station_override for manual curation

Then add:
- PostGIS spatial queries
- pg_h3 for heatmaps/fog-style features
- Supabase Auth replacing local auth routes

## File Layout

- public: Browser app (map + UI)
- server: API, cache logic, auth, spatial helpers
- data: SQLite file at runtime (ignored from git)
- docs: Architecture and deployment notes
- prototypes: archived static experiments (ignored from git)

## Security and Git Hygiene

Ignored from git:
- .env and env variants
- config.local.js / local env variants
- prototypes folder
- local db/cache artifacts
- Reference folder (as requested)

## Next Suggested Development Steps

1. Add Supabase adapter while keeping current API contract.
2. Add manual override management UI and review workflow.
3. Add background refresh job for city caches.
4. Add route-level progress pages and notes per station.
5. Add spatial clustering/H3 tables for fog and heatmap features.
