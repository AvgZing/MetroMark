# Operations Guide

## Login model
- Admin console and manual override editor both require a session login.
- Login uses the Supabase account whose email matches `ADMIN_EMAIL` (the bootstrap admin, granted the admin role on login); the password lives in Supabase, not the env.
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

## Production Deployment (Windows 11)
- Two env profiles: `.env.development` and `.env.production`.
- Start: `npm run start:dev` / `npm run start:prod`.
- Operational jobs: `npm run harvest:world`, `npm run harvest:headway`, `npm run backup:nonrecoverable` (or the `operations/run-harvesters.bat` loop).
- Use separate Supabase projects for dev and production.
- Apply schema from SQL files in `scripts/`.

## Windows Host Operation (bat-based)
- Start at login: put a shortcut to `operations\start-metromark.bat` in the Startup folder (`Win+R` → `shell:startup`), or add a Task Scheduler task (trigger: At startup; "restart on failure") for crash recovery.
- `start-metromark.bat` starts the web app (Express server) and the harvester loop (`operations\run-harvesters.bat`: world + headway, daily-quota-aware). It does **not** touch GitHub.
- **GitHub updates are manual**: run `operations\sync-from-github.bat` when you want to pull the latest stable code. It self-locates the repo (or clones it fresh) and works on any PC, including a spare running an old version — copy the bat over and run it.
- Backups are not run by any bat — use the admin dashboard "Run Nonrecoverable Backup" button or `npm run backup:nonrecoverable:prod`.

## Production Readiness Checklist
1. Populate `.env.production` with real production keys.
2. Apply SQL migration on production Supabase.
3. Run `npm install` once.
4. Verify account register/login and progress write/read.
5. Run one manual harvest and one backup.
6. Verify `/admin` values.
7. Add `operations\start-metromark.bat` to Startup (or a Task Scheduler task).
8. Confirm `start-metromark.bat` starts the app + harvester loop, and that the dashboard backup button works.
