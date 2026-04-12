const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const config = require("./config");

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

function sanitizeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function createUser(email, password, displayName) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const safeName = String(displayName || "").trim() || "MetroMark User";

  if (!normalizedEmail || !password) {
    return null;
  }

  const existing = statements.getUserByEmail.get(normalizedEmail);
  if (existing) {
    return null;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const createdAt = nowSeconds();

  const result = statements.createUser.run(normalizedEmail, passwordHash, safeName, createdAt);
  return getUserById(result.lastInsertRowid);
}

function verifyUser(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = statements.getUserByEmail.get(normalizedEmail);

  if (!user) {
    return null;
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  return ok ? sanitizeUser(user) : null;
}

function getUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return sanitizeUser(statements.getUserByEmail.get(normalizedEmail));
}

function getUserById(id) {
  return sanitizeUser(statements.getUserById.get(id));
}

function getCache(cacheKey) {
  const row = statements.getCache.get(cacheKey, nowSeconds());
  if (!row) {
    return null;
  }

  try {
    return {
      payload: JSON.parse(row.payload),
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at
    };
  } catch (error) {
    return null;
  }
}

function setCache(cacheKey, payload, ttlSeconds) {
  const fetchedAt = nowSeconds();
  const expiresAt = fetchedAt + Math.max(60, ttlSeconds);
  statements.setCache.run(cacheKey, JSON.stringify(payload), fetchedAt, expiresAt);
}

function clearCacheByPrefix(prefix) {
  statements.clearCacheByPrefix.run(`${prefix}%`);
}

function upsertStopTranslation(inputStopId, stableKey, source = "transitland") {
  if (!inputStopId || !stableKey) {
    return;
  }

  statements.upsertStopTranslation.run(inputStopId, stableKey, source, nowSeconds());
}

function getStationOverride(stableKey) {
  const row = statements.getStationOverride.get(stableKey);
  if (!row) {
    return null;
  }

  return {
    stableKey: row.stable_key,
    manualName: row.manual_name,
    manualLat: row.manual_lat,
    manualLon: row.manual_lon,
    note: row.note,
    updatedAt: row.updated_at
  };
}

function upsertStationOverride(stableKey, manualName, manualLat, manualLon, note) {
  statements.upsertStationOverride.run(
    stableKey,
    manualName || null,
    Number.isFinite(manualLat) ? manualLat : null,
    Number.isFinite(manualLon) ? manualLon : null,
    note || null,
    nowSeconds()
  );
}

function setVisitedState(userId, payload) {
  const lineKey = String(payload.lineKey || "").trim();
  const stationKey = String(payload.stationKey || "").trim();
  const stationName = String(payload.stationName || "").trim() || "Unnamed Stop";
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const visited = Boolean(payload.visited);

  if (!lineKey || !stationKey || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid station payload.");
  }

  if (!visited) {
    statements.deleteVisit.run(userId, lineKey, stationKey);
    return;
  }

  statements.upsertVisit.run(
    userId,
    lineKey,
    stationKey,
    stationName,
    lat,
    lon,
    1,
    nowSeconds()
  );
}

function getVisitedStations(userId, lineKey = "") {
  const rows = lineKey
    ? statements.getVisitsForUserByLine.all(userId, lineKey)
    : statements.getVisitsForUser.all(userId);

  return rows.map((row) => ({
    lineKey: row.line_key,
    stationKey: row.station_key,
    stationName: row.station_name,
    lat: row.lat,
    lon: row.lon,
    updatedAt: row.updated_at
  }));
}

function seedDemoUser() {
  const existing = statements.getUserByEmail.get(config.DEMO_USER_EMAIL.toLowerCase());
  if (existing) {
    return sanitizeUser(existing);
  }

  const passwordHash = bcrypt.hashSync(config.DEMO_USER_PASSWORD, 10);
  const createdAt = nowSeconds();
  const result = statements.createUser.run(
    config.DEMO_USER_EMAIL.toLowerCase(),
    passwordHash,
    config.DEMO_USER_NAME,
    createdAt
  );

  return getUserById(result.lastInsertRowid);
}

seedDemoUser();

module.exports = {
  dbPath,
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  getCache,
  setCache,
  clearCacheByPrefix,
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride,
  setVisitedState,
  getVisitedStations
};
