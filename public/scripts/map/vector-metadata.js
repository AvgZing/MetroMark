let vectorMetadataRebuildTimer = null;

function vectorSourceFeatures() {
  if (!appState.map || !appState.mapReady) {
    return [];
  }
  // City mode reads the persistent per-city GeoJSON so its routes stay loaded.
  if (typeof isCityGeometryMode === "function" && isCityGeometryMode()) {
    const entry = typeof cityGeometryEntry === "function" ? cityGeometryEntry(appState.activeCitySlug) : null;
    const features = entry?.featureCollection?.features;
    if (Array.isArray(features) && features.length) {
      return features;
    }
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

// Derive canonical<->member merge maps from override payloads.
function refreshRouteMergeMaps() {
  const membersByCanonical = new Map();
  const canonicalByMember = new Map();
  const overrides = appState.routeOverridesByCity instanceof Map ? appState.routeOverridesByCity : new Map();
  for (const [lineKey, override] of overrides) {
    const members = Array.isArray(override?.payload?.mergedLineKeys)
      ? override.payload.mergedLineKeys
          .map((key) => String(key || "").trim())
          .filter((key) => key && key !== lineKey)
      : [];
    if (members.length) {
      membersByCanonical.set(lineKey, members);
      for (const member of members) {
        canonicalByMember.set(member, lineKey);
      }
    }
  }
  appState.mergeMembersByCanonical = membersByCanonical;
  appState.mergeCanonicalByMember = canonicalByMember;
}

function joinMergedNames(names) {
  const parts = [];
  for (const name of names) {
    for (const piece of String(name || "").split("/")) {
      const trimmed = piece.trim();
      if (trimmed && !parts.includes(trimmed)) {
        parts.push(trimmed);
      }
    }
  }
  return parts.join(" / ");
}

function resolveCanonicalLineKey(lineKey) {
  const key = String(lineKey || "").trim();
  if (!key || !(appState.mergeCanonicalByMember instanceof Map)) {
    return key;
  }
  return appState.mergeCanonicalByMember.get(key) || key;
}

function rebuildLineMetadataFromTiles() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  refreshRouteMergeMaps();

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
    const overrideFrequencyRaw = String(overridePayload?.frequencyBucket || "").trim().toLowerCase();
    const overrideFrequency = ["frequent", "regular", "local", "unknown"].includes(overrideFrequencyRaw)
      ? overrideFrequencyRaw
      : "";
    const overrideOrdering = String(overridePayload?.orderingMode || "").trim();
    const overrideHeadwayMinutes = Number(overridePayload?.headwayBestMinutes);

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
      frequencyBucket: overrideFrequency || (hasKnownHeadway ? String(existing.frequencyBucket || "unknown").toLowerCase() : "unknown"),
      headwayBestMinutes: Number.isFinite(overrideHeadwayMinutes) && overrideHeadwayMinutes > 0
        ? overrideHeadwayMinutes
        : hasKnownHeadway && Number.isFinite(Number(existing.headwayBestMinutes))
          ? Number(existing.headwayBestMinutes)
          : null,
      headwaySource: hasKnownHeadway ? String(existing.headwaySource || "") : "",
      headwayChecked: overrideFrequency || Number.isFinite(overrideHeadwayMinutes) ? 1 : (hasKnownHeadway ? 1 : 0),
      headwayFallback: hasKnownHeadway ? Number(existing.headwayFallback || 0) : 0,
      lineViewOrderingDefaultMode: overrideOrdering || String(existing?.lineViewOrderingDefaultMode || ""),
      orderingModeDefaultSource: overrideOrdering ? "admin" : String(existing?.orderingModeDefaultSource || "")
    });
  }

  // City mode: keep the active city's routes listed after the viewport moves away.
  const activeCity = String(appState.activeCitySlug || "").trim();
  const cityKeys =
    activeCity && appState.cityRouteKeysBySlug instanceof Map
      ? appState.cityRouteKeysBySlug.get(activeCity)
      : null;
  if (activeCity && cityKeys) {
    const store = appState.cityLineSummariesBySlug instanceof Map
      ? appState.cityLineSummariesBySlug
      : new Map();
    const remembered = new Map();
    for (const line of store.get(activeCity) || []) {
      if (line?.lineKey && cityKeys.has(line.lineKey)) {
        remembered.set(line.lineKey, line);
      }
    }
    for (const line of lineByKey.values()) {
      if (cityKeys.has(line.lineKey)) {
        remembered.set(line.lineKey, line);
      }
    }
    for (const [key, line] of remembered) {
      if (!lineByKey.has(key)) {
        lineByKey.set(key, line);
      }
    }
    store.set(activeCity, Array.from(remembered.values()));
    appState.cityLineSummariesBySlug = store;
  }

  // Collapse merged routes: the canonical joins names; members hide from the list.
  for (const [canonical, members] of appState.mergeMembersByCanonical) {
    const canonicalLine = lineByKey.get(canonical);
    if (!canonicalLine) {
      continue;
    }
    const group = [canonicalLine, ...members.map((member) => lineByKey.get(member))].filter(Boolean);
    const mergedName = joinMergedNames(group.map((line) => line.lineName));
    if (mergedName) {
      canonicalLine.lineName = mergedName;
    }
    canonicalLine.mergedLineKeys = members.slice();
    for (const member of members) {
      const memberLine = lineByKey.get(member);
      if (!memberLine) {
        continue;
      }
      memberLine.mergedIntoCanonical = canonical;
      memberLine.color = canonicalLine.color;
      memberLine.operatorName = canonicalLine.operatorName || memberLine.operatorName;
      memberLine.frequencyBucket = canonicalLine.frequencyBucket || memberLine.frequencyBucket;
      memberLine.headwayBestMinutes = canonicalLine.headwayBestMinutes ?? memberLine.headwayBestMinutes;
    }
  }

  const lineSummaries = Array.from(lineByKey.values());
  const canonicalPresent = new Set();
  for (const canonical of appState.mergeMembersByCanonical.keys()) {
    if (lineByKey.has(canonical)) {
      canonicalPresent.add(canonical);
    }
  }
  appState.mergeCanonicalPresent = canonicalPresent;
  const mergeSignature = Array.from(appState.mergeMembersByCanonical.entries())
    .map(([canonical, members]) => `${canonical}>${[...members].sort().join(",")}`)
    .sort()
    .join("|");
  const signature = lineSummaries.map((line) => line.lineKey).sort().join("|") + "||" + mergeSignature;
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
  applyRouteOverridesToMap();
}

// Push route override colors (and clear stale ones) into feature-state so the
// rendered line color reflects manual edits without touching tile geometry.
function applyRouteOverridesToMap() {
  if (!appState.map || !appState.mapReady) {
    return;
  }

  const overrides = appState.routeOverridesByCity instanceof Map ? appState.routeOverridesByCity : new Map();
  const seen = new Set();
  const routeSource = typeof activeRouteSource === "function"
    ? activeRouteSource()
    : { source: "routes-vector", sourceLayer: "routes" };
  const featureStateTarget = (id) =>
    routeSource.sourceLayer
      ? { source: routeSource.source, sourceLayer: routeSource.sourceLayer, id }
      : { source: routeSource.source, id };

  for (const [lineKey, override] of overrides) {
    const color = String(override?.payload?.color || "").trim();
    if (!color) {
      continue;
    }
    seen.add(lineKey);
    try {
      appState.map.setFeatureState(featureStateTarget(lineKey), { color });
    } catch {
      // feature may not be in the current tileset
    }
  }

  // Merged members use the canonical color.
  const summaries = Array.isArray(appState.lineSummaries) ? appState.lineSummaries : [];
  const merges = appState.mergeMembersByCanonical instanceof Map ? appState.mergeMembersByCanonical : new Map();
  for (const [canonical, members] of merges) {
    const color =
      String(overrides.get(canonical)?.payload?.color || "").trim() ||
      String(summaries.find((line) => line.lineKey === canonical)?.color || "").trim();
    if (!color) {
      continue;
    }
    for (const member of members) {
      seen.add(member);
      try {
        appState.map.setFeatureState(featureStateTarget(member), { color });
      } catch {
        // member may not be in the current tileset
      }
    }
  }

  const stateCache = appState.mapRouteFeatureStateCache;
  if (stateCache instanceof Map) {
    for (const featureId of Array.from(stateCache.keys())) {
      if (seen.has(featureId)) {
        continue;
      }
      try {
        appState.map.setFeatureState(featureStateTarget(featureId), { color: null });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
