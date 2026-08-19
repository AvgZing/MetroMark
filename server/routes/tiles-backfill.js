const express = require("express");

const { runBackfill, getBackfillStats, totalRoutesInArchive } = require("../sources/transitland/backfill");
const { getTilesStats } = require("./tiles");
const { getTransitlandMetrics } = require("../sources/transitland/metrics");
const { withTransitlandMetrics } = require("./helpers");

const router = express.Router();

function parseBbox(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) {
    return null;
  }
  return [west, south, east, north];
}

router.post("/tiles/backfill", async (req, res) => {
  const requestStart = Date.now();
  const bbox = parseBbox(req.body?.bbox);

  if (!bbox) {
    return res.status(400).json({ error: "A valid bbox (west,south,east,north) is required." });
  }

  try {
    const summary = await runBackfill(bbox, {
      forceRefresh: Boolean(req.body?.forceRefresh),
      zoom: Number(req.body?.zoom)
    });

    return res.json(withTransitlandMetrics({
      ...summary,
      serverTimingMs: Date.now() - requestStart
    }));
  } catch (error) {
    return res.status(400).json({
      error: "Tile backfill failed.",
      detail: String(error?.message || error),
      serverTimingMs: Date.now() - requestStart
    });
  }
});

router.get("/tiles/stats", (req, res) => {
  const transitland = getTransitlandMetrics();
  return res.json({
    tiles: getTilesStats(),
    backfill: getBackfillStats(),
    archive: {
      totalRoutes: totalRoutesInArchive()
    },
    transitland: {
      restApiRequestCount: transitland.restApiRequestCount,
      restApiRequestFailureCount: transitland.restApiRequestFailureCount,
      vectorTileRequestCount: transitland.vectorTileRequestCount,
      vectorTileRequestFailureCount: transitland.vectorTileRequestFailureCount,
      routingApiRequestCount: transitland.routingApiRequestCount,
      routingApiRequestFailureCount: transitland.routingApiRequestFailureCount
    }
  });
});

module.exports = router;
