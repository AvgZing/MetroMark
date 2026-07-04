async function onStopClicked(event) {
  const feature = event.features && event.features[0];
  if (!feature) {
    return;
  }

  if (Number(stopFeatureState(feature)?.interactive || 0) !== 1) {
    return;
  }

  closeRouteSelectionPopup();
  onRouteHoverLeave();

  appState.lastStopClickAt = Date.now();
  resetClearRouteProgressConfirmation();

  await toggleVisitedForStation(feature.properties || {}, feature.geometry?.coordinates || []);
}

function onStopHoverMove(event) {
  if (!hoverInteractionsEnabled()) {
    onStopHoverLeave();
    return;
  }

  const feature = event.features && event.features[0];
  if (!feature || !appState.hoverPopup) {
    return;
  }

  if (Number(stopFeatureState(feature)?.interactive || 0) !== 1) {
    onStopHoverLeave();
    return;
  }

  if (appState.routeHoverPopup) {
    appState.routeHoverPopup.remove();
  }

  appState.hoverPopup
    .setLngLat(event.lngLat)
    .setHTML(stopHoverHtml(feature.properties || {}))
    .addTo(appState.map);
}

function onStopHoverLeave() {
  if (appState.hoverPopup) {
    appState.hoverPopup.remove();
  }

  if (appState.userStatusPinnedKind !== "station") {
    restoreUserStatusFromFocus();
  }
}

function stopFeatureState(feature) {
  const featureId = String(feature?.id || feature?.properties?.feature_id || "").trim();
  if (!featureId || !appState.map || typeof appState.map.getFeatureState !== "function") {
    return {};
  }

  return appState.map.getFeatureState({ source: "stops", id: featureId }) || {};
}

function lineFromRouteFeature(feature) {
  const lineKey = String(feature?.properties?.line_key || "").trim();
  if (!lineKey) {
    return null;
  }

  const fromSummary = appState.lineSummaries.find((line) => line.lineKey === lineKey);
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

  if (!appState.routeHoverPopup || !appState.map) {
    return;
  }

  if (appState.hoverPopup) {
    appState.hoverPopup.remove();
  }

  const features = appState.map.queryRenderedFeatures(event.point, {
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

  appState.routeHoverPopup
    .setLngLat(event.lngLat)
    .setHTML(lineHoverHtml(lines, allLines.length))
    .addTo(appState.map);
}

function onRouteHoverLeave() {
  if (appState.routeHoverPopup) {
    appState.routeHoverPopup.remove();
  }

  if (appState.userStatusPinnedKind !== "station") {
    restoreUserStatusFromFocus();
  }
}

function initializeMap() {
  appState.map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(),
    center: [-122.335, 47.608],
    zoom: 9.5,
    maxPitch: 80,
    antialias: true
  });

  appState.map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  appState.hoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 12
  });
  appState.routeHoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10
  });
  appState.routeSelectPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    closeOnMove: true,
    offset: 12,
    maxWidth: "340px"
  });

  appState.map.on("style.load", () => {
    appState.map.setProjection({ type: "globe" });
    appState.map.setFog({
      color: "#dce4e7",
      "high-color": "#f5f8ff",
      "horizon-blend": 0.05,
      "space-color": "#0f1b22",
      "star-intensity": 0.03
    });
  });

  appState.map.on("load", () => {
    appState.map.addSource("routes", {
      type: "geojson",
      promoteId: "feature_id",
      data: emptyFeatureCollection()
    });

    appState.map.addSource("stops", {
      type: "geojson",
      promoteId: "feature_id",
      data: emptyFeatureCollection()
    });

    appState.map.addSource("focus-mask", {
      type: "geojson",
      data: focusMaskFeatureCollection(false)
    });

    appState.map.addLayer({
      id: "routes-background-casing",
      type: "line",
      source: "routes",
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
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
          ],
          0,
          0
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    appState.map.addLayer({
      id: "routes-background-main",
      type: "line",
      source: "routes",
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
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 0]
          ],
          0.9,
          0
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    appState.map.addLayer({
      id: "focus-dim-layer",
      type: "fill",
      source: "focus-mask",
      paint: {
        "fill-color": "#1f262d",
        "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.65, 0]
      }
    });

    appState.map.addLayer({
      id: "routes-casing",
      type: "line",
      source: "routes",
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
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.38,
          0
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    appState.map.addLayer({
      id: "routes-main",
      type: "line",
      source: "routes",
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
          "case",
          [
            "all",
            ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
            ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1]
          ],
          0.96,
          0
        ],
        "line-opacity-transition": {
          duration: 220,
          delay: 0
        }
      }
    });

    appState.map.addLayer({
      id: "routes-hit",
      type: "line",
      source: "routes",
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
        "line-opacity": [
          "case",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          0,
          0
        ]
      }
    });

    appState.map.addLayer({
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
          ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
          "#ffffff",
          ["==", ["coalesce", ["to-number", ["feature-state", "visited"]], 0], 1],
          "#1a9b66",
          "#d9563a"
        ],
        "circle-stroke-color": [
          "case",
          ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
          "#0f1b22",
          "#ffffff"
        ],
        "circle-stroke-width": [
          "case",
          ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1],
          0.9,
          1.2
        ],
        "circle-opacity": [
          "case",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          ["case", ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1], 1, ["case", ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1], 0.94, 0.32]],
          0
        ],
        "circle-stroke-opacity": [
          "case",
          ["==", ["coalesce", ["to-number", ["feature-state", "visible"]], 0], 1],
          ["case", ["==", ["coalesce", ["to-number", ["feature-state", "show_all"]], 0], 1], 1, ["case", ["==", ["coalesce", ["to-number", ["feature-state", "focused"]], 0], 1], 1, 0.45]],
          0
        ]
        }
      });

      const routeHoverLayers = ["routes-main", "routes-background-main"];
      const routeClickLayers = ["routes-hit"];

      for (const layerId of routeClickLayers) {
        appState.map.on("click", layerId, (event) => {
          const now = Date.now();
          if (now - appState.lastStopClickAt < 260) {
            return;
          }
          if (now - appState.lastRouteClickAt < 160) {
            return;
          }

          const stopHits = appState.map
            .queryRenderedFeatures(event.point, {
              layers: ["stops-layer"]
            })
            .filter((feature) => Number(stopFeatureState(feature)?.interactive || 0) === 1);
          if (
            Array.isArray(stopHits) &&
            stopHits.length > 0 &&
            appState.userStatusPinnedKind !== "station"
          ) {
            return;
          }

          const routeHits = appState.map.queryRenderedFeatures(event.point, {
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
          appState.lastRouteClickAt = now;

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
        appState.map.on("mouseenter", layerId, () => {
          if (hoverInteractionsEnabled()) {
            appState.map.getCanvas().style.cursor = "pointer";
          }
        });

        appState.map.on("mousemove", layerId, (event) => {
          if (hoverInteractionsEnabled()) {
            onRouteHoverMove(event);
          }
        });

        appState.map.on("mouseleave", layerId, () => {
          appState.map.getCanvas().style.cursor = "";
          onRouteHoverLeave();
        });
      }

      appState.map.on("click", "stops-layer", onStopClicked);
      appState.map.on("mouseenter", "stops-layer", (event) => {
        const feature = event.features && event.features[0];
        if (hoverInteractionsEnabled() && Number(stopFeatureState(feature)?.interactive || 0) === 1) {
          appState.map.getCanvas().style.cursor = "pointer";
        }
      });
      appState.map.on("mousemove", "stops-layer", (event) => {
        if (hoverInteractionsEnabled()) {
          onStopHoverMove(event);
        }
      });
      appState.map.on("mouseleave", "stops-layer", () => {
        appState.map.getCanvas().style.cursor = "";
        onStopHoverLeave();
      });

      appState.map.on("click", (event) => {
        const now = Date.now();
        if (now - appState.lastStopClickAt < 260 || now - appState.lastRouteClickAt < 220) {
          return;
        }

        const point = event.point;
        const closePadding = 14;

        if (appState.routeSelectPopup) {
          const nearbyRoutes = appState.map.queryRenderedFeatures(
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

        if (!appState.focusedLineKey) {
          return;
        }

        const nearby = appState.map.queryRenderedFeatures(
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
                return Number(stopFeatureState(feature)?.interactive || 0) === 1;
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

      appState.map.on("touchstart", () => {
        onStopHoverLeave();
        onRouteHoverLeave();
        closeRouteSelectionPopup();
      });

      appState.map.on("movestart", () => {
        closeRouteSelectionPopup();
        if (!hoverInteractionsEnabled()) {
          onStopHoverLeave();
          onRouteHoverLeave();
        }
      });

      appState.map.on("moveend", onMapMoveEnd);

      appState.mapReady = true;
      updateMapModeButtons();
      renderMapData();

      if (typeof appState.mapReadyResolver === "function") {
        appState.mapReadyResolver();
        appState.mapReadyResolver = null;
      }
    });
  }

