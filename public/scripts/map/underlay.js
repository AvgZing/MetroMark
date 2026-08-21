// Transitland route underlay.
//
// Shows Transitland's ground-truth route network for the current viewport as a
// faint line layer BELOW the PMTiles archive's rendered routes, so users see
// what routes exist even where the archive is incomplete. The same probe also
// updates appState.transitCoverageCount, which the auto-backfill uses to
// detect full and partial gaps. The underlay is a context layer: it is never
// rendered above the archive routes and it is never used as fake data.

const UNDERLAY_ENABLED = true;
const UNDERLAY_SOURCE = "routes-underlay";
const UNDERLAY_LAYER = "routes-underlay";

let underlayPromise = null;
let underlayKey = "";
const underlayGeoJsonCache = new Map();
let underlaySourceReady = false;

function underlayBboxKey(bbox) {
  const snap = 0.05;
  return bbox.map((value) => Math.round(Number(value) / snap)).join(",");
}

function ensureUnderlaySource() {
  if (!appState.map || underlaySourceReady) {
    return;
  }
  if (!appState.map.getSource(UNDERLAY_SOURCE)) {
    appState.map.addSource(UNDERLAY_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
  }
  if (!appState.map.getLayer(UNDERLAY_LAYER)) {
    appState.map.addLayer({
      id: UNDERLAY_LAYER,
      type: "line",
      source: UNDERLAY_SOURCE,
      paint: {
        "line-color": "#4f7ea8",
        "line-width": 1.1,
        "line-opacity": 0.18,
        "line-blur": 0.4
      }
    }, "routes-background-casing");
  }
  underlaySourceReady = true;
}

let currentUnderlayFull = { type: "FeatureCollection", features: [] };

// Accumulated underlay features, deduped by line_key. Panning adds newly
// fetched routes instead of replacing the whole set, so previously-loaded
// routes stay on the map instead of "jumping" out as new tiles load.
const underlayFeaturesByLineKey = new Map();

function underlayFeaturePoint(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || !coords.length) {
    return null;
  }
  const first = Array.isArray(coords[0]) && Array.isArray(coords[0][0]) ? coords[0][0] : coords[0];
  if (Array.isArray(first) && first.length >= 2 && Number.isFinite(first[0]) && Number.isFinite(first[1])) {
    return first;
  }
  return null;
}

function pruneUnderlayFeatures() {
  if (!appState.map || !appState.mapReady || !underlayFeaturesByLineKey.size) {
    return Array.from(underlayFeaturesByLineKey.values());
  }

  const bounds = appState.map.getBounds();
  const viewport = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];

  // Margin scales with the viewport so nearby context survives small pans, but
  // distant areas are dropped once you travel well away from them.
  const spanX = Math.max(0.05, viewport[2] - viewport[0]);
  const spanY = Math.max(0.05, viewport[3] - viewport[1]);
  const marginX = Math.min(25, spanX * 1.5);
  const marginY = Math.min(25, spanY * 1.5);
  const minLon = viewport[0] - marginX;
  const maxLon = viewport[2] + marginX;
  const minLat = Math.max(-85, viewport[1] - marginY);
  const maxLat = Math.min(85, viewport[3] + marginY);

  const kept = [];
  for (const feature of underlayFeaturesByLineKey.values()) {
    const point = underlayFeaturePoint(feature);
    if (!point || point[0] < minLon || point[0] > maxLon || point[1] < minLat || point[1] > maxLat) {
      continue;
    }
    kept.push(feature);
  }

  underlayFeaturesByLineKey.clear();
  for (const feature of kept) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    if (lineKey) {
      underlayFeaturesByLineKey.set(lineKey, feature);
    }
  }

  return kept;
}

function underlayFeatureModeKey(feature) {
  const routeType = Number(feature?.properties?.route_type);
  if (!Number.isFinite(routeType)) {
    return typeof MODE_FILTER_OTHER !== "undefined" ? MODE_FILTER_OTHER : "other";
  }
  if (typeof modeKeyFromRouteType === "function") {
    return modeKeyFromRouteType(routeType);
  }
  return String(routeType);
}

let lastUnderlayFeatureCount = -1;
let lastUnderlayModeKey = "";

function applyUnderlayModeFilter() {
  if (!appState.map || !appState.mapReady) {
    return;
  }
  ensureUnderlaySource();
  const source = appState.map.getSource(UNDERLAY_SOURCE);
  if (!source || typeof source.setData !== "function") {
    return;
  }

  const features = currentUnderlayFull?.features || [];
  const modeKey = Array.from(appState.activeModeKeys || []).sort().join(",");

  // Skip the setData (and the expensive re-vectorization of a large source)
  // unless the feature set or the mode selection actually changed — repeated
  // setData on every UI refresh is what made the underlay flicker.
  if (features.length === lastUnderlayFeatureCount && modeKey === lastUnderlayModeKey) {
    return;
  }
  lastUnderlayFeatureCount = features.length;
  lastUnderlayModeKey = modeKey;

  const showAll = !appState.activeModeKeys ||
    appState.activeModeKeys.has(MODE_FILTER_ALL) ||
    appState.activeModeKeys.size === 0;

  let nextFeatures = features;
  if (!showAll) {
    nextFeatures = features.filter((feature) => appState.activeModeKeys.has(underlayFeatureModeKey(feature)));
  }

  source.setData({ type: "FeatureCollection", features: nextFeatures });
}

function renderUnderlay(geojson) {
  if (!appState.map || !appState.mapReady) {
    return;
  }
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  for (const feature of features) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    if (lineKey) {
      underlayFeaturesByLineKey.set(lineKey, feature);
    }
  }
  const pruned = pruneUnderlayFeatures();
  currentUnderlayFull = { type: "FeatureCollection", features: pruned || [] };
  applyUnderlayModeFilter();
}

async function updateUnderlay() {
  const bbox = appState.currentViewportBbox;
  const zoom = appState.map && appState.mapReady ? Number(appState.map.getZoom()) : 0;
  if (!bbox || !appState.mapReady) {
    return;
  }

  const key = underlayBboxKey(bbox);

  // Reuse an in-flight probe for the same coarse area; a different area always
  // fetches fresh so the count matches the viewport being evaluated.
  if (underlayPromise && underlayKey === key) {
    return underlayPromise;
  }

  const fetchUnderlay = (async () => {
    try {
      const params = new URLSearchParams({
        bbox: bbox.join(","),
        zoom: String(Math.round(zoom))
      });
      if (UNDERLAY_ENABLED) {
        params.set("includeGeometry", "1");
      }
      const payload = await apiRequest(`/api/transit/coverage?${params.toString()}`, {
        method: "GET"
      });

      appState.transitCoverageCount = Number(payload?.routeCount || 0);

      if (UNDERLAY_ENABLED && Array.isArray(payload?.routesGeoJson?.features)) {
        const geojson = payload.routesGeoJson;
        underlayGeoJsonCache.set(key, geojson);
        renderUnderlay(geojson);
      }
    } catch {
      // Non-critical — keep the last known coverage count and underlay.
    }
  })();

  underlayKey = key;
  underlayPromise = fetchUnderlay;
  try {
    await fetchUnderlay;
  } finally {
    underlayPromise = null;
  }
}
