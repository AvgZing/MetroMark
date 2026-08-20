// Automatic gap detection + feed-in backfill for the PMTiles pipeline.
//
// Completeness is judged by comparing the placeholder underlay (Transitland's
// ground truth for the viewport) against what the routes.pmtiles archive
// currently renders. When Transitland has significantly more routes in the
// viewport than the archive, we fetch the missing routes once, save them to
// the NDJSON store, rebuild the archive, and reload the vector source — all
// without a page reload. Repeated views of the same area are skipped
// (coarse-bbox dedup client-side + line_key dedup server-side).

var BACKFILL_MIN_ZOOM = 8;
var BACKFILL_COOLDOWN_MS = 20000;
var BACKFILL_WAIT_MS = 2500;
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

function placeholderLineCount() {
  const geojson = (typeof PLACEHOLDER_GEOJSON !== "undefined") ? PLACEHOLDER_GEOJSON : null;
  if (!geojson || !Array.isArray(geojson.features)) {
    return 0;
  }
  return distinctLineKeys(geojson.features).size;
}

function renderedLineCount() {
  if (!appState.map || !appState.mapReady) {
    return 0;
  }
  try {
    const features = appState.map.queryRenderedFeatures({
      layers: ["routes-main-vector", "routes-background-main-vector", "routes-casing-vector", "routes-vector-layer"]
    });
    return distinctLineKeys(features).size;
  } catch {
    return 0;
  }
}

function hasIncompleteCoverage() {
  const placeholderCount = placeholderLineCount();
  const renderedCount = renderedLineCount();

  // Transitland has no data here (ocean/rural) — nothing to backfill.
  if (placeholderCount === 0) {
    return false;
  }

  // Nothing rendered but Transitland has routes → clear gap.
  if (renderedCount === 0) {
    return true;
  }

  // Partial coverage: Transitland has significantly more routes here than we
  // currently render (e.g. a few through-running lines vs. a whole network).
  return placeholderCount > renderedCount * 2 + 3;
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
  requestBackfill(bbox, { forceRefresh: false });
}

async function requestBackfill(bbox, options = {}) {
  const t0 = performance.now();
  appState.tileBackfillInFlight = true;

  if (typeof setMapNotice === "function") {
    setMapNotice(
      "Loading new routes for this area…",
      "Fetching from Transitland and rebuilding tiles. This may take a moment.",
      "neutral",
      "center"
    );
  }
  if (typeof setBackendStatus === "function") {
    setBackendStatus("Fetching routes for this viewport from Transitland…");
  }

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

    if (typeof clearMapNotice === "function") {
      clearMapNotice();
    }
    if (typeof setStatus === "function") {
      const added = Number(payload?.addedRoutes || 0);
      const updated = Number(payload?.updatedRoutes || 0);
      if (added > 0 || updated > 0) {
        setStatus(
          `${added} new route${added === 1 ? "" : "s"} loaded for this area.`,
          "ok",
          `${payload.totalRoutesInArchive} routes now in the archive.`
        );
      } else {
        setStatus("No new routes to load for this area.", "ok", "This area is already covered.");
      }
    }

    if (typeof loadTilesStats === "function") {
      loadTilesStats().catch(() => {});
    }

    return payload;
  } catch (error) {
    appState.tileBackfillLastError = String(error?.message || error);
    if (typeof clearMapNotice === "function") {
      clearMapNotice();
    }
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
  }
}

function reloadVectorSource() {
  if (!appState.map || !appState.mapReady) {
    return;
  }

  appState.vectorSourceVersion = (Number(appState.vectorSourceVersion || 0) + 1);

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
