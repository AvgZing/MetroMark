const express = require("express");

const {
  refreshRoutes,
  addRoutes,
  removeRoutes,
  searchTransitlandRoutes
} = require("../../admin/route-refresh");
const { findMergeCandidates } = require("../../admin/merge-detect");
const { getArchiveFeaturesByLineKeys } = require("../../sources/transitland/backfill");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

function parseLineKeys(value) {
  if (Array.isArray(value)) {
    return value.map((key) => String(key || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

router.get("/admin/routes/search", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const query = String(req.query.q || "").trim();
  if (!query) {
    return res.json({ routes: [] });
  }
  const bbox = String(req.query.bbox || "")
    .split(",")
    .map((value) => Number(value.trim()));
  try {
    const routes = await searchTransitlandRoutes(query, {
      bbox: bbox.length === 4 ? bbox : null
    });
    return res.json({ routes });
  } catch (error) {
    return res.status(502).json({
      error: "Route search failed.",
      detail: String(error?.message || error)
    });
  }
});

router.get("/admin/routes/geometry", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const lineKey = String(req.query.lineKey || "").trim();
  if (!lineKey) {
    return res.status(400).json({ error: "lineKey is required." });
  }
  try {
    const features = await getArchiveFeaturesByLineKeys([lineKey]);
    const feature = features.get(lineKey);
    if (!feature) {
      return res.status(404).json({ error: "Route not found in the archive." });
    }
    return res.json({
      lineKey,
      feature: { ...feature, properties: { ...(feature.properties || {}), line_key: lineKey } }
    });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load route geometry.", detail: String(error?.message || error) });
  }
});

router.get("/admin/routes/merge-candidates", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const bbox = String(req.query.bbox || "")
    .split(",")
    .map((value) => Number(value.trim()));
  try {
    const result = await findMergeCandidates({
      bbox: bbox.length === 4 && bbox.every((value) => Number.isFinite(value)) ? bbox : null,
      citySlug: String(req.query.citySlug || "").trim() || null,
      lineKeys: parseLineKeys(req.query.lineKeys)
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Merge-candidate detection failed.",
      detail: String(error?.message || error)
    });
  }
});

router.post("/admin/routes/refresh", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const lineKeys = parseLineKeys(req.body?.lineKeys);
  if (!lineKeys.length) {
    return res.status(400).json({ error: "lineKeys is required." });
  }
  try {
    const report = await refreshRoutes(lineKeys, {
      zoom: Number(req.body?.zoom),
      refreshStops: req.body?.refreshStops !== false,
      refreshHeadway: req.body?.refreshHeadway !== false
    });
    return res.json({ ok: true, ...report });
  } catch (error) {
    return res.status(500).json({
      error: "Route refresh failed.",
      detail: String(error?.message || error)
    });
  }
});

router.post("/admin/routes/add", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const lineKeys = parseLineKeys(req.body?.lineKeys || req.body?.lineKey);
  if (!lineKeys.length) {
    return res.status(400).json({ error: "lineKeys is required." });
  }
  try {
    const report = await addRoutes(lineKeys, {
      zoom: Number(req.body?.zoom),
      refreshStops: req.body?.refreshStops !== false,
      refreshHeadway: req.body?.refreshHeadway !== false
    });
    if (report.notFound?.length && report.notFound.length === lineKeys.length) {
      return res.status(404).json({
        error: `No Transitland route found for ${report.notFound.join(", ")}.`,
        notFound: report.notFound
      });
    }
    return res.json({ ok: true, ...report });
  } catch (error) {
    return res.status(500).json({
      error: "Route add failed.",
      detail: String(error?.message || error)
    });
  }
});

router.post("/admin/routes/remove", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const lineKeys = parseLineKeys(req.body?.lineKeys);
  if (!lineKeys.length) {
    return res.status(400).json({ error: "lineKeys is required." });
  }
  try {
    const report = await removeRoutes(lineKeys);
    return res.json({ ok: true, ...report });
  } catch (error) {
    return res.status(500).json({
      error: "Route removal failed.",
      detail: String(error?.message || error)
    });
  }
});

module.exports = router;
