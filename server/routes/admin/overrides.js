const express = require("express");

const db = require("../../processors/data");
const { TRANSIT_CACHE_PREFIX } = require("../../processors/transitland");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

router.post("/admin/overrides/station", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }

  const stationKey = String(req.body.stationKey || "").trim();
  if (!stationKey) {
    return res.status(400).json({ error: "stationKey is required." });
  }

  const manualName = String(req.body.manualName || "").trim() || null;
  const manualLat = Number(req.body.manualLat);
  const manualLon = Number(req.body.manualLon);
  const note = String(req.body.note || "").trim() || null;

  try {
    await db.upsertStationOverride(
      stationKey,
      manualName,
      Number.isFinite(manualLat) ? manualLat : null,
      Number.isFinite(manualLon) ? manualLon : null,
      note
    );

    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.json({ ok: true, invalidatedCachePrefix: TRANSIT_CACHE_PREFIX });
  } catch (error) {
    return res.status(500).json({
      error: "Unable to apply station override.",
      detail: error.message
    });
  }
});

// Admin routes using authenticated admin users (preferred over static admin keys)
router.get("/admin/overrides/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const city = String(req.query.citySlug || "").trim();
    const overrides = await db.listRouteOverrides(city);
    return res.json({ overrides });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list route overrides.", detail: error.message });
  }
});

router.get("/admin/overrides/route/:lineKey", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const lineKey = String(req.params.lineKey || "").trim();
    if (!lineKey) return res.status(400).json({ error: "lineKey required." });
    const row = await db.getRouteOverride(lineKey);
    return res.json({ override: row });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load override.", detail: error.message });
  }
});

router.post("/admin/overrides/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const lineKey = String(req.body.lineKey || "").trim();
    const citySlug = String(req.body.citySlug || "").trim();
    const payload = req.body.payload || null;
    if (!lineKey || !payload) return res.status(400).json({ error: "lineKey and payload are required." });

    const row = await db.upsertRouteOverride(lineKey, citySlug, payload);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.status(201).json({ override: row });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save route override.", detail: error.message });
  }
});

router.delete("/admin/overrides/route/:lineKey", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const lineKey = String(req.params.lineKey || "").trim();
    if (!lineKey) return res.status(400).json({ error: "lineKey required." });
    await db.deleteRouteOverride(lineKey);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Unable to delete override.", detail: error.message });
  }
});

module.exports = router;
