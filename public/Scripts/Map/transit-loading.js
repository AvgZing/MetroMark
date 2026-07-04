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
  var zoom = appState.map.getZoom();
  var rawBbox = mapBoundsToBbox();
  appState.currentViewportBbox = rawBbox ? rawBbox.slice() : null;

  if (rawBbox) {
    appState.lastViewportFetchBbox = rawBbox.slice();
    appState.lastViewportFetchZoom = Number(zoom || 0);
  }

  if (!rawBbox) {
    // Dateline crossing — show all cached routes
    appState.viewportSummaryLineSummaries = [];
    appState.viewportSummaryRequestToken += 1;
    var allCachedKeys = new Set(appState.areaCache.keys());
    if (allCachedKeys.size === 0) {
      setStatus("This view crosses the 180-degree line and cannot be loaded yet.", "error",
        "Pan away from the dateline and transit will resume loading.");
      return;
    }
    appState.requestedAreaKeys = allCachedKeys;
    appState.currentViewportBbox = null;
    appState._viewportPayload = null;
    syncActiveAreaKeys({ fallbackToAllCached: true });
    rebuildCombinedTransit();
    refreshUiFromState();
    setStatus("Zoomed out. Showing all cached routes.", "ok",
      allCachedKeys.size + " cached areas are visible at this zoom.");
    setBackendStatus("World/dateline view detected.");
    return;
  }

  // Single viewport API call — server uses spatial merge (route_geometry_lod
  // + transit_cache overlap). No tile fragmentation, no fallbacks.
  var modeRouteTypes = selectedRouteTypesForFetch();
  var cacheOnly = Number(zoom || 0) < MIN_VIEWPORT_FETCH_ZOOM;

  // Clamp viewport bbox to valid coordinate ranges to prevent 400 errors
  // at continental/global zoom levels where bounds can exceed safe ranges.
  var safeBbox = [
    Math.max(-180, Math.min(180, rawBbox[0])),
    Math.max(-85, Math.min(85, rawBbox[1])),
    Math.max(-180, Math.min(180, rawBbox[2])),
    Math.max(-85, Math.min(85, rawBbox[3]))
  ];
  // Ensure west < east and south < north after clamping
  if (safeBbox[0] >= safeBbox[2]) safeBbox[0] = safeBbox[2] - 0.001;
  if (safeBbox[1] >= safeBbox[3]) safeBbox[1] = safeBbox[3] - 0.001;

  var params = new URLSearchParams({
    bbox: bboxQueryText(safeBbox),
    zoom: Number(zoom || 0).toFixed(2)
  });

  if (cacheOnly) {
    params.set("cacheOnly", "1");
  }
  if (Boolean(options.forceRefresh)) {
    params.set("refresh", "1");
    params.delete("cacheOnly");
    // Force refresh always fetches all route types — mode filter is client-side only
  } else if (Array.isArray(modeRouteTypes) && modeRouteTypes.length) {
    params.set("routeTypes", modeRouteTypes.join(","));
  }

  // Clear placeholder overlay at zoom >= 10 — real data renders instead
  if (Number(zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM && typeof clearPlaceholderLayer === "function") {
    clearPlaceholderLayer();
  }

  // Show loading indicator: corner badge when routes exist, center notice when empty
  var hasExistingRoutes = appState.lineSummaries.length > 0;
  if (hasExistingRoutes) {
    showMapLoadingBadge();
  } else {
    setMapNotice("Loading...", "", "neutral", "center");
  }

  // Fire placeholder fetch in parallel with the main spatial query.
  // When Postgres has cached placeholder data (90-day TTL), this returns
  // immediately and the underlay appears before the main routes do.
  if (Number(zoom || 0) < MIN_VIEWPORT_FETCH_ZOOM && typeof fetchPlaceholder === "function") {
    fetchPlaceholder(rawBbox, zoom);
  }

  logTiming('load-viewport:request');
  try {
    var response = await apiRequest("/api/transit/bbox?" + params.toString(), { method: "GET" });
    logTiming('load-viewport:response');

    // Track API usage counters
    appState.viewportRequestCount += 1;
    var serverPostgres = Number(response?.postgresQueryCount || 0);
    if (serverPostgres > 0) {
      appState.postgresQueryCount = serverPostgres;
    }
    var serverRest = Number(response?.transitlandRestApiRequests || 0);
    if (serverRest > 0) {
      appState.transitlandRestApiRequestCount = serverRest;
      appState.transitlandViewportFetchCount += 1;
    }
    if (!serverRest) {
      appState.postgresViewportHitCount += 1;
    }
    renderApiCounter();

    var responseRoutes = response?.routesGeoJson?.features?.length || 0;
    var responseCacheStatus = String(response?.cacheStatus || "").trim().toLowerCase();

    if (responseRoutes > 0) {
      appState._viewportPayload = response;
      rebuildCombinedTransit(response);
      refreshUiFromState();
      clearMapNotice();
      hideMapLoadingBadge();
      setBackendStatus(responseRoutes + " routes loaded for viewport at zoom " +
        Number(zoom).toFixed(0) + " (" + responseCacheStatus + ")");

      // At zoom >= 10, always backfill from Transitland so Postgres is complete.
      // The spatial query may only have a subset of routes (Amtrak from a
      // different bbox, mode-filtered previous fetch). One fetch per viewport
      // snap cell per session fills the gap permanently.
      if (Number(zoom || 0) >= MIN_VIEWPORT_FETCH_ZOOM && !appState._forceRefreshInFlight) {
        appState._forceRefreshInFlight = true;
        setBackendStatus(responseRoutes + " routes loaded — backfilling from Transitland...");
        loadVisibleTransit({ forceRefresh: true, reason: "auto-backfill" }).then(function () {
          appState._forceRefreshInFlight = false;
        }).catch(function () {
          appState._forceRefreshInFlight = false;
        });
      }
    } else {
      // No routes in viewport — keep _viewportPayload for route-click fallback
      if (!hasExistingRoutes) {
        appState._viewportPayload = null;
        rebuildCombinedTransit();
        refreshUiFromState();
      }
      // If routes were already visible, don't rebuild — the existing
      // appState.transit is still valid. Skipping avoids the flash from
      // syncMapSourceData resetting feature states on a new object ref.
      hideMapLoadingBadge();
      if (!hasExistingRoutes && Number(zoom || 0) < MIN_VIEWPORT_FETCH_ZOOM) {
        setMapNotice("Zoom in to see routes", "Pan or zoom the map to load transit.", "neutral", "center");
        setBackendStatus("No cached routes at this zoom. Zoom in to load.");
      } else if (!hasExistingRoutes) {
        setBackendStatus("No routes found at zoom " + Number(zoom).toFixed(0) + ". Try a different area.");
      }
      // If routes were already visible, keep them — don't show notices
    }

    logTiming('load-viewport:done');
  } catch (error) {
    hideMapLoadingBadge();
    console.warn("[viewport] loadVisibleTransit failed:", error.message);
    setBackendStatus("Viewport load failed: " + error.message);
    // Don't clear _viewportPayload — keep last successful data visible
  }

  debouncedViewportSummary(safeBbox, zoom);
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


