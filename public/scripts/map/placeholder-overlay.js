// Transient vector-tile-sourced route overlay for empty viewports.
// When route_geometry_lod has no data for a viewport (zoom < 10, city
// not yet populated), this module fetches a lightweight GeoJSON overlay
// from Transitland's MVT tiles and renders it as a muted placeholder
// layer. Cleared automatically when real route data arrives.
// Entire module can be disabled by returning early from fetchPlaceholder.

var PLACEHOLDER_SOURCE = "routes-placeholder";
var PLACEHOLDER_LAYER = "routes-placeholder-layer";
var PLACEHOLDER_GEOJSON = null;
var PLACEHOLDER_LAST_BBOX = null;

function clearPlaceholderLayer() {
  if (!appState.map || !appState.mapReady) return;
  try {
    if (appState.map.getLayer(PLACEHOLDER_LAYER)) {
      appState.map.removeLayer(PLACEHOLDER_LAYER);
    }
    if (appState.map.getSource(PLACEHOLDER_SOURCE)) {
      appState.map.removeSource(PLACEHOLDER_SOURCE);
    }
  } catch { /* non-critical */ }
  PLACEHOLDER_GEOJSON = null;
}

function renderPlaceholderLayer(geojson) {
  if (!appState.map || !appState.mapReady || !geojson) return;

  var hasRoutes = Array.isArray(geojson.features) && geojson.features.length > 0;
  if (!hasRoutes) {
    clearPlaceholderLayer();
    return;
  }

  PLACEHOLDER_GEOJSON = geojson;
  var lineColor = appState.theme === "dark" ? "#6699bb" : "#556688";

  // If the source already exists, update data in-place — no clear, no flash
  if (appState.map.getSource(PLACEHOLDER_SOURCE)) {
    var filtered = geojson;
    var activeKeys = appState.activeModeKeys;
    if (activeKeys && activeKeys.size > 0 && !activeKeys.has("all") && typeof MODE_DEF_BY_KEY !== "undefined") {
      var routeTypes = [];
      activeKeys.forEach(function (modeKey) {
        var def = MODE_DEF_BY_KEY.get(modeKey);
        if (def && Array.isArray(def.routeTypes)) {
          def.routeTypes.forEach(function (rt) {
            if (routeTypes.indexOf(rt) === -1) routeTypes.push(rt);
          });
        }
      });
      if (routeTypes.length > 0) {
        var allowed = new Set(routeTypes);
        filtered = { type: "FeatureCollection", features: geojson.features.filter(function (f) {
          return allowed.has(Number(f.properties?.route_type));
        })};
      }
    }
    appState.map.getSource(PLACEHOLDER_SOURCE).setData(filtered);
    return;
  }

  // First time — add source and layer
  appState.map.addSource(PLACEHOLDER_SOURCE, {
    type: "geojson",
    data: geojson
  });

  appState.map.addLayer({
    id: PLACEHOLDER_LAYER,
    type: "line",
    source: PLACEHOLDER_SOURCE,
    paint: {
      "line-color": lineColor,
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        1, 0.6,
        3, 0.9,
        6, 1.5,
        9, 2.2,
        12, 3.0
      ],
      "line-opacity": [
        "interpolate", ["linear"], ["zoom"],
        1, 0.55,
        3, 0.5,
        6, 0.45,
        9, 0.4,
        12, 0.35
      ]
    },
    layout: {
      "line-join": "round",
      "line-cap": "round"
    }
  }, "routes-background-casing");

  applyPlaceholderLayerFilter();
}

function applyPlaceholderLayerFilter() {
  if (!PLACEHOLDER_GEOJSON || !appState.map || !appState.map.getSource(PLACEHOLDER_SOURCE)) return;

  var activeKeys = appState.activeModeKeys;
  var routeTypes = [];

  if (!activeKeys || activeKeys.size === 0 || activeKeys.has("all")) {
    appState.map.getSource(PLACEHOLDER_SOURCE).setData(PLACEHOLDER_GEOJSON);
    return;
  }

  if (typeof MODE_DEF_BY_KEY !== "undefined") {
    activeKeys.forEach(function (modeKey) {
      var def = MODE_DEF_BY_KEY.get(modeKey);
      if (def && Array.isArray(def.routeTypes)) {
        def.routeTypes.forEach(function (rt) {
          if (routeTypes.indexOf(rt) === -1) {
            routeTypes.push(rt);
          }
        });
      }
    });
  }

  if (routeTypes.length === 0) {
    appState.map.getSource(PLACEHOLDER_SOURCE).setData(PLACEHOLDER_GEOJSON);
    return;
  }

  var allowed = new Set(routeTypes);
  var filtered = PLACEHOLDER_GEOJSON.features.filter(function (f) {
    return allowed.has(Number(f.properties?.route_type));
  });

  appState.map.getSource(PLACEHOLDER_SOURCE).setData({
    type: "FeatureCollection",
    features: filtered
  });
}

async function fetchPlaceholder(rawBbox, zoom) {
  // Comment out this early return to disable the placeholder overlay
  // if (!appState.map || !appState.mapReady) return;

  if (!rawBbox || !appState.map) return;

  var bboxStr = rawBbox.slice();
  bboxStr[0] = Math.max(-180, Math.min(180, bboxStr[0]));
  bboxStr[1] = Math.max(-85, Math.min(85, bboxStr[1]));
  bboxStr[2] = Math.max(-180, Math.min(180, bboxStr[2]));
  bboxStr[3] = Math.max(-85, Math.min(85, bboxStr[3]));
  if (bboxStr[0] >= bboxStr[2]) bboxStr[0] = bboxStr[2] - 0.001;
  if (bboxStr[1] >= bboxStr[3]) bboxStr[1] = bboxStr[3] - 0.001;

  // Coarse bbox comparison matching the server's cache snap step.
  // At low zoom, only trigger a new fetch when the viewport moves by
  // more than one snap degree (10° at country scale, 2° at region scale).
  var snap = Number(zoom || 0) < 5 ? 10 : Number(zoom || 0) < 8 ? 2 : 0.5;
  var coarseKey = Math.round(bboxStr[0] / snap) + "," + Math.round(bboxStr[1] / snap) + "," +
                  Math.round(bboxStr[2] / snap) + "," + Math.round(bboxStr[3] / snap);
  if (coarseKey === PLACEHOLDER_LAST_BBOX) return;
  PLACEHOLDER_LAST_BBOX = coarseKey;

  var params = new URLSearchParams({
    bbox: bboxStr.join(","),
    zoom: Number(zoom || 5).toFixed(2)
  });

  try {
    var response = await apiRequest("/api/transit/tile-placeholder?" + params.toString(), { method: "GET" });
    var geojson = response?.routesGeoJson;
    if (geojson && Array.isArray(geojson.features) && geojson.features.length > 0) {
      renderPlaceholderLayer(geojson);
    }
  } catch {
    // Placeholder is non-critical — fail silently
  }
}
