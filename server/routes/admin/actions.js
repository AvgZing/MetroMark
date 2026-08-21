const express = require("express");

const { runNonrecoverableBackup } = require("../../admin/backup-nonrecoverable");
const { runBackfill } = require("../../sources/transitland/backfill");
const { buildPmtiles } = require("../../scripts/build/build-pmtiles");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

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

router.post("/admin/actions/rebuild-tiles", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  try {
    const built = await buildPmtiles({ log: { log: () => {} } });
    return res.json({ ok: true, tileCount: built.tileCount, sizeBytes: built.sizeBytes });
  } catch (error) {
    return res.status(500).json({
      error: "Tile rebuild failed.",
      detail: error.message
    });
  }
});

module.exports = router;
