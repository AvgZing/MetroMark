// Shared CARTO basemap configuration.
//
// The CARTO API key is served from the backend (/api/health -> cartoBasemapKey)
// so it lives in one place (.env) rather than being hardcoded across the
// frontend. The app uses CARTO's Protomaps-compatible vector tileset.
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

function cartoVectorTileJsonUrl() {
  return `https://tiles.basemaps.cartocdn.com/vector/carto.streets/v2/tiles.json${keyQuery()}`;
}

function cartoAttribution() {
  return "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> &copy; <a href=\"https://carto.com/attributions\">CARTO</a>";
}
