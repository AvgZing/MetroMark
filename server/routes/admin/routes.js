const express = require("express");

const {
  refreshRoutes,
  addRoutes,
  removeRoutes,
  searchTransitlandRoutes
} = require("../../admin/route-refresh");
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
  try {
    const routes = await searchTransitlandRoutes(query);
    return res.json({ routes });
  } catch (error) {
    return res.status(502).json({
      error: "Route search failed.",
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
