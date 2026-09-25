const SESSION_KEY = "metromark_admin_session_token";

const MODE_LABELS = {
  0: "Tram", 1: "Metro", 2: "Rail", 3: "Bus", 4: "Ferry",
  5: "Cable Tram", 6: "Aerial", 7: "Funicular", 11: "Trolleybus", 12: "Monorail"
};

const els = {
  adminLoginShell: document.getElementById("adminLoginShell"),
  adminApp: document.getElementById("adminApp"),
  adminEmailInput: document.getElementById("adminEmailInput"),
  adminPasswordInput: document.getElementById("adminPasswordInput"),
  loginBtn: document.getElementById("loginBtn"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  loginStatusMessage: document.getElementById("loginStatusMessage"),
  logoutBtn: document.getElementById("logoutBtn"),
  refreshMapBtn: document.getElementById("refreshMapBtn"),
  areaRefreshBtn: document.getElementById("areaRefreshBtn"),
  areaRefreshPanel: document.getElementById("areaRefreshPanel"),
  areaRefreshCloseBtn: document.getElementById("areaRefreshCloseBtn"),
  areaRefreshWest: document.getElementById("areaRefreshWest"),
  areaRefreshSouth: document.getElementById("areaRefreshSouth"),
  areaRefreshEast: document.getElementById("areaRefreshEast"),
  areaRefreshNorth: document.getElementById("areaRefreshNorth"),
  areaRefreshSpan: document.getElementById("areaRefreshSpan"),
  areaRefreshStopsCb: document.getElementById("areaRefreshStopsCb"),
  areaRefreshHeadwayCb: document.getElementById("areaRefreshHeadwayCb"),
  areaRefreshRunBtn: document.getElementById("areaRefreshRunBtn"),
  areaRefreshStatus: document.getElementById("areaRefreshStatus"),
  routeEditPanel: document.getElementById("routeEditPanel"),
  stationEditPanel: document.getElementById("stationEditPanel"),
  routeIdentity: document.getElementById("routeIdentity"),
  routeEditColorDot: document.getElementById("routeEditColorDot"),
  routeEditMeta: document.getElementById("routeEditMeta"),
  routeName: document.getElementById("routeName"),
  routeShortName: document.getElementById("routeShortName"),
  routeLongName: document.getElementById("routeLongName"),
  routeOperator: document.getElementById("routeOperator"),
  routeMode: document.getElementById("routeMode"),
  routeColor: document.getElementById("routeColor"),
  routeOrdering: document.getElementById("routeOrdering"),
  routeFrequency: document.getElementById("routeFrequency"),
  routeProblematic: document.getElementById("routeProblematic"),
  routeStopsList: document.getElementById("routeStopsList"),
  newStopName: document.getElementById("newStopName"),
  newStopLat: document.getElementById("newStopLat"),
  newStopLon: document.getElementById("newStopLon"),
  addStopBtn: document.getElementById("addStopBtn"),
  branchGroupsList: document.getElementById("branchGroupsList"),
  addBranchGroupBtn: document.getElementById("addBranchGroupBtn"),
  resetRouteBtn: document.getElementById("resetRouteBtn"),
  deleteRouteOverrideBtn: document.getElementById("deleteRouteOverrideBtn"),
  cityPanelSelect: document.getElementById("cityPanelSelect"),
  newCitySlug: document.getElementById("newCitySlug"),
  newCityName: document.getElementById("newCityName"),
  newCityCountry: document.getElementById("newCityCountry"),
  newCityView: document.getElementById("newCityView"),
  newCityCreateBtn: document.getElementById("newCityCreateBtn"),
  newCityStatus: document.getElementById("newCityStatus"),
  cityPanelBody: document.getElementById("cityPanelBody"),
  cityPanelSummary: document.getElementById("cityPanelSummary"),
  citySelectedRoute: document.getElementById("citySelectedRoute"),
  cityOperatorsList: document.getElementById("cityOperatorsList"),
  cityOperatorSearchInput: document.getElementById("cityOperatorSearchInput"),
  cityOperatorSearchBtn: document.getElementById("cityOperatorSearchBtn"),
  cityOperatorResults: document.getElementById("cityOperatorResults"),
  cityAddSelectedRouteBtn: document.getElementById("cityAddSelectedRouteBtn"),
  cityExcludeSelectedRouteBtn: document.getElementById("cityExcludeSelectedRouteBtn"),
  cityRoutesList: document.getElementById("cityRoutesList"),
  cityPanelStatus: document.getElementById("cityPanelStatus"),
  saveStopOrderBtn: document.getElementById("saveStopOrderBtn"),
  clearStopOrderBtn: document.getElementById("clearStopOrderBtn"),
  saveRouteBtn: document.getElementById("saveRouteBtn"),
  discardRouteBtn: document.getElementById("discardRouteBtn"),
  routeEditStatus: document.getElementById("routeEditStatus"),
  routeSearchInput: document.getElementById("routeSearchInput"),
  routeModeFilterSelect: document.getElementById("routeModeFilterSelect"),
  routeSearchInfo: document.getElementById("routeSearchInfo"),
  routeSearchResults: document.getElementById("routeSearchResults"),
  refreshSelectedRoutesBtn: document.getElementById("refreshSelectedRoutesBtn"),
  routeBatchStatus: document.getElementById("routeBatchStatus"),
  transitlandSearchInput: document.getElementById("transitlandSearchInput"),
  transitlandSearchBtn: document.getElementById("transitlandSearchBtn"),
  transitlandSearchResults: document.getElementById("transitlandSearchResults"),
  transitlandSearchStatus: document.getElementById("transitlandSearchStatus"),
  refreshRouteBtn: document.getElementById("refreshRouteBtn"),
  removeRouteBtn: document.getElementById("removeRouteBtn"),
  routeDataStatus: document.getElementById("routeDataStatus"),
  hideAllOperatorsBtn: document.getElementById("hideAllOperatorsBtn"),
  showAllOperatorsBtn: document.getElementById("showAllOperatorsBtn"),
  batchModeSelect: document.getElementById("batchModeSelect"),
  batchHideBtn: document.getElementById("batchHideBtn"),
  batchShowBtn: document.getElementById("batchShowBtn"),
  batchStatus: document.getElementById("batchStatus"),
  stationIdentity: document.getElementById("stationIdentity"),
  stationName: document.getElementById("stationName"),
  stationLat: document.getElementById("stationLat"),
  stationLon: document.getElementById("stationLon"),
  stationNote: document.getElementById("stationNote"),
  saveStationBtn: document.getElementById("saveStationBtn"),
  discardStationBtn: document.getElementById("discardStationBtn"),
  stationEditStatus: document.getElementById("stationEditStatus"),
  operatorList: document.getElementById("operatorList"),
  manualEditsLog: document.getElementById("manualEditsLog")
};

const state = {
  token: sessionStorage.getItem(SESSION_KEY) || "",
  map: null,
  mapReady: false,
  cities: [],
  currentCitySlug: "",
  routeSearchQuery: "",
  routeModeFilter: "",
  underlayFeatures: [],
  selectedLineKey: "",
  selectedStationKey: "",
  selectedRouteFeature: null,
  selectedRouteOverride: null,
  selectedRouteReview: null,
  routeOverlapPopup: null,
  operatorsByCity: new Map(),
  currentRouteStops: [],
  manualEdits: [],
  areaRefreshOpen: false,
  areaRefreshBbox: null,
  routeBatchSelection: new Set(),
  selectedBranchGroups: [],
  hiddenOperators: new Set(),
  disabledRouteKeys: new Set(),
  cityPanelList: [],
  cityPanelCity: null
};

// Mirrors MAX_SPAN_DEGREES in server/admin/reharvest.js.
const MAX_REFRESH_SPAN_DEGREES = 1.8;

const EMPTY_FC = { type: "FeatureCollection", features: [] };

function setAdminSession(token) {
  state.token = String(token || "").trim();
  if (state.token) {
    sessionStorage.setItem(SESSION_KEY, state.token);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

function clearAdminSession() {
  setAdminSession("");
}

function setAdminLocked(locked) {
  if (els.adminLoginShell) {
    els.adminLoginShell.hidden = !locked;
  }
  if (els.adminApp) {
    els.adminApp.hidden = locked;
  }
  document.body.classList.toggle("admin-locked", Boolean(locked));
}

async function apiRequest(path, options = {}) {
  const token = String(options.adminKey || state.token || "").trim();
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function setEditStatus(el, message, isError = false) {
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  el.classList.toggle("is-ok", !isError);
  el.style.color = "";
}

function recordManualEdit(kind, label, detail) {
  state.manualEdits.unshift({
    at: new Date().toISOString(),
    kind,
    label,
    detail
  });
  renderManualEditsLog();
}

function renderManualEditsLog() {
  els.manualEditsLog.innerHTML = "";
  if (!state.manualEdits.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No manual edits recorded yet.";
    els.manualEditsLog.append(p);
    return;
  }
  for (const edit of state.manualEdits.slice(0, 60)) {
    const row = document.createElement("div");
    row.className = "manual-edit-row";
    const head = document.createElement("div");
    head.className = "manual-edit-head";
    const kind = document.createElement("span");
    kind.className = "manual-edit-kind";
    kind.textContent = edit.kind;
    const at = document.createElement("span");
    at.className = "manual-edit-at";
    at.textContent = new Date(edit.at).toLocaleString();
    head.append(kind, at);
    const label = document.createElement("p");
    label.textContent = edit.label;
    const detail = document.createElement("p");
    detail.className = "microcopy";
    detail.textContent = edit.detail || "";
    row.append(head, label, detail);
    els.manualEditsLog.append(row);
  }
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function mapStyle() {
  // Frontend basemap/projection + admin overlay layers.
  const savedTheme = typeof getAdminTheme === "function" ? getAdminTheme() : "light";
  const base = createMapStyle(savedTheme);
  return {
    ...base,
    sources: {
      ...base.sources,
      "routes-vector": { type: "vector", url: "pmtiles:///api/tiles/routes.pmtiles" },
      "routes-underlay": { type: "geojson", data: EMPTY_FC },
      "routes-edited": { type: "geojson", data: EMPTY_FC },
      stops: { type: "geojson", data: EMPTY_FC },
      "stops-edited": { type: "geojson", data: EMPTY_FC }
    },
    layers: [
      ...base.layers,
      {
        id: "routes-underlay",
        type: "line",
        source: "routes-underlay",
        paint: { "line-color": "#4f7ea8", "line-width": 1, "line-opacity": 0.15 }
      },
      {
        id: "routes-main",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], ["get", "color"], "#177ca2"],
          "line-width": 1.6,
          "line-opacity": 0.8
        }
      },
      {
        id: "routes-hit",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: { "line-color": "#000000", "line-width": 10, "line-opacity": 0 }
      },
      {
        id: "routes-edited",
        type: "line",
        source: "routes-edited",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 3,
          "line-opacity": 0.95,
          "line-dasharray": [2, 1.2]
        }
      },
      {
        id: "stops-layer",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": 5.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#111920",
          "circle-stroke-width": 1.5
        }
      },
      {
        id: "stops-edited",
        type: "circle",
        source: "stops-edited",
        paint: {
          "circle-radius": 8,
          "circle-color": "#f59e0b",
          "circle-stroke-color": "#111920",
          "circle-stroke-width": 1.8
        }
      }
    ]
  };
}

async function initMap() {
  if (typeof pmtiles !== "undefined" && typeof maplibregl !== "undefined") {
    const pmtilesProtocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
  }

  // Ensure the CARTO basemap key is loaded before the style is built.
  if (typeof fetchBasemapKey === "function") {
    await fetchBasemapKey();
  }

  state.map = new maplibregl.Map({
    container: "overrideMap",
    style: mapStyle(),
    center: [-122.335, 47.608],
    zoom: 10,
    attributionControl: true
  });
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  state.map.on("load", () => {
    state.mapReady = true;
    updateCurrentCity();
    bindMapEvents();
    updateUnderlay();
    applyDeepLinkView();
    updateNewCityView();
    // Retry once if a cold cache drops the first pmtiles paint.
    window.setTimeout(() => {
      if (!state.map || !state.map.getLayer("routes-main")) {
        return;
      }
      if (state.map.queryRenderedFeatures({ layers: ["routes-main"] }).length === 0) {
        reloadVectorSource();
        updateUnderlay();
      }
    }, 4000);
  });

  state.map.on("moveend", () => {
    updateUnderlay();
    updateCurrentCity();
    loadOperatorsForViewport();
    updateNewCityView();
    if (state.areaRefreshOpen) {
      updateAreaRefreshBbox();
    }
  });
}

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

// Re-create the vector source with a cache-busting stamp (keeps layer order).
function reloadVectorSource() {
  const map = state.map;
  if (!map || !map.getStyle) {
    return;
  }
  const style = map.getStyle();
  const sourceDef = style.sources && style.sources["routes-vector"];
  if (!sourceDef) {
    return;
  }
  const layerDefs = style.layers.filter((layer) => layer.source === "routes-vector");
  const beforeId = map.getLayer("routes-edited") ? "routes-edited" : undefined;
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
    url: `pmtiles:///api/tiles/routes.pmtiles?v=${Date.now()}`
  });
  for (const layer of layerDefs) {
    map.addLayer(layer, beforeId);
  }
  // Re-added layers lost their filter; restore hidden/disabled visibility.
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
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
    reloadVectorSource();
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

// ---------------------------------------------------------------------------
// Route browser: search/focus, per-route refresh/remove, add from Transitland
// ---------------------------------------------------------------------------

function routeFeatureBounds(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const parts =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const part of parts) {
    if (!Array.isArray(part)) {
      continue;
    }
    for (const coord of part) {
      if (!Array.isArray(coord) || coord.length < 2) {
        continue;
      }
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon)) {
    return null;
  }
  return [[minLon, minLat], [maxLon, maxLat]];
}

function focusRouteFeature(feature) {
  const bounds = routeFeatureBounds(feature);
  if (bounds && state.map) {
    state.map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 300 });
  }
  selectRouteFromFeature(feature);
}

// Rendered + underlay routes, deduped by line key (coverage alone misses some).
function collectRouteSearchCorpus() {
  const byKey = new Map();
  const add = (feature) => {
    const props = featureLineProps(feature);
    if (!props.lineKey) {
      return;
    }
    const existing = byKey.get(props.lineKey);
    if (!existing) {
      byKey.set(props.lineKey, feature);
      return;
    }
    const hasGeom = Boolean(feature.geometry && Array.isArray(feature.geometry.coordinates));
    const existingGeom = Boolean(existing.geometry && Array.isArray(existing.geometry.coordinates));
    if (hasGeom && !existingGeom) {
      byKey.set(props.lineKey, feature);
    }
  };
  if (state.map && state.mapReady && state.map.getLayer("routes-main")) {
    for (const feature of state.map.queryRenderedFeatures({ layers: ["routes-main"] })) {
      add(feature);
    }
  }
  for (const feature of state.underlayFeatures || []) {
    add(feature);
  }
  return Array.from(byKey.values());
}

function routeSearchHaystack(feature) {
  const p = feature?.properties || {};
  return [
    p.line_key,
    p.line_name,
    p.line_short_name,
    p.line_long_name,
    p.operator_name,
    p.onestop_id,
    p.route_onestop_id
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function renderRouteSearchResults(features, context = {}) {
  const container = els.routeSearchResults;
  if (!container) {
    return;
  }
  const query = String(context.query || "").trim().toLowerCase();
  const modeFilter = String(context.modeFilter || "").trim();
  const hasFilter = Boolean(query || modeFilter);
  container.innerHTML = "";
  // Only render results when a search/filter is active.
  if (!hasFilter) {
    updateRouteBatchControl();
    return;
  }
  const list = (Array.isArray(features) ? features : []).filter((feature) => {
    if (query && !routeSearchHaystack(feature).includes(query)) {
      return false;
    }
    if (modeFilter) {
      const routeType = Number(feature?.properties?.route_type);
      if (!Number.isFinite(routeType) || String(routeType) !== modeFilter) {
        return false;
      }
    }
    return true;
  });
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No matching routes in the current view. Pan/zoom the map to load more.";
    container.append(p);
    updateRouteBatchControl();
    return;
  }

  const seen = new Set();
  let rendered = 0;
  for (const feature of list) {
    const props = featureLineProps(feature);
    if (!props.lineKey || seen.has(props.lineKey)) {
      continue;
    }
    seen.add(props.lineKey);
    if (rendered >= 60) {
      break;
    }
    rendered += 1;

    const row = document.createElement("div");
    row.className = "admin-route-result-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.title = "Select for batch refresh";
    cb.checked = state.routeBatchSelection.has(props.lineKey);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.routeBatchSelection.add(props.lineKey);
      } else {
        state.routeBatchSelection.delete(props.lineKey);
      }
      updateRouteBatchControl();
    });

    const focusBtn = document.createElement("button");
    focusBtn.type = "button";
    focusBtn.className = "admin-route-result-focus";
    const dot = document.createElement("span");
    dot.className = "admin-route-select-dot";
    dot.style.background = props.color || "#177ca2";
    const name = document.createElement("span");
    name.className = "admin-route-select-name";
    name.textContent = adminLineDisplayName(props) || props.lineKey;
    const meta = document.createElement("span");
    meta.className = "admin-route-select-meta";
    meta.textContent = props.lineKey;
    focusBtn.append(dot, name, meta);
    focusBtn.addEventListener("click", () => focusRouteFeature(feature));

    row.append(cb, focusBtn);
    container.append(row);
  }
  updateRouteBatchControl();
}

function updateRouteBatchControl() {
  const count = state.routeBatchSelection.size;
  if (els.refreshSelectedRoutesBtn) {
    els.refreshSelectedRoutesBtn.textContent = `Refresh selected (${count})`;
    els.refreshSelectedRoutesBtn.disabled = count === 0;
  }
}

function summarizeRouteReport(payload, keys) {
  const parts = [`Done in ${Math.round(Number(payload.elapsedMs || 0) / 1000)}s`];
  if (payload.refreshed?.length) parts.push(`${payload.refreshed.length} refreshed`);
  if (payload.merged?.added) parts.push(`${payload.merged.added} added`);
  if (payload.merged?.updated) parts.push(`${payload.merged.updated} updated`);
  if (payload.removed?.length) parts.push(`${payload.removed.length} removed`);
  if (payload.flagsOpened?.length) parts.push(`${payload.flagsOpened.length} flag(s) opened`);
  if (payload.failures?.length) parts.push(`${payload.failures.length} failure(s)`);
  if (payload.tileCount !== null && payload.tileCount !== undefined) {
    parts.push(`tiles rebuilt (${payload.tileCount})`);
  }
  const removedKeys = new Set((payload.removed || []).map((entry) => entry.lineKey));
  return { text: parts.join(" · "), isError: Boolean(payload.failures?.length), removedKeys };
}

async function refreshRoutesByKeys(keys, statusEl) {
  if (!keys.length) {
    return null;
  }
  if (!state.token) {
    setEditStatus(statusEl, "Log in first.", true);
    return null;
  }
  setEditStatus(statusEl, `Refreshing ${keys.length} route(s)…`);
  try {
    const payload = await apiRequest("/api/admin/routes/refresh", {
      method: "POST",
      body: {
        lineKeys: keys,
        zoom: state.map ? state.map.getZoom() : undefined
      }
    });
    const summary = summarizeRouteReport(payload, keys);
    setEditStatus(statusEl, summary.text, summary.isError);
    recordManualEdit("route-data", `${keys.length} route(s) refreshed`, summary.text);
    return summary;
  } catch (error) {
    setEditStatus(statusEl, `Failed: ${error.message}`, true);
    return null;
  }
}

async function refreshSelectedRoutes() {
  const keys = Array.from(state.routeBatchSelection);
  if (els.refreshSelectedRoutesBtn) {
    els.refreshSelectedRoutesBtn.disabled = true;
  }
  try {
    const summary = await refreshRoutesByKeys(keys, els.routeBatchStatus);
    if (!summary) {
      return;
    }
    state.routeBatchSelection.clear();
    reloadVectorSource();
    updateUnderlay();
    loadOperatorsForViewport();
    if (summary.removedKeys.has(state.selectedLineKey)) {
      clearSelection();
    }
  } finally {
    updateRouteBatchControl();
  }
}

async function refreshSingleRoute() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  if (els.refreshRouteBtn) {
    els.refreshRouteBtn.disabled = true;
  }
  try {
    const summary = await refreshRoutesByKeys([lineKey], els.routeDataStatus);
    if (!summary) {
      return;
    }
    reloadVectorSource();
    updateUnderlay();
    if (summary.removedKeys.has(lineKey)) {
      clearSelection();
    }
  } finally {
    if (els.refreshRouteBtn) {
      els.refreshRouteBtn.disabled = false;
    }
  }
}

async function removeSingleRoute() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  const confirmed = window.confirm(
    `Remove ${lineKey} from the archive? Admin overrides, reviews, and votes are preserved and flagged for review.`
  );
  if (!confirmed) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.routeDataStatus, "Log in first.", true);
    return;
  }
  if (els.removeRouteBtn) {
    els.removeRouteBtn.disabled = true;
  }
  try {
    setEditStatus(els.routeDataStatus, "Removing route…");
    const payload = await apiRequest("/api/admin/routes/remove", {
      method: "POST",
      body: { lineKeys: [lineKey] }
    });
    const summary = summarizeRouteReport(payload, [lineKey]);
    setEditStatus(els.routeDataStatus, summary.text, summary.isError);
    recordManualEdit("route-data", `${lineKey} removed`, "removed from archive");
    reloadVectorSource();
    updateUnderlay();
    clearSelection();
  } catch (error) {
    setEditStatus(els.routeDataStatus, `Failed: ${error.message}`, true);
  } finally {
    if (els.removeRouteBtn) {
      els.removeRouteBtn.disabled = false;
    }
  }
}

async function searchTransitland() {
  const query = String(els.transitlandSearchInput?.value || "").trim();
  if (!query) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.transitlandSearchStatus, "Log in first.", true);
    return;
  }
  setEditStatus(els.transitlandSearchStatus, "Searching Transitland…");
  if (els.transitlandSearchResults) {
    els.transitlandSearchResults.innerHTML = "";
  }
  try {
    const bounds = state.map && state.map.getBounds ? state.map.getBounds() : null;
    const bboxParam = bounds
      ? `&bbox=${[bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",")}`
      : "";
    const payload = await apiRequest(
      `/api/admin/routes/search?q=${encodeURIComponent(query)}${bboxParam}`,
      { method: "GET" }
    );
    renderTransitlandResults(Array.isArray(payload?.routes) ? payload.routes : []);
  } catch (error) {
    setEditStatus(els.transitlandSearchStatus, `Search failed: ${error.message}`, true);
  }
}

function renderTransitlandResults(routes) {
  const container = els.transitlandSearchResults;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  if (!routes.length) {
    setEditStatus(els.transitlandSearchStatus, "No Transitland routes matched.");
    return;
  }
  setEditStatus(els.transitlandSearchStatus, `${routes.length} match(es).`);
  for (const candidate of routes) {
    const row = document.createElement("div");
    row.className = "admin-route-result-row";

    const dot = document.createElement("span");
    dot.className = "admin-route-select-dot";
    dot.style.background = candidate.color || "#177ca2";

    const name = document.createElement("span");
    name.className = "admin-route-select-name";
    name.textContent =
      adminLineDisplayName({
        lineShortName: candidate.lineShortName,
        lineLongName: candidate.lineLongName,
        lineName: candidate.lineName,
        lineKey: candidate.lineKey
      }) || candidate.lineKey;

    const meta = document.createElement("span");
    meta.className = "admin-route-select-meta";
    meta.textContent = candidate.lineKey;

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => addTransitlandRoute(candidate, addBtn));

    row.append(dot, name, meta, addBtn);
    container.append(row);
  }
}

async function addTransitlandRoute(candidate, button) {
  if (!candidate?.lineKey) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.transitlandSearchStatus, "Log in first.", true);
    return;
  }
  button.disabled = true;
  setEditStatus(els.transitlandSearchStatus, `Adding ${candidate.lineKey}…`);
  try {
    const payload = await apiRequest("/api/admin/routes/add", {
      method: "POST",
      body: {
        lineKeys: [candidate.lineKey],
        zoom: state.map ? state.map.getZoom() : undefined
      }
    });
    const summary = summarizeRouteReport(payload, [candidate.lineKey]);
    setEditStatus(
      els.transitlandSearchStatus,
      `Added ${candidate.lineKey}. ${summary.text}`,
      summary.isError
    );
    recordManualEdit("route-data", `${candidate.lineKey} added`, "added from Transitland search");
    reloadVectorSource();
    updateUnderlay();
    const match = (state.underlayFeatures || []).find(
      (feature) => String(featureLineProps(feature).lineKey) === candidate.lineKey
    );
    if (match) {
      focusRouteFeature(match);
    }
  } catch (error) {
    setEditStatus(els.transitlandSearchStatus, `Add failed: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function updateCurrentCity() {
  if (!state.map || !state.mapReady) {
    return;
  }
  const center = state.map.getCenter();
  const city = state.cities.find((c) => {
    const [w, s, e, n] = c.bbox || [];
    return w <= center.lng && center.lng <= e && s <= center.lat && center.lat <= n;
  }) || state.cities[0] || null;
  state.currentCitySlug = city ? city.slug : "";
}

async function updateUnderlay() {
  if (!state.mapReady || !state.map) {
    return;
  }
  const bbox = state.map.getBounds().toArray();
  const bounds = [bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]];
  const zoom = state.map.getZoom();
  try {
    const params = new URLSearchParams({
      bbox: bounds.join(","),
      zoom: String(Math.round(zoom)),
      includeGeometry: "1"
    });
    const payload = await fetch(`/api/transit/coverage?${params.toString()}`).then((r) => r.json());
    const source = state.map.getSource("routes-underlay");
    if (source && payload?.routesGeoJson) {
      // Cache raw features for the search/filter controls.
      state.underlayFeatures = Array.isArray(payload.routesGeoJson.features)
        ? payload.routesGeoJson.features
        : [];
      applyUnderlaySearchFilter();
    }
  } catch {
    // non-critical
  }
}

function buildUnderlaySearchText(feature) {
  const props = feature?.properties || {};
  return [
    props.line_key,
    props.line_name,
    props.line_short_name,
    props.line_long_name,
    props.operator_name,
    props.onestop_id,
    props.route_onestop_id
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function applyUnderlaySearchFilter() {
  const source = state.map && state.map.getSource("routes-underlay");
  if (!source) {
    return;
  }

  const query = String(state.routeSearchQuery || "").trim().toLowerCase();
  const modeFilter = String(state.routeModeFilter || "").trim();

  const features = (state.underlayFeatures || []).filter((feature) => {
    if (query) {
      const haystack = buildUnderlaySearchText(feature);
      if (!haystack.includes(query)) {
        return false;
      }
    }
    if (modeFilter) {
      const routeType = Number(feature?.properties?.route_type);
      if (!Number.isFinite(routeType) || String(routeType) !== modeFilter) {
        return false;
      }
    }
    return true;
  });

  source.setData({ type: "FeatureCollection", features });

  const corpus = collectRouteSearchCorpus();
  if (els.routeSearchInfo) {
    els.routeSearchInfo.textContent =
      query || modeFilter ? `${corpus.length} route(s) in view` : "";
  }

  renderRouteSearchResults(corpus, { query, modeFilter });
}

async function loadCities() {
  try {
    const data = await fetch("/api/catalog/cities").then((r) => r.json());
    state.cities = Array.isArray(data.cities) ? data.cities : [];
  } catch {
    state.cities = [];
  }
}

function bindMapEvents() {
  state.map.on("click", "routes-hit", (event) => {
    const features = state.map.queryRenderedFeatures(event.point, { layers: ["routes-hit"] });
    if (!features || !features.length) {
      return;
    }

    const seenLineKeys = new Set();
    const uniqueFeatures = [];
    for (const feature of features) {
      const props = featureLineProps(feature);
      const lineKey = String(props.lineKey || "").trim();
      if (!lineKey || seenLineKeys.has(lineKey)) {
        continue;
      }
      seenLineKeys.add(lineKey);
      uniqueFeatures.push(feature);
    }

    if (uniqueFeatures.length === 1) {
      selectRouteFromFeature(uniqueFeatures[0]);
      return;
    }

    openRouteOverlapPopup(uniqueFeatures, event.lngLat);
  });

  state.map.on("click", "stops-layer", (event) => {
    const features = state.map.queryRenderedFeatures(event.point, { layers: ["stops-layer"] });
    const feature = features && features[0];
    if (!feature) {
      return;
    }
    selectStationFromFeature(feature);
  });

  state.map.on("click", (event) => {
    const clicked = state.map.queryRenderedFeatures(event.point, {
      layers: ["routes-hit", "stops-layer"]
    });
    if (!clicked || !clicked.length) {
      closeRouteOverlapPopup();
      clearSelection();
    }
  });

  state.map.on("mousemove", (event) => {
    const hit = state.map.queryRenderedFeatures(event.point, { layers: ["routes-hit", "stops-layer"] });
    state.map.getCanvas().style.cursor = hit && hit.length ? "pointer" : "";
  });
}

function escapeAdminHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function adminLineDisplayName(props) {
  return [props.lineShortName, props.lineLongName || props.lineName]
    .filter(Boolean)
    .join(" | ") || props.lineKey;
}

function openRouteOverlapPopup(features, lngLat) {
  closeRouteOverlapPopup();
  if (!state.map) {
    return;
  }

  const rows = features
    .map((feature) => {
      const props = featureLineProps(feature);
      const meta = [props.operatorName, props.lineKey].filter(Boolean).join(" | ");
      return `
        <button class="route-select-btn" type="button" data-admin-route-select="${escapeAdminHtml(props.lineKey)}">
          <span class="route-select-name">${escapeAdminHtml(adminLineDisplayName(props))}</span>
          <span class="route-select-meta">${escapeAdminHtml(meta)}</span>
        </button>`;
    })
    .join("");

  // Same markup/classes as the frontend route selector.
  state.routeOverlapPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    offset: 16
  })
    .setLngLat(lngLat)
    .setHTML(
      `<div class="station-hover route-select-popup">
        <div class="route-select-header"><h4>Select Route</h4></div>
        <p class="hover-subtitle">${features.length} routes overlap here.</p>
        <div class="route-select-list">${rows}</div>
      </div>`
    )
    .addTo(state.map);

  const popupEl = state.routeOverlapPopup.getElement();
  if (popupEl) {
    popupEl.querySelectorAll("[data-admin-route-select]").forEach((button) => {
      button.addEventListener("click", () => {
        const lineKey = String(button.getAttribute("data-admin-route-select") || "").trim();
        const feature = features.find((f) => {
          return String(featureLineProps(f).lineKey || "").trim() === lineKey;
        });
        closeRouteOverlapPopup();
        if (feature) {
          selectRouteFromFeature(feature);
        }
      });
    });
  }
}

function closeRouteOverlapPopup() {
  if (state.routeOverlapPopup) {
    state.routeOverlapPopup.remove();
    state.routeOverlapPopup = null;
  }
}

function featureLineProps(feature) {
  const p = feature?.properties || {};
  return {
    lineKey: String(p.line_key || p.id || "").trim(),
    lineName: String(p.line_name || ""),
    lineShortName: String(p.line_short_name || ""),
    lineLongName: String(p.line_long_name || ""),
    operatorName: String(p.operator_name || ""),
    routeType: Number.isFinite(Number(p.route_type)) ? Number(p.route_type) : null,
    color: String(p.color || ""),
    routeOnestopId: String(p.route_onestop_id || p.onestop_id || "")
  };
}

function dedupeAdminStopFeatures(features) {
  const seen = new Set();
  return (Array.isArray(features) ? features : []).filter((feature) => {
    const key = String(feature?.properties?.station_key || "").trim();
    if (!key) {
      return true;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function adminCustomStopFeature(stop, lineKey) {
  const key = String(stop?.key || "").trim();
  const lat = Number(stop?.lat);
  const lon = Number(stop?.lon);
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return {
    type: "Feature",
    id: `${lineKey}|${key}`,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      station_key: key,
      station_name: String(stop?.name || key),
      line_key: lineKey,
      custom_stop: 1
    }
  };
}

function orderAdminStopsByCustomOrder(features, customStops, lineKey = "") {
  const byKey = new Map();
  for (const feature of features || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (key) {
      byKey.set(key, feature);
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const stop of customStops || []) {
    const key = String(stop?.key || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const feature = byKey.get(key);
    if (feature) {
      ordered.push(feature);
      continue;
    }
    // A stop added manually by an admin — synthesize it from override coords.
    const synthetic = adminCustomStopFeature(stop, lineKey);
    if (synthetic) {
      ordered.push(synthetic);
    }
  }

  for (const feature of features || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (!seen.has(key)) {
      ordered.push(feature);
    }
  }

  return ordered;
}

async function loadStopsForRoute(lineKey) {
  const source = state.map && state.map.getSource("stops");
  if (!source) {
    return;
  }
  try {
    const params = new URLSearchParams({ lineKey, stopTypes: ROUTE_STOP_TYPES_QUERY });
    const payload = await fetch(`/api/transit/route-stops?${params.toString()}`).then((r) => r.json());
    if (Array.isArray(payload?.stopsGeoJson?.features)) {
      // Dedupe by station key, then apply the saved custom order.
      let stops = dedupeAdminStopFeatures(payload.stopsGeoJson.features);
      if (state.selectedRouteOverride && Array.isArray(state.selectedRouteOverride.payload?.stops)) {
        stops = orderAdminStopsByCustomOrder(
          stops,
          state.selectedRouteOverride.payload.stops,
          lineKey
        );
      }
      source.setData({ type: "FeatureCollection", features: stops });
      state.currentRouteStops = stops.slice();
      renderStopsOrderList();
    }
  } catch {
    // non-critical — stations still editable via other flows
  }
}

function appendStopsToMapSource(newFeatures) {
  const source = state.map && state.map.getSource("stops");
  if (!source || !newFeatures?.length) {
    return;
  }
  const current = Array.isArray(source._data?.features) ? source._data.features : [];
  source.setData({ type: "FeatureCollection", features: [...current, ...newFeatures] });
}

function slugifyBranchId(text, fallback) {
  const slug = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

function branchOptionChoices() {
  const choices = [];
  for (const group of state.selectedBranchGroups || []) {
    for (const option of group.options || []) {
      choices.push({ group, option });
    }
  }
  return choices;
}

function renderBranchGroupsEditor() {
  const container = els.branchGroupsList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const groups = state.selectedBranchGroups || [];
  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No branch groups. Add one to tag alternative stop runs.";
    container.append(p);
    return;
  }

  groups.forEach((group, groupIndex) => {
    const card = document.createElement("div");
    card.className = "branch-group-card";

    const head = document.createElement("div");
    head.className = "branch-group-head";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "branch-group-label";
    labelInput.value = String(group.label || "");
    labelInput.placeholder = "Branch label (e.g. Via Bank)";
    labelInput.addEventListener("input", () => {
      group.label = labelInput.value;
    });
    const removeGroup = document.createElement("button");
    removeGroup.type = "button";
    removeGroup.className = "stop-order-remove";
    removeGroup.textContent = "×";
    removeGroup.title = "Remove branch group";
    removeGroup.addEventListener("click", () => {
      state.selectedBranchGroups.splice(groupIndex, 1);
      renderBranchGroupsEditor();
      renderStopsOrderList();
    });
    head.append(labelInput, removeGroup);

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "branch-options-list";
    (group.options || []).forEach((option, optionIndex) => {
      const row = document.createElement("div");
      row.className = "branch-option-row";
      const optionInput = document.createElement("input");
      optionInput.type = "text";
      optionInput.className = "branch-option-label";
      optionInput.value = String(option.label || "");
      optionInput.placeholder = "Option label";
      optionInput.addEventListener("input", () => {
        option.label = optionInput.value;
      });
      const removeOption = document.createElement("button");
      removeOption.type = "button";
      removeOption.className = "stop-order-remove";
      removeOption.textContent = "×";
      removeOption.title = "Remove option";
      removeOption.addEventListener("click", () => {
        group.options.splice(optionIndex, 1);
        renderBranchGroupsEditor();
        renderStopsOrderList();
      });
      row.append(optionInput, removeOption);
      optionsWrap.append(row);
    });

    const addOption = document.createElement("button");
    addOption.type = "button";
    addOption.className = "btn btn-subtle branch-add-option";
    addOption.textContent = "+ option";
    addOption.addEventListener("click", () => {
      const stamp = Date.now().toString(36);
      group.options = Array.isArray(group.options) ? group.options : [];
      group.options.push({
        id: `opt-${groupIndex + 1}-${stamp}`,
        label: `Option ${group.options.length + 1}`
      });
      renderBranchGroupsEditor();
      renderStopsOrderList();
    });

    card.append(head, optionsWrap, addOption);
    container.append(card);
  });
}

function addBranchGroup() {
  const stamp = Date.now().toString(36);
  state.selectedBranchGroups = state.selectedBranchGroups || [];
  state.selectedBranchGroups.push({
    id: `group-${state.selectedBranchGroups.length + 1}-${stamp}`,
    label: `Branch ${state.selectedBranchGroups.length + 1}`,
    options: [{ id: `opt-1-${stamp}`, label: "Option 1" }]
  });
  renderBranchGroupsEditor();
  renderStopsOrderList();
}

function renderStopsOrderList() {
  els.routeStopsList.innerHTML = "";
  const stops = state.currentRouteStops || [];
  if (!stops.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No stops loaded for this route yet.";
    els.routeStopsList.append(p);
    return;
  }
  stops.forEach((feature, index) => {
    const p = feature.properties || {};
    const row = document.createElement("div");
    row.className = "stop-order-row" + (p.custom_stop ? " is-custom" : "");

    const pos = document.createElement("span");
    pos.className = "stop-order-pos";
    pos.textContent = String(index + 1).padStart(2, "0");

    const coords = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];

    const fields = document.createElement("div");
    fields.className = "stop-order-fields";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = String(p.station_name || p.stop_name || p.station_key || "");
    nameInput.placeholder = "Stop name";
    nameInput.addEventListener("input", () => {
      p.station_name = nameInput.value;
    });

    const latInput = document.createElement("input");
    latInput.type = "number";
    latInput.step = "any";
    latInput.placeholder = "Lat";
    latInput.value = Number.isFinite(Number(coords[1])) ? String(Number(coords[1]).toFixed(6)) : "";
    latInput.addEventListener("input", () => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        feature.geometry = { type: "Point", coordinates: [lon, lat] };
      }
    });

    const lonInput = document.createElement("input");
    lonInput.type = "number";
    lonInput.step = "any";
    lonInput.placeholder = "Lon";
    lonInput.value = Number.isFinite(Number(coords[0])) ? String(Number(coords[0]).toFixed(6)) : "";
    lonInput.addEventListener("input", () => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        feature.geometry = { type: "Point", coordinates: [lon, lat] };
      }
    });

    fields.append(nameInput, latInput, lonInput);

    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Move up";
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      const arr = state.currentRouteStops;
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      renderStopsOrderList();
    });

    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Move down";
    down.disabled = index === stops.length - 1;
    down.addEventListener("click", () => {
      const arr = state.currentRouteStops;
      [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
      renderStopsOrderList();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stop-order-remove";
    remove.textContent = "×";
    remove.title = "Remove stop";
    remove.addEventListener("click", () => {
      state.currentRouteStops.splice(index, 1);
      renderStopsOrderList();
    });

    row.append(pos, fields, up, down, remove);

    if ((state.selectedBranchGroups || []).length) {
      const branchRow = document.createElement("div");
      branchRow.className = "stop-branch-row";
      const branchSelect = document.createElement("select");
      branchSelect.className = "stop-branch-select";
      branchSelect.title = "Which branch option this stop belongs to";
      const trunkOption = document.createElement("option");
      trunkOption.value = "";
      trunkOption.textContent = "Trunk (always shown)";
      branchSelect.append(trunkOption);
      for (const choice of branchOptionChoices()) {
        const optionEl = document.createElement("option");
        optionEl.value = String(choice.option.id);
        optionEl.textContent = `${choice.group.label || "Branch"}: ${choice.option.label || choice.option.id}`;
        branchSelect.append(optionEl);
      }
      branchSelect.value = String(p.branch || "");
      branchSelect.addEventListener("change", () => {
        p.branch = branchSelect.value;
      });
      branchRow.append(branchSelect);
      row.append(branchRow);
    }

    els.routeStopsList.append(row);
  });
}

function addCustomStop() {
  if (!state.selectedLineKey) {
    return;
  }
  const name = String(els.newStopName?.value || "").trim();
  const lat = Number(els.newStopLat?.value);
  const lon = Number(els.newStopLon?.value);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    setEditStatus(els.routeEditStatus, "A stop name and numeric lat/lon are required.", true);
    return;
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "stop";
  const key = `custom:${slug}:${Date.now().toString(36)}`;
  const feature = adminCustomStopFeature({ key, name, lat, lon }, state.selectedLineKey);
  if (!feature) {
    return;
  }
  state.currentRouteStops.push(feature);
  renderStopsOrderList();
  appendStopsToMapSource([feature]);
  if (els.newStopName) els.newStopName.value = "";
  if (els.newStopLat) els.newStopLat.value = "";
  if (els.newStopLon) els.newStopLon.value = "";
  setEditStatus(els.routeEditStatus, `Added "${name}" to the working order. Save Stop Order to persist.`);
}

async function saveStopOrder() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  const stops = (state.currentRouteStops || [])
    .map((feature) => {
      const p = feature.properties || {};
      const coords = feature.geometry?.coordinates || [];
      const entry = {
        key: String(p.station_key || ""),
        name: String(p.station_name || p.stop_name || p.station_key || ""),
        lat: Number.isFinite(Number(coords[1])) ? Number(coords[1]) : null,
        lon: Number.isFinite(Number(coords[0])) ? Number(coords[0]) : null
      };
      const branch = String(p.branch || "").trim();
      if (branch) {
        entry.branch = branch;
      }
      return entry;
    })
    .filter((entry) => entry.key);

  let payload = {};
  try {
    const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET" });
    payload = (existing?.override?.payload || {});
  } catch {
    // new override
  }
  payload = { ...payload, stops };
  const branchGroups = (state.selectedBranchGroups || []).filter(
    (group) => (group.options || []).length > 0
  );
  if (branchGroups.length) {
    payload.branchGroups = branchGroups;
  } else {
    delete payload.branchGroups;
  }

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    setEditStatus(els.routeEditStatus, `Stop order saved (${stops.length} stops).`);
    recordManualEdit(
      "route",
      `${lineKey} · stop order`,
      `${stops.length} stops${branchGroups.length ? `, ${branchGroups.length} branch group(s)` : ""}`
    );
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function clearStopOrder() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  let payload = {};
  try {
    const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET" });
    payload = (existing?.override?.payload || {});
  } catch {
    // new override
  }
  delete payload.stops;

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    setEditStatus(els.routeEditStatus, "Custom stop order cleared.");
    recordManualEdit("route", `${lineKey} · stop order`, "cleared custom order");
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function selectRouteFromFeature(feature) {
  const props = featureLineProps(feature);
  closeRouteOverlapPopup();
  state.selectedRouteFeature = feature;
  state.selectedLineKey = props.lineKey;
  state.selectedStationKey = "";
  state.selectedRouteOverride = null;
  state.selectedRouteReview = null;

  els.stationEditPanel.hidden = true;
  els.routeEditPanel.hidden = false;
  els.routeIdentity.textContent = `${props.lineKey}${props.lineName ? " · " + props.lineName : ""}`;
  if (els.routeEditColorDot) {
    els.routeEditColorDot.style.background = props.color || "#177ca2";
  }
  if (els.routeEditMeta) {
    els.routeEditMeta.textContent = `${props.lineName || "Unnamed route"}${props.operatorName ? " · " + props.operatorName : ""}`;
  }

  els.routeName.value = props.lineName;
  els.routeShortName.value = props.lineShortName;
  els.routeLongName.value = props.lineLongName;
  els.routeOperator.value = props.operatorName;
  els.routeMode.value = props.routeType !== null ? String(props.routeType) : "";
  els.routeColor.value = props.color;
  els.routeOrdering.value = "";
  if (els.routeFrequency) els.routeFrequency.value = "";
  state.selectedBranchGroups = [];
  renderBranchGroupsEditor();
  els.routeProblematic.checked = false;
  state.problematicTouched = false;
  if (els.newStopName) els.newStopName.value = "";
  if (els.newStopLat) els.newStopLat.value = "";
  if (els.newStopLon) els.newStopLon.value = "";
  setEditStatus(els.routeEditStatus, "Loaded from tile properties.");
  if (els.routeDataStatus) {
    setEditStatus(els.routeDataStatus, "");
  }
  if (els.refreshRouteBtn) {
    els.refreshRouteBtn.disabled = false;
  }
  if (els.removeRouteBtn) {
    els.removeRouteBtn.disabled = false;
  }

  try {
    const [overridePayload, reviewsPayload, headwayPayload] = await Promise.all([
      apiRequest(`/api/admin/overrides/route/${encodeURIComponent(state.selectedLineKey)}`, { method: "GET" }),
      state.currentCitySlug
        ? apiRequest(`/api/admin/reviews/route?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" })
        : Promise.resolve({ reviews: [] }),
      apiRequest(`/api/transit/route-headway/bulk?${new URLSearchParams({ lineKeys: state.selectedLineKey })}`, { method: "GET" })
        .catch(() => ({ headwayByLineKey: {} }))
    ]);

    if (overridePayload?.override) {
      state.selectedRouteOverride = overridePayload.override;
      const payload = overridePayload.override.payload || {};
      if (payload.lineName) els.routeName.value = payload.lineName;
      if (payload.lineShortName !== undefined) els.routeShortName.value = payload.lineShortName;
      if (payload.lineLongName !== undefined) els.routeLongName.value = payload.lineLongName;
      if (payload.operatorName) els.routeOperator.value = payload.operatorName;
      if (payload.mode !== undefined && payload.mode !== null && payload.mode !== "") els.routeMode.value = String(payload.mode);
      if (payload.color) els.routeColor.value = payload.color;
      if (payload.orderingMode) els.routeOrdering.value = payload.orderingMode;
      if (payload.frequencyBucket && els.routeFrequency) {
        els.routeFrequency.value = String(payload.frequencyBucket);
      }
      state.selectedBranchGroups = Array.isArray(payload.branchGroups)
        ? JSON.parse(JSON.stringify(payload.branchGroups))
        : [];
      renderBranchGroupsEditor();
      setEditStatus(els.routeEditStatus, "Loaded existing override + tile properties.");
    }

    // Problematic = manual override, else auto-detect.
    const review = (reviewsPayload.reviews || []).find((r) => r.line_key === state.selectedLineKey);
    const manualOverride = review ? review.problematic_override : undefined;
    const autoProblematic = Boolean(headwayPayload?.headwayByLineKey?.[state.selectedLineKey]?.problematicGeometry);
    const effectiveProblematic = manualOverride === true || (manualOverride !== false && autoProblematic);
    if (review) {
      state.selectedRouteReview = review;
    }
    els.routeProblematic.checked = Boolean(effectiveProblematic);

    loadStopsForRoute(state.selectedLineKey);
    renderCitySelectedRoute();
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function selectStationFromFeature(feature) {
  const p = feature?.properties || {};
  closeRouteOverlapPopup();
  const stationKey = String(p.station_key || "").trim();
  const lineKey = String(p.line_key || "").trim();
  if (!stationKey) {
    return;
  }

  state.selectedStationKey = stationKey;
  state.selectedLineKey = "";
  els.routeEditPanel.hidden = true;
  els.stationEditPanel.hidden = false;
  els.stationIdentity.textContent = `${stationKey}${lineKey ? " · on " + lineKey : ""}`;

  const coords = feature.geometry?.coordinates || [];
  els.stationName.value = String(p.station_name || "");
  els.stationLat.value = coords[1] !== undefined ? String(Number(coords[1]).toFixed(6)) : "";
  els.stationLon.value = coords[0] !== undefined ? String(Number(coords[0]).toFixed(6)) : "";
  els.stationNote.value = "";
  setEditStatus(els.stationEditStatus, "Loaded from stop properties.");
}

function clearSelection() {
  closeRouteOverlapPopup();
  state.selectedLineKey = "";
  state.selectedStationKey = "";
  if (els.routeEditPanel) {
    els.routeEditPanel.hidden = true;
  }
  if (els.stationEditPanel) {
    els.stationEditPanel.hidden = true;
  }
  renderCitySelectedRoute();
}

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

async function saveRouteEdits() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;

  // Merge so fields this form doesn't own (custom stops) survive.
  let payload = {};
  try {
    const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET" });
    payload = existing?.override?.payload || {};
  } catch {
    payload = {};
  }

  const name = String(els.routeName.value || "").trim();
  const short = String(els.routeShortName.value || "").trim();
  const long = String(els.routeLongName.value || "").trim();
  const operator = String(els.routeOperator.value || "").trim();
  const modeRaw = String(els.routeMode.value || "").trim();
  const color = String(els.routeColor.value || "").trim();
  const ordering = String(els.routeOrdering.value || "").trim();
  const frequency = String(els.routeFrequency?.value || "").trim();

  if (name) payload.lineName = name;
  else delete payload.lineName;
  if (short) payload.lineShortName = short;
  else delete payload.lineShortName;
  if (long) payload.lineLongName = long;
  else delete payload.lineLongName;
  if (operator) payload.operatorName = operator;
  else delete payload.operatorName;
  if (modeRaw) payload.mode = Number(modeRaw);
  else delete payload.mode;
  if (color) payload.color = color;
  else delete payload.color;
  if (ordering) payload.orderingMode = ordering;
  else delete payload.orderingMode;
  if (frequency === "__default__") {
    delete payload.frequencyBucket;
  } else if (frequency) {
    payload.frequencyBucket = frequency;
  }

  try {
    // Emptied payload deletes the override instead of leaving an empty row.
    const result =
      Object.keys(payload).length === 0
        ? await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "DELETE" }).then(() => ({ override: null }))
        : await apiRequest("/api/admin/overrides/route", {
            method: "POST",
            body: { lineKey, citySlug: state.currentCitySlug, payload }
          });

    // Persist only when the admin actually changed the toggle.
    const problematicTouched = Boolean(state.problematicTouched);
    const problematicOverride = problematicTouched ? Boolean(els.routeProblematic.checked) : null;
    await apiRequest("/api/admin/reviews/route", {
      method: "POST",
      body: {
        lineKey,
        citySlug: state.currentCitySlug,
        problematicOverride
      }
    });

    setEditStatus(els.routeEditStatus, "Route edits saved.");
    const problematicActive = Boolean(els.routeProblematic?.checked);
    recordManualEdit(
      "route",
      `${lineKey}${name ? " · " + name : ""}`,
      [
        color ? `color ${color}` : "",
        ordering ? `ordering ${ordering}` : "",
        frequency === "__default__" ? "frequency cleared" : frequency ? `frequency ${frequency}` : "",
        modeRaw ? `mode ${MODE_LABELS[Number(modeRaw)] || modeRaw}` : "",
        problematicActive ? "disabled-by-default" : ""
      ]
        .filter(Boolean)
        .join(", ")
    );
    if (result.override) {
      addRouteHighlight(lineKey, result.override.payload || payload);
    } else {
      loadExistingEdits();
    }
    await loadOperatorsForViewport();
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function saveStationEdits() {
  if (!state.selectedStationKey) {
    return;
  }
  const stationKey = state.selectedStationKey;
  const body = {
    stationKey,
    manualName: String(els.stationName.value || "").trim(),
    note: String(els.stationNote.value || "").trim()
  };
  const lat = Number(els.stationLat.value);
  const lon = Number(els.stationLon.value);
  if (Number.isFinite(lat)) body.manualLat = lat;
  if (Number.isFinite(lon)) body.manualLon = lon;

  try {
    await apiRequest("/api/admin/overrides/station", {
      method: "POST",
      body
    });
    setEditStatus(els.stationEditStatus, "Station edits saved.");
    recordManualEdit(
      "station",
      stationKey,
      [body.manualName ? `name "${body.manualName}"` : "", Number.isFinite(lat) ? `lat ${lat}` : "", Number.isFinite(lon) ? `lon ${lon}` : "", body.note ? `note ${body.note}` : ""].filter(Boolean).join(", ")
    );
    addStationHighlight(stationKey, body.manualName, Number.isFinite(lon) ? lon : null, Number.isFinite(lat) ? lat : null);
  } catch (error) {
    setEditStatus(els.stationEditStatus, error.message, true);
  }
}

async function deleteRouteOverride() {
  const lineKey = state.selectedLineKey;
  if (!lineKey) {
    return;
  }
  if (!window.confirm(`Delete the override for ${lineKey}? The route returns to harvested values.`)) {
    return;
  }
  if (els.deleteRouteOverrideBtn) {
    els.deleteRouteOverrideBtn.disabled = true;
  }
  try {
    await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "DELETE" });
    recordManualEdit("route", `${lineKey} override`, "deleted");
    loadExistingEdits();
    if (state.selectedRouteFeature) {
      await selectRouteFromFeature(state.selectedRouteFeature);
    }
    setEditStatus(els.routeEditStatus, "Override deleted; showing harvested values.");
  } catch (error) {
    setEditStatus(els.routeEditStatus, `Failed to delete override: ${error.message}`, true);
  } finally {
    if (els.deleteRouteOverrideBtn) {
      els.deleteRouteOverrideBtn.disabled = false;
    }
  }
}

function addRouteHighlight(lineKey, payload) {
  const source = state.map.getSource("routes-edited");
  if (!source) {
    return;
  }
  const features = source._data?.features || [];
  const color = String(payload?.color || "").trim();
  const existing = features.find((f) => f.properties?.line_key === lineKey);
  const feature = existing || {
    type: "Feature",
    id: lineKey,
    properties: { line_key: lineKey },
    geometry: null
  };
  if (color) {
    feature.properties.color = color;
  }
  if (!existing && state.map) {
    const q = state.map.queryRenderedFeatures({ layers: ["routes-main"] }).find((f) => String(f.properties?.line_key || "") === lineKey);
    if (q) {
      feature.geometry = q.geometry;
    }
  }
  if (!existing) {
    features.push(feature);
  }
  source.setData({ type: "FeatureCollection", features });
}

function addStationHighlight(stationKey, name, lon, lat) {
  const source = state.map.getSource("stops-edited");
  if (!source) {
    return;
  }
  const features = source._data?.features || [];
  const existing = features.find((f) => f.properties?.station_key === stationKey);
  if (existing) {
    existing.properties.station_name = name || existing.properties.station_name;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      existing.geometry.coordinates = [lon, lat];
    }
  } else {
    features.push({
      type: "Feature",
      id: stationKey,
      geometry: Number.isFinite(lon) && Number.isFinite(lat) ? { type: "Point", coordinates: [lon, lat] } : null,
      properties: { station_key: stationKey, station_name: name || stationKey }
    });
  }
  source.setData({ type: "FeatureCollection", features });
}

// ---------------------------------------------------------------------------
// Operators (batch hide by default)
// ---------------------------------------------------------------------------

// Show hidden operators and disabled routes on the map.
function applyMapRouteVisibility({ hiddenOperators, disabledLineKeys } = {}) {
  if (!state.map || !state.mapReady) {
    return;
  }
  const operators = Array.from(hiddenOperators || []).filter(Boolean);
  const lineKeys = Array.from(disabledLineKeys || []).filter(Boolean);
  state.hiddenOperators = new Set(operators);
  state.disabledRouteKeys = new Set(lineKeys);

  const conditions = [];
  if (operators.length) {
    conditions.push(["!", ["in", ["get", "operator_name"], ["literal", operators]]]);
  }
  if (lineKeys.length) {
    conditions.push(["!", ["in", ["get", "line_key"], ["literal", lineKeys]]]);
  }
  const filter = conditions.length === 0 ? null : conditions.length === 1 ? conditions[0] : ["all", ...conditions];

  for (const id of ["routes-main", "routes-hit", "routes-underlay"]) {
    if (state.map.getLayer(id)) {
      state.map.setFilter(id, filter);
    }
  }
}

async function loadOperatorsForViewport() {
  const features = state.map && state.mapReady
    ? state.map.queryRenderedFeatures({ layers: ["routes-main"] })
    : [];
  const operatorNames = new Set();
  for (const feature of features) {
    const name = String(feature.properties?.operator_name || "").trim();
    if (name) {
      operatorNames.add(name);
    }
  }

  let reviews = [];
  let disabledRouteKeys = new Set();
  try {
    if (state.currentCitySlug) {
      const [agencyPayload, routePayload] = await Promise.all([
        apiRequest(`/api/admin/reviews/agencies?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" }),
        apiRequest(`/api/admin/reviews/route?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" })
      ]);
      reviews = Array.isArray(agencyPayload.reviews) ? agencyPayload.reviews : [];
      disabledRouteKeys = new Set(
        (Array.isArray(routePayload.reviews) ? routePayload.reviews : [])
          .filter((review) => review.problematic_override === true)
          .map((review) => String(review.line_key || "").trim())
          .filter(Boolean)
      );
    }
  } catch {
    reviews = [];
  }
  const reviewByOperator = new Map(reviews.map((r) => [r.operator_name, r]));

  const hiddenOperators = new Set(
    reviews
      .filter((r) => r.allowed_override === false)
      .map((r) => String(r.operator_name || "").trim())
      .filter(Boolean)
  );
  applyMapRouteVisibility({ hiddenOperators, disabledLineKeys: disabledRouteKeys });

  els.operatorList.innerHTML = "";
  const names = Array.from(operatorNames).sort();
  if (!names.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No operators in the current viewport (zoom in).";
    els.operatorList.append(p);
    return;
  }

  for (const name of names) {
    const review = reviewByOperator.get(name);
    const hidden = review?.allowed_override === false;

    const row = document.createElement("div");
    row.className = "operator-row";

    const label = document.createElement("span");
    label.textContent = name;
    label.title = hidden ? "Currently hidden by default" : "Currently shown by default";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn " + (hidden ? "btn-danger" : "btn-subtle");
    toggle.textContent = hidden ? "Show by default" : "Hide by default";
    toggle.title = hidden ? "Currently hidden — click to show" : "Currently shown — click to hide";
    toggle.addEventListener("click", async () => {
      const nextHidden = !hidden;
      toggle.disabled = true;
      try {
        await apiRequest("/api/admin/reviews/agencies", {
          method: "POST",
          body: {
            citySlug: state.currentCitySlug,
            operatorName: name,
            allowedOverride: nextHidden ? false : null
          }
        });
        recordManualEdit(
          "agency",
          name,
          nextHidden ? "Hidden by default (users can re-enable)" : "Un-hidden (default shown)"
        );
        await loadOperatorsForViewport();
      } catch (error) {
        setEditStatus(els.routeEditStatus || els.stationEditStatus, error.message, true);
      } finally {
        toggle.disabled = false;
      }
    });

    row.append(label, toggle);
    els.operatorList.append(row);
  }
}

// ---------------------------------------------------------------------------
// Manual edits log (load existing)
// ---------------------------------------------------------------------------

async function loadExistingEdits() {
  state.manualEdits = [];
  try {
    const [routeOverrides, routeReviews, agencyReviews, stationOverrides] = await Promise.all([
      apiRequest("/api/admin/overrides/route", { method: "GET" }),
      state.currentCitySlug ? apiRequest(`/api/admin/reviews/route?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" }) : Promise.resolve({ reviews: [] }),
      state.currentCitySlug ? apiRequest(`/api/admin/reviews/agencies?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" }) : Promise.resolve({ reviews: [] }),
      apiRequest("/api/admin/overrides/station", { method: "GET" })
    ]);

    for (const o of routeOverrides.overrides || []) {
      state.manualEdits.push({
        at: o.updated_at ? new Date(o.updated_at).toISOString() : new Date(0).toISOString(),
        kind: "route",
        label: o.line_key,
        detail: Object.keys(o.payload || {}).join(", ")
      });
    }
    for (const r of routeReviews.reviews || []) {
      if (r.problematic_override !== null) {
        state.manualEdits.push({
          at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date(0).toISOString(),
          kind: "route",
          label: r.line_key,
          detail: r.problematic_override ? "disabled by default" : "enabled by default"
        });
      }
    }
    for (const a of agencyReviews.reviews || []) {
      if (a.allowed_override !== null) {
        state.manualEdits.push({
          at: a.updated_at ? new Date(a.updated_at).toISOString() : new Date(0).toISOString(),
          kind: "agency",
          label: a.operator_name,
          detail: a.allowed_override === false ? "hidden by default" : "shown by default"
        });
      }
    }
    for (const s of stationOverrides.overrides || []) {
      state.manualEdits.push({
        at: s.updatedAt ? new Date(s.updatedAt * 1000).toISOString() : new Date(0).toISOString(),
        kind: "station",
        label: s.stableKey,
        detail: s.manualName || "coordinate override"
      });
    }
  } catch (error) {
    state.manualEdits.push({ at: new Date().toISOString(), kind: "system", label: "Failed to load existing edits", detail: error.message });
  }
  state.manualEdits.sort((a, b) => new Date(b.at) - new Date(a.at));
  renderManualEditsLog();
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

function visibleRouteFeaturesByMode(modeRaw) {
  const features = state.map && state.mapReady
    ? state.map.queryRenderedFeatures({ layers: ["routes-main"] })
    : [];
  const mode = modeRaw === "" ? null : Number(modeRaw);
  const byLineKey = new Map();
  for (const feature of features) {
    const lineKey = String(feature.properties?.line_key || "").trim();
    if (!lineKey || byLineKey.has(lineKey)) {
      continue;
    }
    if (mode !== null && Number(feature.properties?.route_type) !== mode) {
      continue;
    }
    byLineKey.set(lineKey, feature);
  }
  return Array.from(byLineKey.values());
}

async function batchByMode(hide) {
  const modeRaw = String(els.batchModeSelect.value || "").trim();
  const features = visibleRouteFeaturesByMode(modeRaw);
  if (!features.length) {
    setEditStatus(els.batchStatus, "No matching routes in the viewport.", true);
    return;
  }
  const lineKeys = features.map((f) => String(f.properties?.line_key || "").trim());
  els.batchHideBtn.disabled = true;
  els.batchShowBtn.disabled = true;
  let ok = 0;
  let failed = 0;
  try {
    for (const lineKey of lineKeys) {
      try {
        await apiRequest("/api/admin/reviews/route", {
          method: "POST",
          body: {
            lineKey,
            citySlug: state.currentCitySlug,
            problematicOverride: hide ? true : null
          }
        });
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setEditStatus(els.batchStatus, `${ok} routes ${hide ? "hidden" : "shown"} by default${failed ? `, ${failed} failed` : ""}.`);
    recordManualEdit(
      "batch",
      `${hide ? "Hide" : "Show"} by mode ${modeRaw || "all"}`,
      `${ok} route(s) ${hide ? "disabled by default" : "enabled by default"}`
    );
    await loadOperatorsForViewport();
  } finally {
    els.batchHideBtn.disabled = false;
    els.batchShowBtn.disabled = false;
  }
}

async function batchAllOperators(hide) {
  const features = state.map && state.mapReady
    ? state.map.queryRenderedFeatures({ layers: ["routes-main"] })
    : [];
  const operators = new Set();
  for (const feature of features) {
    const name = String(feature.properties?.operator_name || "").trim();
    if (name) {
      operators.add(name);
    }
  }
  const names = Array.from(operators);
  if (!names.length) {
    return;
  }
  els.hideAllOperatorsBtn.disabled = true;
  els.showAllOperatorsBtn.disabled = true;
  let ok = 0;
  try {
    for (const name of names) {
      try {
        await apiRequest("/api/admin/reviews/agencies", {
          method: "POST",
          body: {
            citySlug: state.currentCitySlug,
            operatorName: name,
            allowedOverride: hide ? false : null
          }
        });
        ok += 1;
      } catch {
        // per-operator failure tolerated
      }
    }
    recordManualEdit("batch", `${hide ? "Hide" : "Show"} all operators`, `${ok} operator(s) updated`);
    await loadOperatorsForViewport();
  } finally {
    els.hideAllOperatorsBtn.disabled = false;
    els.showAllOperatorsBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Auth + boot
// ---------------------------------------------------------------------------

function bindEvents() {
  async function submitAdminLogin() {
    const email = String(els.adminEmailInput.value || "").trim();
    const password = String(els.adminPasswordInput.value || "");
    if (!email || !password) {
      els.loginStatusMessage.textContent = "Email and password are required.";
      return;
    }
    els.loginStatusMessage.textContent = "Signing in...";
    try {
      const result = await apiRequest("/api/admin/login", {
        method: "POST",
        body: { email, password }
      });
      setAdminSession(result.token);
      setAdminLocked(false);
      els.loginStatusMessage.textContent = "Logged in.";
      await bootApp();
    } catch (error) {
      clearAdminSession();
      els.loginStatusMessage.textContent = error.message;
    }
  }

  if (els.adminLoginForm) {
    els.adminLoginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAdminLogin();
    });
  } else if (els.loginBtn) {
    els.loginBtn.addEventListener("click", () => submitAdminLogin());
  }

  els.logoutBtn.addEventListener("click", () => {
    apiRequest("/api/admin/logout", { method: "POST" }).catch(() => {});
    clearAdminSession();
    setAdminLocked(true);
  });

  els.refreshMapBtn.addEventListener("click", () => {
    if (state.mapReady) {
      updateUnderlay();
      loadOperatorsForViewport();
      loadExistingEdits();
    }
  });

  if (els.areaRefreshBtn) {
    els.areaRefreshBtn.addEventListener("click", () => {
      if (state.areaRefreshOpen) {
        closeAreaRefresh();
      } else {
        openAreaRefresh();
      }
    });
  }
  if (els.areaRefreshCloseBtn) {
    els.areaRefreshCloseBtn.addEventListener("click", closeAreaRefresh);
  }
  if (els.areaRefreshRunBtn) {
    els.areaRefreshRunBtn.addEventListener("click", () => {
      runAreaRefresh().catch((error) => {
        setEditStatus(els.areaRefreshStatus, `Failed: ${error.message}`, true);
      });
    });
  }

  if (els.routeSearchInput) {
    els.routeSearchInput.addEventListener("input", () => {
      state.routeSearchQuery = String(els.routeSearchInput.value || "").trim();
      applyUnderlaySearchFilter();
    });
  }
  if (els.routeModeFilterSelect) {
    els.routeModeFilterSelect.addEventListener("change", () => {
      state.routeModeFilter = String(els.routeModeFilterSelect.value || "").trim();
      applyUnderlaySearchFilter();
    });
  }

  if (els.refreshSelectedRoutesBtn) {
    els.refreshSelectedRoutesBtn.addEventListener("click", () => {
      refreshSelectedRoutes().catch((error) => {
        setEditStatus(els.routeBatchStatus, `Failed: ${error.message}`, true);
      });
    });
  }
  if (els.transitlandSearchBtn) {
    els.transitlandSearchBtn.addEventListener("click", () => {
      searchTransitland().catch(() => {});
    });
  }
  if (els.transitlandSearchInput) {
    els.transitlandSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchTransitland().catch(() => {});
      }
    });
  }

  if (els.cityPanelSelect) {
    els.cityPanelSelect.addEventListener("change", () => {
      selectCityForPanel(els.cityPanelSelect.value).catch(() => {});
    });
  }
  if (els.newCityCreateBtn) {
    els.newCityCreateBtn.addEventListener("click", () => {
      createCityFromView().catch(() => {});
    });
  }
  if (els.cityOperatorSearchBtn) {
    els.cityOperatorSearchBtn.addEventListener("click", () => {
      searchCityOperators().catch(() => {});
    });
  }
  if (els.cityOperatorSearchInput) {
    els.cityOperatorSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchCityOperators().catch(() => {});
      }
    });
  }
  if (els.cityAddSelectedRouteBtn) {
    els.cityAddSelectedRouteBtn.addEventListener("click", includeSelectedRouteInCity);
  }
  if (els.cityExcludeSelectedRouteBtn) {
    els.cityExcludeSelectedRouteBtn.addEventListener("click", excludeSelectedRouteInCity);
  }
  if (els.refreshRouteBtn) {
    els.refreshRouteBtn.addEventListener("click", () => {
      refreshSingleRoute().catch(() => {});
    });
  }
  if (els.removeRouteBtn) {
    els.removeRouteBtn.addEventListener("click", () => {
      removeSingleRoute().catch(() => {});
    });
  }

  els.saveRouteBtn.addEventListener("click", saveRouteEdits);
  if (els.routeProblematic) {
    els.routeProblematic.addEventListener("change", () => {
      state.problematicTouched = true;
    });
  }
  els.discardRouteBtn.addEventListener("click", () => {
    closeRouteOverlapPopup();
    clearSelection();
  });
  els.saveStationBtn.addEventListener("click", saveStationEdits);
  els.discardStationBtn.addEventListener("click", () => {
    els.stationEditPanel.hidden = true;
    state.selectedStationKey = "";
  });

  els.saveStopOrderBtn.addEventListener("click", saveStopOrder);
  els.clearStopOrderBtn.addEventListener("click", clearStopOrder);
  if (els.addStopBtn) {
    els.addStopBtn.addEventListener("click", addCustomStop);
  }
  if (els.addBranchGroupBtn) {
    els.addBranchGroupBtn.addEventListener("click", addBranchGroup);
  }
  if (els.resetRouteBtn) {
    els.resetRouteBtn.addEventListener("click", () => {
      if (state.selectedRouteFeature) {
        selectRouteFromFeature(state.selectedRouteFeature).catch(() => {});
      }
    });
  }
  if (els.deleteRouteOverrideBtn) {
    els.deleteRouteOverrideBtn.addEventListener("click", () => {
      deleteRouteOverride().catch(() => {});
    });
  }

  els.batchHideBtn.addEventListener("click", () => batchByMode(true));
  els.batchShowBtn.addEventListener("click", () => batchByMode(false));
  els.hideAllOperatorsBtn.addEventListener("click", () => batchAllOperators(true));
  els.showAllOperatorsBtn.addEventListener("click", () => batchAllOperators(false));
}

// ---------------------------------------------------------------------------
// City presets panel: operator rules + explicit route rules + per-route vetting
// ---------------------------------------------------------------------------

function describeCurrentView() {
  if (!state.map || !state.mapReady) {
    return null;
  }
  const center = state.map.getCenter();
  const zoom = state.map.getZoom();
  const bounds = state.map.getBounds();
  return {
    center: [Number(center.lng.toFixed(6)), Number(center.lat.toFixed(6))],
    zoom: Number(zoom.toFixed(2)),
    bbox: [
      Number(bounds.getWest().toFixed(6)),
      Number(bounds.getSouth().toFixed(6)),
      Number(bounds.getEast().toFixed(6)),
      Number(bounds.getNorth().toFixed(6))
    ]
  };
}

function updateNewCityView() {
  if (!els.newCityView) {
    return;
  }
  const view = describeCurrentView();
  els.newCityView.textContent = view
    ? `Center ${view.center[0]}, ${view.center[1]} · zoom ${view.zoom} · bbox ${view.bbox.join(", ")}`
    : "Move the map to the city, then create it here.";
}

// City creation captures the current map view.
async function createCityFromView() {
  const slug = String(els.newCitySlug?.value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = String(els.newCityName?.value || "").trim() || slug;
  const country = String(els.newCityCountry?.value || "").trim();
  if (!slug) {
    setEditStatus(els.newCityStatus, "A slug is required.", true);
    return;
  }
  const view = describeCurrentView();
  if (!view) {
    setEditStatus(els.newCityStatus, "Map not ready yet.", true);
    return;
  }
  setEditStatus(els.newCityStatus, "Creating…");
  try {
    await apiRequest("/api/admin/cities", {
      method: "POST",
      body: {
        slug,
        name,
        country,
        center: view.center,
        bbox: view.bbox,
        defaultZoom: view.zoom,
        published: false
      }
    });
    setEditStatus(els.newCityStatus, `Created ${slug}.`);
    if (els.newCitySlug) els.newCitySlug.value = "";
    if (els.newCityName) els.newCityName.value = "";
    if (els.newCityCountry) els.newCityCountry.value = "";
    await loadCityPanelList();
    if (els.cityPanelSelect) {
      els.cityPanelSelect.value = slug;
    }
    await selectCityForPanel(slug);
    recordManualEdit("city", slug, "created from current map view");
  } catch (error) {
    setEditStatus(els.newCityStatus, `Failed: ${error.message}`, true);
  }
}

async function loadCityPanelList() {
  if (!els.cityPanelSelect) {
    return;
  }
  try {
    const payload = await apiRequest("/api/admin/cities", { method: "GET" });
    state.cityPanelList = Array.isArray(payload?.cities) ? payload.cities : [];
    const current = els.cityPanelSelect.value;
    els.cityPanelSelect.innerHTML = '<option value="">Select a city…</option>';
    for (const city of state.cityPanelList) {
      const option = document.createElement("option");
      option.value = city.slug;
      option.textContent = `${city.name || city.slug}${city.published ? "" : " (draft)"}`;
      els.cityPanelSelect.append(option);
    }
    if (current && state.cityPanelList.some((city) => city.slug === current)) {
      els.cityPanelSelect.value = current;
      await selectCityForPanel(current);
    }
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed to load cities: ${error.message}`, true);
  }
}

async function selectCityForPanel(slug) {
  const key = String(slug || "").trim();
  if (!key) {
    state.cityPanelCity = null;
    if (els.cityPanelBody) {
      els.cityPanelBody.hidden = true;
    }
    return;
  }
  setEditStatus(els.cityPanelStatus, "Loading city…");
  try {
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(key)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || null;
    if (els.cityPanelBody) {
      els.cityPanelBody.hidden = !state.cityPanelCity;
    }
    renderCityPanel();
    setEditStatus(els.cityPanelStatus, "");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed to load city: ${error.message}`, true);
  }
}

function cityRouteDisplayName(lineKey) {
  const feature = (state.underlayFeatures || []).find(
    (entry) => String(featureLineProps(entry).lineKey) === lineKey
  );
  if (feature) {
    return adminLineDisplayName(featureLineProps(feature)) || lineKey;
  }
  return lineKey;
}

function renderCityPanel() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  if (els.cityPanelSummary) {
    const explicit = city.routes || [];
    const fullyVetted = explicit.filter(
      (route) => route.included && route.vettedAccuracy && route.vettedUpToDate && route.vettedStopOrder
    ).length;
    const includedExplicit = explicit.filter((route) => route.included).length;
    const unvetted = includedExplicit - fullyVetted;
    els.cityPanelSummary.textContent =
      `${city.name || city.slug} · ${city.published ? "Published" : "Draft"} · ` +
      `${city.routeCount || 0} route(s) resolved · ${(city.operators || []).length} operator rule(s) · ` +
      `${includedExplicit} explicit · ${unvetted > 0 ? `${unvetted} need vetting` : "all vetted"}`;
  }
  renderCityOperators();
  renderCityRoutes();
  renderCitySelectedRoute();
}

function renderCitySelectedRoute() {
  const container = els.citySelectedRoute;
  if (!container) {
    return;
  }
  const city = state.cityPanelCity;
  const lineKey = String(state.selectedLineKey || "").trim();
  if (!city || !lineKey) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const explicit = (city.routes || []).find((route) => route.lineKey === lineKey) || null;
  const resolved = (city.routeKeys || []).includes(lineKey);

  container.hidden = false;
  container.innerHTML = "";

  const main = document.createElement("div");
  main.className = "city-member-main";
  const name = document.createElement("span");
  name.className = "city-member-name";
  name.textContent = cityRouteDisplayName(lineKey);
  const meta = document.createElement("span");
  meta.className = "city-member-meta";
  const sourceLabel = explicit
    ? explicit.included
      ? "Explicitly included"
      : "Excluded from this city"
    : resolved
      ? "Included via operator rule"
      : "Not part of this city";
  meta.textContent = `${lineKey} · ${sourceLabel}`;
  main.append(name, meta);

  const actions = document.createElement("div");
  actions.className = "city-vet-row";

  if (resolved) {
    const flags = [
      ["vettedAccuracy", "Accuracy"],
      ["vettedUpToDate", "Up to date"],
      ["vettedStopOrder", "Stop order"]
    ];
    for (const [flag, label] of flags) {
      const labelEl = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(explicit?.[flag]);
      checkbox.title = `Mark ${label.toLowerCase()} as vetted for this city`;
      checkbox.addEventListener("change", () => {
        patchCityRoutes([
          {
            lineKey,
            included: true,
            vettedAccuracy: flag === "vettedAccuracy" ? checkbox.checked : Boolean(explicit?.vettedAccuracy),
            vettedUpToDate: flag === "vettedUpToDate" ? checkbox.checked : Boolean(explicit?.vettedUpToDate),
            vettedStopOrder: flag === "vettedStopOrder" ? checkbox.checked : Boolean(explicit?.vettedStopOrder)
          }
        ]);
      });
      labelEl.append(checkbox, document.createTextNode(label));
      actions.append(labelEl);
    }
  }

  container.append(main, actions);
}

function renderCityOperators() {
  const container = els.cityOperatorsList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const operators = state.cityPanelCity?.operators || [];
  if (!operators.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No operator rules yet. Search below to add one.";
    container.append(p);
    return;
  }
  operators.forEach((operator) => {
    const row = document.createElement("div");
    row.className = "city-member-row" + (operator.included ? "" : " is-excluded");

    const main = document.createElement("div");
    main.className = "city-member-main";
    const name = document.createElement("span");
    name.className = "city-member-name";
    name.textContent = operator.operatorName;
    const meta = document.createElement("span");
    meta.className = "city-member-meta";
    meta.textContent = operator.included ? "All current routes included" : "Excluded";
    main.append(name, meta);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-subtle";
    toggle.textContent = operator.included ? "Exclude" : "Include";
    toggle.addEventListener("click", () =>
      patchCityOperators([{ operatorName: operator.operatorName, included: !operator.included }])
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stop-order-remove";
    remove.textContent = "×";
    remove.title = "Remove operator rule";
    remove.addEventListener("click", () => {
      const remaining = operators
        .filter((entry) => entry.operatorName !== operator.operatorName)
        .map((entry) => ({ operatorName: entry.operatorName, included: entry.included }));
      setCityOperators(remaining);
    });

    row.append(main, toggle, remove);
    container.append(row);
  });
}

function renderCityRoutes() {
  const container = els.cityRoutesList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const routes = state.cityPanelCity?.routes || [];
  if (!routes.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No explicit route rules. Use “Include selected” to add a single route.";
    container.append(p);
    return;
  }
  const sorted = [...routes].sort((a, b) => {
    if (a.included !== b.included) return a.included ? -1 : 1;
    return a.lineKey.localeCompare(b.lineKey);
  });

  sorted.forEach((route) => {
    const row = document.createElement("div");
    row.className = "city-member-row" + (route.included ? "" : " is-excluded");

    const main = document.createElement("div");
    main.className = "city-member-main";
    const name = document.createElement("span");
    name.className = "city-member-name";
    name.textContent = cityRouteDisplayName(route.lineKey);
    const meta = document.createElement("span");
    meta.className = "city-member-meta";
    meta.textContent = `${route.lineKey} · ${route.included ? "Included" : "Excluded"}`;
    main.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "city-vet-row";

    if (route.included) {
      const flags = [
        ["vettedAccuracy", "Accuracy"],
        ["vettedUpToDate", "Up to date"],
        ["vettedStopOrder", "Stop order"]
      ];
      for (const [flag, label] of flags) {
        const labelEl = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(route[flag]);
        checkbox.title = `Mark ${label.toLowerCase()} as vetted`;
        checkbox.addEventListener("change", () => {
          patchCityRoutes([
            {
              lineKey: route.lineKey,
              included: true,
              vettedAccuracy: flag === "vettedAccuracy" ? checkbox.checked : route.vettedAccuracy,
              vettedUpToDate: flag === "vettedUpToDate" ? checkbox.checked : route.vettedUpToDate,
              vettedStopOrder: flag === "vettedStopOrder" ? checkbox.checked : route.vettedStopOrder
            }
          ]);
        });
        labelEl.append(checkbox, document.createTextNode(label));
        actions.append(labelEl);
      }
    }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-subtle";
    toggle.textContent = route.included ? "Exclude" : "Include";
    toggle.addEventListener("click", () =>
      patchCityRoutes([{ lineKey: route.lineKey, included: !route.included }])
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stop-order-remove";
    remove.textContent = "×";
    remove.title = "Remove route rule";
    remove.addEventListener("click", () => removeCityRoute(route.lineKey));

    actions.append(toggle, remove);
    row.append(main, actions);
    container.append(row);
  });
}

function applyCityResponse(payload) {
  if (payload?.city) {
    state.cityPanelCity = payload.city;
    renderCityPanel();
  }
}

async function patchCityRoutes(routes) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/routes`,
      { method: "PATCH", body: { routes } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, "Route rules updated.");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function removeCityRoute(lineKey) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/routes/remove`,
      { method: "POST", body: { lineKeys: [lineKey] } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, `Removed ${lineKey}.`);
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function patchCityOperators(operators) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/operators`,
      { method: "PATCH", body: { operators } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, "Operator rules updated.");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function setCityOperators(operators) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/operators`,
      { method: "POST", body: { operators, replace: true } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, "Operator rules updated.");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function searchCityOperators() {
  const query = String(els.cityOperatorSearchInput?.value || "").trim();
  if (!query || !els.cityOperatorResults) {
    return;
  }
  setEditStatus(els.cityPanelStatus, "Searching operators…");
  try {
    const payload = await apiRequest(`/api/admin/operators?q=${encodeURIComponent(query)}`, { method: "GET" });
    const operators = Array.isArray(payload?.operators) ? payload.operators : [];
    els.cityOperatorResults.innerHTML = "";
    if (!operators.length) {
      const p = document.createElement("p");
      p.className = "microcopy";
      p.textContent = "No operators matched.";
      els.cityOperatorResults.append(p);
      return;
    }
    const existing = new Set((state.cityPanelCity?.operators || []).map((entry) => entry.operatorName));
    for (const operator of operators.slice(0, 40)) {
      const row = document.createElement("div");
      row.className = "admin-route-result-row";
      const name = document.createElement("span");
      name.className = "admin-route-select-name";
      name.textContent = operator.operatorName;
      const meta = document.createElement("span");
      meta.className = "admin-route-select-meta";
      meta.textContent = `${operator.routeCount} routes`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn";
      add.textContent = existing.has(operator.operatorName) ? "Added" : "Add";
      add.disabled = existing.has(operator.operatorName);
      add.addEventListener("click", () => {
        add.disabled = true;
        patchCityOperators([{ operatorName: operator.operatorName, included: true }]);
      });
      row.append(name, meta, add);
      els.cityOperatorResults.append(row);
    }
    setEditStatus(els.cityPanelStatus, `${operators.length} operator(s) matched.`);
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Search failed: ${error.message}`, true);
  }
}

function includeSelectedRouteInCity() {
  if (!state.selectedLineKey) {
    setEditStatus(els.cityPanelStatus, "Select a route on the map first.", true);
    return;
  }
  patchCityRoutes([{ lineKey: state.selectedLineKey, included: true }]);
}

function excludeSelectedRouteInCity() {
  if (!state.selectedLineKey) {
    setEditStatus(els.cityPanelStatus, "Select a route on the map first.", true);
    return;
  }
  patchCityRoutes([{ lineKey: state.selectedLineKey, included: false }]);
}

async function bootApp() {
  await loadCities();
  await loadCityPanelList();
  await initMap();
  state.map.once("load", () => {
    setTimeout(() => {
      loadExistingEdits();
      loadOperatorsForViewport();
    }, 1500);
  });
}

async function init() {
  els.adminEmailInput.value = "";
  els.adminPasswordInput.value = "";
  bindEvents();

  // Apply the saved light/dark theme and wire the toggle (basemap swap is
  // handled automatically once the map exists).
  if (typeof initAdminTheme === "function") {
    initAdminTheme(document.getElementById("themeToggleBtn"));
  }

  if (state.token) {
    try {
      await apiRequest("/api/admin/session");
      setAdminLocked(false);
      await bootApp();
      return;
    } catch {
      clearAdminSession();
    }
  }
  setAdminLocked(true);
}

init().catch((error) => {
  els.loginStatusMessage.textContent = error.message;
});
