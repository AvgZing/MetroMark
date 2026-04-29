function updateLoadingStatus() {
  const areaLoadingCount = state.inFlightAreaKeys.size;
  const queuedCount = state.fetchQueue.length;
  const routeStopLoadingCount = state.inFlightLineStopKeys.size;

  if (areaLoadingCount > 0 || queuedCount > 0 || routeStopLoadingCount > 0) {
    setStatus(
      "Loading routes for the current map view...",
      "ok",
      `${state.lastLoadStats.cached} route tiles cached - ${areaLoadingCount} tiles loading - ${routeStopLoadingCount} routes loading stops - ${Math.max(
        queuedCount,
        state.lastLoadStats.deferred
      )} pending`
    );
    return;
  }

  if (state.lineSummaries.length > 0) {
    const focusLabel = state.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    setStatus(
      "Routes are ready for this view.",
      "ok",
      `${state.activeAreaKeys.size} nearby areas in session cache. ${focusLabel}`
    );
    return;
  }

  if (state.lastLoadStats.failed > 0) {
    setStatus(
      "Routes could not be loaded for this area.",
      "error",
      `${state.lastLoadStats.failed} area requests failed. Check the backend note below.`
    );
    return;
  }

  if (state.lastLoadStats.requested > 0) {
    setStatus(
      "No route data was returned for this map area.",
      "error",
      "Try panning a little or changing zoom level."
    );
  }
}

function queueTileFetches(tileRequests, options = {}) {
  let queued = 0;

  for (const request of tileRequests) {
    const cacheKey = request.areaKey;
    if (!options.forceRefresh && state.areaCache.has(cacheKey)) {
      continue;
    }

    if (state.queuedAreaKeys.has(cacheKey) || state.inFlightAreaKeys.has(cacheKey)) {
      continue;
    }

    state.fetchQueue.push({
      cacheKey,
      bbox: request.bbox,
      zoom: request.zoom,
      routeTypes: Array.isArray(request.routeTypes) ? request.routeTypes : [],
      epoch: state.loadEpoch,
      forceRefresh: Boolean(options.forceRefresh)
    });

    state.queuedAreaKeys.add(cacheKey);
    queued += 1;
  }

  if (queued > 0) {
    drainFetchQueue();
  }

  return queued;
}

function trimQueuedFetchesToCurrentView() {
  if (!state.fetchQueue.length) {
    return;
  }

  const nextQueue = [];
  const nextQueuedKeys = new Set();

  for (const job of state.fetchQueue) {
    if (!state.requestedAreaKeys.has(job.cacheKey)) {
      continue;
    }
    nextQueue.push(job);
    nextQueuedKeys.add(job.cacheKey);
  }

  state.fetchQueue = nextQueue;
  state.queuedAreaKeys = nextQueuedKeys;
}

async function fetchTile(job) {
  state.inFlightAreaKeys.add(job.cacheKey);
  updateLoadingStatus();

  try {
    const params = new URLSearchParams({
      bbox: bboxQueryText(job.bbox),
      zoom: Number(job.zoom || 0).toFixed(2)
    });

    if (job.forceRefresh) {
      params.set("refresh", "1");
    }

    if (Array.isArray(job.routeTypes) && job.routeTypes.length) {
      params.set("routeTypes", job.routeTypes.join(","));
    }

    const payload = await apiRequest(`/api/transit/bbox?${params.toString()}`, {
      method: "GET"
    });

    if (job.epoch !== state.loadEpoch) {
      return;
    }

    cacheAreaPayload(job.cacheKey, payload, payload.cacheStatus || "miss");
    state.lastLoadStats.successful += 1;

    const previousVisibleKeys = new Set(state.visibleAreaKeys);
    const hasPendingTiles = state.fetchQueue.length > 0 || state.inFlightAreaKeys.size > 1;

    syncActiveAreaKeys({
      retainVisibleKeys: previousVisibleKeys,
      mergeRetainedVisibleKeys: hasPendingTiles,
      fallbackToAllCached: false
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    const lines = Number(payload?.lineSummaries?.length || 0);
    const vectorTileCount = Number(payload?.matchingStats?.vectorHeadwayTileCount || 0);
    const omittedVectorTiles = Number(payload?.matchingStats?.vectorHeadwayOmittedTileCount || 0);
    setBackendStatus(
      `Fetched ${job.cacheKey} (${payload.cacheStatus || "miss"} cache, ${lines} routes, ${vectorTileCount} vector tiles${
        omittedVectorTiles > 0 ? `, +${omittedVectorTiles} omitted` : ""
      }). Select a route to load stops.`
    );
  } catch (error) {
    if (job.epoch !== state.loadEpoch) {
      return;
    }
    state.lastLoadStats.failed += 1;
    setBackendStatus(`Fetch failed for ${job.cacheKey}: ${error.message}`);
  } finally {
    state.inFlightAreaKeys.delete(job.cacheKey);
  }
}

function drainFetchQueue() {
  if (state.queueDrainRunning) {
    updateLoadingStatus();
    return;
  }

  state.queueDrainRunning = true;

  const launch = () => {
    while (state.inFlightAreaKeys.size < MAX_PARALLEL_FETCHES && state.fetchQueue.length > 0) {
      const job = state.fetchQueue.shift();
      state.queuedAreaKeys.delete(job.cacheKey);

      fetchTile(job)
        .catch(() => {})
        .finally(() => {
          if (state.fetchQueue.length > 0 || state.inFlightAreaKeys.size > 0) {
            launch();
          } else {
            state.queueDrainRunning = false;
            updateLoadingStatus();
          }
        });
    }

    if (state.fetchQueue.length === 0 && state.inFlightAreaKeys.size === 0) {
      state.queueDrainRunning = false;
    }

    updateLoadingStatus();
  };

  launch();
}

async function loadVisibleTransit(options = {}) {
  if (!state.mapReady || !state.map) {
    return;
  }

  const zoom = state.map.getZoom();
  const rawBbox = mapBoundsToBbox();
  if (!rawBbox) {
    setStatus(
      "This view crosses the 180-degree line and cannot be loaded yet.",
      "error",
      "Pan away from the dateline and transit will resume loading."
    );
    return;
  }

  const modeRouteTypes = selectedRouteTypesForFetch();
  const requests = viewportRequestsForMode(rawBbox, zoom, modeRouteTypes);

  if (zoom < MIN_VIEWPORT_FETCH_ZOOM) {
    const cachedInView = visibleCachedAreaKeysForViewport(rawBbox, modeRouteTypes);
    const cachedNearView = visibleCachedAreaKeysForViewport(expandBbox(rawBbox, 0.05), modeRouteTypes);
    const fallbackVisible = new Set(
      Array.from(state.visibleAreaKeys).filter((cacheKey) => state.areaCache.has(cacheKey))
    );

    state.requestedAreaKeys =
      cachedInView.size > 0
        ? cachedInView
        : cachedNearView.size > 0
          ? cachedNearView
          : fallbackVisible;

    trimQueuedFetchesToCurrentView();

    syncActiveAreaKeys({
      fallbackToAllCached: false
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    const cachedVisible = state.requestedAreaKeys.size;

    state.lastLoadStats = {
      requested: requests.length,
      cached: cachedVisible,
      queued: 0,
      deferred: 0,
      failed: 0,
      successful: 0
    };

    setStatus(
      "Zoomed out. Showing previously loaded nearby routes.",
      "ok",
      `${cachedVisible} nearby cached areas visible. Zoom in slightly to load additional routes.`
    );

    setBackendStatus(
      "Viewport fetch paused at low zoom. Server/client caches are still used for already-loaded in-view tiles."
    );
    return;
  }

  const cachedRequestCount = requests.filter((request) => state.areaCache.has(request.areaKey)).length;
  const missingRequests = requests.filter(
    (request) => options.forceRefresh || !state.areaCache.has(request.areaKey)
  );

  const previousVisibleKeys = new Set(state.visibleAreaKeys);
  const cachedInView = visibleCachedAreaKeysForViewport(rawBbox, modeRouteTypes);
  const cachedNearView = visibleCachedAreaKeysForViewport(expandBbox(rawBbox, 0.05), modeRouteTypes);
  const retainedCachedKeys = cachedInView.size > 0 ? cachedInView : cachedNearView;

  state.requestedAreaKeys = new Set([
    ...requests.map((request) => request.areaKey),
    ...Array.from(retainedCachedKeys)
  ]);
  trimQueuedFetchesToCurrentView();

  syncActiveAreaKeys({
    retainVisibleKeys: previousVisibleKeys,
    mergeRetainedVisibleKeys: missingRequests.length > 0,
    allowRetainOutsideRequested: missingRequests.length > 0,
    fallbackToAllCached: false
  });
  rebuildCombinedTransit();
  refreshUiFromState();

  if (!requests.length) {
    setStatus("No nearby request tiles were generated for this view.", "error");
    return;
  }

  const cached = cachedRequestCount;
  const missing = missingRequests;
  const nextBatch = missing.slice(0, MAX_NEW_FETCHES_PER_VIEW);

  state.lastLoadStats = {
    requested: requests.length,
    cached,
    queued: 0,
    deferred: Math.max(0, missing.length - nextBatch.length),
    failed: 0,
    successful: 0
  };

  if (!nextBatch.length) {
    setStatus(
      "Showing routes for the current map view.",
      "ok",
      `${cached}/${requests.length} nearby areas loaded from session cache. Select a route to load stops.`
    );
    setBackendStatus("No network fetch was needed for this view.");
    return;
  }

  const queued = queueTileFetches(nextBatch, {
    forceRefresh: Boolean(options.forceRefresh)
  });

  state.lastLoadStats.queued = queued;

  setStatus(
    "Loading routes for the current map view...",
    "ok",
    `${cached} cached - ${queued} loading${
      state.lastLoadStats.deferred > 0 ? ` - ${state.lastLoadStats.deferred} deferred` : ""
    }`
  );

  setBackendStatus(
    `Route-first mode active. Stops are loaded only on focused routes (location types ${ROUTE_STOP_TYPES_QUERY}).`
  );
}

function onMapMoveEnd() {
  if (!state.mapReady) {
    return;
  }

  const now = Date.now();
  if (now - state.lastMoveFetchAt < MIN_MOVE_FETCH_INTERVAL_MS) {
    return;
  }
  state.lastMoveFetchAt = now;

  loadVisibleTransit({ forceRefresh: false, reason: "move" }).catch((error) => {
    setBackendStatus(`Auto-load failed: ${error.message}`);
  });
}

function fitToArea(area) {
  if (!state.map || !state.mapReady || !area?.bbox) {
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = area.bbox;
  state.map.fitBounds(
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
  if (!state.cities.length) {
    return null;
  }

  return state.cities.find((city) => city.slug === state.initialCitySlug) || state.cities[0] || null;
}

async function loadCities() {
  const payload = await apiRequest("/api/catalog/cities", { method: "GET" });
  state.cities = Array.isArray(payload.cities) ? payload.cities : [];

  if (!state.cities.length) {
    return;
  }

  const exists = state.cities.some((city) => city.slug === state.initialCitySlug);
  if (!exists) {
    state.initialCitySlug = state.cities[0].slug;
    localStorage.setItem("metromark_initial_city_slug", state.initialCitySlug);
  }
}

async function hydrateSession() {
  if (!state.token) {
    updateAuthUi();
    return;
  }

  try {
    const me = await apiRequest("/api/auth/me", { method: "GET" });
    state.user = me.user;
    updateAuthUi();
  } catch {
    setToken("");
    state.user = null;
    updateAuthUi();
  }
}

function updateAuthUi() {
  const loggedIn = Boolean(state.user);
  els.authLoggedOut.hidden = loggedIn;
  els.authLoggedIn.hidden = !loggedIn;
  els.currentUserLabel.textContent = loggedIn ? `${state.user.displayName} (${state.user.email})` : "-";
  if (typeof window.updateFilterPresetAuthState === "function") {
    window.updateFilterPresetAuthState();
  }
  if (typeof window.refreshFilterPresets === "function") {
    window.refreshFilterPresets({ silent: true }).catch(() => {});
  }
  renderUserStatus();
  renderLineView();
}

function rebuildVisitedMap(items) {
  state.visitedByLine = new Map();
  for (const item of items) {
    getVisitedSetForLine(item.lineKey).add(item.stationKey);
  }
}

async function loadProgress() {
  if (!state.user) {
    state.visitedByLine = new Map();
    renderMapData();
    renderProgress();
    renderLineView();
    return;
  }

  const payload = await apiRequest("/api/progress", { method: "GET" });
  rebuildVisitedMap(payload.items || []);
  renderMapData();
  renderProgress();
  renderLineView();
}

async function clearRouteProgress(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  if (!state.user) {
    setStatus("Sign in first to clear route progress.", "error");
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineName = line ? lineDisplayName(line) : normalizedLineKey;

  resetClearRouteProgressConfirmation();

  try {
    const payload = await apiRequest("/api/progress/clear-route", {
      method: "POST",
      body: JSON.stringify({ lineKey: normalizedLineKey })
    });

    state.visitedByLine.set(normalizedLineKey, new Set());
    renderMapData();
    renderProgress();
    if (line && state.focusedLineKey === normalizedLineKey) {
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

async function loginWithPayload(payloadPromise, options = {}) {
  const payload = await payloadPromise;
  if (typeof setAuthFeedback === "function") {
    setAuthFeedback();
  }
  setToken(payload.token);
  state.user = payload.user;
  updateAuthUi();
  closePopups();
  await loadProgress();

  const customMessage = String(options.successMessage || "").trim();
  const statusMessage = customMessage || `Signed in as ${payload.user.displayName}.`;
  setStatus(statusMessage, "ok");
}

