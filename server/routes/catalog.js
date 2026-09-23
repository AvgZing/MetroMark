const express = require("express");

const { cities } = require("../processors/city-presets");
const db = require("../processors/data");

const router = express.Router();

// `cities` is the static harvest-baseline metro list (kept for existing
// consumers such as the admin map's city-by-bbox detection). `published` is the
// admin-curated city presets: each carries its vetted route keys so the app can
// restrict to a city in city mode.
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

module.exports = router;
