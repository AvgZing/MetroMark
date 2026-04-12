# MetroMark MVP

MetroMark is a transit exploration tracker.

Current MVP goal:
- Show transit lines and station points on a global map.
- Load transit by preset city or by visible viewport bbox (international mode).
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
- City presets with one-click jump/load (Seattle, Hong Kong, London, Paris, New York City, Tokyo).
- International visible-area loading from map viewport (bbox) with optional auto-fetch.
- Route and stop rendering on a MapLibre globe.
- Account and line filters available as map popup panels (instead of long sidebar sections).
- Route filter list and search by short/long/operator/mode.
- Light and dark sidebar UI themes with persistence.
- Account auth (register/login) + seeded demo user.
- Station click-to-toggle completion tracking.
- Station hover diagnostics showing line/operator/mode, matching method, feed IDs, and merge counts.
- Progress summary for visible filtered stations.
- Station exit dedup clustering by distance + name to improve stop precision.
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
- TRANSIT_CACHE_TTL_HOURS=168 (7 days)
- STOP_ASSIGNMENT_MAX_METERS=140
- STOP_DEDUP_MAX_METERS=55
- BBOX_MAX_SPAN_DEGREES=2.2
- BBOX_DEFAULT_STEP_DEGREES=0.03

## Caching and API-Limit Strategy

- Transit requests are done server-side only.
- Per-city and per-bbox data is cached in SQLite for the configured TTL.
- Viewport bbox requests are snapped to normalized keys so revisiting the same area does not refetch from Transitland.
- Client keeps a session cache map of loaded area keys to avoid redundant server requests in the same browser session.
- Force refresh exists in UI if you need a one-time manual refetch.
- Station-to-line assignment and stop dedup are computed once per fetch and then cached.

Result: normal use should not repeatedly consume Transitland calls.

## Current Constraints

- Dateline-wrapping viewport bbox fetches are not enabled yet (around the 180-degree meridian).
- Station assignment now prefers same-feed route matching before geometry fallback; dense multi-line overlap can still need additional logic in future iterations.

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
