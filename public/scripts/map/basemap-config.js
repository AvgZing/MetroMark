// Shared CARTO basemap configuration.
//
// The CARTO API key is served from the backend (/api/health -> cartoBasemapKey)
// so it lives in one place (.env) rather than being hardcoded across the
// frontend. This module caches it and exposes tile-URL builders for the raster
// basemaps the app uses (light_all / dark_all). If the key is ever missing the
// URLs fall back to the old key-less templates, so a stale cache or a dev box
// without the key still renders tiles (with the CARTO watermark).
//
// Keep the CARTO + OpenStreetMap attribution visible per CARTO's free tier.

var BASEMAP_KEY_CACHE = {
  key: "",
  loaded: false,
  promise: null
};

function fetchBasemapKey() {
  if (BASEMAP_KEY_CACHE.loaded) {
    return Promise.resolve(BASEMAP_KEY_CACHE.key);
  }
  if (BASEMAP_KEY_CACHE.promise) {
    return BASEMAP_KEY_CACHE.promise;
  }
  BASEMAP_KEY_CACHE.promise = fetch("/api/health", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : {}))
    .then((payload) => {
      BASEMAP_KEY_CACHE.key = String(payload?.cartoBasemapKey || "").trim();
      BASEMAP_KEY_CACHE.loaded = true;
      return BASEMAP_KEY_CACHE.key;
    })
    .catch(() => {
      BASEMAP_KEY_CACHE.key = "";
      BASEMAP_KEY_CACHE.loaded = true;
      return "";
    });
  return BASEMAP_KEY_CACHE.promise;
}

function keyQuery() {
  const key = BASEMAP_KEY_CACHE.key;
  return key ? `?key=${encodeURIComponent(key)}` : "";
}

function cartoTileUrl(style) {
  const safeStyle = style === "dark_all" ? "dark_all" : "light_all";
  return `https://a.basemaps.cartocdn.com/${safeStyle}/{z}/{x}/{y}.png${keyQuery()}`;
}

function cartoTileUrls(style) {
  const safeStyle = style === "dark_all" ? "dark_all" : "light_all";
  const key = keyQuery();
  // Use the full abcd subdomain set like CARTO's own examples; a single URL
  // would hammer one subdomain.
  return ["a", "b", "c", "d"].map(
    (sub) => `https://${sub}.basemaps.cartocdn.com/${safeStyle}/{z}/{x}/{y}.png${key}`
  );
}

function cartoAttribution() {
  return "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> &copy; <a href=\"https://carto.com/attributions\">CARTO</a>";
}
