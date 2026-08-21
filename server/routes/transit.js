const express = require("express");

const db = require("../processors/data");
const { authMiddleware } = require("../processors/supabase/auth");
const {
  getRouteStopsTransit,
  getRouteHeadway,
  getRouteHeadwaysBulk
} = require("../processors/transitland");
const { getTransitCoverageForBbox } = require("../sources/transitland/coverage");
const {
  asBoolean,
  parseStopTypes,
  withTransitlandMetrics
} = require("./helpers");

const router = express.Router();

router.get("/transit/bbox", (req, res) => {
  return res.status(410).json({
    error: "This endpoint is retired.",
    detail:
      "Live viewport transit queries were replaced by the PMTiles tile pipeline (data/tiles/routes.pmtiles). " +
      "Missing areas are fetched on demand via /api/tiles/backfill; offline city builds still run through " +
      "npm run harvest:core and npm run build:tiles."
  });
});

router.get("/transit/route-stops", async (req, res) => {
  const lineKey = String(req.query.lineKey || "").trim();
  if (!lineKey) {
    return res.status(400).json({ error: "lineKey query parameter is required." });
  }

  const stopTypes = parseStopTypes(req.query.stopTypes);

  try {
    const data = await getRouteStopsTransit(lineKey, {
      forceRefresh: asBoolean(req.query.refresh),
      cacheOnly: asBoolean(req.query.cacheOnly),
      summaryOnly: asBoolean(req.query.summaryOnly),
      stopLocationTypes: stopTypes,
      requestSource: "user"
    });

    return res.json(withTransitlandMetrics({
      cacheStatus: data.cacheStatus,
      cacheKey: data.cacheKey,
      cacheExpiresAt: data.cacheExpiresAt || null,
      stopLocationTypes: data.stopLocationTypes || [0, 1],
      ...(data.payload || {})
    }));
  } catch (error) {
    return res.status(400).json({
      error: "Route stop fetch failed.",
      detail: error.message
    });
  }
});

router.get("/transit/route-headway/bulk", async (req, res) => {
  const requestStart = Date.now();
  const lineKeys = String(req.query.lineKeys || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (!lineKeys.length) {
    return res.status(400).json({ error: "lineKeys query parameter is required." });
  }

  try {
    const result = await getRouteHeadwaysBulk(lineKeys, { requestSource: "user" });
    return res.json(withTransitlandMetrics({
      ...result,
      serverTimingMs: Date.now() - requestStart
    }));
  } catch (error) {
    return res.status(400).json({
      error: "Bulk headway lookup failed.",
      detail: error.message
    });
  }
});

router.get("/transit/route-headway", async (req, res) => {
  const lineKey = String(req.query.lineKey || "").trim();
  if (!lineKey) {
    return res.status(400).json({ error: "lineKey query parameter is required." });
  }

  try {
    const data = await getRouteHeadway(lineKey, {
      forceRefresh: asBoolean(req.query.refresh),
      requestSource: "user"
    });

    return res.json(withTransitlandMetrics(data));
  } catch (error) {
    return res.status(400).json({
      error: "Route headway fetch failed.",
      detail: error.message
    });
  }
});

router.post("/transit/stop-fractions", async (req, res) => {
  const lineKey = String(req.body?.lineKey || "").trim();
  const stops = Array.isArray(req.body?.stops) ? req.body.stops : [];
  const zoom = req.body?.zoom !== undefined ? Number(req.body.zoom) : null;

  if (!lineKey) {
    return res.status(400).json({ error: "lineKey is required in body." });
  }

  if (!stops.length) {
    return res.status(400).json({ error: "stops array is required in body." });
  }

  try {
    const results = [];
    for (const stop of stops) {
      const id = stop?.id || null;
      const lat = Number(stop?.lat);
      const lon = Number(stop?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        results.push({ id, fraction: null });
        continue;
      }

      const resRow = await db.getFractionOnRoute(lineKey, lon, lat, { zoom });
      results.push({ id, fraction: resRow ? resRow.fraction : null });
    }

    return res.json(withTransitlandMetrics({ lineKey, results }));
  } catch (err) {
    return res.status(500).json({ error: "Unable to compute stop fractions.", detail: err.message });
  }
});

router.get("/transit/reviews", async (req, res) => {
  const citySlug = String(req.query.citySlug || "").trim();
  if (!citySlug) {
    return res.status(400).json({ error: "citySlug query parameter is required." });
  }

  try {
    const routeReviews = await db.listRouteReviews(citySlug);
    const agencyReviews = await db.listAgencyReviews(citySlug);
    return res.json({
      citySlug,
      routeReviews,
      agencyReviews
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to load review settings.",
      detail: error.message
    });
  }
});

router.post("/transit/route-ordering/vote", authMiddleware, async (req, res) => {
  const lineKey = String(req.body?.lineKey || "").trim();
  const orderingMode = String(req.body?.orderingMode || "").trim();
  const citySlug = String(req.body?.citySlug || "").trim();

  if (!lineKey) {
    return res.status(400).json({ error: "lineKey is required." });
  }

  try {
    await db.upsertRouteOrderingVote(lineKey, citySlug, req.user.id, orderingMode);
    const metadataMap = await db.getRouteOrderingMetadataByLineKeys([lineKey]);
    const metadata = metadataMap.get(lineKey) || null;

    return res.json({
      ok: true,
      lineKey,
      metadata
    });
  } catch (error) {
    return res.status(400).json({
      error: "Route ordering vote failed.",
      detail: error.message
    });
  }
});

router.get("/transit/coverage", async (req, res) => {
  const bboxRaw = String(req.query.bbox || "").trim();
  if (!bboxRaw) {
    return res.status(400).json({ error: "bbox is required" });
  }

  const bbox = bboxRaw.split(",").map((value) => Number(value.trim()));
  const zoom = Number(req.query.zoom);
  const includeGeometry = String(req.query.includeGeometry || "").trim() === "1";

  try {
    const result = await getTransitCoverageForBbox(bbox, Number.isFinite(zoom) ? zoom : 5, { includeGeometry });
    return res.json(withTransitlandMetrics({
      ...result,
      serverTimingMs: Date.now() - (req.startTime || Date.now())
    }));
  } catch (error) {
    return res.status(400).json({
      error: "Coverage probe failed.",
      detail: error.message
    });
  }
});

module.exports = router;
