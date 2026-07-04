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

function syncMapSourceData() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  const routesSource = appState.map.getSource("routes");
  const stopsSource = appState.map.getSource("stops");

  const normalizeRouteFeature = (feature) => {
    const lineKey = String(feature?.properties?.line_key || feature?.id || "").trim();
    const featureId = String(feature?.id || feature?.properties?.feature_id || lineKey || "").trim();

    return {
      ...feature,
      id: featureId || undefined,
      properties: {
        ...feature?.properties,
        feature_id: featureId || undefined,
        line_key: lineKey || feature?.properties?.line_key || ""
      }
    };
  };

  const normalizeStopFeature = (feature) => {
    const props = feature?.properties || {};
    const lineKey = String(props.line_key || "").trim();
    const stationKey = String(props.station_key || props.stop_id || feature?.id || "").trim();
    const featureId = String(feature?.id || props.feature_id || `${lineKey}|${stationKey}` || "").trim();

    return {
      ...feature,
      id: featureId || undefined,
      properties: {
        ...props,
        feature_id: featureId || undefined,
        line_key: lineKey,
        station_key: props.station_key || stationKey
      }
    };
  };

  if (!appState.transit) {
    if (routesSource) {
      routesSource.setData(emptyFeatureCollection());
    }
    if (stopsSource) {
      stopsSource.setData(emptyFeatureCollection());
    }
    appState.mapRenderedTransit = null;
    appState.lastMapFeatureStateSignature = "";
    appState.mapRouteFeatureStateCache = new Map();
    appState.mapStopFeatureStateCache = new Map();
    return;
  }

  if (appState.transit !== appState.mapRenderedTransit) {
    appState.lastMapFeatureStateSignature = "";
    appState.mapRouteFeatureStateCache = new Map();
    appState.mapStopFeatureStateCache = new Map();

    const routes = Array.isArray(appState.transit?.routesGeoJson?.features)
      ? {
          ...appState.transit.routesGeoJson,
          features: appState.transit.routesGeoJson.features.map(normalizeRouteFeature)
        }
      : emptyFeatureCollection();

    // Replace focused route's geometry with full-detail version from route-stops cache
    if (appState.focusedLineKey && routes.features.length > 0) {
      const stopCacheKey = routeStopCacheKey(appState.focusedLineKey);
      const stopCache = appState.lineStopsCache.get(stopCacheKey);
      const fullGeo = stopCache?.payload?.routesGeoJson?.features?.[0]?.geometry;
      if (fullGeo) {
        const idx = routes.features.findIndex((f) => f?.properties?.line_key === appState.focusedLineKey);
        if (idx >= 0) {
          const orig = routes.features[idx];
          routes.features[idx] = { ...orig, geometry: fullGeo };
        }
      }
    }

    const stops = Array.isArray(appState.transit?.stopsGeoJson?.features)
      ? {
          ...appState.transit.stopsGeoJson,
          features: appState.transit.stopsGeoJson.features.map(normalizeStopFeature)
        }
      : emptyFeatureCollection();

  if (routesSource) {
      routesSource.setData(routes);
      if (appState.focusedLineKey) {
        const focused = routes.features.find((f) => f?.properties?.line_key === appState.focusedLineKey);
        if (focused?.geometry?.coordinates) {
          const coords = focused.geometry.coordinates;
          const coordCount = Array.isArray(coords[0]?.[0]) ? coords.reduce((sum, seg) => sum + seg.length, 0) : coords.length;
          const firstCoord = JSON.stringify(Array.isArray(coords[0]?.[0]) ? coords[0][0] : coords[0]);
          const lastCoord = JSON.stringify(Array.isArray(coords[0]?.[0]) ? coords[coords.length - 1]?.slice(-1)[0] : coords[coords.length - 1]);
          console.log(`[geo] Focused route geometry: ${coordCount} coords, first=${firstCoord}, last=${lastCoord}, type=${focused.geometry.type}`);
        }
      }
    }
    if (stopsSource) {
      stopsSource.setData(stops);
    }

    appState.mapRenderedTransit = appState.transit || null;
  }
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
      { source: "routes", id: featureId },
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

  syncMapSourceData();
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
