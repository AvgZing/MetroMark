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
- Auth endpoints and JWT issue/validation.
- Transitland proxy and normalized city/bbox caching.
- Station-to-line assignment logic.
- Station dedup clustering logic (same-name points within radius).
- Cross-line station hub centralization with optional route snapping.
- Progress read/write endpoints.

Key reason:
- Keeps API keys and expensive API logic on server side.

## 3) Local SQLite (data/metromark.db)

Responsibilities:
- User accounts and visited station state.
- Cached transit payloads.
- Translation and override layer tables.

Why SQLite now:
- Space-efficient local file.
- Easy backup/copy.
- No external dependency needed for MVP test cycle.

## Transit Ingest Flow

1. Client requests either /api/transit/city/:slug or /api/transit/bbox?bbox=....
2. Server normalizes area to a strict cache key (city key or snapped bbox key).
3. Server checks api_cache table for that key.
4. If cache miss/expired, server fetches routes and stops from Transitland for the area bbox.
5. Server computes nearest-line assignment for each stop using geometry distance.
6. Server deduplicates station exits by same normalized name and proximity radius.
7. Server clusters line-level stations into cross-line station hubs and centralizes marker coordinates.
8. Server applies local station_override records.
9. Server stores final payload in cache and returns it.

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

- GET /api/health
- GET /api/catalog/cities
- GET /api/transit/city/:slug
- GET /api/transit/bbox
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/demo-login
- GET /api/auth/me
- GET /api/progress
- POST /api/progress/toggle
- POST /api/admin/overrides/station (guarded by optional admin key)

## Upgrade Path to Supabase/PostGIS

Keep API contracts stable while switching storage/auth internals.

Suggested migration sequence:
1. Move users and user_station_visit to Supabase Auth + Postgres tables.
2. Move station_override and stop_translation tables.
3. Add PostGIS geometry columns and spatial indexes.
4. Add pg_h3 columns/tables for fog/heatmap features.
5. Keep server-side caching layer to control Transitland usage.

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
