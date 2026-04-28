const express = require("express");

const config = require("../config");
const db = require("../db");
const { getCityBySlug } = require("../city-presets");
const { TRANSIT_CACHE_PREFIX } = require("../transitland");
const { runHarvestCore } = require("../../scripts/harvest-core");
const { runNonrecoverableBackup } = require("../../scripts/backup-nonrecoverable");

const router = express.Router();

function validateAdminKey(req, res, key) {
  if (!key) {
    res.status(404).json({ error: "Endpoint is disabled." });
    return false;
  }

  const requestKey = String(req.headers["x-admin-key"] || "");
  if (requestKey !== key) {
    res.status(403).json({ error: "Invalid admin key." });
    return false;
  }

  return true;
}

router.get("/admin/stats", async (req, res) => {
  if (!validateAdminKey(req, res, config.ADMIN_STATS_KEY)) {
    return;
  }

  try {
    const usageState = await db.getDailyUsageCapsState({
      rest: config.HARVEST_DAILY_REST_LIMIT,
      vector: config.HARVEST_DAILY_VECTOR_LIMIT,
      routing: config.HARVEST_DAILY_ROUTING_LIMIT
    });
    const harvestSummary = await db.getHarvestSummary();
    const cacheStats = await db.getCacheStats();
    const dbFileStats = await db.getDatabaseFileStats();

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
      cache: cacheStats,
      database: {
        path: dbFileStats.dbPath,
        exists: dbFileStats.exists,
        sizeBytes: dbFileStats.sizeBytes,
        sizeMb: Number((dbFileStats.sizeBytes / (1024 * 1024)).toFixed(2)),
        modifiedAtMs: dbFileStats.modifiedAtMs
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
  if (!validateAdminKey(req, res, config.ADMIN_STATS_KEY)) {
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
  if (!validateAdminKey(req, res, config.ADMIN_STATS_KEY)) {
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
  if (!validateAdminKey(req, res, config.ADMIN_STATS_KEY)) {
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
  if (!validateAdminKey(req, res, config.ADMIN_STATS_KEY)) {
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
  if (!validateAdminKey(req, res, config.ADMIN_OVERRIDE_KEY)) {
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

module.exports = router;
