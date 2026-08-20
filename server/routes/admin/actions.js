const express = require("express");

const db = require("../../processors/data");
const { getCityBySlug } = require("../../processors/city-presets");
const { runHarvestCore } = require("../../admin/harvest-core");
const { runNonrecoverableBackup } = require("../../admin/backup-nonrecoverable");
const { runBackfill } = require("../../sources/transitland/backfill");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

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

router.post("/admin/tiles/backfill", async (req, res) => {
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

  try {
    const summary = await runBackfill(bbox, {
      forceRefresh: true,
      zoom: Number(req.body?.zoom)
    });
    return res.json({ ok: true, ...summary });
  } catch (error) {
    return res.status(400).json({
      error: "Viewport update failed.",
      detail: String(error?.message || error)
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

module.exports = router;
