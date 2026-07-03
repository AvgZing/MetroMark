const express = require("express");

const db = require("../processors/db");
const { authMiddleware } = require("../processors/supabase/auth");

const router = express.Router();

function normalizePresetName(value) {
  return String(value || "").trim().slice(0, 48);
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

router.get("/presets/filters", authMiddleware, async (req, res) => {
  const citySlug = String(req.query.citySlug || "").trim();

  try {
    const presets = await db.listFilterPresets(req.user.id, citySlug);
    return res.json({ presets });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/presets/filters", authMiddleware, async (req, res) => {
  const name = normalizePresetName(req.body.name);
  const snapshot = normalizeSnapshot(req.body.snapshot);
  const citySlug = String(req.body.citySlug || snapshot?.citySlug || "").trim();

  if (!name) {
    return res.status(400).json({ error: "Preset name is required." });
  }

  if (!snapshot) {
    return res.status(400).json({ error: "Snapshot payload is required." });
  }

  if (!citySlug) {
    return res.status(400).json({ error: "citySlug is required." });
  }

  const normalizedSnapshot = {
    ...snapshot,
    citySlug
  };

  try {
    const preset = await db.upsertFilterPreset(req.user.id, {
      name,
      citySlug,
      snapshot: normalizedSnapshot
    });
    return res.status(201).json({ preset });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete("/presets/filters/:presetId", authMiddleware, async (req, res) => {
  const presetId = String(req.params.presetId || "").trim();
  if (!presetId) {
    return res.status(400).json({ error: "presetId is required." });
  }

  try {
    await db.deleteFilterPreset(req.user.id, presetId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
