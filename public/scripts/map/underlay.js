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

function renderUnderlay(geojson) {
  if (!appState.map || !appState.mapReady) {
    return;
  }
  ensureUnderlaySource();
  const source = appState.map.getSource(UNDERLAY_SOURCE);
  if (source && typeof source.setData === "function") {
    source.setData(geojson || { type: "FeatureCollection", features: [] });
  }
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
