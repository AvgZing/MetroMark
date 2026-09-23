// Automatic gap detection + feed-in backfill for the PMTiles pipeline.
//
// Completeness is decided from the archive alone: the coverage probe is only
// used as a yes/no ("does Transitland have anything here?"), never as a count,
// because it samples a limited number of centre tiles in Transitland's own id
// space. An area is fetched once from Transitland, saved to the NDJSON store,
// and the archive is rebuilt + the vector source reloaded without a page reload.
// Repeated views are skipped (coarse-bbox dedup client-side + line_key dedup
// server-side). The check only runs once the archive has settled: tiles loaded,
// routes layers present, and the camera still.

var BACKFILL_MIN_ZOOM = 9;
var BACKFILL_COOLDOWN_MS = 20000;
var BACKFILL_WAIT_MS = 2500;
var BACKFILL_SETTLE_MS = 1500;
var BACKFILL_SETTLE_RETRY_MS = 1200;
var BACKFILL_SETTLE_MAX_RETRIES = 4;
var backfillCheckTimer = null;
var backfillProgressTimer = null;

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

// Line keys present in the loaded archive tiles, ignoring filters/visibility.
// Returns null when the source cannot be queried yet (still loading).
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

// An area needs fetching only when Transitland has routes here and the archive
// has none at all. Counts are never compared: the coverage probe samples a few
// centre tiles in Transitland's id space, while the archive is queried in ours,
// so only presence is meaningful.
function hasIncompleteCoverage() {
  if (coverageLineCount() <= 0) {
    return false;
  }
  if (!routesLayersReady()) {
    return false;
  }
  const archiveKeys = archiveLineKeysInViewport();
  if (!archiveKeys) {
    return false;
  }
  return archiveKeys.size === 0;
}

function coarseBboxKey(bbox) {
  const snap = 0.05;
  return bbox.map((value) => Math.round(Number(value) / snap)).join(",");
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

  const zoom = appState.map.getZoom();
  if (zoom < BACKFILL_MIN_ZOOM) {
    return;
  }
  if (appState.tileBackfillInFlight) {
    return;
  }
  if (Date.now() < Number(appState.tileBackfillCooldownUntil || 0)) {
    return;
  }
  // A slow first load must never read as "missing routes": wait for the
  // archive to settle (tiles loaded + camera still) before judging.
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
    // Failed attempt: allow a later retry for this area.
    appState.tileBackfillBboxes.delete(key);
  }
}

async function pollBackfillProgress() {
  try {
    const payload = await apiRequest("/api/tiles/backfill/status", { method: "GET" });
    if (payload && payload.inFlight) {
      appState.backfillStage = String(payload.stage || "");
      appState.backfillMessage = String(payload.message || "");
      // Presentation is decided in one place: card when nothing is on screen,
      // badge when the map already has routes.
      if (typeof updateLoadingStatus === "function") {
        updateLoadingStatus();
      }
    }
  } catch {
    // Non-critical — polling is best-effort
  }
}

function startBackfillProgressPolling() {
  stopBackfillProgressPolling();
  pollBackfillProgress().catch(() => {});
  backfillProgressTimer = setInterval(() => pollBackfillProgress().catch(() => {}), 2000);
}

function stopBackfillProgressPolling() {
  if (backfillProgressTimer) {
    clearInterval(backfillProgressTimer);
    backfillProgressTimer = null;
  }
}

async function requestBackfill(bbox, options = {}) {
  const t0 = performance.now();
  appState.tileBackfillInFlight = true;
  appState.backfillStage = "fetching";

  // One place decides presentation: card when nothing is on screen, badge when
  // the map already shows routes.
  if (typeof updateLoadingStatus === "function") {
    updateLoadingStatus();
  }
  if (typeof setBackendStatus === "function") {
    setBackendStatus("Fetching routes for this viewport from Transitland…");
  }

  startBackfillProgressPolling();

  try {
    const payload = await apiRequest("/api/tiles/backfill", {
      method: "POST",
      body: JSON.stringify({
        bbox,
        zoom: appState.map.getZoom(),
        forceRefresh: Boolean(options.forceRefresh)
      })
    });

    appState.tileBackfillCount += 1;
    appState.tileBackfillTotalMs += performance.now() - t0;
    appState.tileBackfillAddedRoutes += Number(payload?.addedRoutes || 0);

    const changed = (Number(payload?.addedRoutes || 0) + Number(payload?.updatedRoutes || 0)) > 0;
    if (changed) {
      // The server rebuilt the archive, so its build stamp changed: adopting it
      // both gives the new URL and reloads the source.
      if (typeof syncArchiveVersion === "function") {
        const adopted = await syncArchiveVersion();
        if (!adopted) {
          reloadVectorSource();
        }
      } else {
        reloadVectorSource();
      }
    }

    stopBackfillProgressPolling();
    if (typeof setStatus === "function") {
      const added = Number(payload?.addedRoutes || 0);
      const updated = Number(payload?.updatedRoutes || 0);
      if (added > 0 || updated > 0) {
        setStatus(
          `${added} new route${added === 1 ? "" : "s"} loaded for this area.`,
          "ok",
          `${payload.totalRoutesInArchive} routes now in the archive.`
        );
      } else if (options.forceRefresh) {
        // User/admin-initiated refresh: report the no-op. Auto-backfill stays
        // quiet so scanning the map doesn't spam toasts for covered areas.
        setStatus("No new routes to load for this area.", "ok", "This area is already covered.");
      }
    }

    if (typeof loadTilesStats === "function") {
      loadTilesStats().catch(() => {});
    }

    return payload;
  } catch (error) {
    appState.tileBackfillLastError = String(error?.message || error);
    stopBackfillProgressPolling();
    if (typeof setStatus === "function") {
      setStatus("Couldn't load routes for this area.", "error", String(error?.message || error));
    }
    if (typeof setBackendStatus === "function") {
      setBackendStatus(`Backfill failed: ${error?.message || error}`);
    }
    return null;
  } finally {
    appState.tileBackfillInFlight = false;
    appState.tileBackfillCooldownUntil = Date.now() + BACKFILL_COOLDOWN_MS;
    // Re-evaluate once the flag is clear: routes may have arrived, or the area
    // may still be empty (empty state / zoom hint then take over).
    if (typeof updateLoadingStatus === "function") {
      updateLoadingStatus();
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
