function updateLoadingStatus() {
  const areaLoadingCount = state.inFlightAreaKeys.size;
  const queuedCount = state.fetchQueue.length;
  const routeStopLoadingCount = state.inFlightLineStopKeys.size;
  const hasRoutes = Array.isArray(state.lineSummaries) && state.lineSummaries.some((line) => {
    if (typeof lineIsVisible === "function") {
      return lineIsVisible(line);
    }
    return true;
  });
  const visibleAreaCount = state.visibleAreaKeys.size;
  const hasLoading = areaLoadingCount > 0 || queuedCount > 0 || routeStopLoadingCount > 0;

  if (hasLoading) {
    if (hasRoutes) {
      // Routes are visible; show a compact corner badge while loading additional data.
      showMapLoadingBadge();
      clearMapNotice();
    } else {
      // No routes visible yet — center placeholder should show Loading...
      hideMapLoadingBadge();
      setMapNotice("Loading...", "", "neutral", "center");
    }
    return;
  }

  // Not loading at this point
  if (hasRoutes) {
    const focusLabel = state.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    hideMapLoadingBadge();
    clearMapNotice();
    setBackendStatus(`${visibleAreaCount} on-screen cached areas visible. ${focusLabel}`);
    return;
  }

  // If we've requested area data, are zoomed in enough to have triggered
  // Transitland, but no routes were returned (even successful empty responses),
  // show the explicit "No stops found" error rather than the generic zoom hint.
  const mapZoom = state.map ? Number(state.map.getZoom()) : 0;
  if (state.lastLoadStats?.requested > 0 && Array.isArray(state.lineSummaries) && state.lineSummaries.length === 0 && mapZoom >= MIN_VIEWPORT_FETCH_ZOOM) {
    const transitlandLink = `Check <a href="https://www.transit.land/map" target="_blank" rel="noopener noreferrer">this map</a> for supported routes.`;
    setMapNotice(
      "No stops found",
      transitlandLink,
      "error",
      "center",
      true
    );
    setBackendStatus(
      "No routes were returned for this area. Check Transitland for supported routes: https://www.transit.land/"
    );
    return;
  }

  if (state.lastLoadStats.failed > 0) {
    const mapZoom = state.map ? Number(state.map.getZoom()) : 0;
    if (mapZoom < MIN_VIEWPORT_FETCH_ZOOM) {
      hideMapLoadingBadge();
      setMapNotice("Zoom in to see stops", "Pan or zoom the map to load transit.", "neutral", "center");
      setBackendStatus("Low-zoom Postgres-only lookup encountered request errors. Pan or zoom to retry.");
      return;
    }

    const transitlandLink = `Reload or check the advanced information panel. Check <a href="https://www.transit.land/map" target="_blank" rel="noopener noreferrer">this map</a> for supported routes.`;
    setMapNotice(
      "No stops found",
      transitlandLink,
      "error",
      "center",
      true
    );
    setBackendStatus(
      `Failed to fetch transit for this map area. Reload or check the advanced information panel. ${state.lastLoadStats.failed} area request${state.lastLoadStats.failed === 1 ? "" : "s"} failed.`
    );
    return;
  }

  if (state.lastLoadStats.requested > 0 && state.lastLoadStats.successful === 0) {
    if (state.lastLoadStats.failed > 0) {
      const mapZoom = state.map ? Number(state.map.getZoom()) : 0;
      if (mapZoom < MIN_VIEWPORT_FETCH_ZOOM) {
        hideMapLoadingBadge();
        setMapNotice("Zoom in to see stops", "Pan or zoom the map to load transit.", "neutral", "center");
        setBackendStatus("Low-zoom Postgres-only lookup returned no successful requests yet.");
        return;
      }

      setMapNotice(
        "Failed to fetch",
        "Reload or check the advanced information panel.",
        "error",
        "center"
      );
      setBackendStatus(`Failed to fetch transit for this map area. ${state.lastLoadStats.failed} area request${state.lastLoadStats.failed === 1 ? "" : "s"} failed.`);
      return;
    }

    // Only show "no stops found" if we're zoomed in enough to have tried Transitland,
    // or if sufficient time has passed to confirm Postgres has nothing.
    // At low zoom, Postgres-only queries might legitimately return empty.
    const mapZoom = state.map ? Number(state.map.getZoom()) : 0;
    if (mapZoom < MIN_VIEWPORT_FETCH_ZOOM) {
      // Low zoom: Transitland not called yet, just waiting for Postgres. Don't error.
      hideMapLoadingBadge();
      setMapNotice("Zoom in to see stops", "Pan or zoom the map to load transit.", "neutral", "center");
      return;
    }

    // High zoom: Transitland would have been tried. No routes returned.
    const transitlandLink = `Check <a href="https://www.transit.land/map" target="_blank" rel="noopener noreferrer">this map</a> for supported routes.`;
    setMapNotice(
      "No stops found",
      transitlandLink,
      "error",
      "center",
      true
    );
    setBackendStatus(
      "No routes were returned for this area. Check Transitland for supported routes: https://www.transit.land/"
    );
    return;
  }

  // Default guidance when nothing is loading or visible.
  hideMapLoadingBadge();
  setMapNotice("Zoom in to see stops", "Pan or zoom the map to load transit.", "neutral", "center");
  setBackendStatus("Zoomed out. Cached routes will appear once their areas are on screen.");
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
      cacheOnly: Boolean(options.cacheOnly),
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

// Track progressive follow-up attempts for partial cache hits so we can
// repeatedly try Transitland until coverage stabilizes or we hit a limit.
if (!state.partialFetchAttempts) {
  state.partialFetchAttempts = new Map();
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

    if (job.cacheOnly) {
      params.set("cacheOnly", "1");
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

    // Only persist server payloads that include actual transit content or
    // are cache hits. Avoid overwriting an existing good session cache with
    // an empty miss (which can happen when requesting cache-only).
    const hasRoutes = Array.isArray(payload?.lineSummaries) && payload.lineSummaries.length > 0;
    const cacheStatus = String(payload?.cacheStatus || "").trim().toLowerCase();
    const isHit = cacheStatus === "hit" || cacheStatus === "partial-hit" || cacheStatus === "stale-hit";
    if (hasRoutes || isHit) {
      cacheAreaPayload(job.cacheKey, payload, payload.cacheStatus || "miss");
    }
    state.lastLoadStats.successful += 1;

    // Update viewport source counters so the advanced panel can prove whether
    // data came from Postgres or from an actual Transitland fetch.
    state.viewportRequestCount += 1;
    if (cacheStatus === "hit" || cacheStatus === "partial-hit" || cacheStatus === "stale-hit") {
      state.postgresViewportHitCount += 1;
    } else if (cacheStatus === "miss" && job.cacheOnly) {
      state.postgresViewportMissCount += 1;
    } else if (cacheStatus === "miss" || !cacheStatus) {
      state.transitlandViewportFetchCount += 1;
    }
    renderApiCounter();

    syncActiveAreaKeys({
      fallbackToAllCached: false
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    const lines = Number(payload?.lineSummaries?.length || 0);
    const vectorTileCount = Number(payload?.matchingStats?.vectorHeadwayTileCount || 0);
    const omittedVectorTiles = Number(payload?.matchingStats?.vectorHeadwayOmittedTileCount || 0);
    
    // Build source description based on cache status
    let sourceDesc = "";
    if (cacheStatus === "hit") {
      sourceDesc = "Postgres cache (exact match)";
    } else if (cacheStatus === "partial-hit") {
      sourceDesc = "Postgres cache (spatial overlap)";
    } else if (cacheStatus === "stale-hit") {
      sourceDesc = "Postgres cache (stale)";
    } else if (cacheStatus === "miss" && job.cacheOnly) {
      sourceDesc = "Postgres cache miss (no overlap)";
    } else {
      sourceDesc = "Transitland (fetched)";
    }
    
    setBackendStatus(
      `Fetched ${job.cacheKey} from ${sourceDesc} (${lines} routes${vectorTileCount > 0 ? `, ${vectorTileCount} vector tiles` : ""}${
        omittedVectorTiles > 0 ? `, +${omittedVectorTiles} omitted` : ""
      }). Select a route to load stops.`
    );

    if (job.cacheOnly && (cacheStatus === "miss" || cacheStatus === "partial-hit") && Number(job.zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM) {
      const attempts = Number(state.partialFetchAttempts.get(job.cacheKey) || 0);
      const MAX_ATTEMPTS = 6;

      // If we've already exceeded attempts, stop retrying.
      if (attempts >= MAX_ATTEMPTS) {
        state.partialFetchAttempts.delete(job.cacheKey);
      } else {
        // Schedule a follow-up non-cache fetch. For partial-hits allow re-fetch
        // even if the session cache has an entry (forceRefresh=true). Use
        // exponential backoff to avoid hammering Transitland.
        const backoffMs = 250 * Math.pow(2, Math.min(attempts, 5));
        window.setTimeout(() => {
          if (job.epoch !== state.loadEpoch) {
            return;
          }

          // For partial-hits we still want to try re-fetching even if a
          // cached payload exists, because Postgres may only have partial
          // coverage and we need Transitland to fill gaps progressively.
          const shouldProceed = cacheStatus === "partial-hit" || !state.areaCache.has(job.cacheKey);
          if (!shouldProceed) {
            return;
          }

          state.partialFetchAttempts.set(job.cacheKey, attempts + 1);

          queueTileFetches([
            {
              areaKey: job.cacheKey,
              bbox: job.bbox,
              zoom: job.zoom,
              routeTypes: Array.isArray(job.routeTypes) ? job.routeTypes : []
            }
          ], {
            cacheOnly: false,
            forceRefresh: true
          });
        }, backoffMs);
      }
    }
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
  state.currentViewportBbox = rawBbox ? [...rawBbox] : null;
  if (rawBbox) {
    state.lastViewportFetchBbox = [...rawBbox];
    state.lastViewportFetchZoom = Number(zoom || 0);
  }
  if (!rawBbox) {
    const allCachedKeys = new Set(state.areaCache.keys());
    if (allCachedKeys.size === 0) {
      setStatus(
        "This view crosses the 180-degree line and cannot be loaded yet.",
        "error",
        "Pan away from the dateline and transit will resume loading."
      );
      return;
    }

    state.requestedAreaKeys = allCachedKeys;
    state.currentViewportBbox = null;
    syncActiveAreaKeys({
      fallbackToAllCached: true
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    state.lastLoadStats = {
      requested: 0,
      cached: allCachedKeys.size,
      queued: 0,
      deferred: 0,
      failed: 0,
      successful: 0
    };

    setStatus(
      "Zoomed out. Showing all cached routes.",
      "ok",
      `${allCachedKeys.size} cached areas are visible at this zoom.`
    );

    setBackendStatus(
      "World/dateline view detected. Using all cached transit data without requesting new tiles."
    );
    return;
  }

  const modeRouteTypes = selectedRouteTypesForFetch();
  const requests = viewportRequestsForMode(rawBbox, zoom, modeRouteTypes);

  // No low-zoom short-circuit: always generate requests for the full viewport
  // so that the server can return Postgres-backed cached payloads for any zoom.

  const cachedRequestCount = requests.filter((request) => state.areaCache.has(request.areaKey)).length;
  const missingRequests = requests.filter(
    (request) => options.forceRefresh || !state.areaCache.has(request.areaKey)
  );

  const cachedInView = visibleCachedAreaKeysForViewport(rawBbox);

  state.requestedAreaKeys = new Set([
    ...requests.map((request) => request.areaKey),
    ...Array.from(cachedInView)
  ]);
  trimQueuedFetchesToCurrentView();

  syncActiveAreaKeys({
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

  // First, queue cache-only fetches so we always attempt to surface Postgres cached
  // payloads without triggering Transitland.
  const cacheOnlyBatch = missing.slice(0, MAX_NEW_FETCHES_PER_VIEW);
  const queuedCacheOnly = queueTileFetches(cacheOnlyBatch, {
    cacheOnly: true,
    forceRefresh: Boolean(options.forceRefresh)
  });
  state.lastLoadStats.queued = queuedCacheOnly;

  // Start non-cache-only fetches immediately after the cache-only batch so
  // geometry can begin filling without waiting on an artificial delay.
  if (Number(zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM) {
    setTimeout(() => {
      const stillMissing = missing.filter((r) => !state.areaCache.has(r.areaKey));
      if (!stillMissing.length) return;
      const nextFull = stillMissing.slice(0, MAX_NEW_FETCHES_PER_VIEW);
      const queuedFull = queueTileFetches(nextFull, {
        cacheOnly: false,
        forceRefresh: Boolean(options.forceRefresh)
      });
      state.lastLoadStats.queued += queuedFull;
    }, 0);
  }

  if (!nextBatch.length) {
    if (state.lineSummaries.length > 0) {
      clearMapNotice();
      setBackendStatus(`${cached}/${requests.length} on-screen areas loaded from cache. Select a route to load stops.`);
    } else {
      if (Number(zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM) {
        setMapNotice(
          "No stops found",
          "Check this map for supported routes: https://www.transit.land/",
          "error"
        );
        setBackendStatus(
          "No routes are visible in this area. Check Transitland for supported routes: https://www.transit.land/"
        );
      } else {
        hideMapLoadingBadge();
        setMapNotice("Zoom in to see stops", "Pan or zoom the map to load transit.", "neutral", "center");
        setBackendStatus("No cached routes are currently visible at this zoom. Pan or zoom to another area.");
      }
    }
    return;
  }

  if (state.lineSummaries.length > 0) {
    clearMapNotice();
    setBackendStatus(
      `Loading more routes for the current map view... ${cached} cached - ${queuedCacheOnly} loading${
        state.lastLoadStats.deferred > 0 ? ` - ${state.lastLoadStats.deferred} deferred` : ""
      }`
    );
  } else {
    setMapNotice(
      "Loading...",
      `Fetching transit data for this area. ${queuedCacheOnly} request${queuedCacheOnly === 1 ? "" : "s"} queued.`
    );
    setBackendStatus(
      `Loading transit data for the current map view... Route-first mode active. Stops are loaded only on focused routes (location types ${ROUTE_STOP_TYPES_QUERY}).`
    );
  }
}

function onMapMoveEnd() {
  if (!state.mapReady) {
    return;
  }

  const rawBbox = mapBoundsToBbox();
  const zoom = state.map ? Number(state.map.getZoom()) : 0;
  const lastViewportBbox = normalizeBboxArray(state.lastViewportFetchBbox);
  const lastViewportZoom = Number(state.lastViewportFetchZoom);

  if (
    rawBbox &&
    lastViewportBbox &&
    Number.isFinite(lastViewportZoom) &&
    Math.abs(zoom - lastViewportZoom) < 0.01
  ) {
    const bufferedViewport = expandBbox(lastViewportBbox, 0.18);
    const withinBufferedViewport =
      rawBbox[0] >= bufferedViewport[0] &&
      rawBbox[1] >= bufferedViewport[1] &&
      rawBbox[2] <= bufferedViewport[2] &&
      rawBbox[3] <= bufferedViewport[3];

    if (withinBufferedViewport) {
      state.currentViewportBbox = [...rawBbox];
      syncActiveAreaKeys({
        fallbackToAllCached: false
      });
      rebuildCombinedTransit();
      refreshUiFromState();
      return;
    }
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
    if (typeof saveUserPreferences === "function") {
      saveUserPreferences({ initialCitySlug: state.initialCitySlug }).catch(() => {});
    }
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
    if (state.lineViewOrderingVoteClickSetsByLineKey) {
      state.lineViewOrderingVoteClickSetsByLineKey.clear();
    }
    if (typeof applyUserPreferences === "function") {
      applyUserPreferences(me.user?.preferences || {});
    }
    updateAuthUi();
  } catch {
    setToken("");
    state.user = null;
    if (state.lineViewOrderingVoteClickSetsByLineKey) {
      state.lineViewOrderingVoteClickSetsByLineKey.clear();
    }
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
  setToken(payload.token, Boolean(options.remember));
  state.user = payload.user;
  if (state.lineViewOrderingVoteClickSetsByLineKey) {
    state.lineViewOrderingVoteClickSetsByLineKey.clear();
  }
  if (typeof applyUserPreferences === "function") {
    applyUserPreferences(payload.user?.preferences || {});
  }
  updateAuthUi();
  closePopups();
  await loadProgress();

  // Load saved presets (including the default snapshot preset) and apply defaults if present.
  if (typeof loadFilterPresets === "function") {
    try {
      await loadFilterPresets({ silent: true });
      if (typeof cachedPresets !== "undefined" && Array.isArray(cachedPresets)) {
        const defaultPreset = cachedPresets.find((p) => String(p.name || "").trim() === "__defaults__");
        if (defaultPreset && typeof applyFilterSnapshot === "function") {
          applyFilterSnapshot(defaultPreset.snapshot || {});
        }
      }
    } catch (e) {
      // non-fatal
    }
  }

  const customMessage = String(options.successMessage || "").trim();
  const statusMessage = customMessage || `Signed in as ${payload.user.displayName}.`;
  setStatus(statusMessage, "ok");
}

