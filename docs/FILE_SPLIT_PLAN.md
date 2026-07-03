# File Split Plan

Identify files proejctwide that are over 1000 lines (even possibly 500) and look into the possibility of splitting those out. The general preference is for files to be fairly small and well split out (improves readability) in multiple folders as necessary, with these splits not degrading performance or final functionality. As files are split, splitting must be careful not to impact the functionality elsewhere - checking other references and hooks is important.

1. Split `public/scripts/core-state-ui.js` into submodules under `public/scripts/ui/` (state-store, line-view, station-status, status-panel, formatters).
2. Split `public/scripts/filters-routes.js` into `public/scripts/filters/` modules (route-list, route-focus, progress-panel, filters-logic).
3. Split `public/scripts/map-interactions.js` into `public/scripts/map/` modules (map-layers, map-hover, map-selection).
4. Evaluate `public/scripts/map-viewport-cache.js` and `public/styles.css` as 500+ line follow-up candidates.
5. Continue splitting `server/services/transitland/index.js` (still 1957 lines after the geometry extraction) into route/headway/payload modules.
6. Iteratively move code from the large files into new modules, updating `index.html` or loader order as needed so browser behavior remains the same.
7. Run syntax checks and manual smoke tests after each move; produce small PR-style commits per logical change.

Current large-file shortlist from the workspace audit:

- `public/scripts/core-state-ui.js` (~2082 lines)
- `server/services/transitland/index.js` (~1957 lines, now partially split)
- `public/styles.css` (~1703 lines)
- `server/db/index.js` (~994 lines, now partially split)
- `public/scripts/filters-routes.js` (~963 lines)
- `public/scripts/map-interactions.js` (~549 lines)
- `public/scripts/map-viewport-cache.js` (~526 lines)
- `public/scripts/admin.js` (~447 lines)
- `public/scripts/transit-loading.js` (~438 lines)
- `public/scripts/admin-override.js` (~407 lines)