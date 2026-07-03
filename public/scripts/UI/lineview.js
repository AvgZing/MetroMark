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
  const mode = normalizeLineViewOrderingMode(state.lineViewOrderingMode);
  const resolvedMode = normalizeLineViewOrderingMode(state.lineViewOrderingResolved || mode);
  const activeMode = mode === "auto" ? resolvedMode : mode;
  const label = mode === "auto"
    ? `Auto - ${lineViewOrderingModeLabel(activeMode)} (${lineViewOrderingTechnicalLabel(activeMode)})`
    : `${lineViewOrderingModeLabel(activeMode)} (${lineViewOrderingTechnicalLabel(activeMode)})`;
  return state.lineViewOrderingReversed ? `${label} · Reversed Route` : label;
}

function getLineViewOrderingPreference(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const stored = state.lineViewOrderingPreferencesByLineKey.get(normalizedLineKey);
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

  state.lineViewOrderingPreferencesByLineKey.set(normalizedLineKey, nextPreference);
  persistLineViewOrderingPreferencesToStorage(
    LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY,
    state.lineViewOrderingPreferencesByLineKey
  );

  return nextPreference;
}

function applyLineViewOrderingPreference(lineKey) {
  const preference = getLineViewOrderingPreference(lineKey);
  state.lineViewOrderingMode = preference.mode;
  state.lineViewOrderingReversed = Boolean(preference.reversed);
  return preference;
}

function lineViewOrderingVoteModeForCurrentState() {
  const selectedMode = normalizeLineViewOrderingMode(state.lineViewOrderingMode);
  if (selectedMode !== "auto") {
    return selectedMode;
  }

  return normalizeLineViewOrderingMode(state.lineViewOrderingResolved || "geometry-revised");
}

function updateRouteOrderingMetadataForLine(lineKey, metadata = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey || !metadata || typeof metadata !== "object") {
    return;
  }

  const nextLineSummaries = state.lineSummaries.map((line) => {
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

  state.lineSummaries = nextLineSummaries;

  if (Array.isArray(state.loadedLineSummaries) && state.loadedLineSummaries.length > 0) {
    state.loadedLineSummaries = state.loadedLineSummaries.map((line) => {
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

  if (state.transit?.routesGeoJson?.features) {
    state.transit.routesGeoJson.features = state.transit.routesGeoJson.features.map((feature) => {
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

async function submitLineViewOrderingVote(lineKey, orderingMode) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedMode = normalizeLineViewOrderingMode(orderingMode);
  if (!normalizedLineKey || normalizedMode === "auto" || !state.user) {
    return null;
  }

  const payload = await apiRequest("/api/transit/route-ordering/vote", {
    method: "POST",
    body: {
      lineKey: normalizedLineKey,
      citySlug: String(state.initialCitySlug || "").trim(),
      orderingMode: normalizedMode
    }
  });

  if (payload?.metadata) {
    updateRouteOrderingMetadataForLine(normalizedLineKey, payload.metadata);
  }

  if (state.lineViewOpen && String(state.lineViewLineKey || "").trim() === normalizedLineKey) {
    renderLineView();
  }

  return payload;
}

function noteLineViewOrderingVoteClick(lineKey, stopKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedStopKey = String(stopKey || "").trim();
  if (!normalizedLineKey || !normalizedStopKey || !state.user) {
    return;
  }

  let clickSet = state.lineViewOrderingVoteClickSetsByLineKey.get(normalizedLineKey);
  if (!clickSet) {
    clickSet = new Set();
    state.lineViewOrderingVoteClickSetsByLineKey.set(normalizedLineKey, clickSet);
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

function syncLineViewOrderingControls() {
  const mode = normalizeLineViewOrderingMode(state.lineViewOrderingMode);
  state.lineViewOrderingMode = mode;

  const buttonByMode = {
    auto: els.lineViewOrderingAutoBtn,
    "geometry-revised": els.lineViewOrderingGeometryRevisedBtn,
    "legacy-geometry": els.lineViewOrderingGeometryBtn,
    fractions: els.lineViewOrderingFractionsBtn
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

  if (els.lineViewOrderingReverseBtn) {
    const isActive = Boolean(state.lineViewOrderingReversed);
    els.lineViewOrderingReverseBtn.textContent = "Reverse Route";
    els.lineViewOrderingReverseBtn.title = "Reverse the current stop order";
    els.lineViewOrderingReverseBtn.classList.toggle("is-active", isActive);
    els.lineViewOrderingReverseBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (els.lineViewOrderingResolved) {
    els.lineViewOrderingResolved.textContent = lineViewOrderingStatusLabel();
  }
}

async function renderLineViewStops(lineKey, lineColor, options = {}) {
  if (!els.lineViewStops) {
    return;
  }

  els.lineViewStops.style.setProperty("--line-color", lineColor || "#177ca2");

  const cacheKey = routeStopCacheKey(lineKey);
  const isLoading = state.inFlightLineStopKeys.has(cacheKey);
  const sameLine = String(els.lineViewStops.dataset.lineKey || "") === String(lineKey || "");
  const stopFeatures = uniqueStopFeaturesForLine(lineKey);
  const hasRenderedStopRows = !!els.lineViewStops.querySelector('.line-view-stop-row');
  const forceRefresh = Boolean(options?.forceRefresh);

  syncLineViewOrderingControls();

  if (!stopFeatures.length) {
    if (isLoading && sameLine && hasRenderedStopRows) {
      return;
    }

    els.lineViewStops.innerHTML = "";
    els.lineViewStops.dataset.lineKey = String(lineKey || "");
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = isLoading ? "Loading stops..." : "Stops are not loaded yet.";
    els.lineViewStops.append(empty);
    return;
  }

  if (isLoading && sameLine && hasRenderedStopRows && !forceRefresh) {
    return;
  }

  if (forceRefresh || String(els.lineViewStops.dataset.lineKey || "") !== String(lineKey || "") || !hasRenderedStopRows) {
    els.lineViewStops.innerHTML = "";
    els.lineViewStops.dataset.lineKey = String(lineKey || "");
  } else {
    return;
  }

  const visitedSet = getVisitedSetForLine(lineKey);

  // Get direction sequences from cache payload if available
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(lineKey));
  const line = state.lineSummaries.find((entry) => entry.lineKey === lineKey);
  const routeLookupKey = String(line?.routeOnestopId || lineKey || "").trim();
  const directionSequences = cacheEntry?.payload?.directionStopSequences || null;
  const directionPatterns = cacheEntry?.payload?.directionStopPatterns || directionSequences?.patterns || null;
  const orderingMode = String(
    options?.orderingMode ||
    state.lineViewOrderingMode ||
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

  if (state.lineViewOrderingReversed) {
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

    if (!state.user) {
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
    status.textContent = state.user
      ? visited
        ? "Visited"
        : "Not visited"
      : "Sign in to track";

    content.append(name, status);
    row.append(marker, content);

    if (state.user) {
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleVisitedForStation(props, coords);
        noteLineViewOrderingVoteClick(lineKey, stationKey);
      });
    }

    els.lineViewStops.append(row);
  });

  createLineConnector(lineColor);
}

function renderLineView(options = {}) {
  if (!els.lineViewPanel) {
    return;
  }

  if (!state.lineViewOpen) {
    els.lineViewPanel.hidden = true;
    return;
  }

  const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
  if (!lineKey) {
    els.lineViewPanel.hidden = true;
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === lineKey);
  const lineColor = line?.color || "#177ca2";
  const lineLabel = line ? lineDisplayName(line) : "Selected Route";
  const forceStopRefresh = Boolean(options?.forceStopRefresh);

  applyLineViewOrderingPreference(lineKey);

  // Ensure panel is visible and not hidden
  if (els.lineViewPanel) {
    els.lineViewPanel.hidden = false;
    els.lineViewPanel.removeAttribute("hidden");
  }

  if (els.lineViewColor) {
    els.lineViewColor.style.backgroundColor = lineColor;
  }

  if (els.lineViewName) {
    els.lineViewName.textContent = lineLabel;
  }

  if (els.lineViewMeta) {
    els.lineViewMeta.textContent = line
      ? `${lineMode(line)} | ${lineOperatorLabel(line)}`
      : "Route details";
  }

  const progress = line ? lineProgressMetrics(lineKey, Number(line.stopCount || 0)) : null;
  const fullStopsLoaded = state.lineStopsCache.has(routeStopCacheKey(lineKey));
  const hasStopTotals = Number(line?.stopCount || 0) > 0;
  const stopsLoaded = fullStopsLoaded || hasStopTotals;
  const stopsLoading = state.inFlightLineStopKeys.has(routeStopCacheKey(lineKey));

  if (els.lineViewStatus) {
    if (!stopsLoaded && stopsLoading) {
      els.lineViewStatus.textContent = "Loading stops...";
    } else if (!stopsLoaded) {
      els.lineViewStatus.textContent = "Stops not loaded yet.";
    } else if (!fullStopsLoaded) {
      els.lineViewStatus.textContent = "Stop totals loaded. Tap to load full stops.";
    } else if (!state.user) {
      els.lineViewStatus.textContent = "Sign in to track visited stops.";
    } else if (progress && progress.total > 0) {
      els.lineViewStatus.textContent = `Visited ${progress.visited} of ${progress.total} stations.`;
    } else {
      els.lineViewStatus.textContent = "Stops loaded. Tap to mark visited.";
    }
  }

  if (els.lineViewProgress && els.lineViewProgressText && els.lineViewProgressFill) {
    const hasProgress = Boolean(state.user) && Boolean(progress) && Number(progress?.total || 0) > 0;
    if (hasProgress) {
      const visited = Number(progress.visited || 0);
      const total = Number(progress.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      els.lineViewProgress.hidden = false;
      els.lineViewProgressText.textContent = `${visited}/${total} stations visited (${percent}%)`;
      els.lineViewProgressFill.style.width = `${percent}%`;
    } else {
      els.lineViewProgress.hidden = true;
      els.lineViewProgressText.textContent = "";
      els.lineViewProgressFill.style.width = "0%";
    }
  }

  // Update button labels based on layout
  const isMobileLayout = isPortraitMobileLayout();
  if (els.lineViewReturnBtn) {
    els.lineViewReturnBtn.textContent = isMobileLayout ? "←" : "Close";
    els.lineViewReturnBtn.classList.toggle("mobile-icon-only", isMobileLayout);
  }
  if (els.lineViewMapBtn) {
    els.lineViewMapBtn.textContent = isMobileLayout ? "Map" : "Zoom";
  }

  // renderLineViewStops will manage dataset.lineKey itself to detect line changes
  renderLineViewStops(lineKey, lineColor, { forceRefresh: forceStopRefresh }).catch(() => {});
}

async function openLineView(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  if (!state.lineViewOpen) {
    state.lineViewReturn = {
      focusedLineKey: state.focusedLineKey,
      mapView: captureMapView(),
      mobilePanelsOpen: state.mobilePanelsOpen,
      activePopup: state.activePopup
    };
  }

  state.lineViewOpen = true;
  state.lineViewLineKey = normalizedLineKey;
  document.body.classList.toggle("line-view-open", true);
  closeRouteSelectionPopup();

  if (isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
  }

  if (normalizedLineKey !== state.focusedLineKey) {
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
  const saved = state.lineViewReturn;
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
  } else if (state.focusedLineKey) {
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

function closeLineView(options = {}) {
  const shouldRestore = options.restore !== false;

  state.lineViewOpen = false;
  state.lineViewLineKey = "";
  document.body.classList.toggle("line-view-open", false);

  if (els.lineViewPanel) {
    els.lineViewPanel.hidden = true;
  }

  if (shouldRestore) {
    restoreLineViewReturnState();
  }

  state.lineViewReturn = null;
  renderUserStatus();
}

async function openLineViewMap() {
  const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
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
