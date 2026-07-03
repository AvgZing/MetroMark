# MetroMark Production Runbook (Supabase + PostGIS + Windows 11)

This runbook is for Windows 11 deployment under user `Zing` and uses a two-profile env setup only:

- `.env.development`
- `.env.production`

No third runtime `.env` file is required.

## 0) Repo Layout and What Lives Where

Keep these buckets separate so dev/prod user names do not matter:

- Source code (GitHub): the MetroMark repo folder.
- Installed dependencies: `node_modules/` (rebuildable; never hand-edit).
- Local data and backups: `data/` (e.g. `data/backups/`, any local cache files).
- Supabase schema: `supabase/migrations/` (apply SQL in order).

All Windows scripts below resolve the repo folder relative to the script path,
so `C:\Users\Praji\...` vs `C:\Users\Zing\...` is not critical.

## 1) Supabase Projects and Schema

Use separate Supabase projects:

- Development project
- Production project

For each project:

1. Create project in Supabase.
2. Copy URL, anon key, and service-role key.
3. Ensure PostGIS extension is enabled.
4. Apply migration SQL:
  - `supabase/migrations/20260417_metromark_core.sql`
  - `supabase/migrations/20260418_user_filter_presets.sql`

## 2) Environment Profiles (Only Two)

Create from templates:

- `.env.development` from `.env.development.example`
- `.env.production` from `.env.production.example`

Required values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRANSITLAND_API_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Start commands:

```bash
npm run start:dev
npm run start:prod
```

Helper scripts (no npm command memorization):

```powershell
scripts\windows\start-dev.ps1
scripts\windows\start-prod.ps1
scripts\windows\open-app.ps1
scripts\windows\open-admin.ps1
```

Operational jobs:

```bash
npm run harvest:core
npm run harvest:core:prod
npm run backup:nonrecoverable
npm run backup:nonrecoverable:prod
```

## 3) Account and Session Model

User authentication is Supabase Auth only:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

Progress is stored per authenticated user in `public.user_station_visit`.

## 4) Cache and Reverification

Cache table: `public.transit_cache`.

Behavior:

1. User requests city/bbox payload.
2. Server checks cached payload.
3. If valid cache exists, it returns immediately.
4. Stale city caches (`TRANSIT_CACHE_STALE_DAYS`) are queued for background verification.
5. Harvester compares feed fingerprints before full redownload.

## 5) Admin Console and Monitoring

Open `/admin` and provide `x-admin-key`.

Tracked data includes:

- Usage burn and cap state
- Harvest queue and city state
- Cache and DB size
- Account stats (`profiles`, active profiles, visit rows, latest login)
- Runtime performance (uptime, memory, CPU)
- Transitland request/failure counters and last request timestamps

Manual actions:

- Harvest cycle
- Nonrecoverable backup
- Queue city refresh
- Station override + cache invalidation

## 6) Windows 11 Task Scheduler Setup (User: Zing)

Repository path is resolved by scripts, so user-specific paths are optional.

Recommended one-liner:

```powershell
scripts\windows\register-prod-tasks.ps1 -UserName Zing
```

### Manual command reference (optional)

If you prefer explicit commands, use `%USERPROFILE%` or a custom path:

```powershell
schtasks /Create /F /SC ONLOGON /TN "MetroMark-StartProd" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\Documents\GitHub\MetroMark\scripts\windows\start-prod.ps1" /RU Zing
```

### Harvest every 30 minutes (production env)

```powershell
schtasks /Create /F /SC MINUTE /MO 30 /TN "MetroMark-HarvestCore" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\Documents\GitHub\MetroMark\scripts\windows\run-harvest-prod.ps1" /RU Zing
```

### Nonrecoverable backup daily at 02:15 (production env)

```powershell
schtasks /Create /F /SC DAILY /ST 02:15 /TN "MetroMark-BackupNonrecoverable" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\Documents\GitHub\MetroMark\scripts\windows\run-backup-prod.ps1" /RU Zing
```

## 7) Automatic GitHub Sync to Production Machine

Use script:

- `scripts/windows/sync-from-github.ps1`

It:

1. Fetches and fast-forwards from GitHub branch (default `main`).
2. Installs deps (`npm ci` when lockfile exists).
3. Triggers `MetroMark-StartProd` task to restart app task.

Create scheduled sync task (every 10 minutes):

```powershell
schtasks /Create /F /SC MINUTE /MO 10 /TN "MetroMark-GitHubSync" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\Documents\GitHub\MetroMark\scripts\windows\sync-from-github.ps1" /RU Zing
```

## 8) Git Workflow for Updates

From your dev machine:

1. Commit changes.
2. Push to `origin/main`.
3. Production sync task pulls and deploys automatically.

## 9) Cloudflare Fronting

Recommended:

1. Keep MetroMark bound to localhost on host machine.
2. Publish via Cloudflare Tunnel.
3. Do not expose raw host port publicly.
4. Keep service-role key server-only.

## 10) Production Readiness Checklist

1. Populate `.env.production` with real production keys.
2. Apply SQL migration on production Supabase.
3. Run `npm install` once.
4. Verify account register/login and progress write/read.
5. Run one manual harvest and one backup.
6. Verify `/admin` values for usage, cache size, accounts, and runtime metrics.
7. Enable scheduler tasks.
8. Confirm GitHub sync task pulls and restarts correctly.
9. Cut Cloudflare route to production host.

## 11) Local Testing Guidance

You can continue local testing on your normal PC.

Recommended pattern:

- Use development Supabase for day-to-day testing.
- Use production Supabase only for controlled smoke checks.

You should still do final validation on the production Windows 11 machine before public release.
