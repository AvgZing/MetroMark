# Windows Local and Spare-PC Deployment

## A) Main Home PC (Testing)

1. Install Node.js 20 LTS.
2. Clone repository.
3. Create .env from .env.example.
4. Set TRANSITLAND_API_KEY.
5. Run npm install.
6. Run npm start.
7. Open http://localhost:8080.

Recommended test routine:
- Login with demo account.
- Load one city and verify route/station rendering.
- Click stations to set visited and refresh page.
- Confirm visited states persist.

## B) Spare Windows 7/10 PC (Self-host)

## Option 1: Manual foreground run

Use when you only need occasional testing:
- Open PowerShell in repo directory.
- Run npm start.
- Keep terminal open while testing.

## Option 2: Persistent service-style run (recommended)

Use a process manager such as PM2 (works on Windows with Node).

Example flow:
1. npm install -g pm2
2. pm2 start server/index.js --name metromark
3. pm2 save
4. pm2 startup

Then expose via your local network/router as needed.

## C) Backup Strategy (Space-aware)

You asked for a space-conscious backup model. Suggested split:

- Source code:
  - GitHub repository only (no db/cache files)

- Core local data:
  - data/metromark.db (compact SQLite)
  - Optional periodic compressed snapshots

- Cache:
  - Keep in same SQLite db for simplicity
  - Safe to purge/rebuild when needed

Backup command example (PowerShell):
- Copy-Item .\data\metromark.db .\backups\metromark-$(Get-Date -Format yyyyMMdd).db

For cloud backup with low space:
- Weekly compression of db snapshot before upload.

## D) Security Checklist Before Push

- Confirm .env is ignored.
- Confirm no API keys in tracked files.
- Confirm prototypes folder is ignored.
- Rotate key if a previous key was exposed publicly.

## E) Transition to Public Hosting Later

When you move beyond local hosting:
- Add HTTPS reverse proxy (Caddy/Nginx).
- Add rate-limiting middleware on auth and transit endpoints.
- Add secure cookie/session option if you stop using localStorage tokens.
