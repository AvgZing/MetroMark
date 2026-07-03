const express = require("express");

const db = require("../processors/data");
const { authMiddleware } = require("../processors/supabase/auth");
const { getCityBySlug } = require("../processors/city-presets");
const {
  getCityTransit,
  getBboxTransit,
  getRouteStopsTransit,
  getRouteHeadway
} = require("../processors/transitland");
const {
  asBoolean,
  parseStopTypes,
  parseRouteTypes,
  withTransitlandMetrics
} = require("./helpers");

const router = express.Router();

router.get("/transit/city/:slug", async (req, res) => {
  const city = getCityBySlug(req.params.slug);
  if (!city) {
    return res.status(404).json({ error: "Unknown city slug." });
  }

  try {
    const stopTypes = parseStopTypes(req.query.stopTypes);
    const routeTypes = parseRouteTypes(req.query.routeTypes);
    const data = await getCityTransit(city.slug, {
      forceRefresh: asBoolean(req.query.refresh),
      zoom: Number(req.query.zoom),
      stopLocationTypes: stopTypes,
      routeTypes,
      requestSource: "user"
    });

    if (!data) {
      return res.status(404).json({ error: "No transit data available for this city." });
    }

    return res.json(withTransitlandMetrics({
      cacheStatus: data.cacheStatus,
      cacheKey: data.cacheKey,
      cacheExpiresAt: data.cacheExpiresAt || null,
      cacheVerifiedAt: data.cacheVerifiedAt || null,
      feedFingerprint: data.feedFingerprint || "",
      stopLocationTypes: data.stopLocationTypes || [0, 1],
      routeTypes: data.routeTypes || [],
      ...data.payload
    }));
  } catch (error) {
    return res.status(502).json({
      error: "City transit fetch failed.",
      detail: error.message
    });
  }
});

router.get("/transit/bbox", async (req, res) => {
  const requestStart = Date.now();
  const bboxRaw = String(req.query.bbox || "").trim();
  if (!bboxRaw) {
    return res.status(400).json({ error: "bbox query parameter is required." });
  }

  const bbox = bboxRaw.split(",").map((value) => Number(value.trim()));
  const zoom = Number(req.query.zoom);
  const stopTypes = parseStopTypes(req.query.stopTypes);
  const routeTypes = parseRouteTypes(req.query.routeTypes);

  try {
    const data = await getBboxTransit(bbox, {
      forceRefresh: asBoolean(req.query.refresh),
      cacheOnly: asBoolean(req.query.cacheOnly),
      debug: asBoolean(req.query.debug),
      zoom: Number.isFinite(zoom) ? zoom : null,
      stopLocationTypes: stopTypes,
      routeTypes,
      requestSource: "user"
    });

    const serverTimingMs = Date.now() - requestStart;
    if (serverTimingMs > 500) {
      console.log(`[perf] /api/transit/bbox took ${serverTimingMs}ms (cacheOnly=${req.query.cacheOnly || 0}, zoom=${zoom})`);
    }

    return res.json(withTransitlandMetrics({
      serverTimingMs,
      cacheStatus: data.cacheStatus,
      cacheKey: data.cacheKey,
      cacheExpiresAt: data.cacheExpiresAt || null,
      normalizedBbox: data.normalizedBbox,
      snapStep: data.snapStep,
      stopLocationTypes: data.stopLocationTypes || [0, 1],
      routeTypes: data.routeTypes || [],
      ...data.payload
    }));
  } catch (error) {
    return res.status(400).json({
      serverTimingMs: Date.now() - requestStart,
      error: "Visible-area transit fetch failed.",
      detail: error.message
    });
  }
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

module.exports = router;
