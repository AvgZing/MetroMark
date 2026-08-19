// Automatic gap detection + feed-in backfill for the PMTiles pipeline.
//
// A viewport is considered "complete" when its tiles are covered by the
// routes.pmtiles archive. When a user pans to an area that Transitland has
// data for (the placeholder underlay shows routes) but the archive does not
// cover, we fetch the missing routes once, save them to the NDJSON store,
// rebuild the archive, and reload the vector source — all without a page
// reload. Repeated views of the same area are skipped (server-side dedup).

var BACKFILL_MIN_ZOOM = 8;
var BACKFILL_COOLDOWN_MS = 20000;
var BACKFILL_WAIT_MS = 2500;
var backfillCheckTimer = null;
var pmtilesArchive = null;
var pmtilesArchiveHeader = null;

function viewportHasVectorCoverage() {
  if (!appState.map || !appState.mapReady) {
    return true;
  }
  try {
    const layers = ["routes-main-vector", "routes-background-main-vector", "routes-casing-vector", "routes-vector-layer"];
    return appState.map.queryRenderedFeatures({ layers }).length > 0;
  } catch {
    return true;
  }
}

function placeholderHasRoutes() {
  const geojson = (typeof PLACEHOLDER_GEOJSON !== "undefined") ? PLACEHOLDER_GEOJSON : null;
  return Boolean(geojson && Array.isArray(geojson.features) && geojson.features.length > 0);
}

function getPmtilesArchive() {
  if (pmtilesArchive) {
    return pmtilesArchive;
  }
  const version = appState.vectorSourceVersion || 0;
  pmtilesArchive = new pmtiles.PMTiles(`/api/tiles/routes.pmtiles?v=${version}`);
  return pmtilesArchive;
}

function resetPmtilesArchiveCache() {
  pmtilesArchive = null;
  pmtilesArchiveHeader = null;
}

async function getArchiveHeader() {
  if (pmtilesArchiveHeader) {
    return pmtilesArchiveHeader;
  }
  pmtilesArchiveHeader = await getPmtilesArchive().getHeader();
  return pmtilesArchiveHeader;
}

async function tileExistsInArchive(z, x, y) {
  try {
    const result = await getPmtilesArchive().getZxy(z, x, y);
    return Boolean(result && result.data && result.data.byteLength > 0);
  } catch {
    return false;
  }
}

async function archiveCoversViewport(bbox, zoom) {
  if (typeof bboxCenter !== "function" || typeof lngLatToTile !== "function") {
    return true;
  }
  try {
    const header = await getArchiveHeader();
    const minZoom = Number(header?.minZoom ?? 0);
    const maxZoom = Number.isFinite(Number(header?.maxZoom)) ? Number(header.maxZoom) : 14;
    const checkZoom = Math.max(minZoom, Math.min(Math.round(Number(zoom) || minZoom), maxZoom));
    const center = bboxCenter(bbox);
    const tile = lngLatToTile(center[0], center[1], checkZoom);
    return await tileExistsInArchive(checkZoom, tile.x, tile.y);
  } catch {
    return true;
  }
}

function coarseBboxKey(bbox) {
  const snap = 0.05;
  return bbox.map((value) => Math.round(Number(value) / snap)).join(",");
}

function scheduleBackfillCheck() {
  if (backfillCheckTimer) {
    clearTimeout(backfillCheckTimer);
  }
  backfillCheckTimer = setTimeout(() => {
    backfillCheckTimer = null;
    maybeBackfillViewport();
  }, BACKFILL_WAIT_MS);
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
  if (viewportHasVectorCoverage()) {
    return;
  }
  if (!placeholderHasRoutes()) {
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

  // Intelligent check: only fetch when the archive genuinely lacks this area.
  const covered = await archiveCoversViewport(bbox, zoom);
  if (covered) {
    return;
  }

  appState.tileBackfillBboxes.add(key);
  requestBackfill(bbox, { forceRefresh: false });
}

async function requestBackfill(bbox, options = {}) {
  const t0 = performance.now();
  appState.tileBackfillInFlight = true;
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
      reloadVectorSource();
    }

    if (typeof loadTilesStats === "function") {
      loadTilesStats().catch(() => {});
    }

    return payload;
  } catch (error) {
    appState.tileBackfillLastError = String(error?.message || error);
    if (typeof setBackendStatus === "function") {
      setBackendStatus(`Backfill failed: ${error?.message || error}`);
    }
    return null;
  } finally {
    appState.tileBackfillInFlight = false;
    appState.tileBackfillCooldownUntil = Date.now() + BACKFILL_COOLDOWN_MS;
  }
}

function reloadVectorSource() {
  if (!appState.map || !appState.mapReady) {
    return;
  }

  appState.vectorSourceVersion = (Number(appState.vectorSourceVersion || 0) + 1);
  resetPmtilesArchiveCache();

  const source = appState.map.getSource("routes-vector");
  const url = `pmtiles:///api/tiles/routes.pmtiles?v=${appState.vectorSourceVersion}`;
  if (source && typeof source.setUrl === "function") {
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
