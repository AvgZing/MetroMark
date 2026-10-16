// Opt-in "old" CartoCSS basemap palette (CARTO pre-redesign look).
// Enable with ?basemap=old (dark) or ?basemap=old-light. Otherwise inert.
// Palette source: CartoDB/basemap-styles/cartocss/web-styles/{dark-matter,positron}.tm2/style.mss

var BASEMAP_OLD_DARK = {
  background: { "background-color": "#090909" },
  water: { "fill-color": "#262626" },
  waterway: { "line-color": "#242424" },
  landuse_residential: { "fill-color": "rgb(0,0,0)", "fill-opacity": 0.4 },
  landcover_wood: { "fill-color": "#090909" },
  landuse_park: { "fill-color": "#090909" },
  building: { "fill-color": "#000000", "fill-outline-color": "#111111" },
  highway_path: { "line-color": "#262626" },
  highway_minor: { "line-color": "#191919" },
  highway_major_inner: { "line-color": "#030303" },
  highway_motorway_inner: { "line-color": "#030303" },
  highway_major_casing: { "line-color": "#2a2a2a" },
  highway_motorway_casing: { "line-color": "#2a2a2a" },
  boundary_state: { "line-color": "#222222" },
  "boundary_country_z0-4": { "line-color": "#292929" },
  "boundary_country_z5-": { "line-color": "#292929" },
  railway: { "line-color": "#1a1a1a" },
  water_name: { "text-color": "#444444", "text-halo-color": "#090909" },
  place_city: { "text-color": "#444444", "text-halo-color": "#111111" },
  place_town: { "text-color": "#444444", "text-halo-color": "#111111" },
  place_other: { "text-color": "#444444", "text-halo-color": "#111111" },
  highway_name_other: { "text-color": "#333333", "text-halo-color": "#030303" }
};

var BASEMAP_OLD_LIGHT = {
  background: { "background-color": "#fafaf8" },
  water: { "fill-color": "#d4dadc" },
  waterway: { "line-color": "#d1dbdf" },
  landuse_residential: { "fill-color": "#ededed" },
  landcover_wood: { "fill-color": "#dbe9df" },
  landuse_park: { "fill-color": "#dbe9df" },
  boundary_state: { "line-color": "#ead5d7" },
  "boundary_country_z0-4": { "line-color": "#f2e6e7" },
  "boundary_country_z5-": { "line-color": "#ebd6d8" },
  water_name: { "text-color": "#7a96a0", "text-halo-color": "#f5f5f3" },
  place_city: { "text-color": "#697b89", "text-halo-color": "#fafaf8" }
};

function basemapOldRequested() {
  const value = new URLSearchParams(location.search).get("basemap");
  return value === "old" || value === "old-light";
}

function basemapOldTheme() {
  return new URLSearchParams(location.search).get("basemap") === "old-light" ? "light" : appState.theme;
}

function basemapOldStyleUrl(theme) {
  return theme === "light"
    ? "https://openmaptiles.geo.data.gouv.fr/styles/positron/style.json"
    : "https://openmaptiles.geo.data.gouv.fr/styles/dark-matter/style.json";
}

function applyOldBasemapPalette(map, theme) {
  const overrides = theme === "light" ? BASEMAP_OLD_LIGHT : BASEMAP_OLD_DARK;
  for (const id of Object.keys(overrides)) {
    if (!map.getLayer(id)) {
      continue;
    }
    for (const [prop, value] of Object.entries(overrides[id])) {
      try {
        map.setPaintProperty(id, prop, value);
      } catch {
        // property not present on this layer
      }
    }
  }
}
