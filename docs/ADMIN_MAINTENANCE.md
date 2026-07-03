# Admin and Maintenance

## Login model
- Admin console and manual override editor both require a session login.
- Login uses `ADMIN_USERNAME` and `ADMIN_PASSWORD` from the environment.
- The browser stores the admin session token in `sessionStorage`, not `localStorage`.
- Reopen the browser or tab to require a fresh login.

## Admin console
- `/admin` is the main maintenance hub.
- It exposes usage, cache, harvest, and database status.
- It links to `/admin/override` for route cleanup work.
- Protected admin actions are accepted only when the request includes the active admin session or a signed-in Supabase admin user.

## Manual override editor
- `/admin/override` loads the selected route and its current cached Transitland geometry/stops.
- Route loading is cache-first through the transit API, with Transitland fallback when needed.
- The editor supports:
  - changing agency, mode, and frequency
  - adding stops
  - deleting stops
  - moving stops up and down
  - renaming stops
  - editing stop coordinates
  - resetting the working copy from the live route payload
- Route overrides are stored in `public.route_override`, so they survive cache refreshes.

## Transit data and cleanup
- Transit cache and route geometry live in local Postgres/PostGIS.
- User auth and user preferences live in Supabase.
- Refreshing a city or clearing transit caches does not remove manual route overrides.
- Keep the cleanup scripts in `tools/` for Supabase purge and local transit reset workflows.

## Review and filtering notes
- Agency review uses a tri-state model:
  - `true` = approved
  - `false` = blocked
  - `null` = unreviewed
- Unreviewed agencies stay visible until they are explicitly reviewed.
- Problematic geometry review should remain a separate route-level review flag.

## Operational notes
- Use the admin console to inspect API usage and harvest progress before forcing a refresh.
- If a route edit is wrong, re-open the editor, load the route again, and adjust the override payload instead of manually editing tables.
- Manual route override payloads should stay JSON-friendly and small enough to review by eye.
