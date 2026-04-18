const express = require("express");

const config = require("../config");
const db = require("../db");
const { TRANSIT_CACHE_PREFIX } = require("../transitland");

const router = express.Router();

router.post("/admin/overrides/station", (req, res) => {
  if (!config.ADMIN_OVERRIDE_KEY) {
    return res.status(404).json({ error: "Override endpoint is disabled." });
  }

  const requestKey = String(req.headers["x-admin-key"] || "");
  if (requestKey !== config.ADMIN_OVERRIDE_KEY) {
    return res.status(403).json({ error: "Invalid admin key." });
  }

  const stationKey = String(req.body.stationKey || "").trim();
  if (!stationKey) {
    return res.status(400).json({ error: "stationKey is required." });
  }

  const manualName = String(req.body.manualName || "").trim() || null;
  const manualLat = Number(req.body.manualLat);
  const manualLon = Number(req.body.manualLon);
  const note = String(req.body.note || "").trim() || null;

  db.upsertStationOverride(
    stationKey,
    manualName,
    Number.isFinite(manualLat) ? manualLat : null,
    Number.isFinite(manualLon) ? manualLon : null,
    note
  );

  db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
  return res.json({ ok: true, invalidatedCachePrefix: TRANSIT_CACHE_PREFIX });
});

module.exports = router;
