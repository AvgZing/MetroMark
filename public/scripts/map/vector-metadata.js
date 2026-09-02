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
    const knownProblematic = Boolean(existing?.problematicGeometry);

    const override = appState.routeOverridesByCity instanceof Map ? appState.routeOverridesByCity.get(lineKey) : null;
    const overridePayload = override?.payload || null;
    const overrideMode = overridePayload?.mode !== undefined && overridePayload?.mode !== null && String(overridePayload.mode) !== ""
      ? Number(overridePayload.mode)
      : null;
    const overrideColor = String(overridePayload?.color || "").trim();
    const overrideOperator = String(overridePayload?.operatorName || overridePayload?.operator || "").trim();
    const overrideShort = String(overridePayload?.lineShortName || "").trim();
    const overrideLong = String(overridePayload?.lineLongName || "").trim();
    const overrideName = String(overridePayload?.lineName || "").trim() || [overrideShort, overrideLong].filter(Boolean).join(" | ");

    const baseMode = props.mode || (typeof modeLabelFromRouteType === "function" ? modeLabelFromRouteType(Number(props.route_type)) : "");
    const appliedMode = overrideMode !== null && typeof modeLabelFromRouteType === "function"
      ? modeLabelFromRouteType(overrideMode)
      : baseMode;

    lineByKey.set(lineKey, {
      lineKey,
      routeType: overrideMode !== null ? overrideMode : Number(props.route_type),
      lineName: overrideName || String(props.line_name || ""),
      color: overrideColor || props.color || "#d44d1f",
      operatorName: overrideOperator || String(props.operator_name || ""),
      mode: appliedMode || baseMode,
      routeOnestopId: String(props.onestop_id || ""),
      stopCount: Number.isFinite(knownStopCount) && knownStopCount > 0 ? knownStopCount : 0,
      problematicGeometry: knownProblematic,
      frequencyBucket: hasKnownHeadway ? String(existing.frequencyBucket || "unknown").toLowerCase() : "unknown",
      headwayBestMinutes: hasKnownHeadway && Number.isFinite(Number(existing.headwayBestMinutes))
        ? Number(existing.headwayBestMinutes)
        : null,
      headwaySource: hasKnownHeadway ? String(existing.headwaySource || "") : "",
      headwayChecked: hasKnownHeadway ? 1 : 0,
      headwayFallback: hasKnownHeadway ? Number(existing.headwayFallback || 0) : 0
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

// Push route override colors (and clear stale ones) into feature-state so the
// rendered line color reflects manual edits without touching tile geometry.
function applyRouteOverridesToMap() {
  if (!appState.map || !appState.mapReady) {
    return;
  }

  const overrides = appState.routeOverridesByCity instanceof Map ? appState.routeOverridesByCity : new Map();
  const seen = new Set();

  for (const [lineKey, override] of overrides) {
    const color = String(override?.payload?.color || "").trim();
    if (!color) {
      continue;
    }
    seen.add(lineKey);
    try {
      appState.map.setFeatureState(
        { source: "routes-vector", sourceLayer: "routes", id: lineKey },
        { color }
      );
    } catch {
      // feature may not be in the current tileset
    }
  }

  const stateCache = appState.mapRouteFeatureStateCache;
  if (stateCache instanceof Map) {
    for (const featureId of Array.from(stateCache.keys())) {
      if (seen.has(featureId)) {
        continue;
      }
      try {
        appState.map.setFeatureState(
          { source: "routes-vector", sourceLayer: "routes", id: featureId },
          { color: null }
        );
      } catch {
        // best-effort cleanup
      }
    }
  }
}
