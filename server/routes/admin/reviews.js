const express = require("express");

const db = require("../../processors/data");
const { TRANSIT_CACHE_PREFIX } = require("../../processors/transitland");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

router.get("/admin/reviews/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const citySlug = String(req.query.citySlug || "").trim();
    const reviews = await db.listRouteReviews(citySlug);
    return res.json({ reviews });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list route reviews.", detail: error.message });
  }
});

router.post("/admin/reviews/route", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });

    const lineKey = String(req.body.lineKey || "").trim();
    const citySlug = String(req.body.citySlug || "").trim();
    const problematicOverride =
      req.body.problematicOverride === null || req.body.problematicOverride === undefined
        ? null
        : Boolean(req.body.problematicOverride);

    if (!lineKey) {
      return res.status(400).json({ error: "lineKey required." });
    }

    const review = await db.upsertRouteReview(lineKey, citySlug, problematicOverride);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.status(201).json({ review });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save route review.", detail: error.message });
  }
});

router.get("/admin/reviews/agencies", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });
    const citySlug = String(req.query.citySlug || "").trim();
    const reviews = await db.listAgencyReviews(citySlug);
    return res.json({ reviews });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list agency reviews.", detail: error.message });
  }
});

router.post("/admin/reviews/agencies", async (req, res) => {
  try {
    const ok = await isAdminAuthorized(req);
    if (!ok) return res.status(403).json({ error: "Admin authorization required." });

    const citySlug = String(req.body.citySlug || "").trim();
    const operatorName = String(req.body.operatorName || "").trim();
    const allowedOverride =
      req.body.allowedOverride === null || req.body.allowedOverride === undefined
        ? null
        : Boolean(req.body.allowedOverride);

    if (!citySlug || !operatorName) {
      return res.status(400).json({ error: "citySlug and operatorName are required." });
    }

    const review = await db.upsertAgencyReview(citySlug, operatorName, allowedOverride);
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    return res.status(201).json({ review });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save agency review.", detail: error.message });
  }
});

module.exports = router;
