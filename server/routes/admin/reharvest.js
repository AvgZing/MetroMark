const express = require("express");

const { runReharvest, getReharvestStats, MAX_SPAN_DEGREES } = require("../../admin/reharvest");
const { listReharvestFlags, resolveReharvestFlag } = require("../../processors/data/reharvest-flags");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

router.post("/admin/tiles/reharvest", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  const parts = String(req.body?.bbox || "")
    .split(",")
    .map((value) => Number(value.trim()));
  const bbox = parts.length === 4 && parts.every((value) => Number.isFinite(value)) ? parts : null;
  if (!bbox || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    return res.status(400).json({ error: "A valid bbox (west,south,east,north) is required." });
  }
  const lonSpan = bbox[2] - bbox[0];
  const latSpan = bbox[3] - bbox[1];
  if (lonSpan > MAX_SPAN_DEGREES || latSpan > MAX_SPAN_DEGREES) {
    return res.status(400).json({
      error: `The viewport is too large for one reharvest push. Zoom in to a span of ${MAX_SPAN_DEGREES} degrees or less (about a metro region).`
    });
  }

  try {
    const report = await runReharvest(bbox, {
      zoom: Number(req.body?.zoom),
      refreshStops: req.body?.refreshStops !== false,
      refreshHeadway: req.body?.refreshHeadway !== false,
      concurrency: Number(req.body?.concurrency)
    });
    return res.json({ ok: true, ...report });
  } catch (error) {
    return res.status(500).json({
      error: "Viewport reharvest failed.",
      detail: String(error?.message || error)
    });
  }
});

router.get("/admin/tiles/reharvest/status", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }
  return res.json(getReharvestStats());
});

router.get("/admin/reharvest/flags", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }
  try {
    const flags = await listReharvestFlags({ status: req.query?.status });
    return res.json({ flags });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list reharvest flags.", detail: String(error?.message || error) });
  }
});

router.post("/admin/reharvest/flags/:id/resolve", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }
  try {
    const flagId = Number(req.params?.id);
    const result = await resolveReharvestFlag(flagId);
    if (!result) {
      return res.status(404).json({ error: "Flag not found." });
    }
    return res.json({ ok: true, id: result.id });
  } catch (error) {
    return res.status(500).json({ error: "Unable to resolve flag.", detail: String(error?.message || error) });
  }
});

module.exports = router;
