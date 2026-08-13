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
  const summaryLines = Array.isArray(appState.viewportSummaryTransit?.lineSummaries)
    ? appState.viewportSummaryTransit.lineSummaries
    : Array.isArray(appState.viewportSummaryLineSummaries)
      ? appState.viewportSummaryLineSummaries
      : [];
  const sourceLines = summaryLines.length > 0 ? summaryLines : getLoadedLines();
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
  rebuildCombinedTransit();
  renderMapData();
  renderLineList();
  renderProgress();

  if (typeof renderLineView === "function") {
    renderLineView({ forceStopRefresh: Boolean(options.forceStopRefresh) });
  }

  restoreUserStatusFromFocus();
}

async function ensureLineStopsLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const cacheKey = routeStopCacheKey(normalizedLineKey);
  const existing = appState.lineStopsCache.get(cacheKey);
  const requestOptions = { ...options };
  if (existing && !requestOptions.forceRefresh) {
    if (requestOptions.cacheOnly) {
      existing.lastUsedAt = Date.now();
      return true;
    }

    const needsPatternRefresh = !existing.payload?.directionStopPatterns && !existing.patternsRefreshAttempted;
    if (!needsPatternRefresh) {
      if (appState.routeStopsAutoLoadAttempts) {
        appState.routeStopsAutoLoadAttempts.delete(cacheKey);
      }
      existing.lastUsedAt = Date.now();
      refreshRouteStopDependentUi({
        forceStopRefresh: false
      });
      return true;
    }
    existing.patternsRefreshAttempted = true;
    requestOptions.forceRefresh = true;
    requestOptions.silent = true;
  }

  if (appState.inFlightLineStopKeys.has(cacheKey)) {
    return false;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineLabel = line ? lineDisplayName(line) : normalizedLineKey;
  const routeStopLookupKey = String(line?.routeOnestopId || normalizedLineKey).trim();

  appState.inFlightLineStopKeys.add(cacheKey);
  updateLoadingStatus();

  if (!requestOptions.silent) {
    setStatus(`Loading stops for ${lineLabel}...`, "ok", "Using route membership from Transitland.");
  }

  try {
    const params = new URLSearchParams({
      lineKey: routeStopLookupKey,
      stopTypes: ROUTE_STOP_TYPES_QUERY
    });

    if (requestOptions.cacheOnly) {
      params.set("cacheOnly", "1");
    }

    if (requestOptions.forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/route-stops?${params.toString()}`, {
      method: "GET"
    });

    const hasStopPayload = Array.isArray(payload?.stopsGeoJson?.features);
    if (!hasStopPayload) {
      return false;
    }

    const compactPayload = compactRouteStopsPayload(payload);

    appState.lineStopsCache.set(cacheKey, {
      lineKey: normalizedLineKey,
      stopTypesKey: ROUTE_STOP_TYPES_KEY,
      payload: compactPayload,
      cacheStatus: payload.cacheStatus || "miss",
      lastUsedAt: Date.now()
    });

    if (appState.routeStopsAutoLoadAttempts) {
      appState.routeStopsAutoLoadAttempts.delete(cacheKey);
    }

    pruneLineStopsCache();
    refreshRouteStopDependentUi({
      forceStopRefresh: Boolean(requestOptions.forceRefresh)
    });
    restoreUserStatusFromFocus();

    const stationCount = Number(payload?.stopsGeoJson?.features?.length || 0);
    setBackendStatus(
      `Route stops ready for ${lineLabel} (${payload.cacheStatus || "miss"} cache, ${stationCount} stops).`
    );

    if (!requestOptions.silent) {
      setStatus(`Loaded ${stationCount} route-linked stops for ${lineLabel}.`, "ok");
    }

    return true;
  } catch (error) {
    setBackendStatus(`Route stop fetch failed for ${lineLabel}: ${error.message}`);
    if (!requestOptions.silent) {
      setStatus(`Could not load stops for ${lineLabel}.`, "error", error.message);
    }
    return false;
  } finally {
    appState.inFlightLineStopKeys.delete(cacheKey);
    updateLoadingStatus();
  }
}

function lineNeedsHeadwayLookup(line) {
  if (!line) {
    return false;
  }

  if (lineHeadwayBestMinutes(line) !== null) {
    return false;
  }

  return Number(line?.headwayChecked || 0) !== 1;
}

function normalizeHeadwayUpdate(payload) {
  const headwayBestMinutes = Number(payload?.headwayBestMinutes);
  const normalizedBestMinutes =
    Number.isFinite(headwayBestMinutes) && headwayBestMinutes > 0
      ? Number(headwayBestMinutes.toFixed(1))
      : null;

  const headwayFallback = Boolean(payload?.headwayFallback);

  const normalizedBucket = String(payload?.frequencyBucket || "").trim().toLowerCase();
  const frequencyBucket = normalizedBestMinutes
    ? frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
    : normalizedBucket || FREQUENCY_FILTER_UNKNOWN;

  return {
    headwayBestMinutes: headwayFallback ? null : normalizedBestMinutes,
    frequencyBucket,
    headwaySource: String(payload?.headwaySource || payload?.headwaySummary?.source || "").trim(),
    headwayChecked: 1,
    headwayFallback: headwayFallback ? 1 : 0
  };
}

function applyHeadwayUpdateToCachedTransit(lineKey, headwayUpdate) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  let updated = false;

  appState.lineSummaries = appState.lineSummaries.map((line) => {
    if (line.lineKey !== normalizedLineKey) {
      return line;
    }

    updated = true;
    return {
      ...line,
      ...headwayUpdate
    };
  });

  if (appState.transit?.routesGeoJson?.features) {
    for (const feature of appState.transit.routesGeoJson.features) {
      const featureLineKey = String(feature?.properties?.line_key || "").trim();
      if (featureLineKey !== normalizedLineKey) {
        continue;
      }

      feature.properties = {
        ...feature.properties,
        frequency_bucket: headwayUpdate.frequencyBucket,
        headway_best_minutes: headwayUpdate.headwayBestMinutes,
        headway_source: headwayUpdate.headwaySource,
        headway_checked: headwayUpdate.headwayChecked
      };
    }
  }

  for (const cacheEntry of appState.areaCache.values()) {
    const payload = cacheEntry?.payload;
    if (!payload) {
      continue;
    }

    if (Array.isArray(payload.lineSummaries)) {
      let didUpdateLineSummary = false;
      payload.lineSummaries = payload.lineSummaries.map((line) => {
        if (line?.lineKey !== normalizedLineKey) {
          return line;
        }

        didUpdateLineSummary = true;
        return {
          ...line,
          ...headwayUpdate
        };
      });

      if (didUpdateLineSummary) {
        updated = true;
      }
    }

    const routeFeatures = payload?.routesGeoJson?.features;
    if (Array.isArray(routeFeatures)) {
      for (const feature of routeFeatures) {
        const featureLineKey = String(feature?.properties?.line_key || "").trim();
        if (featureLineKey !== normalizedLineKey) {
          continue;
        }

        feature.properties = {
          ...feature.properties,
          frequency_bucket: headwayUpdate.frequencyBucket,
          headway_best_minutes: headwayUpdate.headwayBestMinutes,
          headway_source: headwayUpdate.headwaySource,
          headway_checked: headwayUpdate.headwayChecked
        };
      }
    }
  }

  return updated;
}

function applyRouteStopCountSummaryToCachedTransit(lineKey, stopCount) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedStopCount = Number(stopCount || 0);
  if (!normalizedLineKey || !Number.isFinite(normalizedStopCount) || normalizedStopCount <= 0) {
    return false;
  }

  let updated = false;

  const updateLine = (line) => {
    if (!line || line.lineKey !== normalizedLineKey) {
      return line;
    }

    updated = true;
    return {
      ...line,
      stopCount: normalizedStopCount
    };
  };

  appState.lineSummaries = appState.lineSummaries.map(updateLine);

  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    appState.loadedLineSummaries = appState.loadedLineSummaries.map(updateLine);
  }

  if (appState.transit?.routesGeoJson?.features) {
    appState.transit.routesGeoJson.features = appState.transit.routesGeoJson.features.map((feature) => {
      const featureLineKey = String(feature?.properties?.line_key || "").trim();
      if (featureLineKey !== normalizedLineKey) {
        return feature;
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          stop_count: normalizedStopCount,
          stopCount: normalizedStopCount
        }
      };
    });
  }

  for (const cacheEntry of appState.areaCache.values()) {
    const payload = cacheEntry?.payload;
    if (!payload) {
      continue;
    }

    if (Array.isArray(payload.lineSummaries)) {
      let didUpdateLineSummary = false;
      payload.lineSummaries = payload.lineSummaries.map((line) => {
        if (line?.lineKey !== normalizedLineKey) {
          return line;
        }

        didUpdateLineSummary = true;
        return {
          ...line,
          stopCount: normalizedStopCount
        };
      });

      if (didUpdateLineSummary) {
        updated = true;
      }
    }

    const routeFeatures = payload?.routesGeoJson?.features;
    if (Array.isArray(routeFeatures)) {
      for (const feature of routeFeatures) {
        const featureLineKey = String(feature?.properties?.line_key || "").trim();
        if (featureLineKey !== normalizedLineKey) {
          continue;
        }

        feature.properties = {
          ...feature.properties,
          stop_count: normalizedStopCount,
          stopCount: normalizedStopCount
        };
      }
    }
  }

  return updated;
}

async function loadRouteStopCountSummary(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (Number(line.stopCount || 0) > 0) {
    return true;
  }

  if (appState.routeStopCountLoadAttempts.has(normalizedLineKey) || appState.inFlightRouteStopCountKeys.has(normalizedLineKey)) {
    return false;
  }

  appState.routeStopCountLoadAttempts.add(normalizedLineKey);
  appState.inFlightRouteStopCountKeys.add(normalizedLineKey);

  try {
    const routeLookupKey = String(line.routeOnestopId || normalizedLineKey).trim();
    const params = new URLSearchParams({
      lineKey: routeLookupKey,
      stopTypes: ROUTE_STOP_TYPES_QUERY,
      cacheOnly: "1",
      summaryOnly: "1"
    });

    const payload = await apiRequest(`/api/transit/route-stops?${params.toString()}`, {
      method: "GET"
    });

    const summaryCount = Number(payload?.lineSummaries?.[0]?.stopCount || payload?.lineSummaries?.[0]?.stop_count || 0);
    if (Number.isFinite(summaryCount) && summaryCount > 0) {
      applyRouteStopCountSummaryToCachedTransit(normalizedLineKey, summaryCount);
      return true;
    }

    return false;
  } catch (error) {
    if (!options.silent) {
      setStatus(`Could not load stop totals for ${lineDisplayName(line)}.`, "error", error.message);
    }
    return false;
  } finally {
    appState.inFlightRouteStopCountKeys.delete(normalizedLineKey);
  }
}

async function loadVisibleRouteStopCounts() {
  if (!appState.lineSummaries.length) {
    return false;
  }

  const candidateMap = new Map();
  for (const line of getShownLines()) {
    candidateMap.set(line.lineKey, line);
  }
  for (const line of getRouteListLines()) {
    candidateMap.set(line.lineKey, line);
  }

  const candidates = Array.from(candidateMap.values()).filter((line) => {
    if (!line || !line.lineKey) {
      return false;
    }

    if (Number(line.stopCount || 0) > 0) {
      return false;
    }

    if (appState.routeStopCountLoadAttempts.has(line.lineKey)) {
      return false;
    }

    if (appState.inFlightRouteStopCountKeys.has(line.lineKey)) {
      return false;
    }

    if (appState.focusedLineKey === line.lineKey) {
      return false;
    }

    if (appState.lineViewOpen && appState.lineViewLineKey === line.lineKey) {
      return false;
    }

    return true;
  });

  if (!candidates.length) {
    return false;
  }

  const maxCandidates = Math.min(candidates.length, 24);
  const results = await Promise.all(
    candidates.slice(0, maxCandidates).map((line) => loadRouteStopCountSummary(line.lineKey, { silent: true }).catch(() => false))
  );

  if (results.some(Boolean)) {
    renderLineList();
    renderProgress();
    if (typeof renderLineView === "function" && appState.lineViewOpen) {
      renderLineView();
    }
    if (typeof updateLoadingStatus === "function") {
      updateLoadingStatus();
    }
  }

  return true;
}

async function ensureLineHeadwayLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (!options.forceRefresh && !lineNeedsHeadwayLookup(line)) {
    return false;
  }

  if (appState.inFlightHeadwayLineKeys.has(normalizedLineKey)) {
    return false;
  }

  const lineLabel = lineDisplayName(line);
  const routeLookupKey = String(line.routeOnestopId || normalizedLineKey).trim();

  appState.inFlightHeadwayLineKeys.add(normalizedLineKey);

  try {
    const params = new URLSearchParams({
      lineKey: routeLookupKey
    });

    if (options.forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/route-headway?${params.toString()}`, {
      method: "GET"
    });

    const headwayUpdate = normalizeHeadwayUpdate(payload);
    const didUpdate = applyHeadwayUpdateToCachedTransit(normalizedLineKey, headwayUpdate);

    if (didUpdate) {
      refreshUiFromState();
      restoreUserStatusFromFocus();
    }

    if (!options.silent && headwayUpdate.headwayBestMinutes !== null) {
      setStatus(`Updated frequency for ${lineLabel}.`, "ok");
    }

    return didUpdate;
  } catch (error) {
    if (!options.silent) {
      setStatus(`Could not refresh frequency for ${lineLabel}.`, "error", error.message);
    }
    return false;
  } finally {
    appState.inFlightHeadwayLineKeys.delete(normalizedLineKey);
  }
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
  if (typeof applyPlaceholderLayerFilter === "function") {
    applyPlaceholderLayerFilter();
  }
  const elapsed = performance.now() - t0;
  if (elapsed > 50) {
    console.log(`[perf] refreshUiFromState: ${elapsed.toFixed(1)}ms`);
  }
}

updateShowAllStopsUi();

