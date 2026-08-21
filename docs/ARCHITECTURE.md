# MetroMark MVP Architecture

## Goals Driving Architecture

- Keep MVP simple enough to test quickly.
- Avoid locking into decisions that block later features.
- Minimize third-party API calls.
- Preserve station progress even if upstream IDs change.

## Runtime Components

## 1) Browser App (public)

Responsibilities:
- Render the PMTiles route vector source and transit overlays via MapLibre GL.
- Display and filter route list (mode/frequency/search/manual overrides).
- Focus a route to load its stops and line-view ordering.
- Trigger on-demand tile backfill for uncovered viewports (`/api/tiles/backfill`).
- Handle auth forms and session token storage.
- Toggle station visited state.

The browser never directly calls Transitland.

## 2) API Server (server)

Responsibilities:
- Auth endpoints backed by Supabase Auth token flow.
- Serve the PMTiles archive, tile stats, and feed-in backfill (NDJSON merge + archive rebuild).
- Transitland proxy for harvesters, route stops, and headway lookups.
- Station-to-line assignment logic.
- Station dedup clustering logic (same-name points within radius).
- Cross-line station hub centralization with optional route snapping.
- Progress read/write endpoints.
- Internal admin actions and runtime operations endpoints.

Key reason:
- Keeps API keys, harvesting, and tile builds on the server side.

## 3) Postgres Layers

### Local cache/harvest database (PostGIS)
Responsibilities:
- `route_metadata` (per-route names/colors/headway/stop counts) and `transit_cache` (cached Transitland API responses).
- `route_geometry_lod` (route geometries for fractions/detail).
- Daily usage counters and harvest queue state (`usage_log`, `harvest_city_state`, `harvest_job_log`).
- Translation and override/review tables (`stop_translation`, `station_override`, `route_override`, `route_ordering_vote`, `route_review`, `agency_review`).

### Supabase (auth + user data)
Responsibilities:
- User accounts through Supabase Auth (`auth.users`) + profile metadata (`public.profiles`).
- User progress (`user_station_visit`) and filter presets (`user_filter_presets`).

Why this production target:
- Managed Postgres with durability and backups.
- PostGIS extension for geospatial queries and geometry storage.

## Route Geometry: Offline Tile Pipeline (PMTiles)

**Purpose:** Route geometry is harvested from Transitland offline, stored as NDJSON, and compiled once into a single PMTiles vector archive. The browser map reads that archive directly — there is no live viewport REST fetching from Transitland.

**Flow:**
```
Transitland API (REST /routes + trips)
   │  harvesters (npm run harvest:core, harvest-world) + on-demand /api/tiles/backfill
   ▼
data/tiles/geo/*.ndjson            line_key-keyed GeoJSON features (durable source of truth)
   │  scripts/build/build-pmtiles.js (tippecanoe over all NDJSON files)
   ▼
data/tiles/routes.pmtiles          single MVT archive (source-layer "routes")
   ▼
MapLibre "routes-vector" source (pmtiles:// protocol) → routes/casing/hit layers
```

**Client-side flow:**
1. Map loads the `routes-vector` source from `pmtiles:///api/tiles/routes.pmtiles` (Range requests; the service worker caches the archive and serves 206 slices).
2. Route geometry renders as vector tiles; feature-state (`visible`/`focused`) drives styling.
3. `vector-metadata.js` merges `route_metadata` (name, color, headway, stop count) into rendered feature properties; `lineSummaries` power the sidebar list.
4. Stops are GeoJSON on the `stops` source, loaded on demand per focused route via `/api/transit/route-stops`.

**Coverage / backfill:**
- Harvested cities are pre-baked into the archive. On each moveend, the client's `underlay.js` asks `GET /api/transit/coverage?bbox&zoom` for Transitland's distinct route count in the viewport (sampled from vector tiles, cached in Postgres) and renders the ground-truth network as a faint line **underlay** (`routes-underlay` layer) below the archive's routes.
- `tile-backfill.js` compares that coverage count against what the archive renders (`hasIncompleteCoverage`): no Transitland routes → nothing to do; Transitland has routes but the archive renders none → clear gap; Transitland has significantly more routes than rendered → partial gap. Either gap triggers `POST /api/tiles/backfill` with the bbox.
- `runBackfill` fetches Transitland routes for the bbox, merges missing `line_key`s into `routes-feed.ndjson` (server-side dedup; seed-owned lines skipped unless `forceRefresh`), rebuilds the archive via tippecanoe, and the client reloads the vector source (`?v=` bump) — all without a page reload.
- Repeated views are throttled client-side (coarse-bbox dedup + cooldown) and deduped server-side by `line_key`.

**Key behavior:**
- The browser never calls Transitland directly; the API server is the only Transitland client.
- Postgres (`route_metadata`, `transit_cache`, `route_geometry_lod`) supplies metadata, cached API responses, and per-route details; the archive supplies geometry.
- `GET /api/transit/bbox` is retired (HTTP 410); `GET /api/transit/city/:slug` was removed.

## Station Identity Strategy

A stable station key is generated from normalized name + rounded coordinates.

Benefits:
- Less brittle than depending only on external IDs.
- Allows retaining progress even if upstream identifiers shift.

Related tables:
- stop_translation: maps upstream stop IDs to stable key.
- station_override: manual local name/location corrections.

Dedup behavior:
- Stops are first assigned to closest route geometry within threshold.
- Assigned stops are then clustered by line + normalized station name.
- Points within the configured dedup radius collapse to one station marker.

## Current API Surface

**Client-facing endpoints:**
- GET /api/health
- GET /api/catalog/cities (city presets for filter dropdowns)
- GET /api/tiles/routes.pmtiles (Range-aware PMTiles archive streaming)
- GET /api/tiles/stats
- POST /api/tiles/backfill (on-demand feed-in for uncovered viewports)
- GET /api/tiles/backfill/status
- GET /api/transit/route-stops?lineKey=... (per-route stops)
- GET /api/transit/route-headway?lineKey=... (per-route headway)
- GET /api/transit/route-headway/bulk?lineKeys=... (bulk cached headway)
- POST /api/transit/stop-fractions (fractions along route geometry)
- GET /api/transit/reviews (route review metadata)
- POST /api/transit/route-ordering/vote (community ordering preference)
- POST /api/auth/register / POST /api/auth/login / GET /api/auth/me
- GET /api/progress / POST /api/progress / POST /api/progress/clear-route
- GET /api/presets / POST /api/presets / DELETE /api/presets/:name

**Admin-only endpoints (session- or role-guarded):**
- GET /api/admin/stats
- GET /api/admin/harvest/queue
- POST /api/admin/actions/harvest-core
- POST /api/admin/actions/backup-nonrecoverable
- POST /api/admin/actions/queue-city/:slug
- POST /api/admin/overrides/station
- GET/POST/DELETE /api/admin/overrides/route (incl. /:lineKey)
- GET/POST /api/admin/reviews/route
- GET/POST /api/admin/reviews/agencies

**Retired endpoints (clear-error stubs):**
- GET /api/transit/bbox → HTTP 410 (replaced by the PMTiles pipeline + /api/tiles/backfill)

## Storage and Security Baseline

Current baseline:
1. Supabase Auth powers account creation/login/session identity.
2. `public.profiles` stores account role/state metadata.
3. `public.user_station_visit` stores progress with user-level ownership.
4. `public.transit_cache` stores cache payloads and metadata for stale verification.
5. `usage_log` and harvest tables power cap enforcement and admin tracking.

## Notes on 3D Buildings

Current MVP uses raster streets + raster satellite with globe projection.

For stronger 3D city context later:
- Move basemap to vector style with building layers.
- Add building extrusion layers by zoom/pitch.
- Keep transit overlays and auth/progress unchanged.

## Route Visibility and Progress Rules (UI Contract)

These UI rules are intentionally explicit because they affect usability and should not drift in future refactors.

Visibility pipeline:
1. Start from currently loaded route summaries.
2. Apply mode filter.
3. Apply frequency filter.
4. Apply search query.
5. Render resulting shown routes in list, map, and progress panel.

Focus behavior:
- No focused route: all shown routes render as active and station dots are hidden.
- Focused route: all shown routes remain visible, but only focused-route stations render.
- Non-focused routes are dimmed using a mask overlay (not heavy per-line translucency).

Interlined routes:
- No geometry offsetting is applied by default.
- If multiple routes overlap at a click point, UI opens a route selector popup.
- User chooses the intended route explicitly from that popup.

Status panel contract:
- Status context is click-driven, not hover-driven.
- Route click updates route status.
- Station click updates station status and pins it until changed.

Progress contract:
- Progress is tracked by line key + stable station key.
- Route denominator is unique station count for that route.
- Numerator is visited stations that belong to that route.
- Clear Route Progress uses a two-click confirm flow.

Filter count contract:
- Mode chip counts show exact values only after the current viewport load settles.
- During unresolved loading, mode counts can show ? to avoid false precision.
- At low zoom where new fetches are paused, mode counts should stay numeric (no forced ?).

Frequency labels contract:
- Frequent: Up to 10m
- Regular: 11-29m
- Local: 30m+
- Unknown: Frequency Unknown
