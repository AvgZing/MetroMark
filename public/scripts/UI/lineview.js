/** Render the ordered stop list for a line inside the line view panel. */
function orderByCustomStopKeys(stopFeatures, customStops) {
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
    const feature = byKey.get(key);
    if (feature) {
      ordered.push(feature);
      seen.add(key);
    }
  }

  for (const feature of stopFeatures || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (!seen.has(key)) {
      ordered.push(feature);
    }
  }

  return ordered;
}

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
  const customStops = Array.isArray(routeOverride?.payload?.stops) && routeOverride.payload.stops.length
    ? routeOverride.payload.stops
    : null;

  const featuresToRender = customStops
    ? orderByCustomStopKeys(stopFeatures, customStops)
    : await orderStopsForLineView(
        stopFeatures,
        lineKey,
        directionSequences,
        orderingMode,
        routeLookupKey,
        null,
        directionPatterns
      );

  if (appState.lineViewOrderingReversed) {
    featuresToRender.reverse();
  }

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
function renderLineView(options = {}) {
  if (!dom.lineViewPanel) {
    return;
  }

  if (!appState.lineViewOpen) {
    dom.lineViewPanel.hidden = true;
    return;
  }

  const lineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
  if (!lineKey) {
    dom.lineViewPanel.hidden = true;
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

  if (dom.lineViewColor) {
    dom.lineViewColor.style.backgroundColor = lineColor;
  }

  if (dom.lineViewName) {
    dom.lineViewName.textContent = lineLabel;
  }

  if (dom.lineViewMeta) {
    dom.lineViewMeta.textContent = line
      ? `${lineMode(line)} | ${lineOperatorLabel(line)}`
      : "Route details";
  }

  const progress = line ? lineProgressMetrics(lineKey, Number(line.stopCount || 0)) : null;
  const fullStopsLoaded = appState.lineStopsCache.has(routeStopCacheKey(lineKey));
  const hasStopTotals = Number(line?.stopCount || 0) > 0;
  const stopsLoaded = fullStopsLoaded || hasStopTotals;
  const stopsLoading = appState.inFlightLineStopKeys.has(routeStopCacheKey(lineKey));

  if (dom.lineViewStatus) {
    if (!stopsLoaded && stopsLoading) {
      dom.lineViewStatus.textContent = "Loading stops...";
    } else if (!stopsLoaded) {
      dom.lineViewStatus.textContent = "Stops not loaded yet.";
    } else if (!fullStopsLoaded) {
      dom.lineViewStatus.textContent = "Stop totals loaded. Tap to load full stops.";
    } else if (!appState.user) {
      dom.lineViewStatus.textContent = "Sign in to track visited stops.";
    } else if (progress && progress.total > 0) {
      dom.lineViewStatus.textContent = `Visited ${progress.visited} of ${progress.total} stations.`;
    } else {
      dom.lineViewStatus.textContent = "Stops loaded. Tap to mark visited.";
    }
  }

  if (dom.lineViewProgress && dom.lineViewProgressText && dom.lineViewProgressFill) {
    const hasProgress = Boolean(appState.user) && Boolean(progress) && Number(progress?.total || 0) > 0;
    if (hasProgress) {
      const visited = Number(progress.visited || 0);
      const total = Number(progress.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      dom.lineViewProgress.hidden = false;
      dom.lineViewProgressText.textContent = `${visited}/${total} stations visited (${percent}%)`;
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
    dom.lineViewReturnBtn.textContent = isMobileLayout ? "Ã¢â€ Â" : "Close";
    dom.lineViewReturnBtn.classList.toggle("mobile-icon-only", isMobileLayout);
  }
  if (dom.lineViewMapBtn) {
    dom.lineViewMapBtn.textContent = isMobileLayout ? "Map" : "Zoom";
  }

  // renderLineViewStops will manage dataset.lineKey itself to detect line changes
  renderLineViewStops(lineKey, lineColor, { forceRefresh: forceStopRefresh }).catch(() => {});
}

/** Open the line view panel for a given line, saving prior map/focus state for restoration. */
async function openLineView(lineKey) {
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
  document.body.classList.toggle("line-view-open", true);
  closeRouteSelectionPopup();

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

/** Close the line view panel and optionally restore the prior map and focus appState. */
function closeLineView(options = {}) {
  const shouldRestore = options.restore !== false;

  appState.lineViewOpen = false;
  appState.lineViewLineKey = "";
  document.body.classList.toggle("line-view-open", false);

  if (dom.lineViewPanel) {
    dom.lineViewPanel.hidden = true;
  }

  if (shouldRestore) {
    restoreLineViewReturnState();
  }

  appState.lineViewReturn = null;
  renderUserStatus();
}

async function openLineViewMap() {
  const lineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
  if (!lineKey) {
    closeLineView({ restore: true });
    return;
  }

  const shouldClosePanel = isPortraitMobileLayout();
  if (shouldClosePanel) {
    closeLineView({ restore: false });
  }

  await setFocusedLine(lineKey, { forceRefresh: false });
  fitMapToLine(lineKey);
}

try { syncLineViewOrderingControls(); } catch (e) { /* DOM elements may not be ready yet */ }
