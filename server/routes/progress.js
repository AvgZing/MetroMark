const express = require("express");

const db = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

router.get("/progress", authMiddleware, async (req, res) => {
  const lineKey = String(req.query.lineKey || "").trim();
  try {
    const items = await db.getVisitedStations(req.user.id, lineKey);
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/progress/toggle", authMiddleware, async (req, res) => {
  try {
    await db.setVisitedState(req.user.id, {
      lineKey: req.body.lineKey,
      stationKey: req.body.stationKey,
      stationName: req.body.stationName,
      lat: req.body.lat,
      lon: req.body.lon,
      visited: req.body.visited
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/progress/clear-route", authMiddleware, async (req, res) => {
  const lineKey = String(req.body.lineKey || "").trim();
  if (!lineKey) {
    return res.status(400).json({ error: "lineKey is required." });
  }

  try {
    const clearedCount = await db.clearVisitedStationsForLine(req.user.id, lineKey);
    return res.json({ ok: true, lineKey, clearedCount });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
