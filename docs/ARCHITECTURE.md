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
- Handle auth forms and session token storage.
- Toggle station visited state.

The browser never directly calls Transitland.

## 2) API Server (server)

Responsibilities:
- Auth endpoints and JWT issue/validation.
- Transitland proxy and city-level caching.
- Station-to-line assignment logic.
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

1. Client requests /api/transit/city/:slug.
2. Server checks api_cache table for city cache key.
3. If cache miss/expired, server fetches routes and stops from Transitland for city bbox.
4. Server computes nearest-line assignment for each stop using geometry distance.
5. Server applies local station_override records.
6. Server stores final payload in cache and returns it.

## Station Identity Strategy

A stable station key is generated from normalized name + rounded coordinates.

Benefits:
- Less brittle than depending only on external IDs.
- Allows retaining progress even if upstream identifiers shift.

Related tables:
- stop_translation: maps upstream stop IDs to stable key.
- station_override: manual local name/location corrections.

## Current API Surface

- GET /api/health
- GET /api/catalog/cities
- GET /api/transit/city/:slug
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
