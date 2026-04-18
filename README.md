# MetroMark

MetroMark is a transit exploration tracker for people who like to discover and complete transit systems.

## What You Can Do

- Explore routes on a live map.
- Filter by mode, frequency, and search text.
- Focus one route while keeping other filtered routes visible in the background.
- Click stations to mark them visited (when signed in).
- Track progress across visible routes.

## Quick Start

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Add your Transitland API key to `.env`.
4. Run:

```bash
npm install
npm start
```

Open:

- http://localhost:8080

## Demo Login

Use the demo account from the Profile panel.

Default demo credentials are seeded from `.env.example`:

- Email: `demo@metromark.local`
- Password: `demo1234`

## Caching (Important)

MetroMark uses **server-side caching** to control Transitland API usage.

- Transit requests are made by the Node server, not by browser clients directly.
- Server responses are cached in SQLite.
- The browser keeps only a short session cache for smoother map interactions.

This means repeated users/views should hit server cache instead of repeatedly calling Transitland for the same area.

## Data Source and Attribution

- Transit data: Transitland
- Terms: https://www.transit.land/terms

## Notes

- Very wide zoom levels intentionally pause new fetches to avoid expensive global pulls.
- Cached, in-view routes can still render while fetch is paused.
- Route frequency quality depends on available upstream headway data.

## For Maintainers

- Internal architecture notes: `docs/ARCHITECTURE.md`
- Canonical internal changelog: `docs/changelog/CHANGELOG.md`
