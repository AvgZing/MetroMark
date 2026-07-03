function getShownLines(options = {}) {
  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const ignoreFrequency = Boolean(options.ignoreFrequency);
  const ignoreSearch = options.ignoreSearch === undefined ? true : Boolean(options.ignoreSearch);
  const hasQuery = Boolean(query) && !ignoreSearch;

  const filtered = state.lineSummaries.filter((line) => {
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
  if (Array.isArray(state.loadedLineSummaries) && state.loadedLineSummaries.length > 0) {
    return state.loadedLineSummaries;
  }

  return Array.isArray(state.lineSummaries) ? state.lineSummaries : [];
}

function getToggleCountLines() {
  const summaryLines = Array.isArray(state.viewportSummaryTransit?.lineSummaries)
    ? state.viewportSummaryTransit.lineSummaries
    : Array.isArray(state.viewportSummaryLineSummaries)
      ? state.viewportSummaryLineSummaries
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

  if (!state.showProblematicGeometries && line?.lineKey) {
    const routeReview = state.routeReviewsByCity.get(line.lineKey);
    if (routeReview?.problematic_override === true) {
      return false;
    }
  }

  if (!state.showPrivateOperators && line?.operatorName) {
    const agencyReview = state.agencyReviewsByCity.get(line.operatorName);
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

function getRouteListLines() {
  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const hasQuery = Boolean(query);

  const listed = state.lineSummaries.filter((line) => {
    if (hasQuery) {
      return lineSearchText(line).includes(query);
    }

    if (typeof lineIntersectsCurrentViewport === "function" && !lineIntersectsCurrentViewport(line)) {
      return false;
    }

    if (lineVisibilityOverride(line.lineKey)) {
      return true;
    }

    return lineIsVisible(line);
  });

  listed.sort((a, b) => {
    // If there's a search query, prioritize visible matches first, then score.
    if (hasQuery) {
      const visibleA = typeof lineIntersectsCurrentViewport === "function" && lineIntersectsCurrentViewport(a) ? 1 : 0;
      const visibleB = typeof lineIntersectsCurrentViewport === "function" && lineIntersectsCurrentViewport(b) ? 1 : 0;
      if (visibleA !== visibleB) {
        return visibleB - visibleA;
      }

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

  return listed;
}

function getVisibleLineKeys(shownLines) {
  return new Set(shownLines.map((line) => line.lineKey));
}

function getVisitedSetForLine(lineKey) {
  const set = state.visitedByLine.get(lineKey);
  if (set) {
    return set;
  }
  const fresh = new Set();
  state.visitedByLine.set(lineKey, fresh);
  return fresh;
}

function getMapFeatureVisibilityState() {
  if (!state.transit) {
    return null;
  }

  const shownLines = getShownLines();
  const visibleLineKeys = getVisibleLineKeys(shownLines);
  const hasFocus = Boolean(state.focusedLineKey) && visibleLineKeys.has(state.focusedLineKey);
  const showAllStops = Boolean(state.showAllStops) && !hasFocus;

  return {
    shownLines,
    visibleLineKeys,
    hasFocus,
    showAllStops
  };
}

function buildMapFeatureStateSignature(visibility) {
  if (!visibility) {
    return "";
  }

  const visibleLineKeys = Array.from(visibility.visibleLineKeys || []).sort().join("|");
  const visitedSignature = Array.from(state.visitedByLine.entries())
    .map(([lineKey, set]) => `${String(lineKey || "").trim()}:${Number(set?.size || 0)}`)
    .sort()
    .join("|");

  return [
    visibility.hasFocus ? state.focusedLineKey : "",
    visibility.showAllStops ? "1" : "0",
    visibleLineKeys,
    visitedSignature
  ].join("::");
}

function syncMapSourceData() {
  if (!state.mapReady || !state.map) {
    return;
  }

  const routesSource = state.map.getSource("routes");
  const stopsSource = state.map.getSource("stops");

  const normalizeRouteFeature = (feature) => {
    const lineKey = String(feature?.properties?.line_key || feature?.id || "").trim();
    const featureId = String(feature?.id || feature?.properties?.feature_id || lineKey || "").trim();

    return {
      ...feature,
      id: featureId || undefined,
      properties: {
        ...feature?.properties,
        feature_id: featureId || undefined,
        line_key: lineKey || feature?.properties?.line_key || ""
      }
    };
  };

  const normalizeStopFeature = (feature) => {
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
  };

  if (!state.transit) {
    if (routesSource) {
      routesSource.setData(emptyFeatureCollection());
    }
    if (stopsSource) {
      stopsSource.setData(emptyFeatureCollection());
    }
    state.mapRenderedTransit = null;
    state.lastMapFeatureStateSignature = "";
    state.mapRouteFeatureStateCache = new Map();
    state.mapStopFeatureStateCache = new Map();
    return;
  }

  if (state.transit !== state.mapRenderedTransit) {
    state.lastMapFeatureStateSignature = "";
    state.mapRouteFeatureStateCache = new Map();
    state.mapStopFeatureStateCache = new Map();

    const routes = Array.isArray(state.transit?.routesGeoJson?.features)
      ? {
          ...state.transit.routesGeoJson,
          features: state.transit.routesGeoJson.features.map(normalizeRouteFeature)
        }
      : emptyFeatureCollection();

    // Replace focused route's geometry with full-detail version from route-stops cache
    if (state.focusedLineKey && routes.features.length > 0) {
      const stopCacheKey = routeStopCacheKey(state.focusedLineKey);
      const stopCache = state.lineStopsCache.get(stopCacheKey);
      const fullGeo = stopCache?.payload?.routesGeoJson?.features?.[0]?.geometry;
      if (fullGeo) {
        const idx = routes.features.findIndex((f) => f?.properties?.line_key === state.focusedLineKey);
        if (idx >= 0) {
          const orig = routes.features[idx];
          routes.features[idx] = { ...orig, geometry: fullGeo };
        }
      }
    }

    const stops = Array.isArray(state.transit?.stopsGeoJson?.features)
      ? {
          ...state.transit.stopsGeoJson,
          features: state.transit.stopsGeoJson.features.map(normalizeStopFeature)
        }
      : emptyFeatureCollection();

  if (routesSource) {
      routesSource.setData(routes);
      if (state.focusedLineKey) {
        const focused = routes.features.find((f) => f?.properties?.line_key === state.focusedLineKey);
        if (focused?.geometry?.coordinates) {
          const coords = focused.geometry.coordinates;
          const coordCount = Array.isArray(coords[0]?.[0]) ? coords.reduce((sum, seg) => sum + seg.length, 0) : coords.length;
          const firstCoord = JSON.stringify(Array.isArray(coords[0]?.[0]) ? coords[0][0] : coords[0]);
          const lastCoord = JSON.stringify(Array.isArray(coords[0]?.[0]) ? coords[coords.length - 1]?.slice(-1)[0] : coords[coords.length - 1]);
          console.log(`[geo] Focused route geometry: ${coordCount} coords, first=${firstCoord}, last=${lastCoord}, type=${focused.geometry.type}`);
        }
      }
    }
    if (stopsSource) {
      stopsSource.setData(stops);
    }

    state.mapRenderedTransit = state.transit || null;
  }
}

function syncMapFeatureStates() {
  if (!state.mapReady || !state.map || !state.transit) {
    return;
  }

  const visibility = getMapFeatureVisibilityState();
  if (!visibility) {
    return;
  }

  const signature = buildMapFeatureStateSignature(visibility);
  if (signature === state.lastMapFeatureStateSignature) {
    return;
  }
  state.lastMapFeatureStateSignature = signature;

  const routeStateCache = state.mapRouteFeatureStateCache instanceof Map
    ? state.mapRouteFeatureStateCache
    : new Map();
  const stopStateCache = state.mapStopFeatureStateCache instanceof Map
    ? state.mapStopFeatureStateCache
    : new Map();

  const routeFeatures = Array.isArray(state.transit.routesGeoJson?.features)
    ? state.transit.routesGeoJson.features
    : [];
  const seenRouteIds = new Set();
  for (const feature of routeFeatures) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    const featureId = String(feature?.id || feature?.properties?.feature_id || lineKey || "").trim();
    if (!featureId) {
      continue;
    }
    seenRouteIds.add(featureId);

    const visible = visibility.visibleLineKeys.has(lineKey) ? 1 : 0;
    const focused = visible && (!visibility.hasFocus || lineKey === state.focusedLineKey) ? 1 : 0;
    const nextState = {
      visible,
      focused,
      interactive: visible
    };
    const previousState = routeStateCache.get(featureId);
    const changed =
      !previousState ||
      previousState.visible !== nextState.visible ||
      previousState.focused !== nextState.focused ||
      previousState.interactive !== nextState.interactive;

    if (!changed) {
      continue;
    }

    state.map.setFeatureState(
      { source: "routes", id: featureId },
      nextState
    );
    routeStateCache.set(featureId, nextState);
  }

  for (const cachedId of Array.from(routeStateCache.keys())) {
    if (!seenRouteIds.has(cachedId)) {
      routeStateCache.delete(cachedId);
    }
  }

  const stopFeatures = Array.isArray(state.transit.stopsGeoJson?.features)
    ? state.transit.stopsGeoJson.features
    : [];
  const seenStopIds = new Set();
  for (const feature of stopFeatures) {
    const props = feature?.properties || {};
    const lineKey = String(props.line_key || "").trim();
    const stationKey = String(props.station_key || "").trim();
    const featureId = String(feature?.id || props.feature_id || `${lineKey}|${stationKey}` || "").trim();
    if (!featureId) {
      continue;
    }
    seenStopIds.add(featureId);

    const visible = visibility.hasFocus
      ? lineKey === state.focusedLineKey
      : visibility.showAllStops && visibility.visibleLineKeys.has(lineKey)
        ? 1
        : 0;
    const nextState = {
      visible,
      focused: visibility.hasFocus ? 1 : 0,
      interactive: visibility.hasFocus ? 1 : 0,
      show_all: visibility.showAllStops ? 1 : 0,
      visited: getVisitedSetForLine(lineKey).has(stationKey) ? 1 : 0
    };
    const previousState = stopStateCache.get(featureId);
    const changed =
      !previousState ||
      previousState.visible !== nextState.visible ||
      previousState.focused !== nextState.focused ||
      previousState.interactive !== nextState.interactive ||
      previousState.show_all !== nextState.show_all ||
      previousState.visited !== nextState.visited;

    if (!changed) {
      continue;
    }

    state.map.setFeatureState(
      { source: "stops", id: featureId },
      nextState
    );
    stopStateCache.set(featureId, nextState);
  }

  for (const cachedId of Array.from(stopStateCache.keys())) {
    if (!seenStopIds.has(cachedId)) {
      stopStateCache.delete(cachedId);
    }
  }

  state.mapRouteFeatureStateCache = routeStateCache;
  state.mapStopFeatureStateCache = stopStateCache;
}

function renderMapData() {
  const t0 = performance.now();
  if (!state.mapReady || !state.map) {
    return;
  }

  syncMapSourceData();
  syncMapFeatureStates();

  const focusMaskSource = state.map.getSource("focus-mask");
  if (focusMaskSource) {
    focusMaskSource.setData(focusMaskFeatureCollection(Boolean(state.focusedLineKey)));
  }
  const elapsed = performance.now() - t0;
  if (elapsed > 30) {
    console.log(`[perf] renderMapData: ${elapsed.toFixed(1)}ms`);
  }
}

function updateShowAllStopsUi() {
  if (!els.showAllStopsBtn) {
    return;
  }

  const active = Boolean(state.showAllStops);
  els.showAllStopsBtn.classList.toggle("is-active", active);
  els.showAllStopsBtn.setAttribute("aria-pressed", active ? "true" : "false");
  els.showAllStopsBtn.textContent = active ? "All Stops On" : "Show All Stops";
}

function setShowAllStops(enabled, options = {}) {
  state.showAllStops = Boolean(enabled);
  persistBooleanToStorage(SHOW_ALL_STOPS_STORAGE_KEY, state.showAllStops);
  updateShowAllStopsUi();
  renderMapData();

  if (options.silent) {
    return;
  }

  setStatus(
    state.showAllStops ? "Showing all stops." : "Showing route-linked stops only.",
    "ok"
  );
}

function lineSummaryByKey() {
  return new Map(state.lineSummaries.map((line) => [line.lineKey, line]));
}

function renderProgress() {
  if (!state.user) {
    els.progressSummary.textContent = "Sign in to track progress.";
    els.lineProgressList.innerHTML = "";
    const overallProgressCard = document.getElementById("overallProgressCard");
    if (overallProgressCard) {
      overallProgressCard.hidden = true;
    }
    els.lineProgressList.hidden = true;
    return;
  }

  const overallProgressCard = document.getElementById("overallProgressCard");
  if (overallProgressCard) {
    overallProgressCard.hidden = false;
  }
  els.lineProgressList.hidden = false;

  if (!state.transit) {
    els.progressSummary.textContent = "Pan or zoom the map and routes will load automatically.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const visibleLines = getShownLines();
  if (!visibleLines.length) {
    els.progressSummary.textContent = "No routes are visible for the active mode/frequency filters.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const rows = visibleLines
    .map((line) => {
      const metrics = lineProgressMetrics(line.lineKey, Number(line.stopCount || 0));

      return {
        lineKey: line.lineKey,
        lineName: lineDisplayName(line),
        visited: metrics.visited,
        total: metrics.total,
        percent: metrics.percent
      };
    })
    .sort((a, b) => {
      const percentDiff = b.percent - a.percent;
      if (percentDiff !== 0) {
        return percentDiff;
      }

      const visitedDiff = b.visited - a.visited;
      if (visitedDiff !== 0) {
        return visitedDiff;
      }

      return a.lineName.localeCompare(b.lineName);
    });

  const withKnownStops = rows.filter((row) => row.total > 0).length;
  els.progressSummary.textContent = `${visibleLines.length} visible routes. ${withKnownStops} with loaded stop totals.`;

  // Calculate and render overall progress
  const totalVisited = rows.reduce((sum, row) => sum + row.visited, 0);
  const totalStops = rows.reduce((sum, row) => sum + row.total, 0);
  const overallPercent = totalStops > 0 ? Math.round((totalVisited / totalStops) * 100) : 0;
  
  const overallProgressText = document.getElementById("overallProgressText");
  const overallProgressFill = document.getElementById("overallProgressFill");
  
  if (overallProgressText) {
    overallProgressText.textContent = `${totalVisited} / ${totalStops} (${overallPercent}%)`;
  }
  
  if (overallProgressFill) {
    overallProgressFill.style.width = `${overallPercent}%`;
  }

  els.lineProgressList.innerHTML = "";

  for (const row of rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "line-progress-row";

    // Get the line to access its color
    const line = state.lineSummaries.find((l) => l.lineKey === row.lineKey);
    const lineColor = line?.color || "#177ca2";

    // Create color dot
    const colorDot = document.createElement("div");
    colorDot.className = "line-progress-color-dot";
    colorDot.style.backgroundColor = lineColor;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "line-progress-name";
    label.textContent =
      row.total > 0
        ? `${row.lineName} (${row.visited}/${row.total})`
        : `${row.lineName} (${row.visited} visited, total unknown)`;

    label.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openLineView === "function") {
        openLineView(row.lineKey);
      }
    });

    const meter = document.createElement("div");
    meter.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.backgroundColor = lineColor; // Also color the progress fill

    const linePercent = row.total ? Math.round((row.visited / row.total) * 100) : 0;
    fill.style.width = `${linePercent}%`;

    meter.append(fill);

    const mainRow = document.createElement("div");
    mainRow.className = "line-progress-main";
    mainRow.append(colorDot, label);

    const percentLabel = document.createElement("span");
    percentLabel.textContent = `${linePercent}%`;

    wrapper.append(mainRow, percentLabel);
    wrapper.append(meter);

    els.lineProgressList.append(wrapper);
  }
}

function renderModeFilterBar() {
  els.modeFilterBar.innerHTML = "";

  const linesForCounts = getToggleCountLines().filter((line) => lineEligibleForToggleCounts(line));
  const counts = new Map(MODE_DEFS.map((mode) => [mode.key, 0]));

  for (const line of linesForCounts) {
    const modeKey = lineModeKey(line);
    counts.set(modeKey, (counts.get(modeKey) || 0) + 1);
  }

  const chips = MODE_DEFS.map((modeDef) => ({
    key: modeDef.key,
    label: modeDef.label,
    count: modeDef.key === MODE_FILTER_ALL ? linesForCounts.length : counts.get(modeDef.key) || 0
  }));
  const uncertainCounts = areFilterCountsUncertain();

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${filterChipCountLabel(chip.count, uncertainCounts)})`;
    if (uncertainCounts) {
      button.title = "Route totals are still loading for this view.";
    }

    if (state.activeModeKeys.has(chip.key)) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (chip.key === MODE_FILTER_ALL) {
        state.activeModeKeys = new Set([MODE_FILTER_ALL]);
      } else {
        if (state.activeModeKeys.has(chip.key)) {
          state.activeModeKeys.delete(chip.key);
        } else {
          state.activeModeKeys.delete(MODE_FILTER_ALL);
          state.activeModeKeys.add(chip.key);
        }

        if (!state.activeModeKeys.size) {
          state.activeModeKeys.add(MODE_FILTER_ALL);
        }
      }

      normalizeModeSelection();
      clearStatusPin();
      resetClearRouteProgressConfirmation();

      const shown = getShownLines();
      if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
        state.focusedLineKey = "";
      }

      renderModeFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();
      restoreUserStatusFromFocus();

      const selectedLabels = MODE_DEFS.filter((modeDef) => state.activeModeKeys.has(modeDef.key)).map(
        (modeDef) => modeDef.label
      );

      setStatus("Mode filter updated.", "ok", `Showing: ${selectedLabels.join(", ")}.`);

      loadVisibleTransit({ forceRefresh: false, reason: "mode-filter-change" }).catch((error) => {
        setBackendStatus(`Mode-filter fetch failed: ${error.message}`);
      });
      if (typeof saveDefaultPresetDebounced === "function") {
        try { saveDefaultPresetDebounced(); } catch (e) {}
      }
    });

    els.modeFilterBar.append(button);
  }
}

function renderFrequencyFilterBar() {
  els.frequencyFilterBar.innerHTML = "";

  const baseLines = getToggleCountLines().filter((line) =>
    lineEligibleForToggleCounts(line, {
      requireModeMatch: true
    })
  );

  const buckets = new Map([
    [FREQUENCY_FILTER_FREQUENT, 0],
    [FREQUENCY_FILTER_REGULAR, 0],
    [FREQUENCY_FILTER_LOCAL, 0],
    [FREQUENCY_FILTER_UNKNOWN, 0]
  ]);

  for (const line of baseLines) {
    const bucket = lineFrequencyBucket(line);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }

  const chips = [
    {
      key: FREQUENCY_FILTER_ALL,
      label: frequencyBucketLabel(FREQUENCY_FILTER_ALL),
      count: baseLines.length
    },
    {
      key: FREQUENCY_FILTER_FREQUENT,
      label: frequencyBucketLabel(FREQUENCY_FILTER_FREQUENT),
      count: buckets.get(FREQUENCY_FILTER_FREQUENT) || 0
    },
    {
      key: FREQUENCY_FILTER_REGULAR,
      label: frequencyBucketLabel(FREQUENCY_FILTER_REGULAR),
      count: buckets.get(FREQUENCY_FILTER_REGULAR) || 0
    },
    {
      key: FREQUENCY_FILTER_LOCAL,
      label: frequencyBucketLabel(FREQUENCY_FILTER_LOCAL),
      count: buckets.get(FREQUENCY_FILTER_LOCAL) || 0
    },
    {
      key: FREQUENCY_FILTER_UNKNOWN,
      label: "Unknown",
      count: buckets.get(FREQUENCY_FILTER_UNKNOWN) || 0
    }
  ];

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${chip.count})`;

    if (state.activeFrequencyKeys.has(chip.key)) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (chip.key === FREQUENCY_FILTER_ALL) {
        state.activeFrequencyKeys = new Set([FREQUENCY_FILTER_ALL]);
      } else {
        if (state.activeFrequencyKeys.has(chip.key)) {
          state.activeFrequencyKeys.delete(chip.key);
        } else {
          state.activeFrequencyKeys.delete(FREQUENCY_FILTER_ALL);
          state.activeFrequencyKeys.add(chip.key);
        }

        if (!state.activeFrequencyKeys.size) {
          state.activeFrequencyKeys.add(FREQUENCY_FILTER_ALL);
        }
      }

      normalizeFrequencySelection();
      clearStatusPin();
      resetClearRouteProgressConfirmation();

      const shown = getShownLines();
      if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
        state.focusedLineKey = "";
      }

      renderFrequencyFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();
      restoreUserStatusFromFocus();

      const selected = Array.from(state.activeFrequencyKeys)
        .map((value) => frequencyBucketLabel(value))
        .join(", ");

      setStatus("Frequency filter updated.", "ok", `Active frequencies: ${selected}.`);
      if (typeof saveDefaultPresetDebounced === "function") {
        try { saveDefaultPresetDebounced(); } catch (e) {}
      }
    });

    els.frequencyFilterBar.append(button);
  }
}

function compactRouteStopsPayload(payload) {
  if (!payload) {
    return {
      stopsGeoJson: { type: "FeatureCollection", features: [] },
      directionStopSequences: null,
      directionStopPatterns: null,
      matchingStats: null,
      headwaySummary: null,
      routesGeoJson: null
    };
  }

  const {
    lineSummaries: _lineSummaries,
    ...rest
  } = payload;

  return {
    ...rest,
    stopsGeoJson: rest.stopsGeoJson || { type: "FeatureCollection", features: [] },
    routesGeoJson: rest.routesGeoJson || null,
    directionStopSequences: rest.directionStopSequences || null,
    directionStopPatterns: rest.directionStopPatterns || null,
    matchingStats: rest.matchingStats ? { ...rest.matchingStats } : null,
    headwaySummary: rest.headwaySummary ? { ...rest.headwaySummary } : null
  };
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
  const existing = state.lineStopsCache.get(cacheKey);
  const requestOptions = { ...options };
  if (existing && !requestOptions.forceRefresh) {
    if (requestOptions.cacheOnly) {
      existing.lastUsedAt = Date.now();
      return true;
    }

    const needsPatternRefresh = !existing.payload?.directionStopPatterns && !existing.patternsRefreshAttempted;
    if (!needsPatternRefresh) {
      if (state.routeStopsAutoLoadAttempts) {
        state.routeStopsAutoLoadAttempts.delete(cacheKey);
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

  if (state.inFlightLineStopKeys.has(cacheKey)) {
    return false;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineLabel = line ? lineDisplayName(line) : normalizedLineKey;
  const routeStopLookupKey = String(line?.routeOnestopId || normalizedLineKey).trim();

  state.inFlightLineStopKeys.add(cacheKey);
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

    state.lineStopsCache.set(cacheKey, {
      lineKey: normalizedLineKey,
      stopTypesKey: ROUTE_STOP_TYPES_KEY,
      payload: compactPayload,
      cacheStatus: payload.cacheStatus || "miss",
      lastUsedAt: Date.now()
    });

    if (state.routeStopsAutoLoadAttempts) {
      state.routeStopsAutoLoadAttempts.delete(cacheKey);
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
    state.inFlightLineStopKeys.delete(cacheKey);
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

  state.lineSummaries = state.lineSummaries.map((line) => {
    if (line.lineKey !== normalizedLineKey) {
      return line;
    }

    updated = true;
    return {
      ...line,
      ...headwayUpdate
    };
  });

  if (state.transit?.routesGeoJson?.features) {
    for (const feature of state.transit.routesGeoJson.features) {
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

  for (const cacheEntry of state.areaCache.values()) {
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

  state.lineSummaries = state.lineSummaries.map(updateLine);

  if (Array.isArray(state.loadedLineSummaries) && state.loadedLineSummaries.length > 0) {
    state.loadedLineSummaries = state.loadedLineSummaries.map(updateLine);
  }

  if (state.transit?.routesGeoJson?.features) {
    state.transit.routesGeoJson.features = state.transit.routesGeoJson.features.map((feature) => {
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

  for (const cacheEntry of state.areaCache.values()) {
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

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (Number(line.stopCount || 0) > 0) {
    return true;
  }

  if (state.routeStopCountLoadAttempts.has(normalizedLineKey) || state.inFlightRouteStopCountKeys.has(normalizedLineKey)) {
    return false;
  }

  state.routeStopCountLoadAttempts.add(normalizedLineKey);
  state.inFlightRouteStopCountKeys.add(normalizedLineKey);

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
    state.inFlightRouteStopCountKeys.delete(normalizedLineKey);
  }
}

async function loadVisibleRouteStopCounts() {
  if (!state.lineSummaries.length) {
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

    if (state.routeStopCountLoadAttempts.has(line.lineKey)) {
      return false;
    }

    if (state.inFlightRouteStopCountKeys.has(line.lineKey)) {
      return false;
    }

    if (state.focusedLineKey === line.lineKey) {
      return false;
    }

    if (state.lineViewOpen && state.lineViewLineKey === line.lineKey) {
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
    if (typeof renderLineView === "function" && state.lineViewOpen) {
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

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (!options.forceRefresh && !lineNeedsHeadwayLookup(line)) {
    return false;
  }

  if (state.inFlightHeadwayLineKeys.has(normalizedLineKey)) {
    return false;
  }

  const lineLabel = lineDisplayName(line);
  const routeLookupKey = String(line.routeOnestopId || normalizedLineKey).trim();

  state.inFlightHeadwayLineKeys.add(normalizedLineKey);

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
    state.inFlightHeadwayLineKeys.delete(normalizedLineKey);
  }
}

function clearFocusedLine(statusMessage = "Route focus cleared.", statusMeta = "Click a route to focus it.") {
  if (!state.focusedLineKey) {
    closeRouteSelectionPopup();
    return;
  }

  if (state.lineViewOpen && typeof closeLineView === "function") {
    closeLineView({ restore: false });
  }

  closeRouteSelectionPopup();
  clearStatusPin();
  resetClearRouteProgressConfirmation();

  state.focusedLineKey = "";
  renderMapData();
  renderLineList();
  renderProgress();
  if (typeof renderLineView === "function") {
    renderLineView();
  }
  restoreUserStatusFromFocus();
  setStatus(statusMessage, "ok", statusMeta);
}

async function setFocusedLine(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  closeRouteSelectionPopup();

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return;
  }

  clearStatusPin();
  resetClearRouteProgressConfirmation();

  if (state.focusedLineKey === normalizedLineKey && !options.forceRefresh) {
    setUserStatusFromLine(line);
    const headwayLookupPromise = ensureLineHeadwayLoaded(normalizedLineKey, {
      forceRefresh: false,
      silent: true
    });
    await ensureLineStopsLoaded(normalizedLineKey, {
      forceRefresh: false,
      silent: false
    });
    await headwayLookupPromise;
    renderMapData();
    renderProgress();
    if (typeof renderLineView === "function") {
      renderLineView();
    }
    restoreUserStatusFromFocus();
    return;
  }

  state.focusedLineKey = normalizedLineKey;
  
  // If line view is open, update the line shown in line view to match focused line
  if (state.lineViewOpen) {
    state.lineViewLineKey = normalizedLineKey;
  } else if (state.lineViewAutoOpenEnabled && !isPortraitMobileLayout()) {
    // Auto-open line view on desktop if enabled
    await openLineView(normalizedLineKey);
  }
  
  setUserStatusFromLine(line);
  renderMapData();
  renderLineList();
  renderProgress();

  setStatus(
    `Focused on ${lineDisplayName(line)}.`,
    "ok",
    "Loading route-linked stops and details. Other routes stay visible in a dimmed state."
  );

  const headwayLookupPromise = ensureLineHeadwayLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: true
  });

  await ensureLineStopsLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: false
  });

  await headwayLookupPromise;

  renderMapData();
  renderProgress();
  if (typeof renderLineView === "function") {
    renderLineView();
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
  if (state.focusedLineKey && !shown.some((entry) => entry.lineKey === state.focusedLineKey)) {
    state.focusedLineKey = "";
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

function renderLineList() {
  els.lineList.innerHTML = "";

  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const hasQuery = Boolean(query);
  const visibleLines = getShownLines({ ignoreSearch: true });
  const routeListLines = getRouteListLines();
  const overrideCount = routeListLines.filter((line) => Boolean(lineVisibilityOverride(line.lineKey))).length;

  if (els.routeListSummary) {
    if (hasQuery) {
      els.routeListSummary.textContent =
        overrideCount > 0
          ? `Results (${routeListLines.length}, ${overrideCount} overrides)`
          : `Results (${routeListLines.length})`;
    } else {
      els.routeListSummary.textContent =
        overrideCount > 0
          ? `Filtered routes (${visibleLines.length} visible, ${overrideCount} overrides)`
          : `Filtered routes (${visibleLines.length} visible)`;
    }
  }

  if (els.routeListDropdown && hasQuery) {
    els.routeListDropdown.open = true;
  }

  if (!state.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Routes appear here once nearby areas are loaded.";
    els.lineList.append(empty);
    return;
  }

  if (!routeListLines.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = hasQuery
      ? "No matching routes found. Try adjusting the filters? If a route you're looking for isn't available, first check if it exists on https://www.transit.land/map."
      : "No routes are visible. Adjust filters or search for a route and set it ON.";
    els.lineList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  routeListLines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "line-item";

    const focused = state.focusedLineKey && state.focusedLineKey === line.lineKey;
    const faded = state.focusedLineKey && state.focusedLineKey !== line.lineKey;
    const override = lineVisibilityOverride(line.lineKey);
    const visible = lineIsVisible(line);

    if (focused) {
      row.classList.add("is-focused");
    }
    if (faded) {
      row.classList.add("is-faded");
    }
    if (!visible) {
      row.classList.add("is-hidden");
    }
    if (override === "on") {
      row.classList.add("is-manual-on");
    }
    if (override === "off") {
      row.classList.add("is-manual-off");
    }

    const focusButton = document.createElement("button");
    focusButton.type = "button";
    focusButton.className = "line-item-focus";
    focusButton.disabled = !visible;
    focusButton.title = visible ? "Focus this route on the map" : "Set route visibility to ON to focus it";

    const dot = document.createElement("span");
    dot.className = "line-color-dot";
    dot.style.backgroundColor = line.color;

    const labelBlock = document.createElement("div");

    const name = document.createElement("span");
    name.className = "line-name line-name-btn";
    name.textContent = lineDisplayName(line);

    name.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openLineView === "function") {
        openLineView(line.lineKey);
      }
    });

    const meta = document.createElement("p");
    meta.className = "line-meta";
    meta.textContent = `${lineMode(line)} - ${lineOperatorLabel(line)} - ${lineHeadwayLabel(line)}`;

    if (override === "on" || override === "off") {
      meta.textContent = `${meta.textContent} - Manual ${override.toUpperCase()}`;
    }

    if (!visible && !override) {
      meta.textContent = `${meta.textContent} - Hidden by filters`;
    }

    labelBlock.append(name, meta);

    focusButton.append(dot, labelBlock);

    focusButton.addEventListener("click", async () => {
      try {
        await setFocusedLine(line.lineKey);
        // On desktop, open Line View by default when selecting a route
        if (!isPortraitMobileLayout() && typeof openLineView === "function") {
          openLineView(line.lineKey);
        }
      } catch (error) {
        setStatus(error.message, "error");
      }
    });

    const sideStack = document.createElement("div");
    sideStack.className = "line-side-stack";

    const sideTop = document.createElement("div");
    sideTop.className = "line-side-top";

    const routeStopsCacheKeyValue = routeStopCacheKey(line.lineKey);
    const routeStopsCacheEntry = state.lineStopsCache.get(routeStopsCacheKeyValue);
    const routeStopsFullyLoaded = Boolean(routeStopsCacheEntry?.payload?.stopsGeoJson?.features?.length);
    const routeStopsLoaded = routeStopsFullyLoaded || Number(line.stopCount || 0) > 0;
    const loadedFeatures = Array.isArray(routeStopsCacheEntry?.payload?.stopsGeoJson?.features)
      ? routeStopsCacheEntry.payload.stopsGeoJson.features
      : [];
    const dedupedLoadedStopCount = loadedFeatures.length
      ? new Set(
          loadedFeatures
            .map((feature) => {
              const props = feature?.properties || {};
              return String(
                props.station_key ||
                props.parent_stop_id ||
                props.stop_id ||
                props.station_name ||
                props.stop_name ||
                ""
              )
                .trim()
                .toLowerCase();
            })
            .filter(Boolean)
        ).size
      : 0;
    const routeStopsCount = Number(
      dedupedLoadedStopCount ||
      line.stopCount ||
      routeStopsCacheEntry?.payload?.matchingStats?.centralizedStops ||
      routeStopsCacheEntry?.payload?.matchingStats?.lineDedupedStops ||
      routeStopsCacheEntry?.payload?.lineSummaries?.[0]?.stopCount ||
      0
    );
    const routeStopsLoading = state.inFlightLineStopKeys.has(routeStopsCacheKeyValue);
    const routeStopsAutoAttempted = Boolean(state.routeStopsAutoLoadAttempts?.has(routeStopsCacheKeyValue));
    const isFocusedRoute =
      state.focusedLineKey === line.lineKey ||
      (state.lineViewOpen && state.lineViewLineKey === line.lineKey);

    if (isFocusedRoute && !routeStopsFullyLoaded && !routeStopsLoading && !routeStopsAutoAttempted) {
      if (!state.routeStopsAutoLoadAttempts) {
        state.routeStopsAutoLoadAttempts = new Map();
      }
      state.routeStopsAutoLoadAttempts.set(routeStopsCacheKeyValue, Date.now());
      ensureLineStopsLoaded(line.lineKey, {
        forceRefresh: false,
        silent: true,
        cacheOnly: true
      }).catch(() => {});
    }

    const shouldShowLoadingStops = !routeStopsLoaded && (routeStopsLoading || (isFocusedRoute && !routeStopsAutoAttempted));

    if (routeStopsLoaded) {
      const stopCount = document.createElement("span");
      stopCount.className = "line-stop-count";
      stopCount.textContent = `${routeStopsCount} stops`;
      sideTop.append(stopCount);
    } else if (shouldShowLoadingStops) {
      const loading = document.createElement("span");
      loading.className = "line-stop-count";
      loading.textContent = "Loading stops...";
      sideTop.append(loading);
    } else {
      const loadStopsBtn = document.createElement("button");
      loadStopsBtn.type = "button";
      loadStopsBtn.className = "line-stop-load-btn";
      loadStopsBtn.textContent = "Load stops";

      loadStopsBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ensureLineStopsLoaded(line.lineKey, {
          forceRefresh: false,
          silent: false
        }).catch((error) => {
          setStatus(error.message, "error");
        });
      });

      sideTop.append(loadStopsBtn);
    }

    const controls = document.createElement("div");
    controls.className = "line-visibility-controls";

    const onButton = document.createElement("button");
    onButton.type = "button";
    onButton.className = "line-visibility-btn is-on";
    onButton.textContent = "ON";

    const defaultButton = document.createElement("button");
    defaultButton.type = "button";
    defaultButton.className = "line-visibility-btn is-default";
    defaultButton.textContent = "-";

    const offButton = document.createElement("button");
    offButton.type = "button";
    offButton.className = "line-visibility-btn is-off";
    offButton.textContent = "OFF";

    if (override === "on") {
      onButton.classList.add("is-active");
    } else if (override === "off") {
      offButton.classList.add("is-active");
    } else {
      defaultButton.classList.add("is-active");
    }

    if (override === "on") {
      onButton.classList.add("is-manual");
    }
    if (override === "off") {
      offButton.classList.add("is-manual");
    }

    onButton.setAttribute("aria-pressed", override === "on" ? "true" : "false");
    defaultButton.setAttribute("aria-pressed", !override ? "true" : "false");
    offButton.setAttribute("aria-pressed", override === "off" ? "true" : "false");

    onButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyLineVisibilityPreference(line, "on");
    });

    defaultButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyLineVisibilityPreference(line, "");
    });

    offButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyLineVisibilityPreference(line, "off");
    });

    controls.append(onButton, defaultButton, offButton);

    sideStack.append(sideTop, controls);

    row.append(focusButton, sideStack);

    fragment.append(row);
  });

  els.lineList.append(fragment);
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
  const elapsed = performance.now() - t0;
  if (elapsed > 50) {
    console.log(`[perf] refreshUiFromState: ${elapsed.toFixed(1)}ms`);
  }
}

updateShowAllStopsUi();

