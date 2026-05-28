async function onStopClicked(event) {
  const feature = event.features && event.features[0];
  if (!feature) {
    return;
  }

  if (Number(feature?.properties?.is_interactive || 0) !== 1) {
    return;
  }

  closeRouteSelectionPopup();
  onRouteHoverLeave();

  state.lastStopClickAt = Date.now();
  resetClearRouteProgressConfirmation();

  await toggleVisitedForStation(feature.properties || {}, feature.geometry?.coordinates || []);
}

function onStopHoverMove(event) {
  if (!hoverInteractionsEnabled()) {
    onStopHoverLeave();
    return;
  }

  const feature = event.features && event.features[0];
  if (!feature || !state.hoverPopup) {
    return;
  }

  if (Number(feature?.properties?.is_interactive || 0) !== 1) {
    onStopHoverLeave();
    return;
  }

  if (state.routeHoverPopup) {
    state.routeHoverPopup.remove();
  }

  state.hoverPopup
    .setLngLat(event.lngLat)
    .setHTML(stopHoverHtml(feature.properties || {}))
    .addTo(state.map);
}

function onStopHoverLeave() {
  if (state.hoverPopup) {
    state.hoverPopup.remove();
  }

  if (state.userStatusPinnedKind !== "station") {
    restoreUserStatusFromFocus();
  }
}

function lineFromRouteFeature(feature) {
  const lineKey = String(feature?.properties?.line_key || "").trim();
  if (!lineKey) {
    return null;
  }

  const fromSummary = state.lineSummaries.find((line) => line.lineKey === lineKey);
  if (fromSummary) {
    return fromSummary;
  }

  const parsed = lineLikeFromFeatureProperties(feature?.properties || {});
  return {
    ...parsed,
    lineKey,
    routeType: Number.isFinite(parsed.routeType) ? parsed.routeType : null,
    color: feature?.properties?.color
  };
}

function onRouteHoverMove(event) {
  if (!hoverInteractionsEnabled()) {
    onRouteHoverLeave();
    return;
  }

  if (!state.routeHoverPopup || !state.map) {
    return;
  }

  if (state.hoverPopup) {
    state.hoverPopup.remove();
  }

  const features = state.map.queryRenderedFeatures(event.point, {
    layers: ["routes-main", "routes-background-main"]
  });

  const uniqueLines = new Map();
  for (const feature of features || []) {
    const line = lineFromRouteFeature(feature);
    if (!line || !lineIsVisible(line) || uniqueLines.has(line.lineKey)) {
      continue;
    }
    uniqueLines.set(line.lineKey, line);
  }

  const allLines = Array.from(uniqueLines.values());
  const lines = allLines.slice(0, 4);
  if (!lines.length) {
    onRouteHoverLeave();
    return;
  }

  state.routeHoverPopup
    .setLngLat(event.lngLat)
    .setHTML(lineHoverHtml(lines, allLines.length))
    .addTo(state.map);
}

function onRouteHoverLeave() {
  if (state.routeHoverPopup) {
    state.routeHoverPopup.remove();
  }

  if (state.userStatusPinnedKind !== "station") {
    restoreUserStatusFromFocus();
  }
}

function initializeMap() {
  state.map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(),
    center: [-122.335, 47.608],
    zoom: 9.5,
    maxPitch: 80,
    antialias: true
  });

  state.map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  state.hoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 12
  });
  state.routeHoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10
  });
  state.routeSelectPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    closeOnMove: true,
    offset: 12,
    maxWidth: "340px"
  });

  state.map.on("style.load", () => {
    state.map.setProjection({ type: "globe" });
    state.map.setFog({
      color: "#dce4e7",
      "high-color": "#f5f8ff",
      "horizon-blend": 0.05,
      "space-color": "#0f1b22",
      "star-intensity": 0.03
    });
  });

  state.map.on("load", () => {
    state.map.addSource("routes", {
      type: "geojson",
      data: emptyFeatureCollection()
    });

    state.map.addSource("stops", {
      type: "geojson",
      data: emptyFeatureCollection()
    });

    state.map.addSource("focus-mask", {
      type: "geojson",
      data: focusMaskFeatureCollection(false)
    });

    state.map.addLayer({
      id: "routes-background-casing",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "is_focused"], 0],
      paint: {
        "line-color": "#111920",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.7,
          3,
          1.1,
          6,
          2.1,
          9,
          3.2,
          12,
          4.3
        ],
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "is_visible"]], 0],
          0,
          0,
          1,
          0
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    state.map.addLayer({
      id: "routes-background-main",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "is_focused"], 0],
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.45,
          3,
          0.7,
          6,
          1.3,
          9,
          1.9,
          12,
          2.4
        ],
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "is_visible"]], 0],
          0,
          0,
          1,
          0.9
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    state.map.addLayer({
      id: "focus-dim-layer",
      type: "fill",
      source: "focus-mask",
      paint: {
        "fill-color": "#1f262d",
        "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.65, 0]
      }
    });

    state.map.addLayer({
      id: "routes-casing",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "is_focused"], 1],
      paint: {
        "line-color": "#0f1b22",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.95,
          3,
          1.4,
          6,
          2.6,
          9,
          3.9,
          12,
          5.2
        ],
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "is_visible"]], 0],
          0,
          0,
          1,
          0.38
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    state.map.addLayer({
      id: "routes-main",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "is_focused"], 1],
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.7,
          3,
          1.05,
          6,
          1.9,
          9,
          2.9,
          12,
          3.6
        ],
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "is_visible"]], 0],
          0,
          0,
          1,
          0.96
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    state.map.addLayer({
      id: "routes-hit",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "is_visible"], 1],
      paint: {
        "line-color": "#000000",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          6,
          4,
          10,
          8,
          14,
          13,
          18
        ],
        "line-opacity": 0
      }
    });

    state.map.addLayer({
      id: "stops-layer",
      type: "circle",
      source: "stops",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          2.9,
          8,
          4.2,
          11,
          5.6,
          14,
          7.1
        ],
        "circle-color": [
          "case",
          ["==", ["get", "show_all"], 1],
          "#ffffff",
          ["==", ["get", "visited"], 1],
          "#1a9b66",
          "#d9563a"
        ],
        "circle-stroke-color": [
          "case",
          ["==", ["get", "show_all"], 1],
          "#0f1b22",
          "#ffffff"
        ],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "show_all"], 1],
          0.9,
          1.2
        ],
        "circle-opacity": [
          "case",
          ["==", ["get", "show_all"], 1],
          1,
          ["==", ["get", "is_focused"], 1],
          0.94,
          0.32
        ],
        "circle-stroke-opacity": [
          "case",
          ["==", ["get", "show_all"], 1],
          1,
          ["==", ["get", "is_focused"], 1],
          1,
          0.45
        ]
      }
    });

    const routeHoverLayers = ["routes-main", "routes-background-main"];
    const routeClickLayers = ["routes-hit"];

    for (const layerId of routeClickLayers) {
      state.map.on("click", layerId, (event) => {
        const now = Date.now();
        if (now - state.lastStopClickAt < 260) {
          return;
        }
        if (now - state.lastRouteClickAt < 160) {
          return;
        }

        const stopHits = state.map
          .queryRenderedFeatures(event.point, {
            layers: ["stops-layer"]
          })
          .filter((feature) => Number(feature?.properties?.is_interactive || 0) === 1);
        if (
          Array.isArray(stopHits) &&
          stopHits.length > 0 &&
          state.userStatusPinnedKind !== "station"
        ) {
          return;
        }

        const routeHits = state.map.queryRenderedFeatures(event.point, {
          layers: routeClickLayers
        });

        const seenLineKeys = new Set();
        const overlappedLines = [];
        for (const hit of routeHits || []) {
          const line = lineFromRouteFeature(hit);
          const candidateLineKey = String(line?.lineKey || "").trim();
          if (!line || !lineIsVisible(line) || !candidateLineKey || seenLineKeys.has(candidateLineKey)) {
            continue;
          }

          seenLineKeys.add(candidateLineKey);
          overlappedLines.push(line);
        }

        if (!overlappedLines.length) {
          return;
        }

        overlappedLines.sort((a, b) => lineDisplayName(a).localeCompare(lineDisplayName(b)));
        state.lastRouteClickAt = now;

        if (overlappedLines.length === 1) {
          closeRouteSelectionPopup();
          setFocusedLine(overlappedLines[0].lineKey).catch((error) => {
            setStatus(error.message, "error");
          });
          return;
        }

        onRouteHoverLeave();
        openRouteSelectionPopup(overlappedLines, event.lngLat);
        setStatus(
          "Multiple routes overlap here.",
          "ok",
          `Pick one from the selector (${overlappedLines.length} routes).`
        );
      });
    }

    for (const layerId of routeHoverLayers) {
      state.map.on("mouseenter", layerId, () => {
        if (hoverInteractionsEnabled()) {
          state.map.getCanvas().style.cursor = "pointer";
        }
      });

      state.map.on("mousemove", layerId, (event) => {
        if (hoverInteractionsEnabled()) {
          onRouteHoverMove(event);
        }
      });

      state.map.on("mouseleave", layerId, () => {
        state.map.getCanvas().style.cursor = "";
        onRouteHoverLeave();
      });
    }

    state.map.on("click", "stops-layer", onStopClicked);
    state.map.on("mouseenter", "stops-layer", (event) => {
      const feature = event.features && event.features[0];
      if (hoverInteractionsEnabled() && Number(feature?.properties?.is_interactive || 0) === 1) {
        state.map.getCanvas().style.cursor = "pointer";
      }
    });
    state.map.on("mousemove", "stops-layer", (event) => {
      if (hoverInteractionsEnabled()) {
        onStopHoverMove(event);
      }
    });
    state.map.on("mouseleave", "stops-layer", () => {
      state.map.getCanvas().style.cursor = "";
      onStopHoverLeave();
    });

    state.map.on("click", (event) => {
      const now = Date.now();
      if (now - state.lastStopClickAt < 260 || now - state.lastRouteClickAt < 220) {
        return;
      }

      const point = event.point;
      const closePadding = 14;

      if (state.routeSelectPopup) {
        const nearbyRoutes = state.map.queryRenderedFeatures(
          [
            [point.x - closePadding, point.y - closePadding],
            [point.x + closePadding, point.y + closePadding]
          ],
          {
            layers: routeClickLayers
          }
        );

        if (!Array.isArray(nearbyRoutes) || nearbyRoutes.length === 0) {
          closeRouteSelectionPopup();
        }
      }

      if (!state.focusedLineKey) {
        return;
      }

      const nearby = state.map.queryRenderedFeatures(
        [
          [point.x - closePadding, point.y - closePadding],
          [point.x + closePadding, point.y + closePadding]
        ],
        {
          layers: ["stops-layer", "routes-hit", "routes-main", "routes-background-main"]
        }
      );

      const hasVisibleNearbyFeature = Array.isArray(nearby)
        ? nearby.some((feature) => {
            if (feature?.layer?.id === "stops-layer") {
              return Number(feature?.properties?.is_interactive || 0) === 1;
            }

            const line = lineFromRouteFeature(feature);
            return Boolean(line && lineIsVisible(line));
          })
        : false;

      if (hasVisibleNearbyFeature) {
        return;
      }

      clearFocusedLine(
        "Route focus cleared.",
        "Clicked away from routes/stations. Click a route to focus it again."
      );
    });

    state.map.on("touchstart", () => {
      onStopHoverLeave();
      onRouteHoverLeave();
      closeRouteSelectionPopup();
    });

    state.map.on("movestart", () => {
      closeRouteSelectionPopup();
      if (!hoverInteractionsEnabled()) {
        onStopHoverLeave();
        onRouteHoverLeave();
      }
    });

    state.map.on("moveend", onMapMoveEnd);

    state.mapReady = true;
    updateMapModeButtons();
    renderMapData();

    if (typeof state.mapReadyResolver === "function") {
      state.mapReadyResolver();
      state.mapReadyResolver = null;
    }
  });
}

