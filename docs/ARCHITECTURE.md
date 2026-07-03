# MetroMark MVP Architecture

## Goals Driving Architecture

- Keep MVP simple enough to test quickly.
- Avoid locking into decisions that block later features.
- Minimize third-party API calls.
- Preserve station progress even if upstream IDs change.

## Runtime Components

## 1) Browser App (public)

Responsibilities:
- Render map and transit overlays.
- Display and filter route list.
- Merge multiple loaded area payloads into one continuous overlay.
- Handle auth forms and session token storage.
- Toggle station visited state.

The browser never directly calls Transitland.

## 2) API Server (server)

Responsibilities:
- Auth endpoints backed by Supabase Auth token flow.
- Transitland proxy and normalized city/bbox caching.
- Station-to-line assignment logic.
- Station dedup clustering logic (same-name points within radius).
- Cross-line station hub centralization with optional route snapping.
- Progress read/write endpoints.
- Internal admin actions and runtime operations endpoints.

Key reason:
- Keeps API keys and expensive API logic on server side.

## 3) Supabase Postgres + PostGIS

Responsibilities:
- User accounts through Supabase Auth (`auth.users`) + profile metadata (`public.profiles`).
- Cached transit payloads.
- Daily usage counters and harvest queue state.
- Translation and override layer tables.

Why this production target:
- Managed Postgres with durability and backups.
- PostGIS extension for geospatial cache and future spatial queries.
- Clean account/auth boundary for public rollout.

## Transit Data Fetching (Bbox-Primary with Postgres Data Store)

**Purpose:** Postgres holds a persistent local copy of Transitland data organized by geographic bbox. This reduces Transitland API calls by querying Postgres first; Transitland is only called when data isn't found in Postgres.

**Client-side flow:**
1. User opens map or moves/zooms map
2. Frontend calculates viewport bounding box
3. Frontend converts map zoom to tile zoom (0-13): `tileZoom = floor(mapZoom / 3)`
4. Frontend generates viewport tile requests: all tiles intersecting bbox at that zoom level
5. Frontend generates unique data keys: `tile:Z:X:Y`

**Server-side Postgres-primary + Transitland-fallback flow:**
1. Client requests `/api/transit/bbox` with `bbox=minLon,minLat,maxLon,maxLat&zoom=Z&cacheOnly=1`
2. For each requested tile Z:X:Y:
   - **Exact lookup:** Query Postgres `transit_cache` table for exact key `tile:Z:X:Y`
   - **Data miss:** Check for spatial overlaps using `getCacheByBbox()` with PostGIS `ST_Intersects` against `bbox_geom`
   - **Still nothing:** If zoom >= 10 AND not cacheOnly, queue Transitland API fetch (deferred 250ms)
   - **Data found:** Return stored payload from Postgres
3. Transitland fetches (if queued) store payload in Postgres with `bbox_geom` populated for future spatial lookups
4. All responses returned to client for local filtering by geometry intersection

**Key behavior:**
- Postgres is the primary data source (local copy of Transitland data)
- Transitland is only called when data isn't in Postgres (at zoom 10+ with data miss)
- Spatial lookups allow lower zoom levels to find data from higher zoom Postgres stores
- No city selection required for viewport display
- Data available immediately within viewport geometry once in Postgres

**Initial page load expectations:**
- Fresh Postgres (first visit): Map shows "Zoom in..." until Transitland fetches at zoom 10+
- Populated Postgres (after first data fetch): Map shows data at all zoom levels via spatial lookups
- Single line visible at zoom 5: Indicates Postgres already contains data from previous session

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
- GET /api/transit/bbox?bbox=...&zoom=Z&cacheOnly=1 (main viewport data fetching)
- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me
- GET /api/progress
- POST /api/progress/toggle
- POST /api/progress/clear-route
- GET /api/transit/reviews (route review metadata)

**Admin-only endpoints (guarded by optional admin key):**
- GET /api/admin/stats
- GET /api/admin/harvest/queue
- POST /api/admin/actions/harvest-core
- POST /api/admin/actions/backup-nonrecoverable
- POST /api/admin/actions/queue-city/:slug (harvest trigger for specific city)
- POST /api/admin/overrides/station

**Legacy/deprecated endpoints (kept for backward compatibility):**
- GET /api/transit/city/:slug (admin use only; client uses bbox instead)

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
