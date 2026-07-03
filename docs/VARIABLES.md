# MetroMark Project Variables Reference

This document catalogs all major variables, objects, and data structures used throughout MetroMark. It serves as a living reference for consistency and to minimize duplication.

---

## State Management (`core-state-ui.js`)

### User & Session
- **`state.token`** - Auth token (localStorage or sessionStorage)
- **`state.user`** - Current user object `{ email, displayName, id, role }`
- **`state.initialCitySlug`** - Active city slug for filter presets (stored in localStorage)

### Map & Viewport
- **`state.map`** - MapLibre GL instance
- **`state.mapReady`** - Boolean flag when map DOM is loaded
- **`state.mapMode`** - Current map style ('streets' or 'satellite')

### Route Filtering & Visibility
- **`state.activeModeKeys`** - Set of active mode filter keys (e.g., 'bus', 'metro', 'rail')
- **`state.activeFrequencyKeys`** - Set of active frequency filters (e.g., 'frequent', 'regular')
- **`state.manualLineVisibility`** - Map of lineKey → 'on'/'off' visibility overrides (viewport-clipped)
- **`state.showPrivateOperators`** - Boolean to show/hide private operators
- **`state.showProblematicGeometries`** - Boolean to show/hide routes with bad geometry
- **`state.showAllStops`** - Boolean to show all stops or route-linked only
- **`state.lineSearchQuery`** - Current search string for route filtering
- **`state.currentViewportBbox`** - Current map viewport bbox [minLon, minLat, maxLon, maxLat]

### Route & Stop Data Storage
- **`state.lineSummaries`** - Array of combined/merged route summaries visible in current view
- **`state.areaCache`** - Map of areaKey (e.g., "bbox:1:2:3:4:modes:all") → fetched transit data from Postgres
- **`state.lineStopsCache`** - Map of routeStopCacheKey → fetched stops data for a route from Postgres
- **`state.inFlightAreaKeys`** - Set of currently fetching area keys (Postgres queries in progress)
- **`state.inFlightLineStopKeys`** - Set of currently fetching route-stop keys (Postgres queries in progress)

### Active Routes & Data
- **`state.cities`** - Array of available city preset objects (for filter presets)
- **`state.transit`** - Combined GeoJSON: `{ routesGeoJson, stopsGeoJson }` visible in current viewport
- **`state.focusedLineKey`** - Currently selected/focused route lineKey (empty if none)
- **`state.visibleAreaKeys`** - Set of cached area keys visible in current viewport
- **`state.requestedAreaKeys`** - Set of area keys the client is requesting data for

### User Progress & Visits
- **`state.visitedByLine`** - Map of lineKey → Set of stationKeys user has visited
- **`state.userStatus`** - Current panel info: `{ title, subtitle, details[], progress, routeLineKey }`
- **`state.userStatusPinnedKind`** - 'station' if pinning a stop, '' if unpinned

### Line View (Detail Panel)
- **`state.lineViewOpen`** - Boolean; line view panel is visible
- **`state.lineViewLineKey`** - lineKey of route displayed in line view
- **`state.lineViewReturn`** - Saved state to restore when closing line view

### UI State
- **`state.mobilePanelsOpen`** - Boolean; sidebar is visible on mobile
- **`state.activePopup`** - 'account' or '' (only one popup at a time)
- **`state.routeSelectPopup`** - Popup instance for route selection on map

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
- The login form uses `ADMIN_USERNAME` and `ADMIN_PASSWORD` from the environment.
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

### Area Data Key
Format: `areaKey = "{bbox}:modes:{modeCacheKey}"` (e.g., "1:2:3:4:modes:3-2")
- `{bbox}` = snapped bounding box from viewport
- `modeCacheKey` = "-".join(sorted routeTypes) or "all"
- Purpose: Unique identifier for Postgres data store lookups; tracks what transit data has been fetched from Postgres

### Route Stop Data Key
Format: `routeStopCacheKey(lineKey) = `${lineKey}:stops`
- Purpose: Unique identifier for Postgres queries; tracks which route stops have been fetched from Postgres

### Stop Key (Unique Stop Identifier)
- Within a specific route context: `stationKey`
- For deduplication across routes: `${lineKey}|${stationKey}` (stopKey)

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

## API Endpoints & Data Store

### Transit Data API
- **GET `/api/transit/bbox?bbox=...&zoom=...`** - Viewport-specific transit
- **GET `/api/transit/route-stops?lineKey=...`** - Stops for a single route
- **GET `/api/transit/reviews?citySlug=...`** - Route & agency review settings
- Response includes: `lineSummaries[]`, `routesGeoJson`, `stopsGeoJson`, `city`

### Legacy / Compatibility Endpoint
- **GET `/api/transit/city/:slug`** - Legacy/admin compatibility path; main client runtime should use bbox endpoint

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
Postgres serves as the primary local copy of Transitland data to reduce API calls. All Transitland-sourced data is stored here and re-fetched from Postgres instead of calling Transitland repeatedly.

- `public.transit_cache` - Local copy of Transitland routes/stops payloads organized by area bbox
- `public.station_override` - Manual stop coordinate corrections
- `public.route_override` - Manual route property edits
- `public.route_review` - Route quality/validity flags
- `public.agency_review` - Operator allow/block list
- `public.visited_station` - User progress tracking (independent of Transitland)
- `public.filter_preset` - User filter snapshots per city
- `public.harvest_job_log` - Audit trail of data refreshes
- `public.stop_translation` - Stop ID normalization map
- `public.route_geometry_lod` - Simplified geometries for zoom levels

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

None currently documented. Variables listed above are active.
