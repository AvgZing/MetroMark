# MetroMark Project Variables Reference

This document catalogs all major variables, objects, and data structures used throughout MetroMark. It serves as a living reference for consistency and to minimize duplication.

---

## State Management (`UI/state.js`)

`appState` is a single global object (defined in `public/scripts/UI/state.js`) shared across the map/UI scripts. Key fields:

### User & Session
- **`appState.token`** - Auth token (localStorage or sessionStorage)
- **`appState.user`** - Current user object `{ email, displayName, id, role }`
- **`appState.initialCitySlug`** - Active city slug for filter presets (stored in localStorage)

### Map & Viewport
- **`appState.map`** - MapLibre GL instance
- **`appState.mapReady`** - Boolean flag when map DOM is loaded
- **`appState.mapMode`** - Current map style ('streets' or 'satellite')
- **`appState.currentViewportBbox`** - Current map viewport bbox [minLon, minLat, maxLon, maxLat]
- **`appState.vectorSourceVersion`** - Integer bumped to reload the PMTiles vector source (`?v=` cache-buster)
- **`appState.lastTileMetadataSignature`** - Signature used to skip redundant vector-metadata rebuilds

### Route Filtering & Visibility
- **`appState.activeModeKeys`** - Set of active mode filter keys (e.g., 'bus', 'metro', 'rail')
- **`appState.activeFrequencyKeys`** - Set of active frequency filters (e.g., 'frequent', 'regular')
- **`appState.manualLineVisibility`** - Map of lineKey → 'on'/'off' visibility overrides (viewport-clipped)
- **`appState.showPrivateOperators`** - Boolean to show/hide private operators
- **`appState.showProblematicGeometries`** - Boolean to show/hide routes with bad geometry
- **`appState.showAllStops`** - Boolean to show all stops or route-linked only
- **`appState.lineSearchQuery`** - Current search string for route filtering

### Route & Stop Data Storage
- **`appState.lineSummaries`** - Array of route summaries (the currently visible set, from vector metadata)
- **`appState.loadedLineSummaries`** - Array of all loaded route summaries (superset of `lineSummaries`)
- **`appState.lineStopsCache`** - Map of `routeStopCacheKey(lineKey)` → fetched route-stop payloads
- **`appState.inFlightLineStopKeys`** - Set of route-stop keys currently being fetched
- **`appState.routeStopCountLoadAttempts`** - Set of lineKeys already attempted for stop-count summaries
- **`appState.inFlightRouteStopCountKeys`** - Set of lineKeys with an in-flight stop-count fetch
- **`appState.inFlightHeadwayLineKeys`** - Set of lineKeys with an in-flight headway fetch
- **`appState.headwayBulkAttemptedKeys`** - Set of lineKeys already queried via the bulk headway endpoint
- **`appState.routeOverridesByCity`** - Map of lineKey → `route_override` row (`payload` with name/mode/color/operator/orderingMode/stops); applied by vector-metadata.js and the line view (custom stop order)

### Active Routes & Data
- **`appState.cities`** - Array of available city preset objects (for filter presets)
- **`appState.transit`** - Combined GeoJSON: `{ routesGeoJson, stopsGeoJson }` for feature-state/visibility work
- **`appState.focusedLineKey`** - Currently selected/focused route lineKey (empty if none)

### Tile Backfill (PMTiles feed-in)
- **`appState.transitCoverageCount`** - Transitland's distinct route count for the current viewport (from `GET /api/transit/coverage`, set by `underlay.js` on moveend)
- **`appState.tileBackfillCount`** / **`tileBackfillTotalMs`** / **`tileBackfillAddedRoutes`** - Backfill run metrics
- **`appState.tileBackfillInFlight`** - Boolean; a backfill request is in progress
- **`appState.tileBackfillCooldownUntil`** - Epoch ms; skip new backfills until this time
- **`appState.tileBackfillBboxes`** - Set of coarse-bbox keys already backfilled this session
- **`appState.tileBackfillLastError`** - Last backfill error message
- **`appState.tilesStats`** - Latest `/api/tiles/stats` payload (archive size, tile count)

### User Progress & Visits
- **`appState.visitedByLine`** - Map of lineKey → Set of stationKeys user has visited
- **`appState.userStatus`** - Current panel info: `{ title, subtitle, details[], progress, routeLineKey }`
- **`appState.userStatusPinnedKind`** - 'station' if pinning a stop, '' if unpinned

### Line View (Detail Panel)
- **`appState.lineViewOpen`** - Boolean; line view panel is visible
- **`appState.lineViewLineKey`** - lineKey of route displayed in line view
- **`appState.lineViewReturn`** - Saved state to restore when closing line view
- **`appState.lineViewOrderingMode`** / **`lineViewOrderingReversed`** / **`lineViewOrderingResolved`** - Active route-ordering mode, reversal flag, and resolved (non-auto) mode
- **`appState.lineViewOrderingPreferencesByLineKey`** - Map of lineKey → `{ mode, reversed }` user preference
- **`appState.lineViewOrderingVoteClickSetsByLineKey`** - Map of lineKey → Set of stopKeys clicked (vote trigger)

### UI State
- **`appState.mobilePanelsOpen`** - Boolean; sidebar is visible on mobile
- **`appState.activePopup`** - 'account' or '' (only one popup at a time)
- **`appState.routeSelectPopup`** - Popup instance for route selection on map

---

## Core Objects & Interfaces

### Line Summary (Route Metadata)
Used throughout as the canonical route/line object:
```js
{
  lineKey: "string",  // Primary key: "operator:shortname" or generated
  lineName: "string",
  lineShortName: "string",
  lineLongName: "string",
  operatorName: "string",  // Single canonical operator name (extracted once from Transitland)
  mode: "string",  // e.g., "Bus", "Metro", "Rail"
  routeType: number,  // GTFS route_type (0-7, 11, 12)
  routeOnestopId: "string",
  routeFeedId: "string",
  color: "string",  // Hex color for line
  serviceTier: "number",  // 1=Frequent, 2=Regular, 3=Local
  frequencyBucket: "string",  // 'frequent', 'regular', 'local', 'unknown'
  headwayBestMinutes: number | null,
  headwaySource: "string",
  stopCount: number,
}
```

### Stop Feature (GeoJSON Feature)
```js
{
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: {
    station_key: "string",  // Primary key for a stop
    station_name: "string",
    line_key: "string",
    line_short_name: "string",
    line_long_name: "string",
    operator_name: "string",
    stop_location_type: number,  // 0=Platform, 1=Station, etc.
    hub_member_count: number,  // Stops linked in same hub
    visited: 0 | 1,  // User progress tracker
  }
}
```

### Route Override (Payload)
Stored in `route_override` table and edited via admin override page:
```js
{
  agency: "string" | null,
  mode: number | null,  // GTFS mode
  frequency: number | null,  // headway minutes
  orderingMode: "auto" | "geometry-revised" | "legacy-geometry" | "fractions" | null,
  stops: [  // Reordered/filtered stop list
    { key: "string", name: "string", lat: number, lon: number },
    ...
  ]
}
```

### Route Ordering Votes
- **`LINE_VIEW_ORDERING_VOTE_THRESHOLD`** - Minimum signed-in user votes needed before a community default replaces Auto.
- Votes are stored per user per route in `route_ordering_vote`.

### Admin Login Session
- The admin console and override editor create a short-lived browser session after login.
- The login form uses the Supabase account whose email matches `ADMIN_EMAIL` (the env-designated bootstrap admin; its password lives in Supabase, not the env). Any account with `profiles.role = 'admin'` also works.
- The session token is stored in `sessionStorage` for the current tab only.

### Route Review (Problematic Geometry & Agency Allow/Block)
Stored in `route_review` and `agency_review` tables:
```js
// route_review
{
  line_key: "string",
  city_slug: "string",
  problematic_override: true | false | null,  // null = unreviewed (show by default)
  updated_at: "ISO 8601"
}

// agency_review
{
  city_slug: "string",
  operator_name: "string",  // Canonical name
  allowed_override: true | false | null,  // null = unreviewed (show by default)
  updated_at: "ISO 8601"
}
```

### Filter Preset (Snapshot)
User-saved configuration stored per-city:
```js
{
  name: "string",
  citySlug: "string",
  snapshot: {
    activeModeKeys: ["metro", "tram"],
    activeFrequencyKeys: ["frequent"],
    showPrivateOperators: false,
    showProblematicGeometries: false,
  }
}
```

---

## Cache Keys & Identifiers

### Route Stop Data Key
Format: `routeStopCacheKey(lineKey) = `${lineKey}:stops`
- Purpose: Unique key for `appState.lineStopsCache` and the server's route-stops cache entries.

### Transit Cache Keys (Postgres `transit_cache`)
Server-side `cache_key` prefixes written by the Transitland sources:
- `transit-v4:city:{slug}:route-catalog:route-types:{key}` - Per-city route catalog payloads (harvest/admin)
- `transit-v4:route:{lineKey}:types:{types}` - Per-route stops payloads
- `transit-v4:headway:{lookupKey}` - Route headway summaries
- `transit-v4:routes-tile:{z}:{x}:{y}` - Vector-tile headway payloads

### Stop Key (Unique Stop Identifier)
- Within a specific route context: `stationKey` (normalized name + rounded coords, see `stableStationKey`)
- For deduplication across routes: `${lineKey}|${stationKey}` (stopKey)

### Route Line Key
- Primary identity for routes across the NDJSON store, `route_metadata`, feature-state, and the map: `lineKey` (canonical onestop id or generated `operator:shortname`).

---

## Extracted/Computed Data

### Line Operator Label
**Function:** `lineOperatorLabel(line)`
- **Extracted once per line summary** from Transitland API
- Stored in `lineSummaries[].operatorName`
- **Used in:** Status panels, line list, hover popups, route select popup
- **Goal:** Single canonical source to avoid triple-extraction

### Line Display Name
**Function:** `lineDisplayName(line)`
- Returns formatted `"${shortName} | ${longName}"` or shortName or longName
- Used for UI display throughout

### Line Mode Label
**Function:** `lineMode(line)`
- Returns mode string from `line.mode` or converts `line.routeType`

### Line Headway Label
**Function:** `lineHeadwayLabel(line)`
- Returns human readable headway (e.g., "Every 15 min", "Every 1-2 hrs")

### Line Frequency Bucket
**Function:** `lineFrequencyBucket(line)`
- Returns 'frequent' (≤10 min), 'regular' (10-30 min), 'local' (>30 min), or 'unknown'

### Line Progress Metrics
**Function:** `lineProgressMetrics(lineKey, fallbackTotal)`
- Returns `{ visited: number, total: number, percent: number }`
- Reads from `state.visitedByLine.get(lineKey)` (user progress)

---

## Filter & Visibility Logic

### Mode Filter Selection
- **Config:** `state.activeModeKeys` (Set of strings like 'bus', 'metro')
- **Check:** `lineMatchesModeSelection(line)` → true if line.mode in active keys
- **Application:** Pre-filter before rendering route list or map

### Frequency Filter Selection
- **Config:** `state.activeFrequencyKeys` (Set like 'frequent', 'regular', 'local')
- **Check:** `lineMatchesFrequencySelection(line)` → true if line bucket in active keys
- **Application:** Post-mode filter

### Manual Line Visibility Override
- **Storage:** `state.manualLineVisibility` (Map of lineKey → 'on'/'off')
- **Storage Key:** `"metromark_route_visibility_overrides"`
- **Check:** `lineVisibilityOverride(lineKey)` → 'on' | 'off' | ''
- **Scope:** Viewport-scoped; applied only when route geometry intersects current viewport bbox
- **Priority:** Manual override beats mode/frequency filters

### Route Review Visibility (Backend-Driven)
- **Data:** `state.routeReviews` and `state.agencyReviews` (loaded from `/api/transit/reviews`)
- **Behavior:** 
  - If `problematic_override` = true → hide (unless admin shows problematic)
  - If `allowed_override` = false (for operator) → hide
  - If null (unreviewed) → **show by default**
- **Application:** Applied during lineIsVisible check

### Combined Visibility (Route Filtering)
Routes appear on screen when:
1. **Geometry intersects viewport bbox** - LineString/MultiLineString geometry touches current view
2. **Mode filter matches** - Line.mode in activeModesKeys (e.g., 'bus', 'metro')
3. **Frequency filter matches** - Line frequencyBucket in activeFrequencyKeys
4. **Manual override not hiding** - If manualLineVisibility[lineKey] !== 'off'
5. **Backend review allows** - If no problematic_override=true or allowed_override=false from /api/transit/reviews

```
lineIsVisible(line, viewportBbox) = 
  IF geometryIntersectsBbox(line.geometry, viewportBbox) THEN
    IF manualOverride exists: return manualOverride === 'on'
    ELSE IF showProblematicGeometries = false AND routeReview.problematic = true: return false
    ELSE IF operator not allowed (allowedList non-empty and allowed=false): return false
    ELSE: return lineMatchesModeAndFrequency(line)  // Mode + frequency filters
  ELSE return false  // Route geometry not on screen
```

---

## Tile Pipeline

Route geometry flows **offline** from Transitland into a locally-built PMTiles archive:

```
Transitland API
   │  (REST /routes + /routes/{id}/trips; harvesters + on-demand backfill)
   ▼
data/tiles/geo/*.ndjson        durable route-geometry source of truth (line_key per NDJSON row)
   │  (scripts/build/export-transitland-geojson.js → route-features.js)
   ▼
tippecanoe (build-pmtiles.js)  builds the vector tile archive
   ▼
data/tiles/routes.pmtiles      single MVT archive served by GET /api/tiles/routes.pmtiles (Range-aware)
   ▼
MapLibre "routes-vector" source (pmtiles:// protocol, source-layer "routes") + feature-state visibility
```

- **Harvesting:** `harvest-world` (operations/) + `harvest-headway` fetch cities/headway and write NDJSON + `route_metadata`; `build-pmtiles.js` runs tippecanoe over the NDJSON files.
- **On-demand backfill:** the client probes `GET /api/transit/coverage` on each moveend for Transitland's route count in the viewport, renders the ground-truth network as a faint `routes-underlay` line layer below the archive, and `tile-backfill.js` compares the count to what the archive renders. On a full or partial gap it calls `/api/tiles/backfill`, which fetches Transitland routes for the viewport bbox, merges missing `line_key`s into `routes-feed.ndjson` (server-side dedup; seed-owned lines preserved unless `forceRefresh`), rebuilds the archive, and the client reloads the vector source. Coverage responses are cached in Postgres (90-day, snapped keys; separate count vs geometry entries).
- **Metadata:** `route_metadata` (Postgres) supplies names/colors/headway/stop counts; vector-metadata.js merges it into map feature properties.
- **Stops:** rendered on demand per focused route via `/api/transit/route-stops` (GeoJSON `stops` source).

## API Endpoints & Data Store

### Tile & Backfill API
- **GET `/api/tiles/routes.pmtiles`** - Range-aware streaming of the PMTiles archive (`application/x-protobuf`)
- **GET `/api/tiles/stats`** - Archive stats (size, tile count, requests)
- **POST `/api/tiles/backfill`** - Feed-in backfill for a `{ bbox, zoom }`; rebuilds the archive when new routes are merged
- **GET `/api/tiles/backfill/status`** - Backfill progress (stages `fetching` / `rebuilding`)

### Transit Data API
- **GET `/api/transit/coverage?bbox=...&zoom=...`** - Transitland's distinct route count for the viewport (gap-detection probe)
- **GET `/api/transit/route-stops?lineKey=...&stopTypes=...`** - Stops for a single route (route membership)
- **GET `/api/transit/route-headway?lineKey=...`** - Headway summary for one route
- **GET `/api/transit/route-headway/bulk?lineKeys=a,b,c`** - Cached headway for many routes (one query)
- **POST `/api/transit/stop-fractions`** - ST_LineLocatePoint fractions for stops on a route
- **GET `/api/transit/reviews?citySlug=...`** - Route & agency review settings
- **POST `/api/transit/route-ordering/vote`** - Record a signed-in route-ordering preference vote
- **GET `/api/transit/bbox`** - **Retired (HTTP 410)**: replaced by the PMTiles pipeline; kept only to return a clear error.

### Admin Override API
- **GET `/api/admin/overrides/route?citySlug=...`** - List route overrides
- **POST `/api/admin/overrides/route`** - Create/update route override
- **GET `/api/admin/overrides/route/:lineKey`** - Get specific override

### Admin Review API
- **GET `/api/admin/reviews/route?citySlug=...`** - List route problematic reviews
- **POST `/api/admin/reviews/route`** - Set problematic override for a route
- **GET `/api/admin/reviews/agencies?citySlug=...`** - List agency allow/block settings
- **POST `/api/admin/reviews/agencies`** - Set agency allowed override

### Progress API
- **GET `/api/progress`** - User's visited stops
- **POST `/api/progress`** - Mark stop as visited
- **POST `/api/progress/clear-route`** - Clear progress for a route

### Filter Presets API
- **GET `/api/presets?citySlug=...`** - User's saved filter presets
- **POST `/api/presets`** - Save new preset
- **DELETE `/api/presets/:name?citySlug=...`** - Delete preset

---

## Storage & Persistence

### Browser LocalStorage Keys
- `"metromark_token"` - Auth token
- "metromark_admin_session_token" - Admin session token (sessionStorage)
- `"metromark_theme"` - 'light' or 'dark'
- `"metromark_initial_city_slug"` - Last active city
- `"metromark_mode_filter_keys"` - Serialized mode filter set
- `"metromark_frequency_filter_keys"` - Serialized frequency filter set
- `"metromark_route_visibility_overrides"` - Manual line visibility overrides (JSON)
- `"metromark_show_private_operators"` - Boolean
- `"metromark_show_problematic_geometries"` - Boolean
- `"metromark_show_all_stops"` - Boolean
- `"metromark_[presetName]"` - Serialized preset snapshot (auto-named)

### PostgreSQL Data Store Tables
Postgres is the local cache/harvest database (see `operations/local-postgres-schema.sql`). Transitland data is harvested into it and into the NDJSON store to reduce API calls; the runtime map reads the PMTiles archive.

- `public.transit_cache` - Transitland API response cache (city catalogs, route stops, headway, vector tiles)
- `public.route_metadata` - Per-route metadata (name, operator, mode, color, headway, frequency, stop count)
- `public.route_geometry_lod` - Level-of-detail route geometries (fractions, detail views)
- `public.usage_log` - Daily Transitland API usage counters (cap enforcement)
- `public.stop_translation` - Stop ID normalization map (upstream stop id → stable key)
- `public.station_override` - Manual stop coordinate/name corrections
- `public.route_override` - Manual route property edits (incl. `orderingMode`)
- `public.route_ordering_vote` - Community route-ordering preference votes
- `public.route_review` - Problematic-geometry review flags
- `public.agency_review` - Operator allow/block flags

Supabase (`operations/supabase-baseline.sql`) holds the auth/user tables: `profiles`, `user_station_visit` (progress), `user_filter_presets`.

---

## Best Practices

1. **Single Extraction of Operator Name**
   - Extract once at route load time
   - Store in `lineSummaries[].operatorName`
   - Reuse everywhere (status panel, list, popups)

2. **Viewport-Scoped Visibility**
  - Apply manual overrides only to routes currently intersecting viewport geometry
  - Do not gate runtime route visibility by `state.initialCitySlug`
  - Keep city slug usage to harvest/admin/preset workflows

3. **Data Refresh Invalidation**
   - After POST to `/api/admin/overrides/*` or `/api/admin/reviews/*`
   - Call `db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX)`
   - Front-end should reload affected viewport

4. **Filter Consistency**
   - Mode filter applied first
   - Frequency filter second
   - Manual visibility override last (trumps all)
   - Review settings checked inside lineIsVisible

5. **Progress Tracking**
   - Always use `state.visitedByLine` Map
   - Keyed by lineKey
   - Fetch from `/api/progress` on login
   - Update on stop click via POST `/api/progress`

---

## Deprecated / Legacy

The viewport bbox transit pipeline has been removed:
- Client-side area/bbox fetching (`areaCache`, `inFlightAreaKeys`, `visibleAreaKeys`, `requestedAreaKeys`) no longer exists; the map renders from the PMTiles vector source.
- `GET /api/transit/bbox` is a retired stub returning HTTP 410.
- `GET /api/transit/city/:slug` was removed; use the tile pipeline + `/api/tiles/backfill`.
