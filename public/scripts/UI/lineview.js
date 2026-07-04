function lineViewOrderingModeLabel(mode) {
  const normalizedMode = normalizeLineViewOrderingMode(mode);

  if (normalizedMode === "auto") {
    return "Auto";
  }

  if (normalizedMode === "geometry-revised") {
    return "Main";
  }

  if (normalizedMode === "legacy-geometry") {
    return "U-Shape";
  }

  if (normalizedMode === "fractions") {
    return "Loop";
  }

  return "Main";
}

function lineViewOrderingTechnicalLabel(mode) {
  const normalizedMode = normalizeLineViewOrderingMode(mode);

  if (normalizedMode === "auto") {
    return "Automatic route-shape detection";
  }

  if (normalizedMode === "geometry-revised") {
    return "Geometry Revised Endpoint Anchored";
  }

  if (normalizedMode === "legacy-geometry") {
    return "Trip Pattern Geometry";
  }

  if (normalizedMode === "fractions") {
    return "Fractions Only";
  }

  return "Geometry Revised Endpoint Anchored";
}

function lineViewOrderingStatusLabel() {
  var mode = normalizeLineViewOrderingMode(appState.lineViewOrderingMode);
  var resolvedMode = normalizeLineViewOrderingMode(appState.lineViewOrderingResolved || mode);
  var activeMode = mode === "auto" ? resolvedMode : mode;

  var focusedLineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
  var focusedLine = null;
  if (focusedLineKey && Array.isArray(appState.lineSummaries)) {
    focusedLine = appState.lineSummaries.find(function(l) { return String(l.lineKey || "").trim() === focusedLineKey; }) || null;
  }

  var adminMode = focusedLine ? String(focusedLine.lineViewOrderingAdminMode || "").trim() : "";
  var voteCounts = (focusedLine && focusedLine.lineViewOrderingVoteCounts) ? focusedLine.lineViewOrderingVoteCounts : {};

  var label = mode === "auto"
    ? "Auto - " + lineViewOrderingModeLabel(activeMode) + " (" + lineViewOrderingTechnicalLabel(activeMode) + ")"
    : lineViewOrderingModeLabel(activeMode) + " (" + lineViewOrderingTechnicalLabel(activeMode) + ")";

  var voteSuffix = "";
  if (adminMode === activeMode) {
    voteSuffix = " (A)";
  } else {
    var count = Number(voteCounts[activeMode] || 0);
    voteSuffix = " (" + count + ")";
  }

  if (appState.lineViewOrderingReversed) {
    label = label + " \u00B7 Reversed Route";
  }
  return label + voteSuffix;
}

function getLineViewOrderingPreference(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const stored = appState.lineViewOrderingPreferencesByLineKey.get(normalizedLineKey);
  if (!stored) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  return {
    mode: normalizeLineViewOrderingMode(stored.mode),
    reversed: Boolean(stored.reversed)
  };
}

function setLineViewOrderingPreference(lineKey, preference = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const current = getLineViewOrderingPreference(normalizedLineKey);
  const nextPreference = {
    mode: normalizeLineViewOrderingMode(
      Object.prototype.hasOwnProperty.call(preference, "mode") ? preference.mode : current.mode
    ),
    reversed: Object.prototype.hasOwnProperty.call(preference, "reversed")
      ? Boolean(preference.reversed)
      : Boolean(current.reversed)
  };

  appState.lineViewOrderingPreferencesByLineKey.set(normalizedLineKey, nextPreference);
  persistLineViewOrderingPreferencesToStorage(
    LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY,
    appState.lineViewOrderingPreferencesByLineKey
  );

  return nextPreference;
}

function applyLineViewOrderingPreference(lineKey) {
  const preference = getLineViewOrderingPreference(lineKey);
  appState.lineViewOrderingMode = preference.mode;
  appState.lineViewOrderingReversed = Boolean(preference.reversed);
  return preference;
}

function lineViewOrderingVoteModeForCurrentState() {
  const selectedMode = normalizeLineViewOrderingMode(appState.lineViewOrderingMode);
  if (selectedMode !== "auto") {
    return selectedMode;
  }

  return normalizeLineViewOrderingMode(appState.lineViewOrderingResolved || "geometry-revised");
}

function updateRouteOrderingMetadataForLine(lineKey, metadata = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey || !metadata || typeof metadata !== "object") {
    return;
  }

  const nextLineSummaries = appState.lineSummaries.map((line) => {
    if (String(line?.lineKey || "").trim() !== normalizedLineKey) {
      return line;
    }

    return {
      ...line,
      lineViewOrderingDefaultMode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
      lineViewOrderingDefaultSource: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
      lineViewOrderingAdminMode: String(metadata.orderingModeAdminMode || "").trim(),
      lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
      lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
    };
  });

  appState.lineSummaries = nextLineSummaries;

  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    appState.loadedLineSummaries = appState.loadedLineSummaries.map((line) => {
      if (String(line?.lineKey || "").trim() !== normalizedLineKey) {
        return line;
      }

      return {
        ...line,
        lineViewOrderingDefaultMode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
        lineViewOrderingDefaultSource: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
        lineViewOrderingAdminMode: String(metadata.orderingModeAdminMode || "").trim(),
        lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
        lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
      };
    });
  }

  if (appState.transit?.routesGeoJson?.features) {
    appState.transit.routesGeoJson.features = appState.transit.routesGeoJson.features.map((feature) => {
      if (String(feature?.properties?.line_key || "").trim() !== normalizedLineKey) {
        return feature;
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          line_view_ordering_default_mode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
          line_view_ordering_default_source: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
          line_view_ordering_admin_mode: String(metadata.orderingModeAdminMode || "").trim(),
          line_view_ordering_vote_total: Number(metadata.orderingModeVoteTotal || 0)
        }
      };
    });
  }
}

/** Submit an authenticated route ordering preference vote for a line. */
async function submitLineViewOrderingVote(lineKey, orderingMode) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedMode = normalizeLineViewOrderingMode(orderingMode);
  if (!normalizedLineKey || normalizedMode === "auto" || !appState.user) {
    return null;
  }

  const payload = await apiRequest("/api/transit/route-ordering/vote", {
    method: "POST",
    body: {
      lineKey: normalizedLineKey,
      citySlug: String(appState.initialCitySlug || "").trim(),
      orderingMode: normalizedMode
    }
  });

  if (payload?.metadata) {
    updateRouteOrderingMetadataForLine(normalizedLineKey, payload.metadata);
  }

  if (appState.lineViewOpen && String(appState.lineViewLineKey || "").trim() === normalizedLineKey) {
    renderLineView();
  }

  return payload;
}

function noteLineViewOrderingVoteClick(lineKey, stopKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedStopKey = String(stopKey || "").trim();
  if (!normalizedLineKey || !normalizedStopKey || !appState.user) {
    return;
  }

  let clickSet = appState.lineViewOrderingVoteClickSetsByLineKey.get(normalizedLineKey);
  if (!clickSet) {
    clickSet = new Set();
    appState.lineViewOrderingVoteClickSetsByLineKey.set(normalizedLineKey, clickSet);
  }

  if (clickSet.has(normalizedStopKey)) {
    return;
  }

  clickSet.add(normalizedStopKey);
  if (clickSet.size < 2) {
    return;
  }

  clickSet.clear();
  const voteMode = lineViewOrderingVoteModeForCurrentState();
  if (!voteMode || voteMode === "auto") {
    return;
  }

  submitLineViewOrderingVote(normalizedLineKey, voteMode).catch((error) => {
    console.warn("Unable to record route ordering vote:", error);
  });
}

/** Sync the route ordering mode buttons and reversed toggle with current appState. */
function syncLineViewOrderingControls() {
  const mode = normalizeLineViewOrderingMode(appState.lineViewOrderingMode);
  appState.lineViewOrderingMode = mode;

  const buttonByMode = {
    auto: dom.lineViewOrderingAutoBtn,
    "geometry-revised": dom.lineViewOrderingGeometryRevisedBtn,
    "legacy-geometry": dom.lineViewOrderingGeometryBtn,
    fractions: dom.lineViewOrderingFractionsBtn
  };

  const buttonLabelByMode = {
    auto: "Auto",
    "geometry-revised": "Main",
    "legacy-geometry": "U-Shape",
    fractions: "Loop"
  };

  const buttonTitleByMode = {
    auto: "Automatic route-shape detection",
    "geometry-revised": "Geometry Revised Endpoint Anchored",
    "legacy-geometry": "Trip Pattern Geometry",
    fractions: "Fractions Only"
  };

  for (const [buttonMode, button] of Object.entries(buttonByMode)) {
    if (!button) {
      continue;
    }

    const isActive = buttonMode === mode;
    button.textContent = buttonLabelByMode[buttonMode] || button.textContent;
    button.title = buttonTitleByMode[buttonMode] || button.title || "";
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (dom.lineViewOrderingReverseBtn) {
    const isActive = Boolean(appState.lineViewOrderingReversed);
    dom.lineViewOrderingReverseBtn.textContent = "Reverse Route";
    dom.lineViewOrderingReverseBtn.title = "Reverse the current stop order";
    dom.lineViewOrderingReverseBtn.classList.toggle("is-active", isActive);
    dom.lineViewOrderingReverseBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (dom.lineViewOrderingResolved) {
    dom.lineViewOrderingResolved.textContent = lineViewOrderingStatusLabel();
  }
}

/** Render the ordered stop list for a line inside the line view panel. */
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

  const featuresToRender = await orderStopsForLineView(
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

  if (saved.mapView) {
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
