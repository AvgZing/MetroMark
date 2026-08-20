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

var lastRouteHoverAt = 0;
var lastRouteHoverPoint = null;

function onRouteHoverMove(event) {
  if (!hoverInteractionsEnabled()) {
    onRouteHoverLeave();
    return;
  }

  if (!appState.routeHoverPopup || !appState.map) {
    return;
  }

  // Throttle the rendered-feature query: over a dense (global-scale) viewport
  // this runs on every mousemove and can be very expensive. Keep the existing
  // popup unless the pointer moved meaningfully and enough time has passed.
  const now = performance.now();
  const point = event.point;
  const movedEnough =
    !lastRouteHoverPoint ||
    Math.abs(point.x - lastRouteHoverPoint.x) + Math.abs(point.y - lastRouteHoverPoint.y) > 3;
  if (now - lastRouteHoverAt < 50 || !movedEnough) {
    return;
  }
  lastRouteHoverAt = now;
  lastRouteHoverPoint = point;

  if (appState.hoverPopup) {
    appState.hoverPopup.remove();
  }

  const features = appState.map.queryRenderedFeatures(event.point, {
    layers: ["routes-main-vector", "routes-background-main-vector"]
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

  appState.map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), "bottom-right");
  appState.map.dragRotate.disable();
  appState.map.touchZoomRotate.disableRotation();
  appState.map.keyboard.disableRotation();
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
    registerMapSources(appState.map);

    if (typeof initVectorMetadataWiring === "function") {
      initVectorMetadataWiring();
    }

    if (typeof initZoomReadout === "function") {
      initZoomReadout();
    }

    addMapRouteLayers(appState.map);
    bindMapInteractionEvents(appState.map);

    appState.mapReady = true;
    updateMapModeButtons();
    renderMapData();

    if (typeof appState.mapReadyResolver === "function") {
      appState.mapReadyResolver();
      appState.mapReadyResolver = null;
    }
  });
}
