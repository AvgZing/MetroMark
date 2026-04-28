# MetroMark

MetroMark is a transit exploration tracker for people who like to discover and complete transit systems.

## Features

- Explore routes on a live map.
- Filter by mode, frequency, and search text.
- Focus one route while keeping other filtered routes visible in the background.
- Click stations to mark them visited (when signed in).
- Track progress across visible routes.

## Run Locally

1. Install Node.js 20+.
2. Copy `.env.development.example` to `.env.development`.
3. Add Supabase keys and Transitland API key to `.env.development`.
4. Apply `supabase/migrations/20260417_metromark_core.sql` to your Supabase project.
5. Run:

```bash
npm install
npm run start:dev
```

Optional explicit profiles:

```bash
npm run start:dev
npm run start:prod
```

Then open:

- http://localhost:8080

## Data and Caching

MetroMark uses **server-side caching** to control Transitland API usage.

- Transit requests are made by the Node server, not by browser clients directly.
- Server responses are cached in Supabase Postgres with PostGIS enabled.
- The browser keeps only a short session cache for smoother map interactions.

This means repeated users/views should hit server cache instead of repeatedly calling Transitland for the same area.

Defaults now use stronger retention for production hosting:

- `TRANSIT_CACHE_TTL_HOURS=2160` (90 days)
- `TRANSIT_CACHE_STALE_DAYS=30` (background reverify threshold)

Background scripts:

- `npm run harvest:core` (development profile)
- `npm run harvest:core:prod` (production profile)
- `npm run backup:nonrecoverable` (development profile)
- `npm run backup:nonrecoverable:prod` (production profile)

Admin operations page:

- Open `/admin` and provide `x-admin-key` value.
- Track burn rate, harvest queue, and storage size.
- Manually trigger harvest, nonrecoverable backup, city queueing, and station overrides.

For full hosting migration steps (Windows scheduler + Cloudflare), see [docs/MIGRATION-WINDOWS.md](docs/MIGRATION-WINDOWS.md).

## Attribution

- Transit data: Transitland
- Terms: https://www.transit.land/terms

## Notes

- Very wide zoom levels intentionally pause new fetches to avoid expensive global pulls.
- Cached, in-view routes can still render while fetch is paused.
- Route frequency quality depends on available upstream headway data.
