const express = require("express");

const db = require("../../processors/data");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

async function requireAdmin(req, res) {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return false;
  }
  return true;
}

function presetFields(body = {}) {
  return {
    name: body.name,
    country: body.country,
    center: body.center,
    bbox: body.bbox,
    defaultZoom: body.defaultZoom,
    published: body.published,
    notes: body.notes,
    sortOrder: body.sortOrder
  };
}

// Operators with route metadata, for the city operator picker.
router.get("/admin/operators", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const operators = await db.listOperators(String(req.query.q || ""));
    return res.json({ operators });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list operators.", detail: String(error.message || error) });
  }
});

router.get("/admin/cities", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const cities = await db.listCityPresets();
    return res.json({ cities });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list cities.", detail: String(error.message || error) });
  }
});

router.get("/admin/cities/:slug", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const city = await db.getCityPreset(req.params.slug);
    if (!city) {
      return res.status(404).json({ error: "City not found." });
    }
    return res.json({ city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to load city.", detail: String(error.message || error) });
  }
});

router.post("/admin/cities", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const slug = String(req.body?.slug || "").trim();
  if (!slug) {
    return res.status(400).json({ error: "slug is required." });
  }
  try {
    const city = await db.upsertCityPreset(slug, presetFields(req.body));
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save city.", detail: String(error.message || error) });
  }
});

router.delete("/admin/cities/:slug", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await db.deleteCityPreset(req.params.slug);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Unable to delete city.", detail: String(error.message || error) });
  }
});

router.post("/admin/cities/:slug/publish", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const existing = await db.getCityPreset(req.params.slug);
    if (!existing) {
      return res.status(404).json({ error: "City not found." });
    }
    const city = await db.upsertCityPreset(existing.slug, {
      name: existing.name,
      country: existing.country,
      center: existing.center,
      bbox: existing.bbox,
      defaultZoom: existing.defaultZoom,
      notes: existing.notes,
      sortOrder: existing.sortOrder,
      published: req.body?.published !== false
    });
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to update publish state.", detail: String(error.message || error) });
  }
});

// Explicit route rules. POST replaces the whole set; PATCH merges; /remove drops.
router.post("/admin/cities/:slug/routes", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!Array.isArray(req.body?.routes)) {
    return res.status(400).json({ error: "routes array is required." });
  }
  try {
    const city = await db.setCityPresetRoutes(req.params.slug, req.body.routes, {
      replace: req.body?.replace !== false
    });
    if (!city) {
      return res.status(404).json({ error: "City not found." });
    }
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save city routes.", detail: String(error.message || error) });
  }
});

router.patch("/admin/cities/:slug/routes", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!Array.isArray(req.body?.routes)) {
    return res.status(400).json({ error: "routes array is required." });
  }
  try {
    const city = await db.patchCityPresetRoutes(req.params.slug, req.body.routes);
    if (!city) {
      return res.status(404).json({ error: "City not found." });
    }
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to update city routes.", detail: String(error.message || error) });
  }
});

router.post("/admin/cities/:slug/routes/remove", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const lineKeys = Array.isArray(req.body?.lineKeys) ? req.body.lineKeys : [];
  if (!lineKeys.length) {
    return res.status(400).json({ error: "lineKeys array is required." });
  }
  try {
    const city = await db.removeCityPresetRoutes(req.params.slug, lineKeys);
    if (!city) {
      return res.status(404).json({ error: "City not found." });
    }
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to remove city routes.", detail: String(error.message || error) });
  }
});

// Operator rules. POST replaces the whole set; PATCH merges.
router.post("/admin/cities/:slug/operators", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!Array.isArray(req.body?.operators)) {
    return res.status(400).json({ error: "operators array is required." });
  }
  try {
    const city = await db.setCityPresetOperators(req.params.slug, req.body.operators, {
      replace: req.body?.replace !== false
    });
    if (!city) {
      return res.status(404).json({ error: "City not found." });
    }
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save city operators.", detail: String(error.message || error) });
  }
});

router.patch("/admin/cities/:slug/operators", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!Array.isArray(req.body?.operators)) {
    return res.status(400).json({ error: "operators array is required." });
  }
  try {
    const city = await db.patchCityPresetOperators(req.params.slug, req.body.operators);
    if (!city) {
      return res.status(404).json({ error: "City not found." });
    }
    return res.json({ ok: true, city });
  } catch (error) {
    return res.status(500).json({ error: "Unable to update city operators.", detail: String(error.message || error) });
  }
});

module.exports = router;
