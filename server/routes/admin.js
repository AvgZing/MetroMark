const crypto = require("crypto");
const express = require("express");

const config = require("../config");
const db = require("../db");
const { getCityBySlug } = require("../city-presets");
const { TRANSIT_CACHE_PREFIX, getTransitlandMetrics } = require("../transitland");
const { postgresMetrics } = require("../postgres");
const { runHarvestCore } = require("../../scripts/harvest-core");
const { runNonrecoverableBackup } = require("../../scripts/backup-nonrecoverable");

const router = express.Router();
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const adminSessions = new Map();

function normalizeAdminText(value) {
  return String(value || "").trim();
}

function cleanupExpiredAdminSessions() {
  const now = Date.now();
  for (const [token, entry] of adminSessions.entries()) {
    if (!entry || entry.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function issueAdminSession(username) {
  cleanupExpiredAdminSessions();
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, {
    username,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });
  return token;
}

function getAdminSession(req) {
  cleanupExpiredAdminSessions();
  const header = normalizeAdminText(req.headers.authorization);
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return null;
  }

  const session = adminSessions.get(token) || null;
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function isConfiguredAdminLogin(username, password) {
  if (!config.ADMIN_USERNAME || !config.ADMIN_PASSWORD) {
    return false;
  }

  return normalizeAdminText(username) === config.ADMIN_USERNAME && String(password || "") === config.ADMIN_PASSWORD;
}

function attachAdminSession(res, token) {
  return res.json({
    ok: true,
    token,
    expiresInMs: ADMIN_SESSION_TTL_MS
  });
}

router.post("/admin/login", async (req, res) => {
  const username = normalizeAdminText(req.body?.username);
  const password = String(req.body?.password || "");

  if (!isConfiguredAdminLogin(username, password)) {
    return res.status(401).json({ error: "Invalid admin username or password." });
  }

  const token = issueAdminSession(username);
  return attachAdminSession(res, token);
});

router.post("/admin/logout", (req, res) => {
  const session = getAdminSession(req);
  if (session?.token) {
    adminSessions.delete(session.token);
  }
  return res.json({ ok: true });
});

router.get("/admin/session", (req, res) => {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Admin session required." });
  }

  return res.json({ ok: true, username: session.username });
});

async function isAdminAuthorized(req) {
  const session = getAdminSession(req);
  if (session) {
    return true;
  }

  const tokenHeader = String(req.headers.authorization || "").trim();
  const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.slice(7) : tokenHeader || null;
  if (token) {
    try {
      const user = await db.getUserFromToken(token);
      if (user && String(user.role || "").trim() === "admin") {
        return true;
      }
    } catch (e) {
      // ignore
    }
  }
  return false;
}

router.get("/admin/stats", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  try {
    const usageState = await db.getDailyUsageCapsState({
      rest: config.HARVEST_DAILY_REST_LIMIT,
      vector: config.HARVEST_DAILY_VECTOR_LIMIT,
      routing: config.HARVEST_DAILY_ROUTING_LIMIT
    });
    const accountStats = await db.getAccountStats();
    const harvestSummary = await db.getHarvestSummary();
    const cacheStats = await db.getCacheStats();
    const dbFileStats = await db.getDatabaseFileStats();
    const transitland = getTransitlandMetrics();
    const mem = process.memoryUsage();
    const perf = process.resourceUsage();

    return res.json({
      nowIso: new Date().toISOString(),
      usage: {
        dayKey: usageState.usage.dayKey,
        rest: {
          calls: usageState.usage.restApiCalls,
          limit: usageState.limits.rest,
          remaining: usageState.remaining.rest,
          reached: usageState.reached.rest,
          burnRatePct: Number(((usageState.usage.restApiCalls / usageState.limits.rest) * 100).toFixed(1))
        },
        vector: {
          calls: usageState.usage.vectorTileCalls,
          limit: usageState.limits.vector,
          remaining: usageState.remaining.vector,
          reached: usageState.reached.vector,
          burnRatePct: Number(
            ((usageState.usage.vectorTileCalls / usageState.limits.vector) * 100).toFixed(1)
          )
        },
        routing: {
          calls: usageState.usage.routingApiCalls,
          limit: usageState.limits.routing,
          remaining: usageState.remaining.routing,
          reached: usageState.reached.routing,
          burnRatePct: Number(
            ((usageState.usage.routingApiCalls / usageState.limits.routing) * 100).toFixed(1)
          )
        },
        backgroundHarvestAllowed: usageState.backgroundAllowed
      },
      harvest: {
        activeCachedCities: harvestSummary.activeCachedCities,
        pendingHarvests: harvestSummary.pendingHarvests,
        inProgress: harvestSummary.inProgress,
        ready: harvestSummary.ready,
        totalCities: harvestSummary.totalCities
      },
      accounts: accountStats,
      cache: cacheStats,
      database: {
        path: dbFileStats.dbPath,
        exists: dbFileStats.exists,
        sizeBytes: dbFileStats.sizeBytes,
        sizeMb: Number((dbFileStats.sizeBytes / (1024 * 1024)).toFixed(2)),
        modifiedAtMs: dbFileStats.modifiedAtMs
      },
      transitland: {
        restApiRequests: Number(transitland.restApiRequestCount || 0),
        restApiFailures: Number(transitland.restApiRequestFailureCount || 0),
        vectorTileRequests: Number(transitland.vectorTileRequestCount || 0),
        vectorTileFailures: Number(transitland.vectorTileRequestFailureCount || 0),
        routingApiRequests: Number(transitland.routingApiRequestCount || 0),
        routingApiFailures: Number(transitland.routingApiRequestFailureCount || 0),
        lastRestRequestAt: transitland.lastRestRequestAt || null,
        lastVectorTileRequestAt: transitland.lastVectorTileRequestAt || null,
        lastRoutingRequestAt: transitland.lastRoutingRequestAt || null
      },
      postgres: {
        queries: Number(postgresMetrics.queryCount || 0),
        failures: Number(postgresMetrics.queryFailureCount || 0),
        lastQueryAt: postgresMetrics.lastQueryAt || null
      },
      performance: {
        processUptimeSec: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memory: {
          rssBytes: Number(mem.rss || 0),
          heapTotalBytes: Number(mem.heapTotal || 0),
          heapUsedBytes: Number(mem.heapUsed || 0),
          externalBytes: Number(mem.external || 0)
        },
        cpu: {
          userMicros: Number(perf.userCPUTime || 0),
          systemMicros: Number(perf.systemCPUTime || 0)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to read admin stats.",
      detail: error.message
    });
  }
});

router.get("/admin/harvest/queue", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  try {
    const limit = Math.max(1, Number(req.query.limit || 20));
    const pending = await db.listPendingHarvestCities(limit);
    const summary = await db.getHarvestSummary();
    return res.json({ pending, summary });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to load harvest queue.",
      detail: error.message
    });
  }
});

router.post("/admin/actions/harvest-core", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  try {
    const result = await runHarvestCore({ triggerSource: "admin" });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      error: "Harvest run failed.",
      detail: error.message
    });
  }
});

router.post("/admin/actions/backup-nonrecoverable", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  try {
    const result = await runNonrecoverableBackup({ triggerSource: "admin" });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      error: "Backup run failed.",
      detail: error.message
    });
  }
});

router.post("/admin/actions/queue-city/:slug", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  const city = getCityBySlug(req.params.slug);
  if (!city) {
    return res.status(404).json({ error: "Unknown city slug." });
  }

  try {
    await db.ensureCityHarvestState(city, {
      initialStatus: "queued",
      pendingRefresh: true
    });
    await db.queueCityRefresh(city.slug);
    return res.json({ ok: true, citySlug: city.slug });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to queue city refresh.",
      detail: error.message
    });
  }
});

router.post("/admin/overrides/station", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  const stationKey = String(req.body.stationKey || "").trim();
  if (!stationKey) {
    return res.status(400).json({ error: "stationKey is required." });
  }

  const manualName = String(req.body.manualName || "").trim() || null;
  const manualLat = Number(req.body.manualLat);
  const manualLon = Number(req.body.manualLon);
  const note = String(req.body.note || "").trim() || null;

  try {
    await db.upsertStationOverride(
      stationKey,
      manualName,
      Number.isFinite(manualLat) ? manualLat : null,
      Number.isFinite(manualLon) ? manualLon : null,
      note
    );

    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.json({ ok: true, invalidatedCachePrefix: TRANSIT_CACHE_PREFIX });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to apply station override.",
      detail: error.message
    });
  }
});

// Admin routes using authenticated admin users (preferred over static admin keys)
router.get("/admin/overrides/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const city = String(req.query.citySlug || "").trim();
    const overrides = await db.listRouteOverrides(city);
    return res.json({ overrides });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list route overrides.", detail: error.message });
  }
});

router.get("/admin/overrides/route/:lineKey", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const lineKey = String(req.params.lineKey || "").trim();
    if (!lineKey) return res.status(400).json({ error: "lineKey required." });
    const row = await db.getRouteOverride(lineKey);
    return res.json({ override: row });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load override.", detail: error.message });
  }
});

router.post("/admin/overrides/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const lineKey = String(req.body.lineKey || "").trim();
    const citySlug = String(req.body.citySlug || "").trim();
    const payload = req.body.payload || null;
    if (!lineKey || !payload) return res.status(400).json({ error: "lineKey and payload are required." });

    const row = await db.upsertRouteOverride(lineKey, citySlug, payload);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.status(201).json({ override: row });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save route override.", detail: error.message });
  }
});

router.delete("/admin/overrides/route/:lineKey", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const lineKey = String(req.params.lineKey || "").trim();
    if (!lineKey) return res.status(400).json({ error: "lineKey required." });
    await db.deleteRouteOverride(lineKey);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Unable to delete override.", detail: error.message });
  }
});

router.get("/admin/reviews/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const citySlug = String(req.query.citySlug || "").trim();
    const reviews = await db.listRouteReviews(citySlug);
    return res.json({ reviews });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list route reviews.", detail: error.message });
  }
});

router.post("/admin/reviews/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });

    const lineKey = String(req.body.lineKey || "").trim();
    const citySlug = String(req.body.citySlug || "").trim();
    const problematicOverride =
      req.body.problematicOverride === null || req.body.problematicOverride === undefined
        ? null
        : Boolean(req.body.problematicOverride);

    if (!lineKey) {
      return res.status(400).json({ error: "lineKey required." });
    }

    const review = await db.upsertRouteReview(lineKey, citySlug, problematicOverride);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.status(201).json({ review });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save route review.", detail: error.message });
  }
});

router.get("/admin/reviews/agencies", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const citySlug = String(req.query.citySlug || "").trim();
    const reviews = await db.listAgencyReviews(citySlug);
    return res.json({ reviews });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list agency reviews.", detail: error.message });
  }
});

router.post("/admin/reviews/agencies", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });

    const citySlug = String(req.body.citySlug || "").trim();
    const operatorName = String(req.body.operatorName || "").trim();
    const allowedOverride =
      req.body.allowedOverride === null || req.body.allowedOverride === undefined
        ? null
        : Boolean(req.body.allowedOverride);

    if (!citySlug || !operatorName) {
      return res.status(400).json({ error: "citySlug and operatorName are required." });
    }

    const review = await db.upsertAgencyReview(citySlug, operatorName, allowedOverride);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.status(201).json({ review });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save agency review.", detail: error.message });
  }
});

module.exports = router;
