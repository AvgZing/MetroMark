const express = require("express");
const fs = require("fs");
const path = require("path");

const config = require("../../admin/config");
const db = require("../../processors/data");
const { getTransitlandMetrics } = require("../../processors/transitland");
const { postgresMetrics } = require("../../processors/postgres");
const { getTilesStats } = require("../tiles");
const { isAdminAuthorized } = require("./auth");

const TILES_FILE = path.join(__dirname, "..", "..", "..", "data", "tiles", "routes.pmtiles");

const router = express.Router();

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
    let accountStats = null;
    try {
      accountStats = await db.getAccountStats();
    } catch (error) {
      accountStats = { unavailable: true, reason: error.message };
    }
    const harvestSummary = await db.getHarvestSummary();
    const cacheStats = await db.getCacheStats();
    const dbFileStats = await db.getDatabaseFileStats();
    const coverageStats = await db.getRouteMetadataCoverageStats();
    const usageHistory = await db.getUsageHistory(7);
    const transitland = getTransitlandMetrics();
    const tilesServed = getTilesStats();
    const mem = process.memoryUsage();
    const perf = process.resourceUsage();

    let archiveSizeBytes = 0;
    try {
      archiveSizeBytes = fs.existsSync(TILES_FILE) ? fs.statSync(TILES_FILE).size : 0;
    } catch {
      archiveSizeBytes = 0;
    }

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
      archive: {
        sizeBytes: archiveSizeBytes,
        sizeMb: Number((archiveSizeBytes / (1024 * 1024)).toFixed(2))
      },
      routeCoverage: coverageStats,
      usageHistory,
      tilesServed: {
        requests: Number(tilesServed.requests || 0),
        bytesServed: Number(tilesServed.bytesServed || 0),
        averageMs: Number(tilesServed.averageMs || 0),
        lastAt: tilesServed.lastAt || null
      },
      system: {
        supabaseReachable: Boolean(accountStats && !accountStats.unavailable),
        harvestEnabled: Boolean(config.HARVEST_ENABLED),
        serviceWorkerEnabled: Boolean(config.SW_ENABLED),
        appEnv: config.APP_ENV,
        envFile: config.ENV_FILE
      },
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

module.exports = router;
