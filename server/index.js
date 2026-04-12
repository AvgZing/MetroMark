const path = require("path");
const express = require("express");

const config = require("./config");
const db = require("./db");
const { cities, getCityBySlug } = require("./city-presets");
const { createAuthToken, authMiddleware } = require("./auth");
const { getCityTransit } = require("./transitland");

const app = express();

app.use(express.json({ limit: "1mb" }));

function asBoolean(value) {
  const text = String(value || "").toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function userResponse(user, token) {
  return {
    token,
    user
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "MetroMark",
    hasTransitlandKey: Boolean(config.TRANSITLAND_API_KEY),
    cacheTtlHours: config.TRANSIT_CACHE_TTL_HOURS
  });
});

app.get("/api/catalog/cities", (req, res) => {
  res.json({
    cities
  });
});

app.get("/api/transit/city/:slug", async (req, res) => {
  const city = getCityBySlug(req.params.slug);
  if (!city) {
    return res.status(404).json({ error: "Unknown city slug." });
  }

  try {
    const data = await getCityTransit(city.slug, {
      forceRefresh: asBoolean(req.query.refresh)
    });

    if (!data) {
      return res.status(404).json({ error: "No transit data available for this city." });
    }

    return res.json({
      cacheStatus: data.cacheStatus,
      cacheExpiresAt: data.cacheExpiresAt || null,
      ...data.payload
    });
  } catch (error) {
    return res.status(502).json({
      error: "Transit fetch failed.",
      detail: error.message
    });
  }
});

app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const displayName = String(req.body.displayName || "").trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const created = db.createUser(email, password, displayName);
  if (!created) {
    return res.status(409).json({ error: "User already exists or payload is invalid." });
  }

  const token = createAuthToken(created);
  return res.status(201).json(userResponse(created, token));
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.verifyUser(email, password);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = createAuthToken(user);
  return res.json(userResponse(user, token));
});

app.post("/api/auth/demo-login", (req, res) => {
  const demoUser = db.getUserByEmail(config.DEMO_USER_EMAIL);
  if (!demoUser) {
    return res.status(500).json({ error: "Demo user is unavailable." });
  }

  const token = createAuthToken(demoUser);
  return res.json(userResponse(demoUser, token));
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

app.get("/api/progress", authMiddleware, (req, res) => {
  const lineKey = String(req.query.lineKey || "").trim();
  const items = db.getVisitedStations(req.user.id, lineKey);
  return res.json({ items });
});

app.post("/api/progress/toggle", authMiddleware, (req, res) => {
  try {
    db.setVisitedState(req.user.id, {
      lineKey: req.body.lineKey,
      stationKey: req.body.stationKey,
      stationName: req.body.stationName,
      lat: req.body.lat,
      lon: req.body.lon,
      visited: req.body.visited
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/overrides/station", (req, res) => {
  if (!config.ADMIN_OVERRIDE_KEY) {
    return res.status(404).json({ error: "Override endpoint is disabled." });
  }

  const requestKey = String(req.headers["x-admin-key"] || "");
  if (requestKey !== config.ADMIN_OVERRIDE_KEY) {
    return res.status(403).json({ error: "Invalid admin key." });
  }

  const stationKey = String(req.body.stationKey || "").trim();
  if (!stationKey) {
    return res.status(400).json({ error: "stationKey is required." });
  }

  const manualName = String(req.body.manualName || "").trim() || null;
  const manualLat = Number(req.body.manualLat);
  const manualLon = Number(req.body.manualLon);
  const note = String(req.body.note || "").trim() || null;

  db.upsertStationOverride(
    stationKey,
    manualName,
    Number.isFinite(manualLat) ? manualLat : null,
    Number.isFinite(manualLon) ? manualLon : null,
    note
  );

  db.clearCacheByPrefix("city-transit-v1:");
  return res.json({ ok: true, invalidatedCachePrefix: "city-transit-v1:" });
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found." });
  }
  return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(config.PORT, () => {
  console.log(`MetroMark server running on http://localhost:${config.PORT}`);
  console.log(`SQLite data file: ${db.dbPath}`);
});
