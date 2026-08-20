async function onMapMoveEnd() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  appState.currentViewportBbox = typeof mapBoundsToBbox === "function" ? mapBoundsToBbox() : null;

  // The placeholder underlay is the "Transitland has routes here" signal used by
  // gap detection, so wait for it before scheduling the backfill check.
  if (typeof fetchPlaceholder === "function") {
    try {
      await fetchPlaceholder(appState.currentViewportBbox, appState.map.getZoom());
    } catch {
      // Non-critical
    }
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

  if (routeStopLoadingCount > 0) {
    if (hasRoutes) {
      showMapLoadingBadge();
      clearMapNotice();
    } else {
      hideMapLoadingBadge();
      setMapNotice("Loading…", "", "neutral", "center");
    }
    return;
  }

  if (hasRoutes) {
    const focusLabel = appState.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    hideMapLoadingBadge();
    clearMapNotice();
    setBackendStatus(focusLabel);
    return;
  }

  if (backfillInFlight) {
    hideMapLoadingBadge();
    setMapNotice(
      "Loading new routes for this area…",
      "Fetching from Transitland and rebuilding tiles. This may take a moment.",
      "neutral",
      "center"
    );
    setBackendStatus("Fetching routes for this viewport from Transitland…");
    return;
  }

  if (zoom < (typeof BACKFILL_MIN_ZOOM !== "undefined" ? BACKFILL_MIN_ZOOM : 8)) {
    hideMapLoadingBadge();
    setMapNotice(
      "Zoom in to load routes",
      "Routes load automatically at zoom level 8 and higher.",
      "neutral",
      "center"
    );
    setBackendStatus(`No routes loaded — current zoom ${Number(zoom).toFixed(1)} is below the loading threshold.`);
    return;
  }

  hideMapLoadingBadge();
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

async function loadProgress() {
  if (!appState.user) {
    appState.visitedByLine = new Map();
    renderMapData();
    renderProgress();
    renderLineView({ forceStopRefresh: true });
    return;
  }

  const payload = await apiRequest("/api/progress", { method: "GET" });
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
