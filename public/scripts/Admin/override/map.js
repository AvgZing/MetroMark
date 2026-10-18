// Admin Map Editor — focus mask, map style, map init.
// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

// Full-world dim fill.
function adminFocusMask(active) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]]
        },
        properties: { active: active ? 1 : 0 }
      }
    ]
  };
}

function setAdminFocusMask(active) {
  const source = state.map && state.map.getSource ? state.map.getSource("focus-mask") : null;
  if (source && typeof source.setData === "function") {
    source.setData(adminFocusMask(active));
  }
}

function adminMapFitPadding() {
  const editor = document.getElementById("routeEditPanel");
  const editorWidth = editor && !editor.hidden
    ? editor.getBoundingClientRect().width
    : window.innerWidth >= 1100
      ? Math.min(430, window.innerWidth * 0.46)
      : 0;
  return { top: 70, bottom: 70, left: 60, right: Math.max(60, Math.round(editorWidth) + 20) };
}

function mapStyle() {
  // Frontend basemap/projection + admin overlay layers.
  const savedTheme = typeof getAdminTheme === "function" ? getAdminTheme() : "light";
  const base = createMapStyle(savedTheme);
  return {
    ...base,
    sources: {
      ...base.sources,
      "routes-vector": { type: "vector", url: adminVectorSourceUrl(), promoteId: "line_key" },
      "focus-mask": { type: "geojson", data: adminFocusMask(false) },
      stops: { type: "geojson", data: EMPTY_FC }
    },
    layers: [
      ...base.layers,
      // Non-focused routes dim; the selected route draws on top.
      {
        id: "routes-base-main",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], ["get", "color"], "#d44d1f"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.45, 3, 0.7, 6, 1.3, 9, 1.9, 12, 2.4],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 0], 0.3, 0],
            5,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 0], 0.55, 0],
            9,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 0], 0.9, 0]
          ]
        }
      },
      {
        id: "focus-dim-layer",
        type: "fill",
        source: "focus-mask",
        paint: {
          "fill-color": savedTheme === "dark" ? "#0a121c" : "#1f262d",
          "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.65, 0]
        }
      },
      {
        id: "routes-casing",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": "#0f1b22",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.95, 3, 1.4, 6, 2.6, 9, 3.9, 12, 5.2],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.12, 0],
            5,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.22, 0],
            9,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.38, 0]
          ]
        }
      },
      {
        id: "routes-main",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], ["get", "color"], "#d44d1f"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 3, 1.05, 6, 1.9, 9, 2.9, 12, 3.6],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.35, 0],
            5,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.6, 0],
            9,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.96, 0]
          ]
        }
      },
      {
        id: "routes-hit",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": "#000000",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 10, 4, 14, 8, 18],
          "line-opacity": 0
        }
      },
      {
        id: "stops-layer",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": 5.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#111920",
          "circle-stroke-width": 1.5
        }
      }
    ]
  };
}

async function initMap() {
  if (typeof pmtiles !== "undefined" && typeof maplibregl !== "undefined") {
    const pmtilesProtocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
  }

  // Ensure the CARTO basemap key is loaded before the style is built.
  if (typeof fetchBasemapKey === "function") {
    await fetchBasemapKey();
  }

  // Adopt the archive stamp before building the style (shared SW cache entry).
  const initialStamp = await fetchAdminArchiveStamp();
  if (initialStamp) {
    state.archiveVersion = initialStamp;
  }

  state.map = new maplibregl.Map({
    container: "overrideMap",
    style: mapStyle(),
    center: [-122.335, 47.608],
    zoom: 10,
    attributionControl: false
  });
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

  state.map.on("load", () => {
    state.mapReady = true;
    updateCurrentCity();
    bindMapEvents();
    updateUnderlay();
    applyDeepLinkView();
    applyDeepLinkRoute();
    startAdminArchiveVersionWatch();
    updateNewCityView();
    // Retry once if a cold cache drops the first pmtiles paint.
    window.setTimeout(() => {
      if (!state.map || !state.map.getLayer("routes-main")) {
        return;
      }
      if (state.map.queryRenderedFeatures({ layers: ["routes-main"] }).length === 0) {
        reloadVectorSource();
        updateUnderlay();
      }
    }, 4000);
  });

  state.map.on("moveend", () => {
    appState.mapZoom = state.map.getZoom();
    if (state.selectedLineKey) {
      setAdminFocusState(state.selectedLineKey);
    }
    updateUnderlay();
    updateCurrentCity();
    loadOperatorsForViewport();
    updateNewCityView();
    if (state.areaRefreshOpen) {
      updateAreaRefreshBbox();
    }
    scheduleMergeDetection();
  });

  // Re-apply focus once the deep-linked route is in the tiles.
  state.map.on("sourcedata", (event) => {
    if (state.adminFocusActive || !state.selectedLineKey || event.sourceId !== "routes-vector") {
      return;
    }
    setAdminFocusState(state.selectedLineKey);
  });
}
