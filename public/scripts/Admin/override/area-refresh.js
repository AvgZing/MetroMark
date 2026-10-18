// Admin Map Editor — refresh-this-area panel, archive stamp/reload, deep-link view.
// ---------------------------------------------------------------------------
// Area refresh (viewport reharvest) — the action now lives on the map
// ---------------------------------------------------------------------------

function currentMapBbox() {
  if (!state.map) {
    return null;
  }
  const bounds = state.map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function formatAreaCoord(value) {
  return Number(value).toFixed(6);
}

function updateAreaRefreshBbox() {
  if (!state.areaRefreshOpen || !state.map) {
    return null;
  }
  const bbox = currentMapBbox();
  if (!bbox) {
    return null;
  }
  state.areaRefreshBbox = bbox;
  if (els.areaRefreshWest) els.areaRefreshWest.textContent = formatAreaCoord(bbox[0]);
  if (els.areaRefreshSouth) els.areaRefreshSouth.textContent = formatAreaCoord(bbox[1]);
  if (els.areaRefreshEast) els.areaRefreshEast.textContent = formatAreaCoord(bbox[2]);
  if (els.areaRefreshNorth) els.areaRefreshNorth.textContent = formatAreaCoord(bbox[3]);

  const lonSpan = bbox[2] - bbox[0];
  const latSpan = bbox[3] - bbox[1];
  const tooLarge = lonSpan > MAX_REFRESH_SPAN_DEGREES || latSpan > MAX_REFRESH_SPAN_DEGREES;
  if (els.areaRefreshSpan) {
    els.areaRefreshSpan.textContent = tooLarge
      ? `View span ${lonSpan.toFixed(2)}° × ${latSpan.toFixed(2)}° is larger than the ${MAX_REFRESH_SPAN_DEGREES}° limit — zoom in first.`
      : `Span ${lonSpan.toFixed(2)}° × ${latSpan.toFixed(2)}° (limit ${MAX_REFRESH_SPAN_DEGREES}°).`;
    els.areaRefreshSpan.classList.toggle("is-error", tooLarge);
  }
  if (els.areaRefreshRunBtn) {
    els.areaRefreshRunBtn.disabled = tooLarge;
  }
  return bbox;
}

function openAreaRefresh() {
  if (!els.areaRefreshPanel) {
    return;
  }
  state.areaRefreshOpen = true;
  els.areaRefreshPanel.hidden = false;
  setEditStatus(els.areaRefreshStatus, "");
  updateAreaRefreshBbox();
}

function closeAreaRefresh() {
  state.areaRefreshOpen = false;
  if (els.areaRefreshPanel) {
    els.areaRefreshPanel.hidden = true;
  }
}

// Versioned archive URL, matching the frontend (one shared SW cache entry).
function adminVectorSourceUrl() {
  const stamp = String(state.archiveVersion || "").trim();
  return stamp
    ? `pmtiles:///api/tiles/routes.pmtiles?v=${encodeURIComponent(stamp)}`
    : `pmtiles:///api/tiles/routes.pmtiles?v=${Date.now()}`;
}

async function fetchAdminArchiveStamp() {
  try {
    const payload = await apiRequest("/api/tiles/archive-version", { method: "GET" });
    return String(payload?.version || "").trim();
  } catch {
    return "";
  }
}

// Adopt the current archive stamp; swap the source URL in place when it changes.
async function syncAdminArchiveVersion() {
  const stamp = await fetchAdminArchiveStamp();
  if (!stamp || stamp === state.archiveVersion) {
    return false;
  }
  state.archiveVersion = stamp;
  const source = state.map && state.map.getSource ? state.map.getSource("routes-vector") : null;
  if (source && typeof source.setUrl === "function") {
    try {
      source.setUrl(adminVectorSourceUrl());
      return true;
    } catch {
      // fall through to a full source recreate
    }
  }
  reloadVectorSource();
  return true;
}

function startAdminArchiveVersionWatch() {
  if (state.archiveVersionTimer) {
    return;
  }
  syncAdminArchiveVersion().catch(() => {});
  state.archiveVersionTimer = window.setInterval(() => {
    syncAdminArchiveVersion().catch(() => {});
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncAdminArchiveVersion().catch(() => {});
    }
  });
}

// Re-create the vector source with the current archive stamp (keeps layer order).
async function reloadVectorSource() {
  const map = state.map;
  if (!map || !map.getStyle) {
    return;
  }
  const stamp = await fetchAdminArchiveStamp();
  if (stamp) {
    state.archiveVersion = stamp;
  }
  const style = map.getStyle();
  const sourceDef = style.sources && style.sources["routes-vector"];
  if (!sourceDef) {
    return;
  }
  const layerDefs = style.layers.filter((layer) => layer.source === "routes-vector");
  const beforeId = map.getLayer("stops-layer") ? "stops-layer" : undefined;
  for (const layer of layerDefs) {
    if (map.getLayer(layer.id)) {
      map.removeLayer(layer.id);
    }
  }
  if (map.getSource("routes-vector")) {
    map.removeSource("routes-vector");
  }
  map.addSource("routes-vector", {
    ...sourceDef,
    url: adminVectorSourceUrl()
  });
  for (const layer of layerDefs) {
    map.addLayer(layer, beforeId);
  }
  // Keep the focus mask between base and focus routes.
  if (map.getLayer("focus-dim-layer") && map.getLayer("routes-casing")) {
    map.moveLayer("focus-dim-layer", "routes-casing");
  }
  // Re-added layers lost their filter; restore hidden/disabled visibility.
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
  if (state.selectedLineKey) {
    setAdminFocusState(state.selectedLineKey);
  }
}

async function runAreaRefresh() {
  const bbox = updateAreaRefreshBbox();
  if (!bbox || !els.areaRefreshRunBtn) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.areaRefreshStatus, "Log in first.", true);
    return;
  }
  els.areaRefreshRunBtn.disabled = true;
  setEditStatus(els.areaRefreshStatus, "Starting area refresh…");

  const statusTimer = setInterval(async () => {
    try {
      const status = await apiRequest("/api/admin/tiles/reharvest/status", { method: "GET" });
      if (status?.current) {
        setEditStatus(els.areaRefreshStatus, `${status.current.stage}: ${status.current.message}`);
      }
    } catch {
      // Polling is best-effort; the main request reports failures.
    }
  }, 2000);

  try {
    const payload = await apiRequest("/api/admin/tiles/reharvest", {
      method: "POST",
      body: {
        bbox,
        zoom: state.map ? state.map.getZoom() : undefined,
        refreshStops: els.areaRefreshStopsCb ? els.areaRefreshStopsCb.checked : true,
        refreshHeadway: els.areaRefreshHeadwayCb ? els.areaRefreshHeadwayCb.checked : true
      }
    });
    clearInterval(statusTimer);

    const parts = [
      `Done in ${Math.round(payload.elapsedMs / 1000)}s`,
      `${payload.addedRoutes} added`,
      `${payload.updatedRoutes} updated`,
      `${payload.removedRoutes} removed`,
      `${payload.confirmedStillPresent} kept`
    ];
    if (payload.flagsOpened?.length) {
      parts.push(`${payload.flagsOpened.length} flag(s) opened`);
    }
    if (payload.refreshFailures?.length) {
      parts.push(`${payload.refreshFailures.length} refresh failure(s)`);
    }
    if (payload.tileCount !== null && payload.tileCount !== undefined) {
      parts.push(`tiles rebuilt (${payload.tileCount})`);
    }
    setEditStatus(els.areaRefreshStatus, parts.join(" · "), Boolean(payload.refreshFailures?.length));
    recordManualEdit("area", "Area refresh", parts.join(", "));
    showAdminAction(`Area refresh: ${parts.join(" · ")}`, Boolean(payload.refreshFailures?.length));
    startRebuildWatch();
    updateUnderlay();
    loadOperatorsForViewport();
  } catch (error) {
    clearInterval(statusTimer);
    setEditStatus(els.areaRefreshStatus, `Failed: ${error.message}`, true);
  } finally {
    if (els.areaRefreshRunBtn) {
      els.areaRefreshRunBtn.disabled = false;
    }
    updateAreaRefreshBbox();
  }
}

// Deep link from the console's issue reports: /admin/override?bbox=w,s,e,n&zoom=z
function applyDeepLinkView() {
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get("bbox") || "").trim();
  if (!raw) {
    return;
  }
  const parts = raw.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 4 || !parts.every((value) => Number.isFinite(value))) {
    return;
  }
  const [west, south, east, north] = parts;
  const zoom = Number(params.get("zoom"));
  if (state.map) {
    state.map.fitBounds(
      [[west, south], [east, north]],
      { padding: 40, maxZoom: Number.isFinite(zoom) ? zoom : 15, duration: 0 }
    );
  }
  openAreaRefresh();
}
