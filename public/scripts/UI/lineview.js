/** Render the ordered stop list for a line inside the line view panel. */
function orderByCustomStopKeys(stopFeatures, customStops, lineKey = "") {
  const byKey = new Map();
  for (const feature of stopFeatures || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (key) {
      byKey.set(key, feature);
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const stop of customStops || []) {
    const key = String(stop?.key || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const feature = byKey.get(key);
    if (feature) {
      ordered.push(feature);
      continue;
    }
    // A stop the admin added manually (no live Transitland feature) — render it
    // from the override coordinates so the custom order is complete.
    const lat = Number(stop?.lat);
    const lon = Number(stop?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    ordered.push({
      type: "Feature",
      id: `${lineKey}|${key}`,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        station_key: key,
        station_name: String(stop?.name || key),
        line_key: lineKey,
        custom_stop: 1
      }
    });
  }

  for (const feature of stopFeatures || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (!seen.has(key)) {
      ordered.push(feature);
    }
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Branch-tagged override stop orders
//
// payload.stops entries may carry `branch: <option id>`; payload.branchGroups
// is [{ id, label, options: [{ id, label }] }]. A group is a split point where
// the user swaps between alternative stop runs. Stops with no branch tag are
// trunk and always shown; a selected option's stops appear at their position in
// the flat order. The line view stays a single diagram with split markers.
// ---------------------------------------------------------------------------

var LINE_VIEW_BRANCH_SELECTION_STORAGE_KEY = "metromark_line_view_branch_selections";

function loadBranchSelectionsFromStorage() {
  const map = new Map();
  try {
    const raw = localStorage.getItem(LINE_VIEW_BRANCH_SELECTION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    for (const [lineKey, selection] of Object.entries(parsed || {})) {
      if (selection && typeof selection === "object") {
        map.set(lineKey, { ...selection });
      }
    }
  } catch {
    // storage unavailable — start empty
  }
  return map;
}

function persistBranchSelections(map) {
  try {
    const obj = {};
    for (const [lineKey, selection] of map) {
      obj[lineKey] = selection;
    }
    localStorage.setItem(LINE_VIEW_BRANCH_SELECTION_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // best-effort
  }
}

function branchSelectionsMap() {
  if (!(appState.lineViewBranchSelectionsByLineKey instanceof Map)) {
    appState.lineViewBranchSelectionsByLineKey = loadBranchSelectionsFromStorage();
  }
  return appState.lineViewBranchSelectionsByLineKey;
}

function branchSelectionForLine(lineKey) {
  return branchSelectionsMap().get(String(lineKey || "").trim()) || {};
}

function setBranchOptionForLine(lineKey, groupId, optionId) {
  const normalizedLineKey = String(lineKey || "").trim();
  const map = branchSelectionsMap();
  const next = { ...(map.get(normalizedLineKey) || {}), [String(groupId)]: String(optionId) };
  map.set(normalizedLineKey, next);
  persistBranchSelections(map);
  return next;
}

/** Resolve the branch selection and return the filtered stop order + split labels. */
function resolveBranchStops(customStops, branchGroups, selection) {
  const groups = Array.isArray(branchGroups) ? branchGroups : [];
  const stops = Array.isArray(customStops) ? customStops : [];
  if (!groups.length) {
    return { stops, splitLabels: new Map(), hasBranches: false };
  }

  const optionById = new Map();
  for (const group of groups) {
    for (const option of group.options || []) {
      if (option?.id) {
        optionById.set(String(option.id), { group, option });
      }
    }
  }

  const chosen = {};
  for (const group of groups) {
    const first = String(group.options?.[0]?.id || "");
    const selected = String(selection?.[group.id] || "");
    chosen[group.id] = optionById.has(selected) ? selected : first;
  }

  const filtered = [];
  const splitLabels = new Map();
  const seenSplit = new Set();
  for (const stop of stops) {
    const branchId = String(stop?.branch || "").trim();
    if (branchId) {
      const meta = optionById.get(branchId);
      if (!meta || chosen[meta.group.id] !== branchId) {
        continue;
      }
      const key = String(stop?.key || "").trim();
      if (key && !seenSplit.has(meta.group.id)) {
        seenSplit.add(meta.group.id);
        splitLabels.set(key, String(meta.option.label || meta.group.label || "Branch"));
      }
    }
    filtered.push(stop);
  }

  return { stops: filtered, splitLabels, hasBranches: true };
}

function renderLineViewBranchSelector(lineKey, branchGroups) {
  const el = document.getElementById("lineViewBranchSelector");
  if (!el) {
    return;
  }
  const groups = Array.isArray(branchGroups) ? branchGroups : [];
  el.innerHTML = "";
  if (!groups.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const selection = branchSelectionForLine(lineKey);
  for (const group of groups) {
    const wrap = document.createElement("div");
    wrap.className = "branch-selector-group";
    const label = document.createElement("span");
    label.className = "branch-selector-label";
    label.textContent = String(group.label || "Branch");
    wrap.append(label);

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "branch-selector-options";
    const activeOption = String(selection?.[group.id] || group.options?.[0]?.id || "");
    for (const option of group.options || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "branch-selector-btn";
      const isActive = String(option.id) === activeOption;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.textContent = String(option.label || option.id);
      button.addEventListener("click", () => {
        setBranchOptionForLine(lineKey, group.id, option.id);
        if (typeof renderLineView === "function") {
          renderLineView({ forceStopRefresh: true });
        }
      });
      optionsWrap.append(button);
    }
    wrap.append(optionsWrap);
    el.append(wrap);
  }
}

// Orders/renders are async, and openLineView can fire several for the same
// line while stops load. Without a token, two overlapping renders each clear
// (before the await) then append, stacking duplicate rows. Only the newest
// render is allowed to write.
let lineViewStopsRenderToken = 0;

async function renderLineViewStops(lineKey, lineColor, options = {}) {
  if (!dom.lineViewStops) {
    return;
  }
  dom.lineViewStops.style.setProperty("--line-color", lineColor || "#177ca2");

  const cacheKey = routeStopCacheKey(lineKey);
  const isLoading = appState.inFlightLineStopKeys.has(cacheKey);
  const sameLine = String(dom.lineViewStops.dataset.lineKey || "") === String(lineKey || "");
  const stopFeatures = uniqueStopFeaturesForLine(lineKey);
  const hasRenderedStopRows = !!dom.lineViewStops.querySelector('.line-view-stop-row');
  const forceRefresh = Boolean(options?.forceRefresh);

  syncLineViewOrderingControls();

  if (!stopFeatures.length) {
    if (isLoading && sameLine && hasRenderedStopRows) {
      return;
    }

    dom.lineViewStops.innerHTML = "";
    dom.lineViewStops.dataset.lineKey = String(lineKey || "");
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = isLoading ? "Loading stops..." : "Stops are not loaded yet.";
    dom.lineViewStops.append(empty);
    return;
  }

  if (isLoading && sameLine && hasRenderedStopRows && !forceRefresh) {
    return;
  }

  if (forceRefresh || String(dom.lineViewStops.dataset.lineKey || "") !== String(lineKey || "") || !hasRenderedStopRows) {
    dom.lineViewStops.innerHTML = "";
    dom.lineViewStops.dataset.lineKey = String(lineKey || "");
  } else {
    return;
  }

  // Committed to rendering this call; claim the newest token. Any older
  // in-flight render will see a stale token after its await and bail.
  const renderToken = ++lineViewStopsRenderToken;

  const visitedSet = getVisitedSetForLine(lineKey);

  // Get direction sequences from cache payload if available
  const cacheEntry = appState.lineStopsCache.get(routeStopCacheKey(lineKey));
  const line = appState.lineSummaries.find((entry) => entry.lineKey === lineKey);
  const routeLookupKey = String(line?.routeOnestopId || lineKey || "").trim();
  const directionSequences = cacheEntry?.payload?.directionStopSequences || null;
  const directionPatterns = cacheEntry?.payload?.directionStopPatterns || directionSequences?.patterns || null;
  const orderingMode = String(
    options?.orderingMode ||
    appState.lineViewOrderingMode ||
    'geometry-revised'
  ).trim() || 'geometry-revised';

  syncLineViewOrderingControls();

  // If an admin set a custom stop order for this route, apply it directly
  // (matching by station key, then appending any unmatched stops).
  const routeOverride = appState.routeOverridesByCity instanceof Map
    ? appState.routeOverridesByCity.get(lineKey)
    : null;
  const rawCustomStops = Array.isArray(routeOverride?.payload?.stops) && routeOverride.payload.stops.length
    ? routeOverride.payload.stops
    : null;
  const branchGroups = Array.isArray(routeOverride?.payload?.branchGroups)
    ? routeOverride.payload.branchGroups
    : [];
  let customStops = rawCustomStops;
  let splitLabels = new Map();
  if (rawCustomStops) {
    const resolved = resolveBranchStops(rawCustomStops, branchGroups, branchSelectionForLine(lineKey));
    customStops = resolved.stops;
    splitLabels = resolved.splitLabels;
  }

  const featuresToRender = customStops
    ? orderByCustomStopKeys(stopFeatures, customStops, lineKey)
    : await orderStopsForLineView(
        stopFeatures,
        lineKey,
        directionSequences,
        orderingMode,
        routeLookupKey,
        null,
        directionPatterns
      );

  if (splitLabels.size) {
    for (const feature of featuresToRender) {
      const key = String(feature?.properties?.station_key || "").trim();
      if (splitLabels.has(key)) {
        feature.properties.branch_split_label = splitLabels.get(key);
      }
    }
  }

  // When a maintainer has set the order manually, hide the algorithm picker but
  // keep Reverse; show the explainer instead.
  const diagnosticsEl = document.getElementById("lineViewDiagnostics");
  if (diagnosticsEl) {
    diagnosticsEl.classList.toggle("is-admin-order", Boolean(customStops));
  }
  renderLineViewBranchSelector(lineKey, customStops ? branchGroups : []);

  if (appState.lineViewOrderingReversed) {
    featuresToRender.reverse();
  }

  // Only the latest render writes, and it clears right before appending so an
  // interleaved older render can never stack rows.
  if (renderToken !== lineViewStopsRenderToken) {
    return;
  }
  dom.lineViewStops.innerHTML = "";
  dom.lineViewStops.dataset.lineKey = String(lineKey || "");

  syncLineViewOrderingControls();

  featuresToRender.forEach((feature, index) => {
    const props = feature?.properties || {};
    const stationName = String(props.station_name || props.stop_name || "Unnamed Station");
    const stationKey = stopKeyForFeature(feature);
    const coords = feature?.geometry?.coordinates;
    const visited = stationKey && visitedSet.has(stationKey);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "line-view-stop-row";
    row.dataset.stationKey = stationKey || "";
    if (index === 0) {
      row.classList.add("is-first");
    }
    if (index === featuresToRender.length - 1) {
      row.classList.add("is-last");
    }
    if (visited) {
      row.classList.add("is-visited");
    }

    if (!appState.user) {
      row.disabled = true;
    }

    const marker = document.createElement("div");
    marker.className = "line-view-stop-marker";

    const dot = document.createElement("span");
    dot.className = "line-view-stop-dot";
    dot.style.backgroundColor = typeof stopFillForVisited === "function"
      ? stopFillForVisited(visited)
      : visited
        ? "#1a9b66"
        : "#ffffff";
    marker.append(dot);

    const content = document.createElement("div");

    const name = document.createElement("p");
    name.className = "line-view-stop-name";
    name.textContent = stationName;

    const status = document.createElement("p");
    status.className = "line-view-stop-status";
    status.textContent = appState.user
      ? visited
        ? "Visited"
        : "Not visited"
      : "Sign in to track";

    content.append(name, status);
    if (String(props.branch_split_label || "").trim()) {
      row.classList.add("is-branch-split");
      const branchLabel = document.createElement("p");
      branchLabel.className = "line-view-stop-branch";
      branchLabel.textContent = `Branches to ${String(props.branch_split_label).trim()}`;
      content.prepend(branchLabel);
    }
    row.append(marker, content);

    if (appState.user) {
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleVisitedForStation(props, coords);
        noteLineViewOrderingVoteClick(lineKey, stationKey);
      });
    }

    dom.lineViewStops.append(row);
  });

  createLineConnector(lineColor);
}

/** Render or update the line view panel with the focused line's metadata and progress. */
function setLineViewEmptyState() {
  if (dom.lineViewPanel) {
    dom.lineViewPanel.classList.add("is-empty");
  }
  if (dom.lineViewName) {
    dom.lineViewName.textContent = "Select a route";
  }
  if (dom.lineViewMeta) {
    dom.lineViewMeta.textContent = "Tap a route on the map to see stops and progress.";
  }
  if (dom.lineViewColor) {
    dom.lineViewColor.style.backgroundColor = "transparent";
  }
  const emptyFacts = document.getElementById("lineViewFacts");
  if (emptyFacts) {
    emptyFacts.innerHTML = "";
    emptyFacts.hidden = true;
  }
  if (dom.lineViewStatus) {
    dom.lineViewStatus.hidden = true;
  }
  if (dom.lineViewProgress) {
    dom.lineViewProgress.hidden = true;
  }
  if (dom.lineViewDiagnostics) {
    dom.lineViewDiagnostics.hidden = true;
  }
  const statusCard = document.querySelector(".line-view-card .user-status-card");
  if (statusCard) {
    statusCard.hidden = true;
  }
  if (dom.lineViewStops) {
    dom.lineViewStops.innerHTML = "";
    const ordered = typeof getShownLines === "function"
      ? getShownLines({ ignoreSearch: true })
      : (Array.isArray(appState.lineSummaries) ? appState.lineSummaries : []);
    const lines = ordered.slice(0, 60);
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sheet-route-item";
      const dot = document.createElement("span");
      dot.className = "line-color-dot";
      dot.style.backgroundColor = line.color || "#177ca2";
      const name = document.createElement("span");
      name.textContent = typeof lineDisplayName === "function" ? lineDisplayName(line) : line.lineKey;
      button.append(dot, name);
      button.addEventListener("click", () => {
        if (typeof openLineView === "function") {
          openLineView(line.lineKey, { zoom: true });
        }
      });
      fragment.appendChild(button);
    }
    dom.lineViewStops.appendChild(fragment);
  }
  document.body.classList.remove("route-selected");
  if (typeof window.setMobileSheetState === "function") {
    window.setMobileSheetState("peek");
  }
}

function renderLineView(options = {}) {
  if (!dom.lineViewPanel) {
    return;
  }

  if (!appState.lineViewOpen) {
    if (isPortraitMobileLayout()) {
      appState.lineViewOpen = true;
      dom.lineViewPanel.hidden = false;
      document.body.classList.add("line-view-open");
      setLineViewEmptyState();
      return;
    }
    dom.lineViewPanel.hidden = true;
    return;
  }

  const lineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
  if (!lineKey) {
    if (isPortraitMobileLayout() && dom.lineViewPanel) {
      dom.lineViewPanel.hidden = false;
      document.body.classList.add("line-view-open");
      setLineViewEmptyState();
    } else if (dom.lineViewPanel) {
      dom.lineViewPanel.hidden = true;
    }
    return;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === lineKey);
  const lineColor = line?.color || "#177ca2";
  const lineLabel = line ? lineDisplayName(line) : "Selected Route";
  const forceStopRefresh = Boolean(options?.forceStopRefresh);

  applyLineViewOrderingPreference(lineKey);

  // Ensure panel is visible and not hidden
  if (dom.lineViewPanel) {
    dom.lineViewPanel.hidden = false;
    dom.lineViewPanel.removeAttribute("hidden");
  }
  const statusCard = document.querySelector(".line-view-card .user-status-card");
  if (statusCard) {
    statusCard.hidden = false;
  }
  if (dom.lineViewDiagnostics) {
    dom.lineViewDiagnostics.hidden = false;
  }
  if (dom.lineViewPanel) {
    dom.lineViewPanel.classList.remove("is-empty");
  }
  if (isPortraitMobileLayout()) {
    document.body.classList.add("route-selected");
    if (typeof window.setMobileSheetState === "function") {
      window.setMobileSheetState(appState.lineViewPeekPinned ? "peek" : "half");
    }
  }

  if (dom.lineViewColor) {
    dom.lineViewColor.style.backgroundColor = lineColor;
  }

  if (dom.lineViewName) {
    dom.lineViewName.textContent = lineLabel;
  }

  if (dom.lineViewMeta) {
    dom.lineViewMeta.textContent = line
      ? `${lineMode(line)} · ${lineOperatorLabel(line)}`
      : "Route details";
    dom.lineViewMeta.hidden = false;
  }

  const progress = line ? lineProgressMetrics(lineKey, Number(line.stopCount || 0)) : null;
  const showProgress = Boolean(appState.user) && Boolean(progress) && Number(progress?.total || 0) > 0;
  const fullStopsLoaded = appState.lineStopsCache.has(routeStopCacheKey(lineKey));
  const hasStopTotals = Number(line?.stopCount || 0) > 0;
  const stopsLoaded = fullStopsLoaded || hasStopTotals;
  const stopsLoading = appState.inFlightLineStopKeys.has(routeStopCacheKey(lineKey));

  if (dom.lineViewStatus) {
    if (!stopsLoaded && stopsLoading) {
      dom.lineViewStatus.textContent = "Loading stops…";
      dom.lineViewStatus.hidden = false;
    } else if (!stopsLoaded) {
      dom.lineViewStatus.textContent = "Tap to load stops";
      dom.lineViewStatus.hidden = false;
    } else {
      dom.lineViewStatus.textContent = "";
      dom.lineViewStatus.hidden = true;
    }
  }

  if (dom.lineViewProgress && dom.lineViewProgressText && dom.lineViewProgressFill) {
    const hasProgress = showProgress;
    const forceBar = isPortraitMobileLayout();
    if (hasProgress || forceBar) {
      const visited = Number(progress?.visited || 0);
      const total = Number(progress?.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      dom.lineViewProgress.hidden = false;
      dom.lineViewProgressText.textContent = hasProgress ? `${visited}/${total} stations visited (${percent}%)` : "";
      dom.lineViewProgressFill.style.width = `${percent}%`;
    } else {
      dom.lineViewProgress.hidden = true;
      dom.lineViewProgressText.textContent = "";
      dom.lineViewProgressFill.style.width = "0%";
    }
  }

  // Update button labels based on layout
  const isMobileLayout = isPortraitMobileLayout();
  if (dom.lineViewReturnBtn) {
    if (isMobileLayout) {
      dom.lineViewReturnBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>';
      dom.lineViewReturnBtn.setAttribute("aria-label", "Deselect route");
    } else {
      dom.lineViewReturnBtn.textContent = "Back";
    }
    dom.lineViewReturnBtn.classList.toggle("mobile-icon-only", isMobileLayout);
  }
  if (dom.lineViewMapBtn) {
    dom.lineViewMapBtn.textContent = "Zoom";
  }

  const facts = document.getElementById("lineViewFacts");
  if (facts) {
    facts.innerHTML = "";
    // Subheader carries mode/operator and the progress bar the stop count, so
    // the facts row is only the headway.
    const headway = typeof lineHeadwayLabel === "function" ? lineHeadwayLabel(line) : "";
    if (!headway) {
      facts.hidden = true;
    } else {
      facts.hidden = false;
      const item = document.createElement("span");
      item.className = "line-view-fact";
      item.textContent = headway;
      facts.appendChild(item);
    }
  }

  // renderLineViewStops will manage dataset.lineKey itself to detect line changes
  renderLineViewStops(lineKey, lineColor, { forceRefresh: forceStopRefresh }).catch(() => {});
}

/** Open the line view panel for a given line, saving prior map/focus state for restoration.
    Pass { zoom: true } when the selection came from a list so the map frames the route. */
async function openLineView(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  if (!appState.lineViewOpen) {
    appState.lineViewReturn = {
      focusedLineKey: appState.focusedLineKey,
      mapView: captureMapView(),
      mobilePanelsOpen: appState.mobilePanelsOpen,
      activePopup: appState.activePopup
    };
  }

  appState.lineViewOpen = true;
  appState.lineViewLineKey = normalizedLineKey;
  appState.lineViewPeekPinned = false;
  document.body.classList.toggle("line-view-open", true);
  closeRouteSelectionPopup();

  if (document.body.classList.contains("filters-panel-open") && typeof window.setFiltersPanelOpen === "function") {
    window.setFiltersPanelOpen(false);
  }

  if (isPortraitMobileLayout() && typeof window.resetMobileSheet === "function") {
    window.resetMobileSheet();
  }

  if (isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
  }

  if (normalizedLineKey !== appState.focusedLineKey) {
    setFocusedLine(normalizedLineKey, { forceRefresh: false }).catch((error) => {
      setStatus(error.message, "error");
    });
  }

  renderLineView();
  renderUserStatus();

  if (options.zoom && typeof fitMapToLine === "function") {
    fitMapToLine(normalizedLineKey);
  }

  await Promise.all([
    ensureLineStopsLoaded(normalizedLineKey, { silent: true }),
    ensureLineHeadwayLoaded(normalizedLineKey, { forceRefresh: false, silent: true })
  ]).catch(() => {});

  renderLineView();
}

function restoreLineViewReturnState() {
  const saved = appState.lineViewReturn;
  if (!saved) {
    return;
  }

  // Only restore the map view if the user hasn't moved the map since opening
  // line view. If they panned elsewhere, preserve their new location.
  if (saved.mapView && typeof mapViewChanged === "function" && !mapViewChanged(saved.mapView)) {
    restoreMapView(saved.mapView);
  }

  if (saved.focusedLineKey) {
    setFocusedLine(saved.focusedLineKey, { forceRefresh: false }).catch((error) => {
      setStatus(error.message, "error");
    });
  } else if (appState.focusedLineKey) {
    clearFocusedLine("Route focus cleared.", "Returning to previous view.");
  }

  if (saved.activePopup) {
    setActivePopup(saved.activePopup);
  } else {
    closePopups();
  }

  if (saved.mobilePanelsOpen && isPortraitMobileLayout()) {
    setMobilePanelsOpen(true);
  }
}

/** Close the line view. Per the unified status/line-view model, closing always
    unselects the current route. */
function closeLineView(options = {}) {
  if (closeLineView._closing) {
    return;
  }
  closeLineView._closing = true;
  const shouldRestore = options.restore !== false;

  appState.lineViewOpen = false;
  appState.lineViewLineKey = "";
  document.body.classList.toggle("line-view-open", false);

  if (dom.lineViewPanel) {
    const panel = dom.lineViewPanel;
    if (isPortraitMobileLayout()) {
      panel.hidden = false;
      document.body.classList.add("line-view-open");
      if (typeof renderLineView === "function") {
        renderLineView("");
      }
    } else if (!panel.hidden) {
      panel.classList.add("line-view-closing");
      window.setTimeout(() => {
        panel.classList.remove("line-view-closing");
        panel.hidden = true;
      }, 200);
    } else {
      panel.hidden = true;
    }
  }

  if (shouldRestore) {
    const saved = appState.lineViewReturn;
    if (saved && saved.mapView && typeof mapViewChanged === "function" && !mapViewChanged(saved.mapView)) {
      restoreMapView(saved.mapView);
    }
  }

  appState.lineViewReturn = null;

  if (typeof clearFocusedLine === "function") {
    clearFocusedLine("Route unselected.", "Select a route to focus it.");
  }

  renderUserStatus();
  closeLineView._closing = false;
}

/** Resolve once the sheet's height transition has finished (or shortly after). */
function waitForSheetSettled(el) {
  return new Promise((resolve) => {
    if (!el) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      el.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === el && event.propertyName === "height") {
        finish();
      }
    };
    el.addEventListener("transitionend", onEnd);
    window.setTimeout(finish, 420);
  });
}

async function openLineViewMap() {
  const lineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
  if (!lineKey) {
    closeLineView({ restore: true });
    return;
  }

  const panel = dom.lineViewPanel;
  if (isPortraitMobileLayout()) {
    appState.lineViewPeekPinned = true;
    if (typeof window.setMobileSheetState === "function") {
      window.setMobileSheetState("peek");
    }
    // Fit after the sheet shrinks, or padding uses the tall sheet height.
    await waitForSheetSettled(panel);
  }

  await setFocusedLine(lineKey, { forceRefresh: false });
  fitMapToLine(lineKey);

  if (isPortraitMobileLayout() && typeof window.setMobileSheetState === "function") {
    window.setMobileSheetState("peek");
  }
}

(function bindLineProgressLongPress() {
  const target = document.getElementById("lineViewProgress");
  if (!target) {
    return;
  }
  let timer = null;
  const start = () => {
    timer = window.setTimeout(() => {
      const clearBtn = document.getElementById("clearRouteProgressBtn");
      if (!clearBtn || clearBtn.disabled) {
        return;
      }
      // Long-press arms the two-step clear confirmation; a second press resets.
      const actions = clearBtn.closest(".line-view-progress-actions");
      if (actions) {
        actions.classList.add("is-revealed");
      }
      clearBtn.hidden = false;
      clearBtn.click();
    }, 550);
  };
  const cancel = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  target.addEventListener("pointerdown", start);
  target.addEventListener("pointerup", cancel);
  target.addEventListener("pointerleave", cancel);
  target.addEventListener("pointercancel", cancel);
})();

try { syncLineViewOrderingControls(); } catch (e) { /* DOM elements may not be ready yet */ }
