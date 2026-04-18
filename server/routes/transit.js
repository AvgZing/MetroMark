const express = require("express");

const { getCityBySlug } = require("../city-presets");
const {
  getCityTransit,
  getBboxTransit,
  getRouteStopsTransit,
  getRouteHeadway
} = require("../transitland");
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
      stopLocationTypes: stopTypes,
      routeTypes
    });

    if (!data) {
      return res.status(404).json({ error: "No transit data available for this city." });
    }

    return res.json(withTransitlandMetrics({
      cacheStatus: data.cacheStatus,
      cacheKey: data.cacheKey,
      cacheExpiresAt: data.cacheExpiresAt || null,
      stopLocationTypes: data.stopLocationTypes || [0, 1],
      routeTypes: data.routeTypes || [],
      ...data.payload
    }));
  } catch (error) {
    return res.status(502).json({
      error: "Transit fetch failed.",
      detail: error.message
    });
  }
});

router.get("/transit/bbox", async (req, res) => {
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
      zoom: Number.isFinite(zoom) ? zoom : null,
      stopLocationTypes: stopTypes,
      routeTypes
    });

    return res.json(withTransitlandMetrics({
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
      stopLocationTypes: stopTypes
    });

    return res.json(withTransitlandMetrics({
      cacheStatus: data.cacheStatus,
      cacheKey: data.cacheKey,
      cacheExpiresAt: data.cacheExpiresAt || null,
      stopLocationTypes: data.stopLocationTypes || [0, 1],
      ...data.payload
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
      forceRefresh: asBoolean(req.query.refresh)
    });

    return res.json(withTransitlandMetrics(data));
  } catch (error) {
    return res.status(400).json({
      error: "Route headway fetch failed.",
      detail: error.message
    });
  }
});

module.exports = router;
