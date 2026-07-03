# Postgres + PostGIS Setup for MetroMark (Local Development)

This document walks through installing PostgreSQL/PostGIS, initializing the MetroMark schema, and configuring environment variables for the app.

## Prerequisites
- A Windows machine (tested here) with administrative privileges.
- Optional: `psql` client and `pgAdmin` for GUI management.

## 1) Install PostgreSQL

1. Download the PostgreSQL installer from https://www.postgresql.org/download/windows/
2. Run the installer and note the superuser password you set (default user: `postgres`).
3. During install, ensure the "StackBuilder" option is available so you can add extensions.

## 2) Install PostGIS extension

Option A (StackBuilder):
- Run StackBuilder after install, choose your PostgreSQL instance, and select `PostGIS` under Extensions.

Option B (OSGeo or binaries):
- Install `postgis` package matching your PostgreSQL version.

## 3) Create metroMark database and user (psql)

Open `psql` as the `postgres` superuser and run:

```psql
CREATE DATABASE metromark_cache;
CREATE USER metromark WITH ENCRYPTED PASSWORD 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE metromark_cache TO metromark;
\c metromark_cache
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

## 4) Environment variables for the app

Set the following in your `.env` or system environment (Windows System Properties > Environment Variables):

- `METROMARK_LOCAL_PG_HOST` (e.g., `127.0.0.1`)
- `METROMARK_LOCAL_PG_PORT` (default `5432`)
- `METROMARK_LOCAL_PG_USER` (e.g., `metromark`)
- `METROMARK_LOCAL_PG_PASSWORD` (the password you chose)
- `METROMARK_LOCAL_PG_DATABASE` (`metromark_cache`)

Alternatively, set a single connection string:

- `METROMARK_LOCAL_PG_URL=postgres://metromark:password@127.0.0.1:5432/metromark_cache`

## 5) Initialize DB schema used by MetroMark

From the project root, you can run the Node initialization (the app will run initialization automatically), or run the SQL statements contained in `server/postgres.js`.

Quick manual SQL approach (connect via `psql -d metromark_cache`):

1. Copy the SQL statements from `server/postgres.js` (the `statements` array) and execute them. This will create the necessary tables and functions, including `route_geometry_lod` and `metromark_geometry_lod` functions.

2. Verify tables exist:

```psql
\dt public.*
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
```

## 6) Optional: Adjust Postgres memory and connection settings

- For local/dev, defaults are fine. For production, tune `shared_buffers`, `work_mem`, `max_connections`.

## 7) Testing the DB from Node

Set environment variables and run a Node REPL or small script to ensure `server/postgres.js` can connect:

```powershell
$env:METROMARK_LOCAL_PG_HOST='127.0.0.1'
$env:METROMARK_LOCAL_PG_USER='metromark'
$env:METROMARK_LOCAL_PG_PASSWORD='yourpassword'
$env:METROMARK_LOCAL_PG_DATABASE='metromark_cache'
node -e "require('./server/postgres').initializeLocalPostgres().then(()=>console.log('OK')).catch(e=>console.error(e))"
```

## 8) Restore/backup tips

- Use `pg_dump` to export databases before running cleanup scripts.
- Example:

```powershell
pg_dump -U postgres -h 127.0.0.1 -Fc -f metromark_cache.dump metromark_cache
```

## 9) Troubleshooting
- If `create extension postgis` fails, ensure the PostGIS binaries match your Postgres version.
- Verify `psql` access and network settings (listen_addresses in postgresql.conf).

## 10) Next steps
- After the DB is up, run the app and exercise endpoints to allow automatic initialization.
- Use the `tools/supabase-cleanup.sql` script for Supabase housekeeping (review carefully and run after backup).
