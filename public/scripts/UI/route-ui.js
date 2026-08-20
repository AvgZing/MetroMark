function normalizeModeSelection() {
  const valid = new Set(
    Array.from(appState.activeModeKeys).filter((modeKey) => MODE_DEF_BY_KEY.has(modeKey))
  );

  if (valid.has(MODE_FILTER_ALL) && valid.size > 1) {
    valid.clear();
    valid.add(MODE_FILTER_ALL);
  }

  if (!valid.size) {
    for (const key of DEFAULT_ACTIVE_MODE_KEYS) {
      valid.add(key);
    }
  }

  appState.activeModeKeys = valid;
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeModeKeys: Array.from(appState.activeModeKeys) }).catch(() => {});
  }
}

function normalizeFrequencySelection() {
  const allowed = new Set([
    FREQUENCY_FILTER_ALL,
    FREQUENCY_FILTER_FREQUENT,
    FREQUENCY_FILTER_REGULAR,
    FREQUENCY_FILTER_LOCAL,
    FREQUENCY_FILTER_UNKNOWN
  ]);

  const valid = new Set(
    Array.from(appState.activeFrequencyKeys).filter((frequencyKey) => allowed.has(frequencyKey))
  );

  if (!valid.size) {
    valid.add(FREQUENCY_FILTER_ALL);
  }

  const explicitFrequencyCount = [
    FREQUENCY_FILTER_FREQUENT,
    FREQUENCY_FILTER_REGULAR,
    FREQUENCY_FILTER_LOCAL,
    FREQUENCY_FILTER_UNKNOWN
  ].filter((key) => valid.has(key)).length;

  if (!valid.has(FREQUENCY_FILTER_ALL) && explicitFrequencyCount === 4) {
    valid.clear();
    valid.add(FREQUENCY_FILTER_ALL);
  }

  if (valid.has(FREQUENCY_FILTER_ALL) && valid.size > 1) {
    valid.clear();
    valid.add(FREQUENCY_FILTER_ALL);
  }

  appState.activeFrequencyKeys = valid;
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeFrequencyKeys: Array.from(appState.activeFrequencyKeys) }).catch(() => {});
  }
}

function normalizeManualVisibilityOverrides() {
  const normalized = new Map();

  for (const [lineKeyRaw, valueRaw] of appState.manualLineVisibility.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    const value = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (value === "on" || value === "off") {
      normalized.set(lineKey, value);
    }
  }

  appState.manualLineVisibility = normalized;
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ manualLineVisibility: Object.fromEntries(appState.manualLineVisibility) }).catch(() => {});
  }
}

function lineVisibilityOverride(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return "";
  }

  const value = String(appState.manualLineVisibility.get(normalizedLineKey) || "").trim().toLowerCase();
  return value === "on" || value === "off" ? value : "";
}

function setLineVisibilityOverride(lineKey, value) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "on" || normalizedValue === "off") {
    appState.manualLineVisibility.set(normalizedLineKey, normalizedValue);
  } else {
    appState.manualLineVisibility.delete(normalizedLineKey);
  }

  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ manualLineVisibility: Object.fromEntries(appState.manualLineVisibility) }).catch(() => {});
  }
}

function lineVisibleFromFilters(line, options = {}) {
  const ignoreMode = Boolean(options.ignoreMode);
  const ignoreFrequency = Boolean(options.ignoreFrequency);

  if (!ignoreMode && !lineMatchesModeSelection(line)) {
    return false;
  }

  if (!ignoreFrequency && !lineMatchesFrequencySelection(line)) {
    return false;
  }

  return true;
}

function lineIntersectsCurrentViewport(line) {
  const lineKey = String(line?.lineKey || "").trim();
  if (!lineKey) {
    return false;
  }

  const features = Array.isArray(appState.transit?.routesGeoJson?.features)
    ? appState.transit.routesGeoJson.features
    : [];
  const routeFeature = features.find((feature) => String(feature?.properties?.line_key || "").trim() === lineKey);
  if (!routeFeature) {
    return false;
  }

  const viewportBbox = typeof normalizeBboxArray === "function" ? normalizeBboxArray(appState.currentViewportBbox) : null;
  if (!viewportBbox || typeof geometryIntersectsBbox !== "function") {
    return true;
  }

  return geometryIntersectsBbox(routeFeature.geometry, viewportBbox);
}

function lineIsVisible(line, options = {}) {
  const override = lineVisibilityOverride(line?.lineKey);
  if (override === "off") {
    return false;
  }

  // Manual "on" override forces visibility regardless of viewport, reviews,
  // or filters — so it renders on the map and counts everywhere consistently.
  if (override === "on") {
    return true;
  }

  if (!lineIntersectsCurrentViewport(line)) {
    return false;
  }

  // Check problematic geometry review
  if (!appState.showProblematicGeometries && line?.lineKey) {
    const routeReview = appState.routeReviewsByCity.get(line.lineKey);
    if (routeReview?.problematic_override === true) {
      return false;
    }
  }

  // Check operator allow/deny review
  if (!appState.showPrivateOperators && line?.operatorName) {
    const agencyReview = appState.agencyReviewsByCity.get(line.operatorName);
    if (agencyReview?.allowed_override === false) {
      return false;
    }
  }

  return lineVisibleFromFilters(line, options);
}

function lineMatchesModeSelection(line) {
  if (appState.activeModeKeys.has(MODE_FILTER_ALL)) {
    return true;
  }

  return appState.activeModeKeys.has(lineModeKey(line));
}

function lineMatchesFrequencySelection(line) {
  if (appState.activeFrequencyKeys.has(FREQUENCY_FILTER_ALL)) {
    return true;
  }

  return appState.activeFrequencyKeys.has(lineFrequencyBucket(line));
}
// Interlining offset calculation - DISABLED
// This was used for rendering interlined routes with visual offset,
// but it wasn't working well. Abandoned in favor of letting overlapping
// lines stack naturally on the map.
/*
function hashLineKeyOffset(lineKey, totalLines = 1) {
  const normalized = String(lineKey || "").trim();
  if (!normalized || Number(totalLines || 0) <= 1) {
    return 0;
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }

  const spread = Math.min(4, Math.max(1, Math.floor(Number(totalLines) / 3)));
  const span = spread * 2 + 1;
  const bucket = Math.abs(hash) % span;
  return bucket - spread;
}
*/
