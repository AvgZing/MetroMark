const express = require("express");

const { cities } = require("../processors/city-presets");
const db = require("../processors/data");
const { getArchiveFeaturesByLineKeys } = require("../sources/transitland/backfill");

const router = express.Router();

// cities = static metro list; published = curated presets with route keys.
router.get("/catalog/cities", async (req, res) => {
  let published = [];
  try {
    const presets = await db.listCityPresets({ publishedOnly: true });
    const keySets = await db.listCityRouteKeySets({ publishedOnly: true });
    published = presets.map((city) => {
      const routeKeys = keySets.get(city.slug) || [];
      return {
        slug: city.slug,
        name: city.name,
        country: city.country,
        center: city.center,
        bbox: city.bbox,
        defaultZoom: city.defaultZoom,
        routeCount: routeKeys.length,
        routeKeys
      };
    });
  } catch {
    // Curated cities need local Postgres; without it the app stays Global-only.
    published = [];
  }

  res.json({ cities, published });
});

// Full route geometry for a curated city, so the client can render a city's
// routes from a persistent source instead of streaming tiles that unload.
router.get("/catalog/cities/:slug/geometry", async (req, res) => {
  const slug = String(req.params.slug || "").trim();
  if (!slug) {
    return res.status(400).json({ error: "slug is required." });
  }
  try {
    const preset = await db.getCityPreset(slug);
    let routeKeys = Array.isArray(preset?.routeKeys) ? preset.routeKeys : [];
    if (!routeKeys.length) {
      const keySets = await db.listCityRouteKeySets({ publishedOnly: false });
      routeKeys = keySets.get(slug) || [];
    }

    const features = routeKeys.length ? await getArchiveFeaturesByLineKeys(routeKeys) : new Map();
    const featureCollection = { type: "FeatureCollection", features: [] };
    for (const [lineKey, feature] of features) {
      if (!feature?.geometry) {
        continue;
      }
      featureCollection.features.push({
        ...feature,
        id: lineKey,
        properties: { ...(feature.properties || {}), line_key: lineKey, feature_id: lineKey }
      });
    }

    res.set("Cache-Control", "no-cache");
    return res.json({ slug, count: featureCollection.features.length, features: featureCollection });
  } catch (error) {
    return res.status(500).json({ error: "Unable to build city geometry.", detail: String(error?.message || error) });
  }
});

module.exports = router;
