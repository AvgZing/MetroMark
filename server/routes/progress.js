const express = require("express");

const db = require("../processors/data");
const { authMiddleware } = require("../processors/supabase/auth");

const router = express.Router();

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function formatVisitedAt(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

router.get("/progress/export", authMiddleware, async (req, res) => {
  try {
    const items = await db.getVisitedStations(req.user.id);
    const lineKeys = Array.from(new Set(items.map((item) => String(item.lineKey || "").trim()).filter(Boolean)));
    let metadataByLineKey = new Map();
    try {
      metadataByLineKey = await db.getRouteMetadatasByLineKeys(lineKeys);
    } catch {
      // Export still works without route display metadata.
    }

    const headerComments = [
      "# MetroMark user data v1",
      `# Exported: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      `# Account: ${req.user.displayName || ""}`
    ];
    const settingsComments = ["# Settings"];
    const preferences = req.user.preferences && typeof req.user.preferences === "object"
      ? req.user.preferences
      : {};
    for (const [key, value] of Object.entries(preferences).sort(([a], [b]) => a.localeCompare(b))) {
      const text = value && typeof value === "object" ? JSON.stringify(value) : String(value);
      settingsComments.push(`# Setting: ${key} = ${text.replace(/\r?\n/g, " ")}`);
    }

    const dataLines = [csvLine([
      "Visited at (UTC)",
      "Line",
      "Operator",
      "Station",
      "Line key",
      "Station key",
      "Latitude",
      "Longitude"
    ])];

    const sortedItems = items.slice().sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0));
    for (const item of sortedItems) {
      const meta = metadataByLineKey.get(item.lineKey) || {};
      dataLines.push(csvLine([
        formatVisitedAt(item.updatedAt),
        meta.lineShortName || meta.lineName || "",
        meta.operatorName || "",
        item.stationName || "",
        item.lineKey,
        item.stationKey,
        item.lat,
        item.lon
      ]));
    }

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="metromark-user-data-${date}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    const body = [
      ...headerComments,
      ...dataLines,
      "",
      ...settingsComments
    ].join("\r\n");
    return res.send(`\uFEFF${body}\r\n`);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/progress/import", authMiddleware, async (req, res) => {
  const visits = Array.isArray(req.body?.visits) ? req.body.visits : null;
  if (!visits) {
    return res.status(400).json({ error: "visits must be an array." });
  }
  if (visits.length > 20000) {
    return res.status(400).json({ error: "Too many visits in one import (maximum 20000)." });
  }

  try {
    const result = await db.importVisitedStations(req.user.id, visits);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

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
