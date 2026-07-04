function logTiming(label) {
  const entry = { label, at: performance.now() };
  appState.loadTimings.push(entry);
  return entry;
}

function scheduleBatchRender() {
  if (appState.renderBatchTimer) return;
  const token = ++appState.renderBatchToken;
  appState.renderBatchTimer = setTimeout(() => {
    if (token !== appState.renderBatchToken) return;
    appState.renderBatchTimer = null;
    logTiming('batch-render-start');
    rebuildCombinedTransit();
    refreshUiFromState();
    logTiming('batch-render-end');
  }, 80);
}

function flushBatchRender() {
  if (appState.renderBatchTimer) {
    clearTimeout(appState.renderBatchTimer);
    appState.renderBatchTimer = null;
  }
  appState.renderBatchToken += 1;
  logTiming('flush-render-start');
  rebuildCombinedTransit();
  refreshUiFromState();
  logTiming('flush-render-end');
}

function updateLoadingStatus() {
  const areaLoadingCount = appState.inFlightAreaKeys.size;
  const queuedCount = appState.fetchQueue.length;
  const routeStopLoadingCount = appState.inFlightLineStopKeys.size;
  const hasRoutes = Array.isArray(appState.lineSummaries) && appState.lineSummaries.some((line) => {
    if (typeof lineIsVisible === "function") {
      return lineIsVisible(line);
    }
    return true;
  });
  const visibleAreaCount = appState.visibleAreaKeys.size;
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
    const focusLabel = appState.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    hideMapLoadingBadge();
    clearMapNotice();
    setBackendStatus(`${visibleAreaCount} on-screen cached areas visible. ${focusLabel}`);
    return;
  }

  // If we've requested area data, are zoomed in enough to have triggered
  // Transitland, but no routes were returned (even successful empty responses),
  // show the explicit "No stops found" error rather than the generic zoom hint.
  const mapZoom = appState.map ? Number(appState.map.getZoom()) : 0;
  if (appState.lastLoadStats?.requested > 0 && Array.isArray(appState.lineSummaries) && appState.lineSummaries.length === 0 && mapZoom >= MIN_VIEWPORT_FETCH_ZOOM) {
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

  if (appState.lastLoadStats.failed > 0) {
    const mapZoom = appState.map ? Number(appState.map.getZoom()) : 0;
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
      `Failed to fetch transit for this map area. Reload or check the advanced information panel. ${appState.lastLoadStats.failed} area request${appState.lastLoadStats.failed === 1 ? "" : "s"} failed.`
    );
    return;
  }

  if (appState.lastLoadStats.requested > 0 && appState.lastLoadStats.successful === 0) {
    if (appState.lastLoadStats.failed > 0) {
      const mapZoom = appState.map ? Number(appState.map.getZoom()) : 0;
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
      setBackendStatus(`Failed to fetch transit for this map area. ${appState.lastLoadStats.failed} area request${appState.lastLoadStats.failed === 1 ? "" : "s"} failed.`);
      return;
    }

    // Only show "no stops found" if we're zoomed in enough to have tried Transitland,
    // or if sufficient time has passed to confirm Postgres has nothing.
    // At low zoom, Postgres-only queries might legitimately return empty.
    const mapZoom = appState.map ? Number(appState.map.getZoom()) : 0;
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
    if (!options.forceRefresh && appState.areaCache.has(cacheKey)) {
      continue;
    }

    if (appState.queuedAreaKeys.has(cacheKey) || appState.inFlightAreaKeys.has(cacheKey)) {
      continue;
    }

    appState.fetchQueue.push({
      cacheKey,
      bbox: request.bbox,
      zoom: request.zoom,
      cacheOnly: Boolean(options.cacheOnly),
      routeTypes: Array.isArray(request.routeTypes) ? request.routeTypes : [],
      epoch: appState.loadEpoch,
      forceRefresh: Boolean(options.forceRefresh)
    });

    appState.queuedAreaKeys.add(cacheKey);
    queued += 1;
  }

  if (queued > 0) {
    drainFetchQueue();
  }

  return queued;
}

function trimQueuedFetchesToCurrentView() {
  if (!appState.fetchQueue.length) {
    return;
  }

  const nextQueue = [];
  const nextQueuedKeys = new Set();

  for (const job of appState.fetchQueue) {
    if (!appState.requestedAreaKeys.has(job.cacheKey)) {
      continue;
    }
    nextQueue.push(job);
    nextQueuedKeys.add(job.cacheKey);
  }

  appState.fetchQueue = nextQueue;
  appState.queuedAreaKeys = nextQueuedKeys;
}

// Track progressive follow-up attempts for partial cache hits so we can
// repeatedly try Transitland until coverage stabilizes or we hit a limit.
if (!appState.partialFetchAttempts) {
  appState.partialFetchAttempts = new Map();
}

async function fetchTile(job) {
  const fetchLabel = `fetch-tile:${job.cacheKey.slice(0, 40)}`;
  logTiming(`${fetchLabel}:start`);
  appState.inFlightAreaKeys.add(job.cacheKey);
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

    logTiming(`${fetchLabel}:request`);
    const payload = await apiRequest(`/api/transit/bbox?${params.toString()}`, {
      method: "GET"
    });
    logTiming(`${fetchLabel}:response`);

    const serverTiming = Number(payload?.serverTimingMs || 0);
    if (serverTiming > 200) {
      console.warn(`[perf] Slow server response for ${job.cacheKey}: ${serverTiming}ms`);
    }

    if (job.epoch !== appState.loadEpoch) {
      return;
    }

    const hasRoutes = Array.isArray(payload?.lineSummaries) && payload.lineSummaries.length > 0;
    const cacheStatus = String(payload?.cacheStatus || "").trim().toLowerCase();
    const isHit = cacheStatus === "hit" || cacheStatus === "partial-hit" || cacheStatus === "stale-hit";
    if (hasRoutes || isHit) {
      cacheAreaPayload(job.cacheKey, payload, payload.cacheStatus || "miss");
    }
    appState.lastLoadStats.successful += 1;

    appState.viewportRequestCount += 1;
    if (cacheStatus === "hit" || cacheStatus === "partial-hit" || cacheStatus === "stale-hit") {
      appState.postgresViewportHitCount += 1;
    } else if (cacheStatus === "miss" && job.cacheOnly) {
      appState.postgresViewportMissCount += 1;
    } else if (cacheStatus === "miss" || !cacheStatus) {
      appState.transitlandViewportFetchCount += 1;
    }
    renderApiCounter();

    syncActiveAreaKeys({
      fallbackToAllCached: false
    });
    scheduleBatchRender();
    logTiming(`${fetchLabel}:cached`);
  } catch (error) {
    if (job.epoch !== appState.loadEpoch) {
      return;
    }
    appState.lastLoadStats.failed += 1;
    setBackendStatus(`Fetch failed for ${job.cacheKey}: ${error.message}`);
  } finally {
    appState.inFlightAreaKeys.delete(job.cacheKey);
  }
}

function drainFetchQueue() {
  if (appState.queueDrainRunning) {
    updateLoadingStatus();
    return;
  }

  appState.queueDrainRunning = true;
  logTiming('queue-drain-start');

  const launch = () => {
    while (appState.inFlightAreaKeys.size < MAX_PARALLEL_FETCHES && appState.fetchQueue.length > 0) {
      const job = appState.fetchQueue.shift();
      appState.queuedAreaKeys.delete(job.cacheKey);
      fetchTile(job)
        .catch(() => {})
        .finally(() => {
          if (appState.fetchQueue.length > 0 || appState.inFlightAreaKeys.size > 0) {
            launch();
          } else {
            appState.queueDrainRunning = false;
            logTiming('queue-drain-end');
            flushBatchRender();
            updateLoadingStatus();
            const timings = appState.loadTimings;
            if (timings.length > 2) {
              const started = timings[0].at;
              const ended = timings[timings.length - 1].at;
              const totalMs = (ended - started).toFixed(1);
              const lineCount = appState.lineSummaries.length;
              const cachedAreas = appState.visibleAreaKeys.size;
              const hitSummary = `Pg:${appState.postgresViewportHitCount} miss:${appState.postgresViewportMissCount} Tld:${appState.transitlandViewportFetchCount}`;
              console.log(`[perf] Load cycle: ${totalMs}ms, ${lineCount} routes, ${cachedAreas} areas, ${hitSummary}`);
              if (Number(totalMs) > 3000) {
                console.warn(`[perf] SLOW load cycle: ${totalMs}ms (${cachedAreas} tile(s), ${hitSummary})`);
              }
              setBackendStatus(`Loaded ${lineCount} routes from ${cachedAreas} area(s) in ${totalMs}ms (${hitSummary}). Select a route to load stops.`);
            }
          }
        });
    }

    if (appState.fetchQueue.length === 0 && appState.inFlightAreaKeys.size === 0) {
      appState.queueDrainRunning = false;
    }

    updateLoadingStatus();
  };

  launch();
}

async function loadVisibleTransit(options = {}) {
  if (!appState.mapReady || !appState.map) {
    return;
  }

  appState.loadTimings = [];
  logTiming('load-visible-transit-start');
  const loadReason = String(options.reason || '').trim() || 'unknown';
  const zoom = appState.map.getZoom();
  const rawBbox = mapBoundsToBbox();
  appState.currentViewportBbox = rawBbox ? [...rawBbox] : null;
  if (rawBbox) {
    appState.lastViewportFetchBbox = [...rawBbox];
    appState.lastViewportFetchZoom = Number(zoom || 0);
  }
  if (!rawBbox) {
    appState.viewportSummaryLineSummaries = [];
    appState.viewportSummaryRequestToken += 1;
    const allCachedKeys = new Set(appState.areaCache.keys());
    if (allCachedKeys.size === 0) {
      setStatus(
        "This view crosses the 180-degree line and cannot be loaded yet.",
        "error",
        "Pan away from the dateline and transit will resume loading."
      );
      return;
    }

    appState.requestedAreaKeys = allCachedKeys;
    appState.currentViewportBbox = null;
    syncActiveAreaKeys({
      fallbackToAllCached: true
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    appState.lastLoadStats = {
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
  let requests = viewportRequestsForMode(rawBbox, zoom, modeRouteTypes);

  // When force-refreshing, limit to a handful of tiles near center to avoid
  // overwhelming Transitland with concurrent API calls, each taking 15+ seconds.
  if (options.forceRefresh && requests.length > 8) {
    requests.sort((a, b) => (a.distanceScore || 0) - (b.distanceScore || 0));
    requests = requests.slice(0, 8);
  }

  appState.viewportSummaryLineSummaries = [];
  appState.viewportSummaryRequestToken += 1;

  // No low-zoom short-circuit: always generate requests for the full viewport
  // so that the server can return Postgres-backed cached payloads for any zoom.

  const cachedRequestCount = requests.filter((request) => appState.areaCache.has(request.areaKey)).length;
  const missingRequests = requests.filter(
    (request) => options.forceRefresh || !appState.areaCache.has(request.areaKey)
  );

  const cachedInView = visibleCachedAreaKeysForViewport(rawBbox, modeRouteTypes);

  appState.requestedAreaKeys = new Set([
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

  appState.lastLoadStats = {
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
  appState.lastLoadStats.queued = queuedCacheOnly;

  if (Number(zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM) {
    setTimeout(() => {
      const stillMissing = missing.filter((r) => !appState.areaCache.has(r.areaKey));
      if (!stillMissing.length) return;
      const nextFull = stillMissing.slice(0, MAX_NEW_FETCHES_PER_VIEW);
      const queuedFull = queueTileFetches(nextFull, {
        cacheOnly: false,
        forceRefresh: Boolean(options.forceRefresh)
      });
      appState.lastLoadStats.queued += queuedFull;
    }, 100);
  }

  if (!nextBatch.length) {
    if (appState.lineSummaries.length > 0) {
      clearMapNotice();
      setBackendStatus(`${cached}/${requests.length} on-screen areas loaded from cache. Select a route to load stops.`);
    } else {
  if (Number(zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM || Boolean(options.forceRefresh)) {
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

  if (appState.lineSummaries.length > 0) {
    clearMapNotice();
    setBackendStatus(
      `Loading more routes for the current map view... ${cached} cached - ${queuedCacheOnly} loading${
        appState.lastLoadStats.deferred > 0 ? ` - ${appState.lastLoadStats.deferred} deferred` : ""
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

  debouncedViewportSummary(rawBbox, zoom);
  logTiming('load-visible-transit-queued');
}

let viewportSummaryTimeout = null;
function debouncedViewportSummary(rawBbox, zoom) {
  if (viewportSummaryTimeout) {
    clearTimeout(viewportSummaryTimeout);
  }
  viewportSummaryTimeout = setTimeout(() => {
    viewportSummaryTimeout = null;
    loadViewportCountSummary(rawBbox, zoom).catch(() => {});
  }, 400);
}

async function loadViewportCountSummary(rawBbox, zoom) {
  const bbox = normalizeBboxArray(rawBbox);
  if (!bbox) {
    return false;
  }

  const requestToken = appState.viewportSummaryRequestToken + 1;
  appState.viewportSummaryRequestToken = requestToken;

  try {
    const params = new URLSearchParams({
      bbox: bbox.join(","),
      zoom: Number.isFinite(Number(zoom)) ? String(Number(zoom)) : "0",
      cacheOnly: "1",
      summaryOnly: "1"
    });

    const payload = await apiRequest(`/api/transit/bbox?${params.toString()}`, {
      method: "GET"
    });

    if (requestToken !== appState.viewportSummaryRequestToken) {
      return false;
    }

    const routesGeoJson = payload?.routesGeoJson && Array.isArray(payload.routesGeoJson.features)
      ? payload.routesGeoJson
      : { type: "FeatureCollection", features: [] };

    const lineSummaries = Array.isArray(payload?.lineSummaries)
      ? payload.lineSummaries
          .map((line) => ({
            ...line,
            lineKey: String(line?.lineKey || "").trim()
          }))
          .filter((line) => line.lineKey)
      : [];

    appState.viewportSummaryTransit = {
      routesGeoJson,
      lineSummaries
    };
    appState.viewportSummaryLineSummaries = lineSummaries;

    if (typeof renderModeFilterBar === "function") {
      renderModeFilterBar();
    }
    if (typeof renderFrequencyFilterBar === "function") {
      renderFrequencyFilterBar();
    }

    return true;
  } catch {
    if (requestToken === appState.viewportSummaryRequestToken) {
      appState.viewportSummaryTransit = null;
      appState.viewportSummaryLineSummaries = [];
    }
    return false;
  }
}

function onMapMoveEnd() {
  if (!appState.mapReady) {
    return;
  }

  const rawBbox = mapBoundsToBbox();
  const zoom = appState.map ? Number(appState.map.getZoom()) : 0;
  const lastViewportBbox = normalizeBboxArray(appState.lastViewportFetchBbox);
  const lastViewportZoom = Number(appState.lastViewportFetchZoom);

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
      appState.currentViewportBbox = [...rawBbox];
      syncActiveAreaKeys({
        fallbackToAllCached: false
      });
      rebuildCombinedTransit();
      refreshUiFromState();
      debouncedViewportSummary(rawBbox, zoom);
      return;
    }
  }

  const now = Date.now();
  if (now - appState.lastMoveFetchAt < MIN_MOVE_FETCH_INTERVAL_MS) {
    return;
  }
  appState.lastMoveFetchAt = now;

  loadVisibleTransit({ forceRefresh: false, reason: "move" }).catch((error) => {
    setBackendStatus(`Auto-load failed: ${error.message}`);
  });
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


