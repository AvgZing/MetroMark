# MetroMark Review and Reorg Notes


## 2. Consolidation Opportunities

These are places where the current structure duplicates intent or splits related concerns too much.

### Filter / route logic
The route filtering logic is spread across [public/scripts/core-state-ui.js](../public/scripts/core-state-ui.js), [public/scripts/filters-routes.js](../public/scripts/filters-routes.js), and parts of [public/scripts/filter-presets.js](../public/scripts/filter-presets.js).

Possible consolidation:
- keep state and pure helper functions in one small module
- keep rendering and UI event handling in a second module
- keep persistence / preset snapshot logic in a third module

This would reduce cross-file coupling and make it easier to reason about search, visibility, presets, and review flags together.

### Review loading
The review-loading logic now exists in both admin and client paths:
- [public/scripts/admin-override.js](../public/scripts/admin-override.js)
- [public/scripts/core-state-ui.js](../public/scripts/core-state-ui.js)
- [public/scripts/filter-presets.js](../public/scripts/filter-presets.js)

Possible consolidation:
- a shared `reviews-api.js` or `city-reviews.js` helper for fetch + normalize + cache update
- one canonical function for loading review state into the client store

That would prevent the same endpoint shape from being handled in slightly different ways.

### Auth/settings panel wiring
The account popup currently mixes login form, register form, and user settings toggles in one long UI path in [public/index.html](../public/index.html). That is functional, but the settings section could be separated into a reusable partial or clearly isolated subsection in the long term.

## 3. Files That Are Too Large

These are the strongest candidates to split into smaller files or modules.

### [public/scripts/core-state-ui.js](../public/scripts/core-state-ui.js)
- ~1790 lines
- This is the most overloaded file in the app
- It currently mixes state, rendering, status, line view, station view, helper formatting, connector drawing, and interaction orchestration

Recommended split targets:
- `state-store.js` for shared state and persistence helpers
- `status-panel.js` for status rendering
- `line-view.js` for line view rendering and connector drawing
- `station-status.js` for station selection and progress display helpers
- `formatters.js` for line names, labels, and helper text

### [public/scripts/filters-routes.js](../public/scripts/filters-routes.js)
- ~963 lines
- This file blends route list rendering, visibility logic, route focus behavior, progress rendering, and route selection UI

Recommended split targets:
- `route-list.js` for filtered list rendering
- `route-focus.js` for focus / selection behavior
- `progress-panel.js` for progress summary rendering
- `filters-logic.js` for pure visibility and search scoring helpers

### [public/scripts/map-interactions.js](../public/scripts/map-interactions.js)
- ~549 lines
- This is less urgent than the two above, but it still combines map layer setup, hover behavior, and route selection behavior

If the app keeps growing, this is a good future split candidate into:
- `map-layers.js`
- `map-hover.js`
- `map-selection.js`

## 4. File Organization Improvements

These are structural changes that would make the workspace easier to manage as a three-system setup.

### Separate local runtime data from synced source
You asked for a clear separation between:
- local data like PostgreSQL and node modules
- synced GitHub repo source
- personal docs and setup scripts that should not be synced to GitHub

A clearer organization would be:
- `server/` and `public/` for synced app source
- `docs/` for durable reference docs
- a dedicated local-only folder outside the repo for runtime storage, exports, cache snapshots, and environment-specific scripts

The current repo already hints at this split, but the distinction should be made more explicit in the documentation and ignored paths.

### Add a clear operations boundary
It would help to separate:
- app source code
- admin/setup scripts
- local database migration or bootstrap scripts
- user-facing docs

Right now, the repo is understandable, but the operational boundary is still implicit rather than obvious.

### Name docs by role
A future-friendly docs layout would be easier to navigate if the docs were grouped by role:
- architecture / system design
- workspace / repo layout
- variables / naming reference
- migration / setup notes
- session scratch notes

## 5. New Docs Worth Adding

These are the most useful additional markdown docs to create next.

### Operational boundaries doc
A markdown doc that explicitly explains what belongs in:
- the synced repo
- the local-only runtime/data area
- the personal docs area
- the database bootstrap / migration area

This would help prevent accidental syncing of data that should stay local.

### Settings and state reference
A doc focused on user settings, storage, and precedence rules:
- localStorage vs user profile vs DB saved state
- default values
- when guest settings are local-only
- when signed-in settings should persist server-side

This would complement [docs/VARIABLES.md](VARIABLES.md) and help avoid drift as the settings surface grows.

### Admin review workflow doc
A short operational guide for the manual override and review system:
- route override editing
- problematic geometry review flow
- agency allow/block flow
- what should happen when a city is refreshed or reharvested

### Performance and fetch policy doc
A reference for the project’s fetch rules and caching expectations:
- cache-first behavior
- when Transitland can be queried
- what should and should not be loaded at low zoom
- when hidden data should stay unloaded

This would be especially useful because the current system now has several interacting data sources and cache layers.

## 7. Recommended Next Cleanup Order

5. Split [public/scripts/core-state-ui.js](../public/scripts/core-state-ui.js) into smaller feature modules.
6. Split [public/scripts/filters-routes.js](../public/scripts/filters-routes.js) once the current behavior is stable.
7. Add the new operational boundary docs so the local/synced/personal split is explicit.