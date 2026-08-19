function getMapFeatureVisibilityState() {
  if (!appState.transit) {
    return null;
  }

  const shownLines = getShownLines();
  const visibleLineKeys = getVisibleLineKeys(shownLines);
  const hasFocus = Boolean(appState.focusedLineKey) && visibleLineKeys.has(appState.focusedLineKey);
  const showAllStops = Boolean(appState.showAllStops) && !hasFocus;

  return {
    shownLines,
    visibleLineKeys,
    hasFocus,
    showAllStops
  };
}

function buildMapFeatureStateSignature(visibility) {
  if (!visibility) {
    return "";
  }

  const visibleLineKeys = Array.from(visibility.visibleLineKeys || []).sort().join("|");
  const visitedSignature = Array.from(appState.visitedByLine.entries())
    .map(([lineKey, set]) => `${String(lineKey || "").trim()}:${Number(set?.size || 0)}`)
    .sort()
    .join("|");

  return [
    visibility.hasFocus ? appState.focusedLineKey : "",
    visibility.showAllStops ? "1" : "0",
    visibleLineKeys,
    visitedSignature
  ].join("::");
}

function syncMapFeatureStates() {
  if (!appState.mapReady || !appState.map || !appState.transit) {
    return;
  }

  const visibility = getMapFeatureVisibilityState();
  if (!visibility) {
    return;
  }

  const signature = buildMapFeatureStateSignature(visibility);
  if (signature === appState.lastMapFeatureStateSignature) {
    return;
  }
  appState.lastMapFeatureStateSignature = signature;

  const routeStateCache = appState.mapRouteFeatureStateCache instanceof Map
    ? appState.mapRouteFeatureStateCache
    : new Map();
  const stopStateCache = appState.mapStopFeatureStateCache instanceof Map
    ? appState.mapStopFeatureStateCache
    : new Map();

  const routeFeatures = Array.isArray(appState.transit.routesGeoJson?.features)
    ? appState.transit.routesGeoJson.features
    : [];
  const seenRouteIds = new Set();
  for (const feature of routeFeatures) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    const featureId = String(feature?.id || feature?.properties?.feature_id || lineKey || "").trim();
    if (!featureId) {
      continue;
    }
    seenRouteIds.add(featureId);

    const visible = visibility.visibleLineKeys.has(lineKey) ? 1 : 0;
    const focused = visible && (!visibility.hasFocus || lineKey === appState.focusedLineKey) ? 1 : 0;
    const nextState = {
      visible,
      focused,
      interactive: visible
    };
    const previousState = routeStateCache.get(featureId);
    const changed =
      !previousState ||
      previousState.visible !== nextState.visible ||
      previousState.focused !== nextState.focused ||
      previousState.interactive !== nextState.interactive;

    if (!changed) {
      continue;
    }

    appState.map.setFeatureState(
      { source: "routes-vector", sourceLayer: "routes", id: featureId },
      nextState
    );
    routeStateCache.set(featureId, nextState);
  }

  for (const cachedId of Array.from(routeStateCache.keys())) {
    if (!seenRouteIds.has(cachedId)) {
      routeStateCache.delete(cachedId);
    }
  }

  const stopFeatures = Array.isArray(appState.transit.stopsGeoJson?.features)
    ? appState.transit.stopsGeoJson.features
    : [];
  const seenStopIds = new Set();
  for (const feature of stopFeatures) {
    const props = feature?.properties || {};
    const lineKey = String(props.line_key || "").trim();
    const stationKey = String(props.station_key || "").trim();
    const featureId = String(feature?.id || props.feature_id || `${lineKey}|${stationKey}` || "").trim();
    if (!featureId) {
      continue;
    }
    seenStopIds.add(featureId);

    const visible = visibility.hasFocus
      ? lineKey === appState.focusedLineKey
      : visibility.showAllStops && visibility.visibleLineKeys.has(lineKey)
        ? 1
        : 0;
    const nextState = {
      visible,
      focused: visibility.hasFocus ? 1 : 0,
      interactive: visibility.hasFocus ? 1 : 0,
      show_all: visibility.showAllStops ? 1 : 0,
      visited: getVisitedSetForLine(lineKey).has(stationKey) ? 1 : 0
    };
    const previousState = stopStateCache.get(featureId);
    const changed =
      !previousState ||
      previousState.visible !== nextState.visible ||
      previousState.focused !== nextState.focused ||
      previousState.interactive !== nextState.interactive ||
      previousState.show_all !== nextState.show_all ||
      previousState.visited !== nextState.visited;

    if (!changed) {
      continue;
    }

    appState.map.setFeatureState(
      { source: "stops", id: featureId },
      nextState
    );
    stopStateCache.set(featureId, nextState);
  }

  for (const cachedId of Array.from(stopStateCache.keys())) {
    if (!seenStopIds.has(cachedId)) {
      stopStateCache.delete(cachedId);
    }
  }

  appState.mapRouteFeatureStateCache = routeStateCache;
  appState.mapStopFeatureStateCache = stopStateCache;
}

function renderMapData() {
  const t0 = performance.now();
  if (!appState.mapReady || !appState.map) {
    return;
  }

  if (typeof syncStopsSourceData === "function") {
    syncStopsSourceData();
  }
  syncMapFeatureStates();

  const focusMaskSource = appState.map.getSource("focus-mask");
  if (focusMaskSource) {
    focusMaskSource.setData(focusMaskFeatureCollection(Boolean(appState.focusedLineKey)));
  }
  const elapsed = performance.now() - t0;
  if (elapsed > 30) {
    console.log(`[perf] renderMapData: ${elapsed.toFixed(1)}ms`);
  }
}

function compactRouteStopsPayload(payload) {
  if (!payload) {
    return {
      stopsGeoJson: { type: "FeatureCollection", features: [] },
      directionStopSequences: null,
      directionStopPatterns: null,
      matchingStats: null,
      headwaySummary: null,
      routesGeoJson: null
    };
  }

  const {
    lineSummaries: _lineSummaries,
    ...rest
  } = payload;

  return {
    ...rest,
    stopsGeoJson: rest.stopsGeoJson || { type: "FeatureCollection", features: [] },
    routesGeoJson: rest.routesGeoJson || null,
    directionStopSequences: rest.directionStopSequences || null,
    directionStopPatterns: rest.directionStopPatterns || null,
    matchingStats: rest.matchingStats ? { ...rest.matchingStats } : null,
    headwaySummary: rest.headwaySummary ? { ...rest.headwaySummary } : null
  };
}
