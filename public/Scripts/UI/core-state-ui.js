function normalizeModeSelection() {
  const valid = new Set(
    Array.from(state.activeModeKeys).filter((modeKey) => MODE_DEF_BY_KEY.has(modeKey))
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

  state.activeModeKeys = valid;
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeModeKeys: Array.from(state.activeModeKeys) }).catch(() => {});
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
    Array.from(state.activeFrequencyKeys).filter((frequencyKey) => allowed.has(frequencyKey))
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

  state.activeFrequencyKeys = valid;
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeFrequencyKeys: Array.from(state.activeFrequencyKeys) }).catch(() => {});
  }
}

function normalizeManualVisibilityOverrides() {
  const normalized = new Map();

  for (const [lineKeyRaw, valueRaw] of state.manualLineVisibility.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    const value = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (value === "on" || value === "off") {
      normalized.set(lineKey, value);
    }
  }

  state.manualLineVisibility = normalized;
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ manualLineVisibility: Object.fromEntries(state.manualLineVisibility) }).catch(() => {});
  }
}

function lineVisibilityOverride(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return "";
  }

  const value = String(state.manualLineVisibility.get(normalizedLineKey) || "").trim().toLowerCase();
  return value === "on" || value === "off" ? value : "";
}

function setLineVisibilityOverride(lineKey, value) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "on" || normalizedValue === "off") {
    state.manualLineVisibility.set(normalizedLineKey, normalizedValue);
  } else {
    state.manualLineVisibility.delete(normalizedLineKey);
  }

  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ manualLineVisibility: Object.fromEntries(state.manualLineVisibility) }).catch(() => {});
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
  const viewportBbox = normalizeBboxArray(state.currentViewportBbox);
  if (!viewportBbox) {
    return true;
  }

  const lineKey = String(line?.lineKey || "").trim();
  if (!lineKey) {
    return false;
  }

  const features = [
    ...(Array.isArray(state.transit?.routesGeoJson?.features) ? state.transit.routesGeoJson.features : []),
    ...(Array.isArray(state.viewportSummaryTransit?.routesGeoJson?.features)
      ? state.viewportSummaryTransit.routesGeoJson.features
      : [])
  ];
  if (!features.length) {
    return false;
  }

  const routeFeature = features.find((feature) => String(feature?.properties?.line_key || "").trim() === lineKey);
  if (!routeFeature || typeof geometryIntersectsBbox !== "function") {
    return false;
  }

  return geometryIntersectsBbox(routeFeature.geometry, viewportBbox);
}

function lineIsVisible(line, options = {}) {
  const override = lineVisibilityOverride(line?.lineKey);
  if (override === "off") {
    return false;
  }

  if (!lineIntersectsCurrentViewport(line)) {
    return false;
  }

  if (override === "on") {
    return true;
  }

  // Check problematic geometry review
  if (!state.showProblematicGeometries && line?.lineKey) {
    const routeReview = state.routeReviewsByCity.get(line.lineKey);
    if (routeReview?.problematic_override === true) {
      return false;
    }
  }

  // Check operator allow/deny review
  if (!state.showPrivateOperators && line?.operatorName) {
    const agencyReview = state.agencyReviewsByCity.get(line.operatorName);
    if (agencyReview?.allowed_override === false) {
      return false;
    }
  }

  return lineVisibleFromFilters(line, options);
}

function selectedRouteTypesForFetch() {
  // If the user has selected the special "all" mode, fetch everything.
  if (state.activeModeKeys.has(MODE_FILTER_ALL)) {
    return [];
  }

  const types = new Set();
  for (const key of Array.from(state.activeModeKeys)) {
    const def = MODE_DEF_BY_KEY.get(key);
    if (def && Array.isArray(def.routeTypes)) {
      def.routeTypes.forEach((t) => types.add(t));
    }
  }

  return Array.from(types);
}

function modeCacheKeyFromRouteTypes(routeTypes) {
  const normalized = Array.isArray(routeTypes) ? routeTypes : [];
  return normalized.length ? normalized.join("-") : "all";
}

function viewportRequestsForMode(rawBbox, zoom, routeTypes) {
  const modeKey = modeCacheKeyFromRouteTypes(routeTypes);
  const primary = buildViewportTileRequests(rawBbox, zoom);
  const coarse = zoom >= 8 ? buildViewportTileRequests(rawBbox, zoom - 3) : [];
  const fine = zoom >= 2 ? buildViewportTileRequests(rawBbox, zoom + 3) : [];
  const seen = new Set();
  const merged = [];
  const push = (reqs) => {
    for (const req of reqs) {
      const key = `${req.areaKey}:types:${modeKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...req,
        routeTypes: Array.isArray(routeTypes) ? routeTypes : [],
        areaKey: key
      });
    }
  };
  push(primary);
  push(coarse);
  push(fine);
  // Always include detail-level tiles around the center to capture data cached at closer zooms
  if (zoom >= 3) {
    const center = bboxCenter(rawBbox);
    const detailZoom = 9;
    const ct = lngLatToTile(center[0], center[1], detailZoom);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const x = ct.x + dx;
        const y = ct.y + dy;
        const tileBbox = tileToBbox(x, y, detailZoom);
        const key = `tile:${detailZoom}:${x}:${y}:types:${modeKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({
          areaKey: key,
          bbox: tileBbox,
          zoom,
          distanceScore: Math.abs(dx) + Math.abs(dy),
          routeTypes: Array.isArray(routeTypes) ? routeTypes : []
        });
      }
    }
  }
  return merged;
}

function lineMatchesModeSelection(line) {
  if (state.activeModeKeys.has(MODE_FILTER_ALL)) {
    return true;
  }

  return state.activeModeKeys.has(lineModeKey(line));
}

function lineMatchesFrequencySelection(line) {
  if (state.activeFrequencyKeys.has(FREQUENCY_FILTER_ALL)) {
    return true;
  }

  return state.activeFrequencyKeys.has(lineFrequencyBucket(line));
}
function canFetchViewportRoutes() {
  if (!state.mapReady || !state.map) {
    return false;
  }

  // Always allow viewport fetches at any zoom level; server will decide
  // whether to return cached Postgres payloads or to fallback to Transitland.
  return true;
}

function areFilterCountsUncertain() {
  if (!canFetchViewportRoutes()) {
    return false;
  }

  if (
    (Array.isArray(state.loadedLineSummaries) && state.loadedLineSummaries.length > 0) ||
    (Array.isArray(state.lineSummaries) && state.lineSummaries.length > 0)
  ) {
    return false;
  }

  return (
    state.inFlightAreaKeys.size > 0 ||
    state.fetchQueue.length > 0 ||
    Number(state.lastLoadStats?.deferred || 0) > 0
  );
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


function lineFromPropertiesForHover(properties) {
  const lineKey = String(properties?.line_key || properties?.lineKey || "").trim();
  if (lineKey) {
    const fromSummary = state.lineSummaries.find((entry) => entry.lineKey === lineKey);
    if (fromSummary) {
      return fromSummary;
    }
  }

  return lineLikeFromFeatureProperties(properties);
}

function stopHoverHtml(properties) {
  const lineLabel = [properties.line_short_name, properties.line_long_name || properties.line_name]
    .filter(Boolean)
    .join(" | ");

  const line = lineFromPropertiesForHover(properties);
  const operatorLabel = lineOperatorLabel(line);
  const modeLabel = lineMode(line);
  const hubCount = Math.max(1, Number(properties.hub_member_count || 1));
  const visited = Number(properties.visited) === 1;
  const progressLabel = state.user
    ? visited
      ? "Visited"
      : "Not visited"
    : "Sign in to track progress";

  return `
    <div class="station-hover">
      <h4>${escapeHtml(properties.station_name || "Unnamed Station")}</h4>
      <p class="hover-subtitle">${escapeHtml(
        lineLabel || properties.line_name || properties.line_key || "Route details"
      )}</p>
      <dl class="hover-grid">
        <dt>Mode</dt>
        <dd>${escapeHtml(modeLabel)}</dd>
        <dt>Operator</dt>
        <dd>${escapeHtml(operatorLabel)}</dd>
        <dt>Frequency</dt>
        <dd>${escapeHtml(lineHeadwayLabel(line))}</dd>
        <dt>Stop Type</dt>
        <dd>${escapeHtml(stopLocationTypeLabel(properties.stop_location_type))}</dd>
        <dt>Hub</dt>
        <dd>${hubCount} linked stops</dd>
        <dt>Status</dt>
        <dd>${escapeHtml(progressLabel)}</dd>
      </dl>
    </div>
  `;
}

function lineHoverHtml(lines, totalLineCount = lines.length) {
  const rows = lines
    .map(
      (line) =>
        `<li class="hover-route-row">
          <p class="hover-route-name">${escapeHtml(lineDisplayName(line))}</p>
          <p class="hover-route-meta">${escapeHtml(lineMode(line))} | ${escapeHtml(
          lineOperatorLabel(line)
        )} | ${escapeHtml(lineHeadwayLabel(line))}${
          Number(line.stopCount || 0) > 0 ? ` | ${Number(line.stopCount)} stops` : ""
        }</p>
        </li>`
    )
    .join("");

  const hiddenCount = Math.max(0, Number(totalLineCount || 0) - lines.length);

  return `
    <div class="station-hover">
      <h4>Routes Under Cursor</h4>
      <p class="hover-subtitle">${
        totalLineCount > 1
          ? "Interlined segment. Tap/click to pick a route."
          : "Tap/click to focus this route."
      }</p>
      <ul class="hover-route-list">${rows || "<li class=\"hover-route-row\">No route details available.</li>"}</ul>
      ${
        hiddenCount > 0
          ? `<p class="hover-subtitle">+${hiddenCount} more route${hiddenCount === 1 ? "" : "s"} at this location</p>`
          : ""
      }
    </div>
  `;
}

function routeSelectionPopupHtml(lines, options = {}) {
  const includeClose = Boolean(options.includeClose);
  const rows = lines
    .map(
      (line) =>
        `<button class="route-select-btn" type="button" data-route-select="${escapeHtml(
          line.lineKey
        )}">
          <span class="route-select-name">${escapeHtml(lineDisplayName(line))}</span>
          <span class="route-select-meta">${escapeHtml(lineMode(line))} | ${escapeHtml(
          lineOperatorLabel(line)
        )} | ${escapeHtml(lineHeadwayLabel(line))}</span>
        </button>`
    )
    .join("");

  return `
    <div class="station-hover route-select-popup">
      <div class="route-select-header">
        <h4>Select Route</h4>
        ${
          includeClose
            ? "<button class=\"route-select-close\" type=\"button\" data-route-select-close>Close</button>"
            : ""
        }
      </div>
      <p class="hover-subtitle">${lines.length} routes overlap here.</p>
      <div class="route-select-list">${rows}</div>
    </div>
  `;
}

function closeRouteSelectionPopup() {
  if (state.routeSelectPopup) {
    state.routeSelectPopup.remove();
  }

  if (els.routeSelectPanel) {
    els.routeSelectPanel.hidden = true;
    els.routeSelectPanel.innerHTML = "";
  }
}

function bindRouteSelectionButtons(container) {
  if (!container) {
    return;
  }

  const buttons = container.querySelectorAll("[data-route-select]");
  buttons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const lineKey = String(button.getAttribute("data-route-select") || "").trim();
      if (!lineKey) {
        return;
      }

      closeRouteSelectionPopup();
      setFocusedLine(lineKey).catch((error) => {
        setStatus(error.message, "error");
      });
    });
  });

  const closeButton = container.querySelector("[data-route-select-close]");
  if (closeButton) {
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      closeRouteSelectionPopup();
    });
  }
}

function openRouteSelectionPopup(lines, lngLat) {
  if (isPortraitMobileLayout() && els.routeSelectPanel) {
    closeRouteSelectionPopup();
    els.routeSelectPanel.hidden = false;
    els.routeSelectPanel.innerHTML = routeSelectionPopupHtml(lines, { includeClose: true });
    bindRouteSelectionButtons(els.routeSelectPanel);
    return;
  }

  if (!state.routeSelectPopup || !state.map) {
    return;
  }

  closeRouteSelectionPopup();
  state.routeSelectPopup.setLngLat(lngLat).setHTML(routeSelectionPopupHtml(lines)).addTo(state.map);

  const popupElement = state.routeSelectPopup.getElement();
  if (!popupElement) {
    return;
  }

  bindRouteSelectionButtons(popupElement);
}
