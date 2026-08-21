function getShownLines(options = {}) {
  const query = String(appState.lineSearchQuery || "").trim().toLowerCase();
  const ignoreFrequency = Boolean(options.ignoreFrequency);
  const ignoreSearch = options.ignoreSearch === undefined ? true : Boolean(options.ignoreSearch);
  const hasQuery = Boolean(query) && !ignoreSearch;

  const filtered = appState.lineSummaries.filter((line) => {
    if (!lineIsVisible(line, { ignoreFrequency })) {
      return false;
    }

    if (hasQuery && !lineSearchText(line).includes(query)) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    // If there's a search query, prioritize search score first
    if (hasQuery) {
      const scoreA = calculateLineSearchScore(a, query);
      const scoreB = calculateLineSearchScore(b, query);
      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Higher score first
      }
    }

    const stopCountKnownA = lineHasCachedStopCount(a) ? 1 : 0;
    const stopCountKnownB = lineHasCachedStopCount(b) ? 1 : 0;
    if (stopCountKnownA !== stopCountKnownB) {
      return stopCountKnownB - stopCountKnownA;
    }

    // Fall back to tier sorting
    const tierDiff = lineSortWeight(a) - lineSortWeight(b);
    if (tierDiff !== 0) {
      return tierDiff;
    }
    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  return filtered;
}

function lineHasCachedStopCount(line) {
  return Number(line?.stopCount || 0) > 0;
}

function getLoadedLines() {
  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    return appState.loadedLineSummaries;
  }

  return Array.isArray(appState.lineSummaries) ? appState.lineSummaries : [];
}

function getToggleCountLines() {
  const sourceLines = getLoadedLines();
  const deduped = new Map();

  for (const line of sourceLines) {
    const lineKey = String(line?.lineKey || "").trim();
    if (!lineKey || deduped.has(lineKey)) {
      continue;
    }
    deduped.set(lineKey, line);
  }

  return Array.from(deduped.values());
}

function lineEligibleForToggleCounts(line, options = {}) {
  if (!line) {
    return false;
  }

  if (typeof lineIntersectsCurrentViewport === "function" && !lineIntersectsCurrentViewport(line)) {
    return false;
  }

  if (!appState.showProblematicGeometries && line?.lineKey) {
    const routeReview = appState.routeReviewsByCity.get(line.lineKey);
    if (routeReview?.problematic_override === true) {
      return false;
    }
  }

  if (!appState.showPrivateOperators && line?.operatorName) {
    const agencyReview = appState.agencyReviewsByCity.get(line.operatorName);
    if (agencyReview?.allowed_override === false) {
      return false;
    }
  }

  if (Boolean(options.requireModeMatch) && typeof lineMatchesModeSelection === "function" && !lineMatchesModeSelection(line)) {
    return false;
  }

  if (Boolean(options.requireFrequencyMatch) && typeof lineMatchesFrequencySelection === "function" && !lineMatchesFrequencySelection(line)) {
    return false;
  }

  return true;
}

function getVisibleLineKeys(shownLines) {
  return new Set(shownLines.map((line) => line.lineKey));
}

function updateShowAllStopsUi() {
  if (!dom.showAllStopsBtn) {
    return;
  }

  const active = Boolean(appState.showAllStops);
  dom.showAllStopsBtn.classList.toggle("is-active", active);
  dom.showAllStopsBtn.setAttribute("aria-pressed", active ? "true" : "false");
  dom.showAllStopsBtn.textContent = active ? "All Stops On" : "Show All Stops";
}

function setShowAllStops(enabled, options = {}) {
  appState.showAllStops = Boolean(enabled);
  persistBooleanToStorage(SHOW_ALL_STOPS_STORAGE_KEY, appState.showAllStops);
  updateShowAllStopsUi();
  renderMapData();

  if (options.silent) {
    return;
  }

  setStatus(
    appState.showAllStops ? "Showing all stops." : "Showing route-linked stops only.",
    "ok"
  );
}

function refreshRouteStopDependentUi(options = {}) {
  renderMapData();
  renderLineList();
  renderProgress();

  if (typeof renderLineView === "function") {
    renderLineView({ forceStopRefresh: Boolean(options.forceStopRefresh) });
  }

  restoreUserStatusFromFocus();
}

function applyLineVisibilityPreference(line, targetVisibility) {
  const lineKey = String(line?.lineKey || "").trim();
  if (!lineKey) {
    return;
  }

  const normalizedTarget = targetVisibility === "on" || targetVisibility === "off" ? targetVisibility : "";
  const nextOverride = normalizedTarget;

  setLineVisibilityOverride(lineKey, nextOverride);
  clearStatusPin();
  resetClearRouteProgressConfirmation();

  const shown = getShownLines({ ignoreSearch: true });
  if (appState.focusedLineKey && !shown.some((entry) => entry.lineKey === appState.focusedLineKey)) {
    appState.focusedLineKey = "";
  }

  refreshUiFromState();
  restoreUserStatusFromFocus();

  const effectiveVisible = lineIsVisible(line);
  const sourceLabel =
    nextOverride === "on"
      ? "Forced ON override"
      : nextOverride === "off"
        ? "Forced OFF override"
        : "Default mode/frequency behavior";

  setStatus(
    `${lineDisplayName(line)} visibility ${effectiveVisible ? "ON" : "OFF"}.`,
    "ok",
    sourceLabel
  );
}

function refreshUiFromState() {
  const t0 = performance.now();
  renderModeFilterBar();
  renderFrequencyFilterBar();
  renderMapData();
  renderLineList();
  renderProgress();
  if (typeof updateLoadingStatus === "function") {
    updateLoadingStatus();
  }
  if (typeof renderLineView === "function") {
    renderLineView();
  }
  if (typeof loadVisibleRouteStopCounts === "function") {
    loadVisibleRouteStopCounts().catch(() => {});
  }
  if (typeof loadVisibleRouteHeadways === "function") {
    loadVisibleRouteHeadways().catch(() => {});
  }
  if (typeof applyUnderlayModeFilter === "function") {
    applyUnderlayModeFilter();
  }
  const elapsed = performance.now() - t0;
  if (elapsed > 50) {
    console.log(`[perf] refreshUiFromState: ${elapsed.toFixed(1)}ms`);
  }
}

updateShowAllStopsUi();
