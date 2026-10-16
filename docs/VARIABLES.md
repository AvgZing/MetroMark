# MetroMark Project Variables Reference

This document catalogs all major variables, objects, and data structures used throughout MetroMark. It serves as a living reference for consistency and to minimize duplication.

---

## State Management (`UI/state.js`)

`appState` is a single global object (defined in `public/scripts/UI/state.js`) shared across the map/UI scripts. Key fields:

### User & Session
- **`appState.token`** - Auth token (localStorage or sessionStorage)
- **`appState.user`** - Current user object `{ email, displayName, id, role }`
- **`appState.initialCitySlug`** - Default city slug for review scoping / preset snapshots (localStorage `metromark_initial_city_slug`). Not a runtime visibility gate.
- **`appState.activeCitySlug`** - Explicitly selected city mode (localStorage `metromark_active_city_slug`); `""` = Globe View. When set, `getShownLines()` restricts routes to `appState.cityRouteKeysBySlug.get(activeCitySlug)`.
- **`appState.publishedCities`** - Published curated cities from `GET /api/catalog/cities` (`published[]`).
- **`appState.cityRouteKeysBySlug`** - Map city slug → Set of included line keys (city-mode filter).
- **`appState.cityGeometryBySlug`** - Map city slug → `{ featureCollection }` of that city's full route geometry (city mode renders from this, so routes never unload).
- **`appState.cityGeometryActive`** - True while the map renders from the persistent city GeoJSON (`routes` source + `city-routes-*` layers) instead of the `routes-vector` tiles. Everything city-geometry gated on an explicit `activeCitySlug`; Globe View is unchanged. `activeRouteSource()` returns the current feature-state target.
- **`appState.cityLineSummariesBySlug`** - Map city slug → last-known route summaries, unioned back into `lineSummaries` so an active city's routes stay listed/counted (and prefetched) after the viewport leaves them.

### Map & Viewport
- **`appState.map`** - MapLibre GL instance
- **`appState.mapReady`** - Boolean flag when map DOM is loaded
- **`appState.mapMode`** - Current map style ('streets' or 'satellite')
- **`appState.currentViewportBbox`** - Current map viewport bbox [minLon, minLat, maxLon, maxLat]
- **`appState.vectorArchiveVersion`** - Build stamp of `routes.pmtiles` (`<mtimeMs>-<size>` from `GET /api/tiles/archive-version`); part of the vector source URL so a rebuilt archive is a new URL
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
- **`appState.routeOverridesByCity`** - Map of lineKey → `route_override` row (`payload` with name/mode/color/operator/orderingMode/stops/mergedLineKeys); applied by vector-metadata.js and the line view (custom stop order)
- **`appState.mergeMembersByCanonical`** - Map canonical lineKey → member lineKeys (derived from `route_override.payload.mergedLineKeys`)
- **`appState.mergeCanonicalByMember`** - Map member lineKey → canonical lineKey; `resolveCanonicalLineKey()` uses it to collapse merged routes

### Active Routes & Data
- **`appState.cities`** - Array of available city preset objects (for filter presets)
- **`appState.transit`** - Combined GeoJSON: `{ routesGeoJson, stopsGeoJson }` for feature-state/visibility work
- **`appState.focusedLineKey`** - Currently selected/focused route lineKey (empty if none)

### Tile Backfill (PMTiles feed-in)
- **`appState.transitCoverageCount`** - Sampled Transitland line-key count for the viewport (from `GET /api/transit/coverage`, set by `underlay.js` on moveend). A capped centre-tile sample used only as a presence signal; never compared for magnitude against archive counts.
- **`appState.backfillStage`** - Last reported backfill stage (`fetching` / `rebuilding`), used for the loading card's progress width
- **`appState.lastCameraMoveAt`** - Epoch ms of the last moveend; loading/empty cards wait for the camera to settle before appearing
- **`appState.tileBackfillCount`** / **`tileBackfillTotalMs`** / **`tileBackfillAddedRoutes`** - Backfill run metrics
- **`appState.tileBackfillInFlight`** - Boolean; a backfill request is in progress
- **`appState.tileBackfillCooldownUntil`** - Epoch ms; skip new backfills until this time
- **`appState.tileBackfillBboxes`** - Set of coarse-bbox keys already backfilled this session
- **`appState.tileBackfillLastError`** - Last backfill error message
- **`appState.vectorArchiveVersion`** - Build stamp of `routes.pmtiles` (`<mtimeMs>-<size>` from `GET /api/tiles/archive-version`); part of the vector source URL so a rebuilt archive is a new URL
- **`appState.backfillStage`** - Last reported backfill stage (`fetching` / `rebuilding`), used for the loading card's progress width
- **`appState.tilesStats`** - Latest `/api/tiles/stats` payload (archive size, tile count, archiveVersion)

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
- **`appState.lineViewBranchSelectionsByLineKey`** - Map of lineKey → `{ groupId: optionId }` branch choice (localStorage `metromark_line_view_branch_selections`)

### UI State
- **`appState.colorblindMode`** - Boolean user preference; adds check/cross glyphs to stop markers (`metromark_colorblind_mode`)
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
  lineName: "string",
  lineShortName: "string",
  lineLongName: "string",
  operatorName: "string",
  color: "string",  // hex
  mode: number | null,  // GTFS mode
  orderingMode: "geometry-revised" | "legacy-geometry" | "fractions" | null,
  frequencyBucket: "frequent" | "regular" | "local" | "unknown" | null,
  headwayBestMinutes: number | null,
  mergedLineKeys: ["string"],  // member line keys merged into this canonical route
  stops: [{ key: "string", name: "string", lat: number, lon: number, branch?: "string" }],
  branchGroups: [{ id: "string", label: "string", options: [{ id: "string", label: "string" }] }]
}
```
- `stops` (when present) is the authoritative ordered list for the line view when the ordering default is Manual; it always supplies names/coordinates. `branch` tags a stop with a `branchGroups` option id (trunk = untagged).
- `mergedLineKeys` (on the canonical route's override): collapses the listed member routes into this route. Names join with "/", members inherit the canonical color/operator/frequency, are hidden from the list, and identical stops merge by `station_key`. Resolved client-side by `resolveCanonicalLineKey` + `appState.mergeMembersByCanonical` / `mergeCanonicalByMember`.
- Applied client-side (vector-metadata.js + line view); no tile rebuild needed for override changes.

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
- Returns the server-classified bucket: 'frequent' (≤10 min), 'regular' (10-30 min), 'local' (>30 min), or 'unknown'
- Bucketing is server-owned (`server/sources/transitland/headway.js`, stored in `route_metadata.frequency_bucket`); the client only validates it
- Fallback headway is flagged server-side as `headway_fallback` on route features

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

### Harvester Budgets
The harvester automates the same requests a user makes (route-stops, headway), capped instead of bounded by user patience.
- Per-category daily REST budgets (`server/sources/transitland/harvest-budget.js`): base 100 each (geometry / headway / stops), 50 once nearly-done. Freed budget reallocates to the categories still working (stops → headway → geometry), keeping the daily total at 300.
- Transitland plan caps (env): `HARVEST_DAILY_REST_LIMIT`, `HARVEST_DAILY_VECTOR_LIMIT`, `HARVEST_DAILY_ROUTING_LIMIT` (routing is only the headway route-page fallback).
- `route_metadata.headway_checked` / `stop_checked` mark terminal attempts so backfills converge; `operations/harvest/harvest-wait-seconds.js` has the runner sleep until the next UTC day once budgets are spent.

## API Endpoints & Data Store

### Tile & Backfill API
- **GET `/api/tiles/routes.pmtiles`** - Range-aware streaming of the PMTiles archive (`application/x-protobuf`)
- **GET `/api/tiles/stats`** - Archive stats (size, tile count, requests)
- **POST `/api/tiles/backfill`** - Feed-in backfill for a `{ bbox, zoom }`; rebuilds the archive when new routes are merged
- **GET `/api/tiles/backfill/status`** - Backfill progress (stages `fetching` / `rebuilding`)

### Transit Data API
- **GET `/api/transit/coverage?bbox=...&zoom=...`** - Transitland's distinct route count for the viewport (gap-detection probe)
- **GET `/api/catalog/cities`** - Static metro list (`cities`) + published curated presets (`published`, each with resolved route keys)
- **GET `/api/catalog/cities/:slug/geometry`** - Full route geometry (FeatureCollection, `feature_id`=lineKey) for a curated city, so the client can render city mode from a persistent source instead of unloading tiles
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

### Admin City Preset API
- **GET `/api/admin/cities`** / **GET `/api/admin/cities/:slug`** - List / load curated cities (routes + operators + resolved route keys)
- **POST `/api/admin/cities`** / **DELETE `/api/admin/cities/:slug`** / **POST `/api/admin/cities/:slug/publish`** - Create-update / delete / publish
- **POST `/api/admin/cities/:slug/routes`** (replace) / **PATCH** (merge) / **POST `/api/admin/cities/:slug/routes/remove`** - Explicit route include/exclude + vetting
- **POST `/api/admin/cities/:slug/operators`** (replace) / **PATCH** (merge) - Operator rules
- **GET `/api/admin/operators?q=`** - Distinct operators for the picker

### Admin Route Data API (per-route, matches a user click)
- **GET `/api/admin/routes/search?q=&bbox=`** - Transitland route search, viewport-scoped
- **GET `/api/admin/routes/geometry?lineKey=`** - Archive geometry for one route; used by the Map Editor `?lineKey=` deep link to center + highlight a route being reviewed
- **Map Editor focus model** - Selecting a route sets `focused` feature-state on the `routes-vector` source (must use `promoteId: "line_key"`, matching the app). Non-focused routes draw under `focus-dim-layer` (a `focus-mask` fill); the selected route draws on top via `routes-casing` / `routes-main`
- **GET `/api/admin/routes/merge-candidates?bbox=&citySlug=`** - Detect routes whose geometry is identical or near-identical (same corridor, either direction), returned as `{ candidates, scanned }`; each candidate lists `lineKeys`, `names`, `reason` (`identical-geometry` / `near-geometry`), `score`, and `suggestedCanonicalKey`
- **POST `/api/admin/routes/refresh`** / **`/add`** / **`/remove`** - Refresh / add / remove routes (one archive rebuild per batch)
- **DELETE `/api/admin/overrides/route/:lineKey`** - Delete a route override

### Route Suggestion API
- **POST `/api/suggestions`** - Public: submit a route change suggestion (`{ lineKey, citySlug, payload, note }`); guests allowed, per-IP daily cap. Payload is limited to name/operator/color/mode/frequency fields.
- **GET `/api/admin/suggestions?status=open|applied|denied`** - List suggestions for review; each entry includes a `current` snapshot (override-aware) so the console can show current → suggested
- **POST `/api/admin/suggestions/:id/resolve`** - `{ status: "applied" | "denied" }`; applying merges the payload into the route's `route_override` and clears the transit cache prefix

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
- `"metromark_initial_city_slug"` - Default city slug (review scoping / preset snapshots)
- `"metromark_active_city_slug"` - Explicitly selected city mode; absent/empty = Globe View
- `"metromark_line_view_branch_selections"` - Per-line branch option choices (JSON)
- `"metromark_admin_panel_<panel>"` - Collapsed state of an admin sidebar panel
- `"metromark_mode_filter_keys"` - Serialized mode filter set
- `"metromark_frequency_filter_keys"` - Serialized frequency filter set
- `"metromark_route_visibility_overrides"` - Manual line visibility overrides (JSON)
- `"metromark_show_private_operators"` - Boolean
- `"metromark_show_problematic_geometries"` - Boolean
- `"metromark_show_all_stops"` - Boolean
- `"metromark_colorblind_mode"` - Boolean user preference (mirrors `profiles.preferences.colorblindMode`)
- `"metromark_[presetName]"` - Serialized preset snapshot (auto-named)

### PostgreSQL Data Store Tables
Postgres is the local cache/harvest database (schema is auto-provisioned at server startup from `server/processors/postgres/schema.js`). Transitland data is harvested into it and into the NDJSON store to reduce API calls; the runtime map reads the PMTiles archive.

- `public.transit_cache` - Transitland API response cache (city catalogs, route stops, headway, vector tiles)
- `public.route_metadata` - Per-route metadata (name, operator, mode, color, headway, frequency, `stop_count`, plus convergence flags `headway_checked` / `stop_checked`)
- `public.route_geometry_lod` - Level-of-detail route geometries (fractions, detail views)
- `public.usage_log` - Daily Transitland API usage counters (cap enforcement)
- `public.stop_translation` - Stop ID normalization map (upstream stop id → stable key)
- `public.station_override` - Manual stop coordinate/name corrections
- `public.route_override` - Manual route property edits (incl. `orderingMode`, `mergedLineKeys`)
- `public.route_ordering_vote` - Community route-ordering preference votes
- `public.route_review` - Problematic-geometry review flags
- `public.agency_review` - Operator allow/block flags
- `public.city_preset` / `public.city_preset_route` / `public.city_preset_operator` - Curated city collections: metadata, explicit route include/exclude + vetting flags, and operator rules (resolved at read time).
- `public.route_suggestion` - User-submitted route change suggestions awaiting admin review (`line_key`, `payload`, `note`, `status`).

Supabase (`operations/sql/supabase-baseline.sql`) holds the auth/user tables: `profiles`, `user_station_visit` (progress), `user_filter_presets`.

---

## Best Practices

1. **Single Extraction of Operator Name**
   - Extract once at route load time
   - Store in `lineSummaries[].operatorName`
   - Reuse everywhere (status panel, list, popups)

2. **Viewport-Scoped Visibility**
   - Manual overrides apply only to routes intersecting the viewport
   - Runtime route visibility is gated by an explicit city choice (`activeCitySlug`) only — never by `initialCitySlug`
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

## UI Shell & Design Tokens
- Sheet states: `panel.dataset.sheetState` = `peek` / `half` / `full` (classes `sheet-peek` / `sheet-half` / `sheet-full`), applied by `UI/shell/sheet.js`.
- Control fill tokens: `--control-bg` / `--control-hover` (one step stronger than `--button-bg`, used by line-view and filter controls).
- Accent text tokens: `--on-accent` (text on an `--accent`/`--accent-strong` fill; white in light theme, near-black in dark) and `--accent-text` (accent-coloured text on normal surfaces). Top-bar-only colors are scoped under `.topbar` because the account/theme buttons are migrated into the mobile search row.
- Stop marker colors: `STOP_STYLE` in `Map/stop-style.js` (`visitedFill` green, `unvisitedFill` light gray, `strokeWidth`), shared by the map paint and the line-view list.
- Status glyph layers: `stops-status-icon-<status>` symbol layers added by `Map/stop-status.js`, one per entry in `stopStatusIconSpecs()` gated by a `feature-state` opacity expression.
- Shared client/server constants: `public/scripts/shared/constants.js` (`ROUTE_STOP_TYPES`) mirrors `DEFAULT_STOP_TYPES` in `server/routes/helpers.js`.

## Deprecated / Legacy
- Removed: `sheet-third` sheet state, legacy `.cities-menu` sheet styles, `Styles/styles.css`.
- Client-side frequency bucket derivation removed; the server value is authoritative.

The viewport bbox transit pipeline has been removed:
- Client-side area/bbox fetching (`areaCache`, `inFlightAreaKeys`, `visibleAreaKeys`, `requestedAreaKeys`) no longer exists; the map renders from the PMTiles vector source.
- `GET /api/transit/bbox` is a retired stub returning HTTP 410.
- `GET /api/transit/city/:slug` was removed; use the tile pipeline + `/api/tiles/backfill`.
