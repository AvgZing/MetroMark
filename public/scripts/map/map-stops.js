// Assembles the on-map stops layer from the per-line route-stops cache and
// keeps the "stops" GeoJSON source (and feature state) in sync with focus,
// "show all stops", and mode/frequency filters.

function mergeStopFeature(existing, incoming) {
  return {
    ...incoming,
    properties: {
      ...existing.properties,
      ...incoming.properties,
      source_count: Math.max(
        Number(existing.properties.source_count || 1),
        Number(incoming.properties.source_count || 1)
      ),
      hub_member_count: Math.max(
        Number(existing.properties.hub_member_count || 1),
        Number(incoming.properties.hub_member_count || 1)
      ),
      hub_spread_m: Math.max(
        Number(existing.properties.hub_spread_m || 0),
        Number(incoming.properties.hub_spread_m || 0)
      ),
      distance_m: Math.min(
        Number(existing.properties.distance_m || 0),
        Number(incoming.properties.distance_m || 0)
      )
    }
  };
}

function normalizeStopFeature(feature) {
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
}

function syncStopsSourceData() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  const stopsSource = appState.map.getSource("stops");
  const visibleLineKeys = typeof getShownLines === "function"
    ? new Set(getShownLines().map((line) => line.lineKey))
    : new Set();

  const includeStopLineKeys = new Set();
  if (
    appState.focusedLineKey &&
    Array.isArray(appState.lineSummaries) &&
    appState.lineSummaries.some((line) => line.lineKey === appState.focusedLineKey)
  ) {
    includeStopLineKeys.add(appState.focusedLineKey);
  } else if (Boolean(appState.showAllStops)) {
    for (const lineKey of visibleLineKeys) {
      includeStopLineKeys.add(lineKey);
    }
  }

  const stopByKey = new Map();
  for (const entry of appState.lineStopsCache.values()) {
    if (!entry || entry.stopTypesKey !== ROUTE_STOP_TYPES_KEY) {
      continue;
    }
    if (!includeStopLineKeys.has(entry.lineKey)) {
      continue;
    }

    entry.lastUsedAt = Date.now();

    for (const feature of entry.payload?.stopsGeoJson?.features || []) {
      const lineKey = String(feature?.properties?.line_key || "").trim();
      const stationKey = String(feature?.properties?.station_key || "").trim();
      if (!lineKey || !stationKey) {
        continue;
      }

      const stopKey = `${lineKey}|${stationKey}`;
      if (stopByKey.has(stopKey)) {
        stopByKey.set(stopKey, mergeStopFeature(stopByKey.get(stopKey), feature));
      } else {
        stopByKey.set(stopKey, feature);
      }
    }
  }

  const stops = {
    type: "FeatureCollection",
    features: Array.from(stopByKey.values()).map(normalizeStopFeature)
  };

  // The stops layer's paint is driven by feature-state (visible/focused).
  // syncMapFeatureStates skips work when its signature is unchanged, but that
  // signature doesn't include the stop set — so invalidate it whenever the
  // stop set changes, forcing feature-state to be re-applied to new stops.
  const stopsKey = Array.from(stopByKey.keys()).sort().join("|");
  if (stopsKey !== appState.lastStopsSourceKey) {
    appState.lastStopsSourceKey = stopsKey;
    appState.lastMapFeatureStateSignature = "";
  }

  if (appState.transit) {
    appState.transit.stopsGeoJson = stops;
  }
  if (stopsSource) {
    stopsSource.setData(stops);
  }
}
