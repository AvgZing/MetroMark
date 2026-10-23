// Auto-backfill missing viewport routes from Transitland, then rebuild and reload.

var BACKFILL_MIN_ZOOM = 9;
var BACKFILL_COOLDOWN_MS = 20000;
var BACKFILL_WAIT_MS = 2500;
var BACKFILL_SETTLE_MS = 1500;
var BACKFILL_SETTLE_RETRY_MS = 1200;
var BACKFILL_SETTLE_MAX_RETRIES = 4;
var backfillCheckTimer = null;

function distinctLineKeys(features) {
  const keys = new Set();
  for (const feature of features || []) {
    const key = String(feature?.properties?.line_key || "").trim();
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function renderedLineCount() {
  if (!appState.map || !appState.mapReady) {
    return 0;
  }
  try {
    const features = appState.map.queryRenderedFeatures({
      layers: ["routes-main-vector", "routes-background-main-vector", "routes-casing-vector"]
    });
    return distinctLineKeys(features).size;
  } catch {
    return 0;
  }
}

function coverageLineCount() {
  return Number(appState.transitCoverageCount || 0);
}

// Archive line keys in the loaded tiles; null until the source is queryable.
function archiveLineKeysInViewport() {
  if (!appState.map || !appState.mapReady) {
    return null;
  }
  if (typeof appState.map.getSource !== "function" || !appState.map.getSource("routes-vector")) {
    return null;
  }
  try {
    // MapLibre needs the source layer explicitly for a vector source.
    const features = typeof vectorSourceFeatures === "function"
      ? vectorSourceFeatures()
      : appState.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" });
    return distinctLineKeys(features);
  } catch {
    return null;
  }
}

function routesLayersReady() {
  return Boolean(appState.map && appState.mapReady && appState.map.getLayer && appState.map.getLayer("routes-main-vector"));
}

// Coverage/archive mismatch proves routes may be missing; empty areas fall
// through to the catalog fallback.
function hasIncompleteCoverage() {
  if (!routesLayersReady()) {
    return false;
  }
  const archiveKeys = archiveLineKeysInViewport();
  if (!archiveKeys) {
    return false;
  }
  const coverageCount = coverageLineCount();
  if (coverageCount <= 0) {
    return archiveKeys.size === 0;
  }
  return archiveKeys.size === 0 || coverageCount > archiveKeys.size;
}

function coarseBboxKey(bbox) {
  const snap = 0.05;
  return bbox.map((value) => Math.round(Number(value) / snap)).join(",");
}

function isBackfillAreaCurrent() {
  if (!appState.backfillAreaKey || !appState.currentViewportBbox) {
    return true;
  }
  return coarseBboxKey(appState.currentViewportBbox) === appState.backfillAreaKey;
}

function scheduleBackfillCheck(delayMs) {
  if (backfillCheckTimer) {
    clearTimeout(backfillCheckTimer);
  }
  const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : BACKFILL_WAIT_MS;
  backfillCheckTimer = setTimeout(() => {
    backfillCheckTimer = null;
    maybeBackfillViewport();
  }, delay);
}

function archiveSettled() {
  const map = appState.map;
  if (!map || typeof map.areTilesLoaded !== "function") {
    return true;
  }
  if (!map.areTilesLoaded()) {
    return false;
  }
  const lastMove = Number(appState.lastCameraMoveAt || 0);
  return !lastMove || Date.now() - lastMove >= BACKFILL_SETTLE_MS;
}

async function maybeBackfillViewport() {
  if (!appState.mapReady || !appState.map) {
    return;
  }
  // City mode renders from pre-fetched geometry, so tile gap-detection is moot.
  if (typeof isCityGeometryMode === "function" && isCityGeometryMode()) {
    return;
  }

  const zoom = appState.processedViewportZoom !== null ? Number(appState.processedViewportZoom) : appState.map.getZoom();
  if (zoom < BACKFILL_MIN_ZOOM) {
    return;
  }
  if (appState.tileBackfillInFlight) {
    return;
  }
  if (Date.now() < Number(appState.tileBackfillCooldownUntil || 0)) {
    return;
  }
  // Wait for the archive to settle before judging gaps.
  if (!archiveSettled()) {
    const retries = Number(appState.backfillSettleRetries || 0);
    if (retries < BACKFILL_SETTLE_MAX_RETRIES) {
      appState.backfillSettleRetries = retries + 1;
      scheduleBackfillCheck(BACKFILL_SETTLE_RETRY_MS);
    }
    return;
  }
  appState.backfillSettleRetries = 0;

  if (!hasIncompleteCoverage()) {
    return;
  }

  const bbox = appState.currentViewportBbox;
  if (!bbox) {
    return;
  }

  const key = coarseBboxKey(bbox);
  if (appState.tileBackfillBboxes.has(key)) {
    return;
  }

  appState.tileBackfillBboxes.add(key);
  const result = await requestBackfill(bbox, { forceRefresh: false });
  if (!result) {
    // Don't auto-retry the same area after a failure.
    appState.tileBackfillCooldownUntil = Date.now() + 10 * 60 * 1000;
  }
}

async function requestBackfill(bbox, options = {}) {
  const t0 = performance.now();
  appState.backfillAreaKey = coarseBboxKey(bbox);
  appState.tileBackfillInFlight = true;
  appState.backfillStage = "fetching";

  // Card when nothing is on screen, badge when routes are visible.
  if (typeof updateLoadingStatus === "function") {
    updateLoadingStatus();
  }
  if (typeof setBackendStatus === "function") {
    setBackendStatus("Fetching routes for this viewport from Transitland…");
  }

  try {
    const start = await apiRequest("/api/tiles/backfill", {
      method: "POST",
      body: JSON.stringify({
        bbox,
        zoom: appState.processedViewportZoom !== null ? appState.processedViewportZoom : appState.map.getZoom(),
        forceRefresh: Boolean(options.forceRefresh)
      })
    });
    if (start?.error) {
      throw new Error(start.error);
    }

    // The server runs the fill in the background; follow the status endpoint.
    let status = null;
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await apiRequest("/api/tiles/backfill/status", { method: "GET" });
      if (!status?.inFlight) {
        break;
      }
      appState.backfillStage = String(status.stage || "");
      appState.backfillMessage = String(status.message || "");
      if (typeof updateLoadingStatus === "function") {
        updateLoadingStatus();
      }
    }
    if (status?.lastError) {
      throw new Error(status.lastError);
    }
    const payload = status?.lastResult || {};
    const sameArea = isBackfillAreaCurrent();

    appState.tileBackfillCount += 1;
    appState.tileBackfillTotalMs += performance.now() - t0;
    appState.tileBackfillAddedRoutes += Number(payload?.addedRoutes || 0);

    const changed =
      Number(payload?.addedRoutes || 0) + Number(payload?.updatedRoutes || 0) > 0 ||
      Boolean(payload?.rebuilt);
    if (changed) {
      // Adopt the rebuilt archive stamp and reload the source.
      if (typeof syncArchiveVersion === "function") {
        const adopted = await syncArchiveVersion();
        if (!adopted) {
          reloadVectorSource();
        }
      } else {
        reloadVectorSource();
      }
    }

    if (typeof setStatus === "function") {
      const added = Number(payload?.addedRoutes || 0);
      const updated = Number(payload?.updatedRoutes || 0);
      if (added > 0 || updated > 0) {
        setStatus(
          sameArea
            ? `${added} new route${added === 1 ? "" : "s"} loaded for this area.`
            : `${added} new route${added === 1 ? "" : "s"} loaded for the area you left.`,
          "ok",
          `${payload.totalRoutesInArchive} routes now in the archive.`
        );
      } else if (options.forceRefresh) {
        // Report the no-op only for explicit refreshes.
        setStatus("No new routes to load for this area.", "ok", "This area is already covered.");
      } else if (
        sameArea &&
        typeof archiveLineKeysInViewport === "function" &&
        (archiveLineKeysInViewport()?.size || 0) === 0
      ) {
        setStatus(
          "No routes found for this area.",
          "neutral",
          "Check Transitland's coverage map; this area may not have a feed yet."
        );
      }
    }

    if (typeof loadTilesStats === "function") {
      loadTilesStats().catch(() => {});
    }

    return payload;
  } catch (error) {
    appState.tileBackfillLastError = String(error?.message || error);
    appState.backfillStage = "";
    appState.backfillMessage = "";
    if (typeof setStatus === "function") {
      setStatus("Couldn't load routes for this area.", "error", String(error?.message || error));
    }
    if (typeof setBackendStatus === "function") {
      setBackendStatus(`Backfill failed: ${error?.message || error}`);
    }
    return null;
  } finally {
    appState.tileBackfillInFlight = false;
    appState.backfillAreaKey = "";
    appState.tileBackfillCooldownUntil = Date.now() + BACKFILL_COOLDOWN_MS;
    // Re-evaluate after the flag clears.
    if (typeof updateLoadingStatus === "function") {
      updateLoadingStatus();
    }
    // Re-check the (possibly moved) viewport after the cooldown.
    if (typeof scheduleBackfillCheck === "function") {
      scheduleBackfillCheck(BACKFILL_COOLDOWN_MS + 500);
    }
  }
}

function reloadVectorSource() {
  if (!appState.map || !appState.mapReady) {
    return;
  }

  const source = appState.map.getSource("routes-vector");
  if (source && typeof source.setUrl === "function") {
    const url = typeof vectorSourceUrl === "function"
      ? vectorSourceUrl()
      : `pmtiles:///api/tiles/routes.pmtiles?v=${Date.now()}`;
    try {
      source.setUrl(url);
    } catch {
      // fall through to metadata rebuild below
    }
  }

  appState.lastTileMetadataSignature = "";
  appState.tileBackfillBboxes.clear();
  if (typeof scheduleVectorMetadataRebuild === "function") {
    scheduleVectorMetadataRebuild();
  }
  if (typeof refreshUiFromState === "function") {
    refreshUiFromState();
  }
}

async function loadTilesStats() {
  try {
    const payload = await apiRequest("/api/tiles/stats", { method: "GET" });
    appState.tilesStats = payload;
    if (typeof renderApiCounter === "function") {
      renderApiCounter();
    }
    return payload;
  } catch {
    return null;
  }
}
