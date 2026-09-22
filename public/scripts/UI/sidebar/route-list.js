function getRouteListLines() {
  const query = String(appState.lineSearchQuery || "").trim().toLowerCase();
  const hasQuery = Boolean(query);

  const listed = appState.lineSummaries.filter((line) => {
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

function renderLineList() {
  dom.lineList.innerHTML = "";

  const query = String(appState.lineSearchQuery || "").trim().toLowerCase();
  const hasQuery = Boolean(query);
  const visibleCount = getShownLines({ ignoreSearch: true }).length;
  const routeListLines = getRouteListLines();
  const overrideCount = routeListLines.filter((line) => Boolean(lineVisibilityOverride(line.lineKey))).length;

  if (dom.routeListSummary) {
    dom.routeListSummary.textContent = hasQuery
      ? `Results (${routeListLines.length})`
      : `Routes (${visibleCount}${overrideCount > 0 ? `, ${overrideCount} overridden` : ""})`;
  }
  if (dom.routeListDropdown && hasQuery) {
    dom.routeListDropdown.open = true;
  }

  if (!appState.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Routes appear here once nearby areas are loaded.";
    dom.lineList.append(empty);
    return;
  }

  if (!routeListLines.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = hasQuery
      ? "No matching routes found. Try adjusting the filters? If a route you're looking for isn't available, first check if it exists on https://www.transit.land/map."
      : "No routes are visible. Adjust filters or search for a route and set it ON.";
    dom.lineList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  // Cap the number of DOM rows rendered at once. At global scale the visible
  // set can be thousands of routes; rendering all of them at once is the
  // biggest cause of UI lag. Search still reaches any route.
  const MAX_ROUTE_LIST_ROWS = 300;
  const renderLines = routeListLines.slice(0, MAX_ROUTE_LIST_ROWS);
  const totalRouteCount = routeListLines.length;

  renderLines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "line-item";

    const focused = appState.focusedLineKey && appState.focusedLineKey === line.lineKey;
    const faded = appState.focusedLineKey && appState.focusedLineKey !== line.lineKey;
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

    const dot = document.createElement("span");
    dot.className = "line-color-dot";
    dot.style.backgroundColor = line.color;

    const name = document.createElement("span");
    name.className = "line-name line-name-btn";
    name.textContent = lineDisplayName(line);

    name.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof openLineView === "function") {
        openLineView(line.lineKey, { zoom: true });
      }
    });

    const meta = document.createElement("p");
    meta.className = "line-meta";
    meta.textContent = `${lineMode(line)} - ${lineOperatorLabel(line)} - ${lineHeadwayLabel(line)}`;

    if (!visible && !override) {
      meta.textContent = `${meta.textContent} - Hidden by filters`;
    }

    const sideTop = document.createElement("div");
    sideTop.className = "line-side-top";

    const routeStopsCacheKeyValue = routeStopCacheKey(line.lineKey);
    const routeStopsCacheEntry = appState.lineStopsCache.get(routeStopsCacheKeyValue);
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
    const routeStopsLoading = appState.inFlightLineStopKeys.has(routeStopsCacheKeyValue);
    const routeStopsAutoAttempted = Boolean(appState.routeStopsAutoLoadAttempts?.has(routeStopsCacheKeyValue));
    const isFocusedRoute =
      appState.focusedLineKey === line.lineKey ||
      (appState.lineViewOpen && appState.lineViewLineKey === line.lineKey);

    if (isFocusedRoute && !routeStopsFullyLoaded && !routeStopsLoading && !routeStopsAutoAttempted) {
      if (!appState.routeStopsAutoLoadAttempts) {
        appState.routeStopsAutoLoadAttempts = new Map();
      }
      appState.routeStopsAutoLoadAttempts.set(routeStopsCacheKeyValue, Date.now());
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
    onButton.title = "Always show this route, regardless of filters";

    const defaultButton = document.createElement("button");
    defaultButton.type = "button";
    defaultButton.className = "line-visibility-btn is-default";
    defaultButton.textContent = "—";
    defaultButton.title = "Follow the filters (no override)";

    const offButton = document.createElement("button");
    offButton.type = "button";
    offButton.className = "line-visibility-btn is-off";
    offButton.textContent = "OFF";
    offButton.title = "Always hide this route, regardless of filters";

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

    row.append(dot, name, meta, sideTop, controls);

    fragment.append(row);
  });

  if (totalRouteCount > MAX_ROUTE_LIST_ROWS) {
    const note = document.createElement("p");
    note.className = "microcopy";
      note.textContent = `Showing first ${MAX_ROUTE_LIST_ROWS} routes.`;
    fragment.append(note);
  }

  dom.lineList.append(fragment);
}
