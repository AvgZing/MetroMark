let vectorMetadataRebuildTimer = null;

function vectorSourceFeatures() {
  if (!appState.map || !appState.mapReady) {
    return [];
  }
  try {
    return appState.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" }) || [];
  } catch {
    return [];
  }
}

function scheduleVectorMetadataRebuild() {
  if (vectorMetadataRebuildTimer) {
    return;
  }
  vectorMetadataRebuildTimer = setTimeout(() => {
    vectorMetadataRebuildTimer = null;
    rebuildLineMetadataFromTiles();
  }, 200);
}

function initVectorMetadataWiring() {
  if (!appState.map) {
    return;
  }
  appState.map.on("sourcedata", (event) => {
    if (event.sourceId === "routes-vector" && event.isSourceLoaded) {
      scheduleVectorMetadataRebuild();
    }
  });
  scheduleVectorMetadataRebuild();
}

function rebuildLineMetadataFromTiles() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  const features = vectorSourceFeatures();
  const existingByKey = new Map();
  for (const line of appState.lineSummaries || []) {
    if (line && line.lineKey) {
      existingByKey.set(line.lineKey, line);
    }
  }

  const lineByKey = new Map();
  for (const feature of features) {
    const props = feature?.properties || {};
    const lineKey = String(props.line_key || "").trim();
    if (!lineKey || lineByKey.has(lineKey)) {
      continue;
    }

    const existing = existingByKey.get(lineKey);
    const hasKnownHeadway = Boolean(existing && Number(existing.headwayChecked || 0) === 1);
    const knownStopCount = Number(existing?.stopCount || 0);

    lineByKey.set(lineKey, {
      lineKey,
      routeType: Number(props.route_type),
      lineName: String(props.line_name || ""),
      color: props.color || "#d44d1f",
      operatorName: String(props.operator_name || ""),
      mode: props.mode || (typeof modeLabelFromRouteType === "function" ? modeLabelFromRouteType(Number(props.route_type)) : ""),
      routeOnestopId: String(props.onestop_id || ""),
      stopCount: Number.isFinite(knownStopCount) && knownStopCount > 0 ? knownStopCount : 0,
      frequencyBucket: hasKnownHeadway ? String(existing.frequencyBucket || "unknown").toLowerCase() : "unknown",
      headwayBestMinutes: hasKnownHeadway && Number.isFinite(Number(existing.headwayBestMinutes))
        ? Number(existing.headwayBestMinutes)
        : null,
      headwaySource: hasKnownHeadway ? String(existing.headwaySource || "") : "",
      headwayChecked: hasKnownHeadway ? 1 : 0,
      headwayFallback: hasKnownHeadway ? Number(existing.headwayFallback || 0) : 1
    });
  }

  const lineSummaries = Array.from(lineByKey.values());
  const signature = lineSummaries.map((line) => line.lineKey).sort().join("|");
  if (signature === appState.lastTileMetadataSignature) {
    return;
  }
  appState.lastTileMetadataSignature = signature;

  const featureByLineKey = new Map();
  for (const feature of features) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    if (lineKey && !featureByLineKey.has(lineKey)) {
      featureByLineKey.set(lineKey, feature);
    }
  }

  appState.lineSummaries = lineSummaries;
  appState.loadedLineSummaries = lineSummaries;
  appState.transit = {
    routesGeoJson: {
      type: "FeatureCollection",
      features: Array.from(featureByLineKey.values())
    },
    stopsGeoJson: {
      type: "FeatureCollection",
      features: []
    }
  };

  if (appState.focusedLineKey && !lineByKey.has(appState.focusedLineKey)) {
    appState.focusedLineKey = "";
  }

  if (typeof renderMapData === "function") {
    renderMapData();
  }
  if (typeof refreshUiFromState === "function") {
    refreshUiFromState();
  }
}
