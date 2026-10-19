async function onMapMoveEnd() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  appState.currentViewportBbox = typeof mapBoundsToBbox === "function" ? mapBoundsToBbox() : null;
  appState.lastCameraMoveAt = Date.now();

  // Refresh the underlay/coverage before the backfill check.
  if (typeof updateUnderlay === "function") {
    await updateUnderlay();
  }

  if (typeof refreshUiFromState === "function") {
    refreshUiFromState();
  }

  if (typeof scheduleBackfillCheck === "function") {
    scheduleBackfillCheck();
  }
}

function updateLoadingStatus() {
  const routeStopLoadingCount = appState.inFlightLineStopKeys.size;
  const backfillInFlight = Boolean(appState.tileBackfillInFlight);
  const hasRoutes = Array.isArray(appState.lineSummaries) && appState.lineSummaries.some((line) => {
    if (typeof lineIsVisible === "function") {
      return lineIsVisible(line);
    }
    return true;
  });
  const zoom = appState.map && appState.mapReady ? Number(appState.map.getZoom()) : 0;

    // Background loading uses the corner badge, not a modal.
  if (hasRoutes) {
    if (routeStopLoadingCount > 0 || backfillInFlight) {
      const message = backfillInFlight
        ? String(appState.backfillMessage || "").trim() || "Fetching routes…"
        : "Loading route stops…";
      showMapLoadingBadge(message);
      if (dom.mapLoadingBadge && backfillInFlight) {
        dom.mapLoadingBadge.title = message;
      }
    } else {
      hideMapLoadingBadge();
    }
    clearMapNotice();
    const focusLabel = appState.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    setBackendStatus(
      backfillInFlight
        ? String(appState.backfillMessage || "").trim() || "Fetching routes for this viewport from Transitland…"
        : focusLabel
    );
    return;
  }

  // Nothing on screen: explain what is happening with the full card.
  if (routeStopLoadingCount > 0) {
    hideMapLoadingBadge();
    setMapNotice("Loading…", "", "neutral", "center");
    return;
  }

  if (backfillInFlight) {
    hideMapLoadingBadge();
    const stage = String(appState.backfillStage || "");
    const detail = String(appState.backfillMessage || "").trim() ||
      "Fetching from Transitland and rebuilding tiles. This may take a moment.";
    setMapNotice(
      stage === "rebuilding" ? "Rebuilding map tiles…" : "Loading new routes for this area…",
      detail,
      "neutral",
      "center"
    );
    const notice = document.getElementById("mapNotice");
    const fill = notice ? notice.querySelector(".map-notice-progress-fill") : null;
    if (fill) {
      fill.style.width = stage === "rebuilding" ? "82%" : "38%";
    }
    setBackendStatus(detail);
    return;
  }

  // Wait for the camera to settle before showing informational cards.
  const settled = Date.now() - Number(appState.lastCameraMoveAt || 0) >= 1200 &&
    (!appState.map || typeof appState.map.areTilesLoaded !== "function" || appState.map.areTilesLoaded());

  if (!settled) {
    hideMapLoadingBadge();
    clearMapNotice();
    return;
  }

  if (zoom < (typeof BACKFILL_MIN_ZOOM !== "undefined" ? BACKFILL_MIN_ZOOM : 8)) {
    hideMapLoadingBadge();
    setMapNotice(
      "Zoom in to load routes",
      `Routes load automatically at zoom level ${typeof BACKFILL_MIN_ZOOM !== "undefined" ? BACKFILL_MIN_ZOOM : 8} and higher.`,
      "neutral",
      "center"
    );
    setBackendStatus(`No routes loaded — current zoom ${Number(zoom).toFixed(1)} is below the loading threshold.`);
    return;
  }

  hideMapLoadingBadge();

    // Filters hide every route in this area.
  const anyLinesKnown = Array.isArray(appState.lineSummaries) && appState.lineSummaries.length > 0;
  if (anyLinesKnown) {
    setMapNotice(
      "No routes match your filters",
      "Adjust or clear the filters to see routes here.",
      "neutral",
      "center"
    );
    setBackendStatus("Routes exist for this viewport but are filtered out.");
    return;
  }

  // Separate "nothing here" from "not harvested yet".
  if (typeof hasIncompleteCoverage === "function" && hasIncompleteCoverage()) {
    setMapNotice(
      "Routes for this area aren't loaded yet",
      "They load automatically — this can take a moment.",
      "neutral",
      "center"
    );
    setBackendStatus("Archive has no routes for this viewport yet; backfill pending.");
    return;
  }

  setMapNotice(
    "No transit routes here yet",
    "If transit routes exist in this area they will load automatically.",
    "neutral",
    "center"
  );
  setBackendStatus("No routes rendered for the current viewport.");
}

function fitToArea(area) {
  if (!appState.map || !appState.mapReady || !area?.bbox) {
    return;
  }

  if (typeof fitMapToBbox === "function") {
    fitMapToBbox(area.bbox, {
      extraPadding: 40,
      duration: 650,
      maxZoom: 12.5
    });
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = area.bbox;
  appState.map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat]
    ],
    {
      padding: 40,
      duration: 650
    }
  );
}

function selectedCityPreset() {
  if (!appState.cities.length) {
    return null;
  }

  return appState.cities.find((city) => city.slug === appState.initialCitySlug) || appState.cities[0] || null;
}

async function loadCities() {
  const payload = await apiRequest("/api/catalog/cities", { method: "GET" });
  appState.cities = Array.isArray(payload.cities) ? payload.cities : [];

  // Published cities (with resolved route keys) drive the Cities menu/city mode.
  appState.publishedCities = Array.isArray(payload.published) ? payload.published : [];
  appState.cityRouteKeysBySlug = new Map(
    appState.publishedCities.map((city) => [String(city.slug || ""), new Set(city.routeKeys || [])])
  );

  // A stored city mode that is no longer published falls back to Globe View.
  if (appState.activeCitySlug && !appState.cityRouteKeysBySlug.has(appState.activeCitySlug)) {
    setActiveCitySlug("", { fly: false });
  }

  if (typeof renderCitiesMenu === "function") {
    renderCitiesMenu();
  }

  if (!appState.cities.length) {
    return;
  }

  const exists = appState.cities.some((city) => city.slug === appState.initialCitySlug);
  if (!exists) {
    appState.initialCitySlug = appState.cities[0].slug;
    if (typeof saveUserPreferences === "function") {
      saveUserPreferences({ initialCitySlug: appState.initialCitySlug }).catch(() => {});
    }
  }
}

function rebuildVisitedMap(items) {
  appState.visitedByLine = new Map();
  for (const item of items) {
    getVisitedSetForLine(item.lineKey).add(item.stationKey);
  }
}

async function loadProgress(options = {}) {
  if (!appState.user) {
    appState.visitedByLine = new Map();
    renderMapData();
    renderProgress();
    renderLineView({ forceStopRefresh: true });
    return;
  }

  const path = options.forceRefresh ? `/api/progress?_=${Date.now()}` : "/api/progress";
  const payload = await apiRequest(path, { method: "GET" });
  rebuildVisitedMap(payload.items || []);
  renderMapData();
  renderProgress();
  renderLineView({ forceStopRefresh: true });
}

async function clearRouteProgress(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  if (!appState.user) {
    setStatus("Sign in first to clear route progress.", "error");
    return;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineName = line ? lineDisplayName(line) : normalizedLineKey;

  resetClearRouteProgressConfirmation();

  try {
    const payload = await apiRequest("/api/progress/clear-route", {
      method: "POST",
      body: JSON.stringify({ lineKey: normalizedLineKey })
    });

    appState.visitedByLine.set(normalizedLineKey, new Set());
    renderMapData();
    renderProgress();
    renderLineView({ forceStopRefresh: true });
    if (line && appState.focusedLineKey === normalizedLineKey) {
      setUserStatusFromLine(line);
    } else {
      restoreUserStatusFromFocus();
    }

    setStatus(
      `Cleared progress for ${lineName}.`,
      "ok",
      `${Number(payload?.clearedCount || 0)} visited stations were reset.`
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}
