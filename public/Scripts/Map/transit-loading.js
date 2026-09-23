async function onMapMoveEnd() {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  appState.currentViewportBbox = typeof mapBoundsToBbox === "function" ? mapBoundsToBbox() : null;
  appState.lastCameraMoveAt = Date.now();

  // Refresh the Transitland underlay + coverage count for this viewport before
  // deciding whether a backfill is needed (the backfill check runs after
  // moveend).
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

  // Routes on screen: anything running in the background is the small corner
  // badge, never a modal over the map the user is reading.
  if (hasRoutes) {
    if (routeStopLoadingCount > 0 || backfillInFlight) {
      showMapLoadingBadge();
    } else {
      hideMapLoadingBadge();
    }
    clearMapNotice();
    const focusLabel = appState.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    setBackendStatus(backfillInFlight ? "Fetching routes for this viewport from Transitland…" : focusLabel);
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
    setMapNotice(
      "Loading new routes for this area…",
      "Fetching from Transitland and rebuilding tiles. This may take a moment.",
      "neutral",
      "center"
    );
    const notice = document.getElementById("mapNotice");
    const fill = notice ? notice.querySelector(".map-notice-progress-fill") : null;
    if (fill) {
      fill.style.width = appState.backfillStage === "rebuilding" ? "82%" : "38%";
    }
    setBackendStatus("Fetching routes for this viewport from Transitland…");
    return;
  }

  // Informational cards wait for the camera to settle so panning through empty
  // areas doesn't strobe a modal.
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
      "Routes load automatically at zoom level 8 and higher.",
      "neutral",
      "center"
    );
    setBackendStatus(`No routes loaded — current zoom ${Number(zoom).toFixed(1)} is below the loading threshold.`);
    return;
  }

  hideMapLoadingBadge();

  // Routes exist for this area but the current filters hide them all: never
  // imply the area is empty.
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

  // Distinguish "nothing exists here" from "exists upstream, not harvested yet"
  // so the empty state never implies the area has no transit at all.
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

  // Curated, published cities (each with its resolved route keys). These drive
  // the Cities menu and city mode; the static `cities` list above stays for
  // review scoping and harvest baselines.
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
