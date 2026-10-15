var CITY_GEOJSON_LAYERS = [
  "routes-background-casing",
  "routes-background-main",
  "routes-casing",
  "routes-main",
  "city-routes-hit"
];

var CITY_VECTOR_LAYERS = [
  "routes-background-casing-vector",
  "routes-background-main-vector",
  "routes-casing-vector",
  "routes-main-vector",
  "routes-hit"
];

function activeRouteSource() {
  return appState.cityGeometryActive
    ? { source: "routes" }
    : { source: "routes-vector", sourceLayer: "routes" };
}

function isCityGeometryMode() {
  return Boolean(appState.cityGeometryActive);
}

function setLayerVisible(layerId, visible) {
  if (appState.map && appState.map.getLayer(layerId)) {
    appState.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

// Per-feature state cache is keyed by id only, so clear it when the source swaps.
function invalidateRouteRebuilds() {
  appState.lastTileMetadataSignature = "";
  appState.lastMapFeatureStateSignature = "";
  appState.mapRouteFeatureStateCache = new Map();
  appState.mapStopFeatureStateCache = new Map();
}

function cityGeometryEntry(slug) {
  if (!(appState.cityGeometryBySlug instanceof Map)) {
    return null;
  }
  return appState.cityGeometryBySlug.get(String(slug || "").trim()) || null;
}

async function loadCityGeometry(slug) {
  const key = String(slug || "").trim();
  if (!key) {
    return null;
  }
  const cached = cityGeometryEntry(key);
  if (cached) {
    return cached;
  }
  const payload = await apiRequest(`/api/catalog/cities/${encodeURIComponent(key)}/geometry`, { method: "GET" });
  const entry = {
    slug: key,
    featureCollection: payload?.features || { type: "FeatureCollection", features: [] }
  };
  if (!(appState.cityGeometryBySlug instanceof Map)) {
    appState.cityGeometryBySlug = new Map();
  }
  appState.cityGeometryBySlug.set(key, entry);
  return entry;
}

function invalidateCityGeometry() {
  appState.cityGeometryBySlug = new Map();
  appState.cityGeometryActive = false;
}

function applyGlobeSourceMode() {
  appState.cityGeometryActive = false;
  const source = appState.map.getSource("routes");
  if (source && typeof source.setData === "function") {
    try {
      source.setData({ type: "FeatureCollection", features: [] });
    } catch {
      // ignore
    }
  }
  for (const id of CITY_GEOJSON_LAYERS) {
    setLayerVisible(id, false);
  }
  for (const id of CITY_VECTOR_LAYERS) {
    setLayerVisible(id, true);
  }
  invalidateRouteRebuilds();
}

function refreshRouteRendering() {
  if (typeof rebuildLineMetadataFromTiles === "function") {
    rebuildLineMetadataFromTiles();
  }
}

async function applyCityGeometryMode() {
  if (!appState.map || !appState.mapReady) {
    return;
  }
  const slug = String(appState.activeCitySlug || "").trim();
  if (!slug) {
    applyGlobeSourceMode();
    refreshRouteRendering();
    return;
  }

  let entry = null;
  try {
    entry = await loadCityGeometry(slug);
  } catch {
    entry = null;
  }
  const features = entry?.featureCollection?.features;
  if (!Array.isArray(features) || !features.length) {
    applyGlobeSourceMode();
    refreshRouteRendering();
    return;
  }

  const source = appState.map.getSource("routes");
  if (!source || typeof source.setData !== "function") {
    applyGlobeSourceMode();
    refreshRouteRendering();
    return;
  }
  source.setData(entry.featureCollection);
  appState.cityGeometryActive = true;
  for (const id of CITY_VECTOR_LAYERS) {
    setLayerVisible(id, false);
  }
  for (const id of CITY_GEOJSON_LAYERS) {
    setLayerVisible(id, true);
  }
  invalidateRouteRebuilds();
  refreshRouteRendering();
}
