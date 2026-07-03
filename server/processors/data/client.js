const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "metromark.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stop_translation (
  input_stop_id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS station_override (
  stable_key TEXT PRIMARY KEY,
  manual_name TEXT,
  manual_lat REAL,
  manual_lon REAL,
  note TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_station_visit (
  user_id INTEGER NOT NULL,
  line_key TEXT NOT NULL,
  station_key TEXT NOT NULL,
  station_name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  visited INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, line_key, station_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const statements = {
  createUser: db.prepare(
    `INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)`
  ),
  getUserByEmail: db.prepare(
    `SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = ?`
  ),
  getUserById: db.prepare(
    `SELECT id, email, password_hash, display_name, created_at FROM users WHERE id = ?`
  ),
  getCache: db.prepare(
    `SELECT payload, fetched_at, expires_at FROM api_cache WHERE cache_key = ? AND expires_at > ?`
  ),
  setCache: db.prepare(
    `
    INSERT INTO api_cache (cache_key, payload, fetched_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key)
    DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
    `
  ),
  clearCacheByPrefix: db.prepare(`DELETE FROM api_cache WHERE cache_key LIKE ?`),
  upsertStopTranslation: db.prepare(
    `
    INSERT INTO stop_translation (input_stop_id, stable_key, source, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(input_stop_id)
    DO UPDATE SET stable_key = excluded.stable_key, source = excluded.source, updated_at = excluded.updated_at
    `
  ),
  getStationOverride: db.prepare(
    `SELECT stable_key, manual_name, manual_lat, manual_lon, note, updated_at FROM station_override WHERE stable_key = ?`
  ),
  upsertStationOverride: db.prepare(
    `
    INSERT INTO station_override (stable_key, manual_name, manual_lat, manual_lon, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(stable_key)
    DO UPDATE SET manual_name = excluded.manual_name, manual_lat = excluded.manual_lat, manual_lon = excluded.manual_lon, note = excluded.note, updated_at = excluded.updated_at
    `
  ),
  upsertVisit: db.prepare(
    `
    INSERT INTO user_station_visit (user_id, line_key, station_key, station_name, lat, lon, visited, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, line_key, station_key)
    DO UPDATE SET station_name = excluded.station_name, lat = excluded.lat, lon = excluded.lon, visited = excluded.visited, updated_at = excluded.updated_at
    `
  ),
  deleteVisit: db.prepare(
    `DELETE FROM user_station_visit WHERE user_id = ? AND line_key = ? AND station_key = ?`
  ),
  deleteVisitsForUserByLine: db.prepare(
    `DELETE FROM user_station_visit WHERE user_id = ? AND line_key = ?`
  ),
  getVisitsForUser: db.prepare(
    `
    SELECT line_key, station_key, station_name, lat, lon, updated_at
    FROM user_station_visit
    WHERE user_id = ? AND visited = 1
    ORDER BY updated_at DESC
    `
  ),
  getVisitsForUserByLine: db.prepare(
    `
    SELECT line_key, station_key, station_name, lat, lon, updated_at
    FROM user_station_visit
    WHERE user_id = ? AND line_key = ? AND visited = 1
    ORDER BY updated_at DESC
    `
  )
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

module.exports = {
  db,
  dbPath,
  statements,
  nowSeconds
};
