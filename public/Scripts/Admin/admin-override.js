const SESSION_KEY = "metromark_admin_session_token";

// Shim for the shared line-view ordering modules (they read `appState`), so the
// admin editor can reuse the exact same stop-ordering algorithms.
var appState = window.appState || { lineSummaries: [], transit: null, mapZoom: null };
appState.lineSummaries = appState.lineSummaries || [];
appState.transit = appState.transit || null;
appState.mapZoom = appState.mapZoom || null;

// Helper the shared line-view ordering modules expect from map-helpers.
function stopKeyForFeature(feature) {
  const props = feature?.properties || {};
  return String(props.station_key || props.stop_id || "").trim();
}

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
  routeFrequencyMinutes: document.getElementById("routeFrequencyMinutes"),
  routeProblematic: document.getElementById("routeProblematic"),
  mergeRoutesList: document.getElementById("mergeRoutesList"),
  mergeRouteKeyInput: document.getElementById("mergeRouteKeyInput"),
  addMergeRouteBtn: document.getElementById("addMergeRouteBtn"),
  mergeRouteStatus: document.getElementById("mergeRouteStatus"),
  mergeRouteKeyResults: document.getElementById("mergeRouteKeyResults"),
  findMergeCandidatesBtn: document.getElementById("findMergeCandidatesBtn"),
  mergeCandidatesList: document.getElementById("mergeCandidatesList"),
  mergeCandidatesStatus: document.getElementById("mergeCandidatesStatus"),
  reloadReviewQueueBtn: document.getElementById("reloadReviewQueueBtn"),
  reloadProblematicBtn: document.getElementById("reloadProblematicBtn"),
  problematicPreviewCb: document.getElementById("problematicPreviewCb"),
  problematicSelectedRow: document.getElementById("problematicSelectedRow"),
  problematicList: document.getElementById("problematicList"),
  problematicStatus: document.getElementById("problematicStatus"),
  flagsReviewList: document.getElementById("flagsReviewList"),
  issuesReviewList: document.getElementById("issuesReviewList"),
  suggestionsReviewList: document.getElementById("suggestionsReviewList"),
  reviewQueueStatus: document.getElementById("reviewQueueStatus"),
  reviewQueueBadge: document.getElementById("reviewQueueBadge"),
  routeStopsList: document.getElementById("routeStopsList"),
  stopOrderLockNote: document.getElementById("stopOrderLockNote"),
  stopAddRow: document.getElementById("stopAddRow"),
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
  cityMetaName: document.getElementById("cityMetaName"),
  cityMetaPublished: document.getElementById("cityMetaPublished"),
  cityMetaSaveBtn: document.getElementById("cityMetaSaveBtn"),
  cityMetaPublishBtn: document.getElementById("cityMetaPublishBtn"),
  cityMetaStatus: document.getElementById("cityMetaStatus"),
  cityPreviewCb: document.getElementById("cityPreviewCb"),
  citySelectedRoute: document.getElementById("citySelectedRoute"),
  cityOperatorsList: document.getElementById("cityOperatorsList"),
  cityOperatorSearchInput: document.getElementById("cityOperatorSearchInput"),
  cityOperatorSearchBtn: document.getElementById("cityOperatorSearchBtn"),
  cityOperatorResults: document.getElementById("cityOperatorResults"),
  cityAddSelectedRouteBtn: document.getElementById("cityAddSelectedRouteBtn"),
  cityExcludeSelectedRouteBtn: document.getElementById("cityExcludeSelectedRouteBtn"),
  cityAddVisibleOperatorsBtn: document.getElementById("cityAddVisibleOperatorsBtn"),
  cityRoutesList: document.getElementById("cityRoutesList"),
  cityPanelStatus: document.getElementById("cityPanelStatus"),
  saveStopOrderBtn: document.getElementById("saveStopOrderBtn"),
  clearStopOrderBtn: document.getElementById("clearStopOrderBtn"),
  clearStopChangesBtn: document.getElementById("clearStopChangesBtn"),
  saveRouteBtn: document.getElementById("saveRouteBtn"),
  discardRouteBtn: document.getElementById("discardRouteBtn"),
  routeEditZoomBtn: document.getElementById("routeEditZoomBtn"),
  routeEditStatus: document.getElementById("routeEditStatus"),
  routeSearchInput: document.getElementById("routeSearchInput"),
  routeModeFilterSelect: document.getElementById("routeModeFilterSelect"),
  routeFrequencyFilterSelect: document.getElementById("routeFrequencyFilterSelect"),
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
  operatorPreviewAllCb: document.getElementById("operatorPreviewAllCb"),
  adminActionToast: document.getElementById("adminActionToast"),
  adminActionToastText: document.getElementById("adminActionToastText"),
  adminActionToastClose: document.getElementById("adminActionToastClose"),
  rebuildIndicator: document.getElementById("rebuildIndicator"),
  rebuildIndicatorTitle: document.getElementById("rebuildIndicatorTitle"),
  rebuildIndicatorChanges: document.getElementById("rebuildIndicatorChanges"),
  runBackupBtn: document.getElementById("runBackupBtn"),
  rebuildTilesBtn: document.getElementById("rebuildTilesBtn"),
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
  routeFrequencyFilter: "",
  frequencyByLineKey: new Map(),
  frequencyFetchInFlight: new Set(),
  underlayFeatures: [],
  selectedLineKey: "",
  selectedStationKey: "",
  selectedRouteFeature: null,
  selectedRouteOverride: null,
  selectedRouteReview: null,
  routeOverlapPopup: null,
  operatorsByCity: new Map(),
  currentRouteStops: [],
  currentRouteDirectionSequences: null,
  currentRouteDirectionPatterns: null,
  selectedRouteOnestopId: "",
  manualEdits: [],
  areaRefreshOpen: false,
  areaRefreshBbox: null,
  routeBatchSelection: new Set(),
  selectedBranchGroups: [],
  selectedMergedKeys: [],
  pendingSuggestion: null,
  mergeCandidates: [],
  dismissedMergeCandidates: new Set(),
  mergeDetectTimer: null,
  mergeMembersByCanonical: new Map(),
  mergeCanonicalByMember: new Map(),
  hiddenOperators: new Set(),
  disabledRouteKeys: new Set(),
  visibilityPreviewAll: false,
  problematicKeys: new Set(),
  problematicPreview: true,
  cityPreviewKeys: null,
  cityPanelList: [],
  cityPanelCity: null,
  problematicTouched: false,
  actionToastTimer: null,
  archiveVersion: "",
  archiveVersionTimer: null
};

// Persistent action result that survives the route editor closing.
function showAdminAction(message, isError = false) {
  if (!els.adminActionToast || !message) {
    return;
  }
  els.adminActionToastText.textContent = message;
  els.adminActionToast.classList.toggle("is-error", Boolean(isError));
  els.adminActionToast.hidden = false;
  if (state.actionToastTimer) {
    clearTimeout(state.actionToastTimer);
  }
  state.actionToastTimer = setTimeout(() => hideAdminAction(), 8000);
}

function hideAdminAction() {
  if (state.actionToastTimer) {
    clearTimeout(state.actionToastTimer);
    state.actionToastTimer = null;
  }
  if (els.adminActionToast) {
    els.adminActionToast.hidden = true;
  }
}

let rebuildPollTimer = null;
let rebuildHideTimer = null;

function renderRebuildIndicator(status) {
  if (!els.rebuildIndicator) {
    return;
  }
  if (rebuildHideTimer) {
    clearTimeout(rebuildHideTimer);
    rebuildHideTimer = null;
  }
  if (status && status.running) {
    els.rebuildIndicator.hidden = false;
    if (els.rebuildIndicatorTitle) {
      els.rebuildIndicatorTitle.textContent = "Rebuilding tiles…";
    }
    if (els.rebuildIndicatorChanges) {
      els.rebuildIndicatorChanges.innerHTML = "";
      for (const change of status.changes || []) {
        const item = document.createElement("li");
        item.textContent = change;
        els.rebuildIndicatorChanges.append(item);
      }
    }
    return;
  }
  if (els.rebuildIndicatorTitle) {
    els.rebuildIndicatorTitle.textContent = "Tiles rebuilt.";
  }
  if (els.rebuildIndicatorChanges) {
    els.rebuildIndicatorChanges.innerHTML = "";
  }
  rebuildHideTimer = setTimeout(() => {
    if (els.rebuildIndicator) {
      els.rebuildIndicator.hidden = true;
    }
  }, 4000);
}

// Poll the server rebuild job; when it finishes, swap the archive in WITHOUT
// clearing the current selection.
async function pollRebuildStatus() {
  try {
    const status = await apiRequest("/api/admin/archive/rebuild-status", { method: "GET" });
    renderRebuildIndicator(status);
    if (status && status.running) {
      rebuildPollTimer = setTimeout(pollRebuildStatus, 3000);
      return;
    }
    rebuildPollTimer = null;
    reloadVectorSource();
    updateUnderlay();
    loadOperatorsForViewport();
  } catch {
    rebuildPollTimer = setTimeout(pollRebuildStatus, 5000);
  }
}

function startRebuildWatch() {
  if (rebuildPollTimer) {
    return;
  }
  pollRebuildStatus();
}

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

// Full-world fill that darkens everything but the surfaced route (app parity).
function adminFocusMask(active) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]]
        },
        properties: { active: active ? 1 : 0 }
      }
    ]
  };
}

function setAdminFocusMask(active) {
  const source = state.map && state.map.getSource ? state.map.getSource("focus-mask") : null;
  if (source && typeof source.setData === "function") {
    source.setData(adminFocusMask(active));
  }
}

function mapStyle() {
  // Frontend basemap/projection + admin overlay layers.
  const savedTheme = typeof getAdminTheme === "function" ? getAdminTheme() : "light";
  const base = createMapStyle(savedTheme);
  return {
    ...base,
    sources: {
      ...base.sources,
      "routes-vector": { type: "vector", url: adminVectorSourceUrl(), promoteId: "line_key" },
      "focus-mask": { type: "geojson", data: adminFocusMask(false) },
      stops: { type: "geojson", data: EMPTY_FC },
      "stops-edited": { type: "geojson", data: EMPTY_FC }
    },
    layers: [
      ...base.layers,
      // Match the app: non-focused routes sit under a dim mask, the selected
      // route is drawn on top with casing so it stays surfaced.
      {
        id: "routes-base-main",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], ["get", "color"], "#d44d1f"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.45, 3, 0.7, 6, 1.3, 9, 1.9, 12, 2.4],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 0], 0.3, 0],
            5,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 0], 0.55, 0],
            9,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 0], 0.9, 0]
          ]
        }
      },
      {
        id: "focus-dim-layer",
        type: "fill",
        source: "focus-mask",
        paint: {
          "fill-color": savedTheme === "dark" ? "#0a121c" : "#1f262d",
          "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.65, 0]
        }
      },
      {
        id: "routes-casing",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": "#0f1b22",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.95, 3, 1.4, 6, 2.6, 9, 3.9, 12, 5.2],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.12, 0],
            5,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.22, 0],
            9,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.38, 0]
          ]
        }
      },
      {
        id: "routes-main",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": ["coalesce", ["feature-state", "color"], ["get", "color"], "#d44d1f"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 3, 1.05, 6, 1.9, 9, 2.9, 12, 3.6],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            1,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.35, 0],
            5,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.6, 0],
            9,
            ["case", ["==", ["coalesce", ["feature-state", "focused"], 1], 1], 0.96, 0]
          ]
        }
      },
      {
        id: "routes-hit",
        type: "line",
        source: "routes-vector",
        "source-layer": "routes",
        paint: {
          "line-color": "#000000",
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 10, 4, 14, 8, 18],
          "line-opacity": 0
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

  // Adopt the archive stamp before building the style (shared SW cache entry).
  const initialStamp = await fetchAdminArchiveStamp();
  if (initialStamp) {
    state.archiveVersion = initialStamp;
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
    applyDeepLinkRoute();
    startAdminArchiveVersionWatch();
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
    appState.mapZoom = state.map.getZoom();
    if (state.selectedLineKey) {
      setAdminFocusState(state.selectedLineKey);
    }
    updateUnderlay();
    updateCurrentCity();
    loadOperatorsForViewport();
    updateNewCityView();
    if (state.areaRefreshOpen) {
      updateAreaRefreshBbox();
    }
    scheduleMergeDetection();
  });

  // Deep links fit the map before its tiles load, so re-apply focus once the
  // selected route is actually in the tiles.
  state.map.on("sourcedata", (event) => {
    if (state.adminFocusActive || !state.selectedLineKey || event.sourceId !== "routes-vector") {
      return;
    }
    setAdminFocusState(state.selectedLineKey);
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
  // The focus mask is not from this source; keep it between base and focus routes.
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

// Dim every route except the focused one (and its merge members) and darken the
// surrounding map, so the selected route stays surfaced like in the app.
function setAdminFocusState(focusedKey) {
  if (!state.map || typeof state.map.querySourceFeatures !== "function") {
    return;
  }
  let features = [];
  try {
    features = state.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" });
  } catch {
    features = [];
  }
  const key = String(focusedKey || "").trim();
  const members = key && state.mergeMembersByCanonical instanceof Map
    ? state.mergeMembersByCanonical.get(key) || []
    : [];
  const group = new Set([key, ...members].filter(Boolean));
  const present = new Set();
  for (const feature of features) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    if (lineKey) {
      present.add(lineKey);
    }
  }
  // Focus only applies while the route is in the loaded tiles, so panning away
  // shows the normal map instead of an all-dimmed one.
  const hasFocus = Boolean(key) && Array.from(group).some((candidate) => present.has(candidate));
  for (const lineKey of present) {
    try {
      state.map.setFeatureState(
        { source: "routes-vector", sourceLayer: "routes", id: lineKey },
        { focused: !hasFocus || group.has(lineKey) ? 1 : 0 }
      );
    } catch {
      // feature not in the loaded tileset
    }
  }
  state.adminFocusActive = hasFocus;
  setAdminFocusMask(hasFocus);
}

function highlightRouteOnMap(feature) {
  if (!state.map) {
    return;
  }
  const props = feature ? featureLineProps(feature) : null;
  setAdminFocusState(props ? props.lineKey : "");
}

function clearRouteHighlight() {
  if (!state.map) {
    return;
  }
  setAdminFocusState("");
}

// ?lineKey=... focuses and highlights that route.
async function focusRouteByLineKey(lineKey) {
  const key = String(lineKey || "").trim();
  if (!key) {
    return;
  }
  try {
    const payload = await apiRequest(`/api/admin/routes/geometry?lineKey=${encodeURIComponent(key)}`, { method: "GET" });
    const feature = payload?.feature;
    if (!feature || !feature.geometry) {
      throw new Error("not in the archive");
    }
    focusRouteFeature(feature);
    showAdminAction(`Showing ${key} on the map.`);
  } catch (error) {
    showAdminAction(`Could not show ${key}: ${error.message}`, true);
  }
}

function reviewRow(mainText) {
  const row = document.createElement("div");
  row.className = "review-row";
  const main = document.createElement("span");
  main.className = "review-main";
  main.textContent = mainText;
  row.append(main);
  return row;
}

function reviewButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-subtle";
  button.textContent = label;
  if (title) {
    button.title = title;
  }
  button.addEventListener("click", onClick);
  return button;
}

// Review surfaces (flags / issues / suggestions) live in the Map Editor where the
// map is visible; the Console is for site/API health only.
async function loadReviewQueue() {
  const flagsEl = els.flagsReviewList;
  const issuesEl = els.issuesReviewList;
  const suggestionsEl = els.suggestionsReviewList;
  const statusEl = els.reviewQueueStatus;
  if (!flagsEl) {
    return;
  }
  setEditStatus(statusEl, "Loading review queue…");
  try {
    const [flagsPayload, issuesPayload, suggestionsPayload] = await Promise.all([
      apiRequest("/api/admin/reharvest/flags?status=open", { method: "GET" }),
      apiRequest("/api/admin/issues?status=open", { method: "GET" }),
      apiRequest("/api/admin/suggestions?status=open", { method: "GET" })
    ]);
    const flags = Array.isArray(flagsPayload?.flags) ? flagsPayload.flags : [];
    const issues = Array.isArray(issuesPayload?.issues) ? issuesPayload.issues : [];
    const suggestions = Array.isArray(suggestionsPayload?.suggestions) ? suggestionsPayload.suggestions : [];

    flagsEl.innerHTML = "";
    issuesEl.innerHTML = "";
    suggestionsEl.innerHTML = "";

    if (!flags.length) {
      flagsEl.innerHTML = "<p class='microcopy'>None.</p>";
    }
    for (const flag of flags) {
      const row = reviewRow(`${flag.kind || "flag"} · ${flag.lineKey || flag.stationKey || ""} · ${flag.message || ""}`);
      if (flag.lineKey) {
        row.append(reviewButton("View Error", "Show this route on the map", () => focusRouteByLineKey(flag.lineKey)));
      }
      row.append(
        reviewButton("Close Issue", "Close this flag — does not change the route", async () => {
          try {
            await apiRequest(`/api/admin/reharvest/flags/${flag.id}/resolve`, { method: "POST" });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to dismiss flag: ${error.message}`, true);
          }
        })
      );
      flagsEl.append(row);
    }

    if (!issues.length) {
      issuesEl.innerHTML = "<p class='microcopy'>None.</p>";
    }
    for (const issue of issues) {
      const row = reviewRow(`#${issue.id} · ${issue.reporterName || issue.reporterEmail || "guest"} · ${issue.description || ""}`);
      if (Array.isArray(issue.bbox) && issue.bbox.length === 4 && state.map) {
        row.append(
          reviewButton("Show", "Jump to the reported area", () => {
            const bbox = issue.bbox.map(Number);
            state.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: 15 });
          })
        );
      }
      row.append(
        reviewButton("Resolve", "Mark this report resolved", async () => {
          try {
            await apiRequest(`/api/admin/issues/${issue.id}/resolve`, { method: "POST" });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to resolve report: ${error.message}`, true);
          }
        })
      );
      issuesEl.append(row);
    }

    if (!suggestions.length) {
      suggestionsEl.innerHTML = "<p class='microcopy'>None.</p>";
    }
    for (const suggestion of suggestions) {
      const changes = Object.entries(suggestion.payload || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      const row = reviewRow(`#${suggestion.id} · ${suggestion.lineKey} · ${changes}`);
      row.append(reviewButton("Show", "Preview the suggested changes on this route", () => showSuggestion(suggestion)));
      row.append(
        reviewButton("Accept", "Apply these fields to the route override", async () => {
          try {
            await apiRequest(`/api/admin/suggestions/${suggestion.id}/resolve`, {
              method: "POST",
              body: { status: "applied" }
            });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to accept: ${error.message}`, true);
          }
        })
      );
      row.append(
        reviewButton("Deny", "Discard this suggestion", async () => {
          try {
            await apiRequest(`/api/admin/suggestions/${suggestion.id}/resolve`, {
              method: "POST",
              body: { status: "denied" }
            });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to deny: ${error.message}`, true);
          }
        })
      );
      suggestionsEl.append(row);
    }

    if (els.reviewQueueBadge) {
      const total = flags.length + issues.length + suggestions.length;
      els.reviewQueueBadge.hidden = total === 0;
      els.reviewQueueBadge.textContent = String(total);
    }
  } catch (error) {
    setEditStatus(statusEl, `Failed to load review queue: ${error.message}`, true);
  }
}

const SUGGESTION_FIELD_INPUTS = {
  lineShortName: "routeShortName",
  lineLongName: "routeLongName",
  lineName: "routeName",
  operatorName: "routeOperator",
  color: "routeColor",
  mode: "routeMode",
  frequencyBucket: "routeFrequency",
  headwayBestMinutes: "routeFrequencyMinutes"
};

async function showSuggestion(suggestion) {
  state.pendingSuggestion = {
    lineKey: String(suggestion.lineKey || "").trim(),
    payload: suggestion.payload || {}
  };
  await focusRouteByLineKey(suggestion.lineKey);
}

// Overlay the suggestion's fields into the route editor and highlight them, so
// the admin sees exactly what the suggestion would change.
function applyActiveSuggestion(lineKey) {
  for (const id of Object.values(SUGGESTION_FIELD_INPUTS)) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("is-suggested");
    }
  }
  const pending = state.pendingSuggestion;
  if (!pending || pending.lineKey !== String(lineKey || "").trim()) {
    return;
  }
  for (const [field, value] of Object.entries(pending.payload || {})) {
    const id = SUGGESTION_FIELD_INPUTS[field];
    const el = id ? document.getElementById(id) : null;
    if (!el) {
      continue;
    }
    el.value = String(value);
    el.classList.add("is-suggested");
  }
  state.pendingSuggestion = null;
}

async function loadProblematicRoutes() {
  const container = els.problematicList;
  if (!container) {
    return;
  }
  setEditStatus(els.problematicStatus, "Loading…");
  try {
    const query = state.currentCitySlug ? `?citySlug=${encodeURIComponent(state.currentCitySlug)}` : "";
    const payload = await apiRequest(`/api/admin/reviews/route${query}`, { method: "GET" });
    const flagged = (payload?.reviews || []).filter(
      (row) => row.problematic_override === true || row.problematicOverride === true
    );
    state.problematicKeys = new Set(
      flagged.map((row) => String(row.line_key || row.lineKey || "").trim()).filter(Boolean)
    );
    applyMapRouteVisibility({
      hiddenOperators: state.hiddenOperators,
      disabledLineKeys: state.disabledRouteKeys
    });
    container.innerHTML = "";
    if (!flagged.length) {
      container.innerHTML = "<p class='microcopy'>None.</p>";
      setEditStatus(els.problematicStatus, "");
      return;
    }
    for (const row of flagged) {
      const key = String(row.line_key || row.lineKey || "").trim();
      if (!key) {
        continue;
      }
      const item = reviewRow(`${cityRouteDisplayName(key)} (${key})`);
      item.append(reviewButton("Show", "Show this route on the map", () => focusRouteByLineKey(key)));
      item.append(
        reviewButton("Unflag", "Unhide this route for users", async () => {
          try {
            await apiRequest("/api/admin/reviews/route", {
              method: "POST",
              body: { lineKey: key, citySlug: state.currentCitySlug, problematicOverride: null }
            });
            loadProblematicRoutes();
          } catch (error) {
            setEditStatus(els.problematicStatus, `Failed to unflag: ${error.message}`, true);
          }
        })
      );
      container.append(item);
    }
    setEditStatus(els.problematicStatus, "");
    renderProblematicSelectedRow();
  } catch (error) {
    setEditStatus(els.problematicStatus, `Failed to load: ${error.message}`, true);
  }
}

// Per-selected-route flag/unflag, like the city include/exclude row.
function renderProblematicSelectedRow() {
  const container = els.problematicSelectedRow;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const lineKey = String(state.selectedLineKey || "").trim();
  if (!lineKey) {
    return;
  }
  const flagged = state.problematicKeys instanceof Set && state.problematicKeys.has(lineKey);
  const row = reviewRow(`${cityRouteDisplayName(lineKey)} (${lineKey}) — ${flagged ? "hidden for users" : "shown to users"}`);
  row.append(
    reviewButton(
      flagged ? "Unflag" : "Flag as problematic",
      flagged ? "Unhide this route for users" : "Hide this route for users by default",
      async () => {
        try {
          await apiRequest("/api/admin/reviews/route", {
            method: "POST",
            body: { lineKey, citySlug: state.currentCitySlug, problematicOverride: flagged ? null : true }
          });
          loadProblematicRoutes();
        } catch (error) {
          setEditStatus(els.problematicStatus, `Failed: ${error.message}`, true);
        }
      }
    )
  );
  container.append(row);
}

function applyDeepLinkRoute() {
  const params = new URLSearchParams(window.location.search);
  const lineKey = String(params.get("lineKey") || "").trim();
  if (!lineKey) {
    return;
  }
  apiRequest(`/api/admin/routes/geometry?lineKey=${encodeURIComponent(lineKey)}`, { method: "GET" })
    .then((payload) => {
      const feature = payload?.feature;
      if (!feature || !feature.geometry) {
        throw new Error("Route geometry is not in the archive yet.");
      }
      focusRouteFeature(feature);
      showAdminAction(`Reviewing ${lineKey}.`);
    })
    .catch((error) => {
      showAdminAction(`Could not open ${lineKey} on the map: ${error.message}`, true);
    });
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
  // Include source (hidden) features so search finds non-rendered routes too.
  if (state.map && state.mapReady) {
    try {
      for (const feature of state.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" })) {
        add(feature);
      }
    } catch {
      // source not ready yet
    }
  }
  for (const feature of state.underlayFeatures || []) {
    add(feature);
  }
  return Array.from(byKey.values());
}

function renderRouteSearchResults(features, context = {}) {
  const container = els.routeSearchResults;
  if (!container) {
    return;
  }
  const query = String(context.query || "").trim().toLowerCase();
  const modeFilter = String(context.modeFilter || "").trim();
  const frequencyFilter = String(context.frequencyFilter || "").trim();
  const hasFilter = Boolean(query || modeFilter || frequencyFilter);
  container.innerHTML = "";
  // Only render results when a search/filter is active.
  if (!hasFilter) {
    updateRouteBatchControl();
    return;
  }
  const list = (Array.isArray(features) ? features : []).filter((feature) => {
    const props = featureLineProps(feature);
    if (query && !buildUnderlaySearchText(feature).includes(query)) {
      return false;
    }
    if (modeFilter) {
      if (props.routeType === null || String(props.routeType) !== modeFilter) {
        return false;
      }
    }
    if (frequencyFilter) {
      const bucket = String(state.frequencyByLineKey.get(props.lineKey) || "unknown").toLowerCase();
      if (bucket !== frequencyFilter) {
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
  if (payload.missing?.length) parts.push(`${payload.missing.length} missing (kept — review to remove)`);
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
    showAdminAction(`${keys.length} route(s): ${summary.text}`, summary.isError);
    state.routeBatchSelection.clear();
    startRebuildWatch();
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
    showAdminAction(`${lineKey}: ${summary.text}`, summary.isError);
    startRebuildWatch();
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
    showAdminAction(`${lineKey}: ${summary.text}`, summary.isError);
    if (payload?.rebuilding) {
      startRebuildWatch();
    } else {
      reloadVectorSource();
      updateUnderlay();
    }
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
    showAdminAction(`Added ${candidate.lineKey}: ${summary.text}`, summary.isError);
    recordManualEdit("route-data", `${candidate.lineKey} added`, "added from Transitland search");
    startRebuildWatch();
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
    state.underlayFeatures = Array.isArray(payload?.routesGeoJson?.features)
      ? payload.routesGeoJson.features
      : [];
    applyUnderlaySearchFilter();
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
  const query = String(state.routeSearchQuery || "").trim().toLowerCase();
  const modeFilter = String(state.routeModeFilter || "").trim();
  const frequencyFilter = String(state.routeFrequencyFilter || "").trim();
  const corpus = collectRouteSearchCorpus();
  if (els.routeSearchInfo) {
    els.routeSearchInfo.textContent =
      query || modeFilter || frequencyFilter ? `${corpus.length} route(s) in view` : "";
  }
  // Frequency comes from route_metadata, not tiles; fetch it for the corpus once.
  if (frequencyFilter) {
    const keys = corpus.map((feature) => featureLineProps(feature).lineKey).filter(Boolean);
    if (keys.some((key) => !state.frequencyByLineKey.has(key))) {
      ensureFrequencyMetadata(keys)
        .then(() => applyUnderlaySearchFilter())
        .catch(() => {});
    }
  }
  renderRouteSearchResults(corpus, { query, modeFilter, frequencyFilter });
}

async function ensureFrequencyMetadata(lineKeys) {
  const missing = Array.from(new Set(lineKeys)).filter(
    (key) => key && !state.frequencyByLineKey.has(key) && !state.frequencyFetchInFlight.has(key)
  );
  if (!missing.length) {
    return;
  }
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    for (const key of chunk) {
      state.frequencyFetchInFlight.add(key);
    }
    try {
      const params = new URLSearchParams({ lineKeys: chunk.join(",") });
      const payload = await apiRequest(`/api/transit/route-headway/bulk?${params.toString()}`, { method: "GET" });
      const byKey = payload?.headwayByLineKey || {};
      for (const key of chunk) {
        state.frequencyByLineKey.set(key, String(byKey[key]?.frequencyBucket || "unknown").toLowerCase());
      }
    } catch {
      for (const key of chunk) {
        state.frequencyByLineKey.set(key, "unknown");
      }
    } finally {
      for (const key of chunk) {
        state.frequencyFetchInFlight.delete(key);
      }
    }
  }
}

// Refresh the coverage underlay for the current viewport while searching.
let underlayRefreshTimer = null;
function scheduleUnderlayRefresh() {
  if (underlayRefreshTimer) {
    clearTimeout(underlayRefreshTimer);
  }
  underlayRefreshTimer = setTimeout(() => {
    underlayRefreshTimer = null;
    updateUnderlay();
  }, 350);
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
      // Merged members collapse into their canonical: don't offer them here.
      if (state.mergeCanonicalByMember instanceof Map && state.mergeCanonicalByMember.has(lineKey)) {
        continue;
      }
      seenLineKeys.add(lineKey);
      uniqueFeatures.push(feature);
    }

    if (!uniqueFeatures.length) {
      return;
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
      state.currentRouteDirectionSequences = payload.directionStopSequences || null;
      state.currentRouteDirectionPatterns = payload.directionStopPatterns || null;
      renderStopsOrderList();
      if (String(els.routeOrdering?.value || "").trim() !== "manual") {
        refreshStopOrderPreview();
      }
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

function clearStopsMapSources() {
  for (const id of ["stops", "stops-edited"]) {
    const source = state.map && state.map.getSource(id);
    if (source && typeof source.setData === "function") {
      source.setData(EMPTY_FC);
    }
  }
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

function renderMergeRoutesList() {
  const container = els.mergeRoutesList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const keys = state.selectedMergedKeys || [];
  if (!keys.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "Not merged with any route.";
    container.append(p);
    return;
  }
  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "city-member-row";
    const main = document.createElement("div");
    main.className = "city-member-main";
    const name = document.createElement("span");
    name.className = "city-member-name";
    name.textContent = cityRouteDisplayName(key);
    const meta = document.createElement("span");
    meta.className = "city-member-meta";
    meta.textContent = key;
    main.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "city-remove-rule";
    remove.textContent = "Unmerge";
    remove.addEventListener("click", () => {
      state.selectedMergedKeys = (state.selectedMergedKeys || []).filter((entry) => entry !== key);
      renderMergeRoutesList();
      setEditStatus(els.mergeRouteStatus, `${key} removed. Save Changes to apply.`);
    });

    row.append(main, remove);
    container.append(row);
  }
}

function renderMergeRouteKeyResults() {
  const input = els.mergeRouteKeyInput;
  const container = els.mergeRouteKeyResults;
  if (!input || !container) {
    return;
  }
  const query = String(input.value || "").trim().toLowerCase();
  container.innerHTML = "";
  if (query.length < 2 || typeof collectRouteSearchCorpus !== "function") {
    return;
  }
  const self = String(state.selectedLineKey || "").trim();
  const seen = new Set();
  for (const feature of collectRouteSearchCorpus()) {
    const props = featureLineProps(feature);
    const key = String(props.lineKey || "").trim();
    if (!key || key === self || seen.has(key)) {
      continue;
    }
    const label = typeof cityRouteDisplayName === "function" ? cityRouteDisplayName(key) : key;
    if (!`${key} ${label}`.toLowerCase().includes(query)) {
      continue;
    }
    seen.add(key);
    const row = document.createElement("div");
    row.className = "admin-route-result-row";
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "admin-route-result-focus";
    const dot = document.createElement("span");
    dot.className = "admin-route-select-dot";
    dot.style.background = props.color || "#177ca2";
    const nameEl = document.createElement("span");
    nameEl.className = "admin-route-select-name";
    nameEl.textContent = label;
    const metaEl = document.createElement("span");
    metaEl.className = "admin-route-select-meta";
    metaEl.textContent = key;
    pickBtn.append(dot, nameEl, metaEl);
    pickBtn.addEventListener("click", () => {
      input.value = key;
      container.innerHTML = "";
    });
    row.append(pickBtn);
    container.append(row);
    if (seen.size >= 8) {
      break;
    }
  }
}

function addMergeRoute() {
  const key = String(els.mergeRouteKeyInput?.value || "").trim();
  if (!key) {
    return;
  }
  if (key === state.selectedLineKey) {
    setEditStatus(els.mergeRouteStatus, "A route cannot merge with itself.", true);
    return;
  }
  if ((state.selectedMergedKeys || []).includes(key)) {
    setEditStatus(els.mergeRouteStatus, `${key} is already merged.`, true);
    return;
  }
  state.selectedMergedKeys = [...(state.selectedMergedKeys || []), key];
  if (els.mergeRouteKeyInput) {
    els.mergeRouteKeyInput.value = "";
  }
  renderMergeRoutesList();
  setEditStatus(els.mergeRouteStatus, `${key} added. Save Changes to apply.`);
}

function mergeCandidateKey(candidate) {
  return [...(candidate?.lineKeys || [])].sort().join("|");
}

function scheduleMergeDetection() {
  if (!els.mergeCandidatesList) {
    return;
  }
  if (state.mergeDetectTimer) {
    clearTimeout(state.mergeDetectTimer);
  }
  state.mergeDetectTimer = setTimeout(() => {
    state.mergeDetectTimer = null;
    findMergeCandidates().catch(() => {});
  }, 1200);
}

async function findMergeCandidates() {
  if (!els.mergeCandidatesList) {
    return;
  }
  const bbox = currentMapBbox();
  if (!bbox) {
    return;
  }
  setEditStatus(els.mergeCandidatesStatus, "Scanning geometry…");
  try {
    const params = new URLSearchParams({ bbox: bbox.join(",") });
    if (state.currentCitySlug) {
      params.set("citySlug", state.currentCitySlug);
    }
    const payload = await apiRequest(`/api/admin/routes/merge-candidates?${params.toString()}`, {
      method: "GET"
    });
    state.mergeCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    renderMergeCandidates();
    const visible = state.mergeCandidates.filter(
      (candidate) => !state.dismissedMergeCandidates.has(mergeCandidateKey(candidate))
    );
    setEditStatus(
      els.mergeCandidatesStatus,
      visible.length ? `${visible.length} possible duplicate group(s) in view.` : "No duplicate-looking routes in view."
    );
  } catch (error) {
    setEditStatus(els.mergeCandidatesStatus, `Detection failed: ${error.message}`, true);
  }
}

function renderMergeCandidates() {
  const container = els.mergeCandidatesList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const candidates = (state.mergeCandidates || []).filter(
    (candidate) => !state.dismissedMergeCandidates.has(mergeCandidateKey(candidate))
  );
  if (!candidates.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No duplicate-looking routes in view.";
    container.append(p);
    return;
  }
  for (const candidate of candidates) {
    container.append(buildMergeCandidateRow(candidate));
  }
}

function buildMergeCandidateRow(candidate) {
  const row = document.createElement("div");
  row.className = "merge-candidate";

  const title = document.createElement("p");
  title.className = "merge-candidate-title";
  const reason = candidate.reason === "identical-geometry" ? "Identical geometry" : "Near-identical geometry";
  title.textContent = `${reason} · match ${Number(candidate.score).toFixed(2)}`;
  row.append(title);

  const names = document.createElement("p");
  names.className = "merge-candidate-names";
  candidate.lineKeys.forEach((key, index) => {
    if (index > 0) {
      names.append(document.createTextNode("  ·  "));
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = "merge-candidate-name-link";
    link.textContent = candidate.names?.[index] || key;
    link.title = `Show ${key} on the map`;
    link.addEventListener("click", () => {
      focusRouteByLineKey(key).catch(() => {});
    });
    names.append(link);
  });
  row.append(names);

  const actions = document.createElement("div");
  actions.className = "override-actions";
  const canonical = candidate.suggestedCanonicalKey || candidate.lineKeys[0];
  const members = candidate.lineKeys.filter((key) => key !== canonical);
  const canonicalIndex = candidate.lineKeys.indexOf(canonical);

  const mergeBtn = document.createElement("button");
  mergeBtn.type = "button";
  mergeBtn.className = "btn";
  mergeBtn.textContent = `Merge into ${candidate.names?.[canonicalIndex] || canonical}`;
  mergeBtn.addEventListener("click", () => mergeCandidateGroup(canonical, members, mergeBtn));

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn btn-subtle";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => {
    state.dismissedMergeCandidates.add(mergeCandidateKey(candidate));
    renderMergeCandidates();
  });

  actions.append(mergeBtn, dismissBtn);
  row.append(actions);
  return row;
}

async function mergeCandidateGroup(canonical, members, button) {
  if (!canonical || !members?.length) {
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Merging…";
  try {
    let payload = {};
    try {
      const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(canonical)}`, {
        method: "GET"
      });
      payload = existing?.override?.payload || {};
    } catch {
      payload = {};
    }
    const existingMembers = Array.isArray(payload.mergedLineKeys) ? payload.mergedLineKeys.map(String) : [];
    const merged = Array.from(
      new Set([...existingMembers, ...members].filter((key) => key && key !== canonical))
    );
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey: canonical, citySlug: state.currentCitySlug, payload: { ...payload, mergedLineKeys: merged } }
    });
    recordManualEdit("route", `${canonical} · merge`, `merged ${members.join(", ")}`);
    showAdminAction(`Merged ${members.join(", ")} into ${canonical}.`);
    state.dismissedMergeCandidates.add(mergeCandidateKey({ lineKeys: [canonical, ...members] }));
    reloadVectorSource();
    updateUnderlay();
    await loadAdminMerges();
    renderMergeCandidates();
  } catch (error) {
    showAdminAction(`Merge failed: ${error.message}`, true);
    button.textContent = originalText;
    button.disabled = false;
  }
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

let dragStopIndex = null;

function stopOrderingModeLabel(mode) {
  return (
    {
      "geometry-revised": "Main",
      "legacy-geometry": "U-Shape",
      fractions: "Loop",
      manual: "Manual"
    }[String(mode || "")] || "Auto"
  );
}

function updateStopOrderLockState() {
  const manual = String(els.routeOrdering?.value || "") === "manual";
  if (els.stopOrderLockNote) {
    const label = stopOrderingModeLabel(els.routeOrdering?.value);
    els.stopOrderLockNote.textContent = `Stops are shown in ${label} order. Set Stop Ordering Default to Manual to drag and reorder.`;
    els.stopOrderLockNote.hidden = manual;
  }
  if (els.stopAddRow) {
    els.stopAddRow.hidden = !manual;
  }
  const branchEditor = document.querySelector(".branch-groups-editor");
  if (branchEditor) {
    branchEditor.hidden = !manual;
  }
  renderStopsOrderList();
  if (!manual) {
    refreshStopOrderPreview();
  }
}

// Preview the chosen ordering by reusing the line-view ordering algorithms.
async function refreshStopOrderPreview() {
  const lineKey = String(state.selectedLineKey || "").trim();
  if (!lineKey || typeof orderStopsForLineView !== "function" || !Array.isArray(state.currentRouteStops)) {
    return;
  }
  const mode = String(els.routeOrdering?.value || "").trim() || "auto";
  if (mode === "manual") {
    return;
  }
  try {
    const ordered = await orderStopsForLineView(
      state.currentRouteStops.slice(),
      lineKey,
      state.currentRouteDirectionSequences || null,
      mode,
      state.selectedRouteOnestopId || null,
      null,
      state.currentRouteDirectionPatterns || null
    );
    if (Array.isArray(ordered) && ordered.length) {
      state.currentRouteStops = ordered;
      renderStopsOrderList();
    }
  } catch {
    // keep the current order
  }
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
  const manual = String(els.routeOrdering?.value || "") === "manual";
  stops.forEach((feature, index) => {
    const p = feature.properties || {};
    const row = document.createElement("div");
    row.className =
      "stop-order-row" + (p.custom_stop ? " is-custom" : "") + (manual ? "" : " is-locked");

    const drag = document.createElement("button");
      drag.type = "button";
      drag.className = "stop-order-drag";
      drag.textContent = "⠿";
      drag.title = manual ? "Drag to reorder" : "Set Stop Ordering Default to Manual to reorder stops";
      drag.draggable = manual;
      drag.disabled = !manual;
      drag.addEventListener("dragstart", (event) => {
        dragStopIndex = index;
        row.classList.add("is-dragging");
        try {
          event.dataTransfer.setData("text/plain", String(index));
        } catch {
          // some browsers block setData on synthetic drags
        }
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      drag.addEventListener("dragend", () => {
        dragStopIndex = null;
        row.classList.remove("is-dragging");
      });
      row.addEventListener("dragover", (event) => {
        if (dragStopIndex === null) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragStopIndex === null || dragStopIndex === index) {
          return;
        }
        const arr = state.currentRouteStops;
        const [moved] = arr.splice(dragStopIndex, 1);
        arr.splice(index, 0, moved);
        dragStopIndex = null;
        renderStopsOrderList();
      });
      row.append(drag);

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

    nameInput.className = "stop-order-name";
    const coordsRow = document.createElement("div");
    coordsRow.className = "stop-order-coords";
    coordsRow.append(latInput, lonInput);
    fields.append(nameInput, coordsRow);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stop-order-remove";
    remove.textContent = "Delete";
    remove.title = "Delete this stop";
    remove.disabled = !manual;
    remove.addEventListener("click", () => {
      state.currentRouteStops.splice(index, 1);
      renderStopsOrderList();
    });

    row.append(fields, remove);

    if (manual && (state.selectedBranchGroups || []).length) {
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
  // Persist the ordering selection so a manual reorder applies on the frontend.
  const orderingValue = String(els.routeOrdering?.value || "").trim();
  if (orderingValue) {
    payload.orderingMode = orderingValue;
  }
  const mergedKeys = (state.selectedMergedKeys || []).filter((key) => key && key !== lineKey);
  if (mergedKeys.length) {
    payload.mergedLineKeys = mergedKeys;
  } else {
    delete payload.mergedLineKeys;
  }
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
    setEditStatus(els.mergeRouteStatus, "");
    recordManualEdit(
      "route",
      `${lineKey} · stop order`,
      `${stops.length} stops${branchGroups.length ? `, ${branchGroups.length} branch group(s)` : ""}`
    );
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function clearStopChanges() {
  if (!state.selectedLineKey) {
    return;
  }
  await loadStopsForRoute(state.selectedLineKey);
  setEditStatus(els.routeEditStatus, "Reverted unsaved stop changes.");
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
  delete payload.orderingMode;

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    if (els.routeOrdering) {
      els.routeOrdering.value = "";
    }
    setEditStatus(els.routeEditStatus, "Stop order reset to automatic.");
    recordManualEdit("route", `${lineKey} · stop order`, "reset all stop-order changes");
    await loadStopsForRoute(lineKey);
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function selectRouteFromFeature(feature) {
  const props = featureLineProps(feature);
  closeRouteOverlapPopup();
  state.selectedRouteFeature = feature;
  state.selectedRouteOnestopId = String(feature?.properties?.onestop_id || "").trim();
  state.selectedLineKey = props.lineKey;
  state.selectedStationKey = "";
  state.selectedRouteOverride = null;
  state.selectedRouteReview = null;

  highlightRouteOnMap(feature);
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
  if (els.routeFrequencyMinutes) els.routeFrequencyMinutes.value = "";
  state.selectedBranchGroups = [];
  renderBranchGroupsEditor();
  state.selectedMergedKeys = [];
  renderMergeRoutesList();
  updateStopOrderLockState();
  if (els.routeProblematic) {
    els.routeProblematic.checked = false;
  }
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
      if (Array.isArray(payload.stops) && payload.stops.length && !payload.orderingMode) {
        // A custom order implies manual mode unless told otherwise.
        els.routeOrdering.value = "manual";
      }
      if (payload.frequencyBucket && els.routeFrequency) {
        els.routeFrequency.value = String(payload.frequencyBucket);
      }
      if (els.routeFrequencyMinutes && payload.headwayBestMinutes !== undefined) {
        const minutes = Number(payload.headwayBestMinutes);
        els.routeFrequencyMinutes.value = Number.isFinite(minutes) ? String(minutes) : "";
      }
      state.selectedBranchGroups = Array.isArray(payload.branchGroups)
        ? JSON.parse(JSON.stringify(payload.branchGroups))
        : [];
      state.selectedMergedKeys = Array.isArray(payload.mergedLineKeys)
        ? payload.mergedLineKeys.map((key) => String(key || "").trim()).filter(Boolean)
        : [];
      renderBranchGroupsEditor();
      renderMergeRoutesList();
      updateStopOrderLockState();
      setEditStatus(els.routeEditStatus, "Loaded existing override + tile properties.");
    }

    if (els.routeFrequencyMinutes && !els.routeFrequencyMinutes.value) {
      const minutes = Number(headwayPayload?.headwayByLineKey?.[state.selectedLineKey]?.headwayBestMinutes);
      if (Number.isFinite(minutes) && minutes > 0) {
        els.routeFrequencyMinutes.value = String(Math.round(minutes));
      }
    }

    // Problematic = manual override, else auto-detect.
    const review = (reviewsPayload.reviews || []).find((r) => r.line_key === state.selectedLineKey);
    const manualOverride = review ? review.problematic_override : undefined;
    const autoProblematic = Boolean(headwayPayload?.headwayByLineKey?.[state.selectedLineKey]?.problematicGeometry);
    const effectiveProblematic = manualOverride === true || (manualOverride !== false && autoProblematic);
    if (review) {
      state.selectedRouteReview = review;
    }
    if (els.routeProblematic) {
      els.routeProblematic.checked = Boolean(effectiveProblematic);
    }

    loadStopsForRoute(state.selectedLineKey);
    renderCitySelectedRoute();
    applyActiveSuggestion(state.selectedLineKey);
    renderProblematicSelectedRow();
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
  state.currentRouteStops = [];
  state.selectedBranchGroups = [];
  state.selectedMergedKeys = [];
  clearRouteHighlight();
  clearStopsMapSources();
  renderStopsOrderList();
  renderBranchGroupsEditor();
  renderMergeRoutesList();
  renderProblematicSelectedRow();
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
  const frequencyMinutes = Number(els.routeFrequencyMinutes?.value);

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
    delete payload.headwayBestMinutes;
  } else if (frequency) {
    payload.frequencyBucket = frequency;
  }
  if (frequency !== "__default__" && Number.isFinite(frequencyMinutes) && frequencyMinutes > 0) {
    payload.headwayBestMinutes = Math.round(frequencyMinutes);
  } else if (frequency === "__default__") {
    delete payload.headwayBestMinutes;
  }

  const mergedKeys = (state.selectedMergedKeys || []).filter((key) => key && key !== lineKey);
  if (mergedKeys.length) {
    payload.mergedLineKeys = mergedKeys;
  } else {
    delete payload.mergedLineKeys;
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

    setEditStatus(els.routeEditStatus, "Route changes saved.");
    setEditStatus(els.mergeRouteStatus, "");

    // Problematic geometry is managed from the Problematic geometries panel.
    const problematicActive = Boolean(els.routeProblematic?.checked);
    recordManualEdit(
      "route",
      `${lineKey}${name ? " · " + name : ""}`,
      [
        color ? `color ${color}` : "",
        ordering ? `ordering ${ordering}` : "",
        frequency === "__default__" ? "frequency cleared" : frequency ? `frequency ${frequency}` : "",
        modeRaw ? `mode ${MODE_LABELS[Number(modeRaw)] || modeRaw}` : "",
        mergedKeys.length ? `merged with ${mergedKeys.join(", ")}` : "",
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

// Recolor the saved route in place via feature-state (no clipped overlay).
function addRouteHighlight(lineKey, payload) {
  if (!state.map || !lineKey) {
    return;
  }
  const color = String(payload?.color || "").trim();
  if (!color) {
    return;
  }
  try {
    state.map.setFeatureState(
      { source: "routes-vector", sourceLayer: "routes", id: lineKey },
      { color }
    );
  } catch {
    // route not in the loaded tileset
  }
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
  // City preset preview: show only the resolved preset routes.
  if (state.cityPreviewKeys instanceof Set && state.cityPreviewKeys.size) {
    conditions.push(["in", ["get", "line_key"], ["literal", Array.from(state.cityPreviewKeys)]]);
  }
  // Problematic geometries are hidden for users by default; preview can reveal.
  if (state.problematicPreview !== false && state.problematicKeys instanceof Set && state.problematicKeys.size) {
    conditions.push(["!", ["in", ["get", "line_key"], ["literal", Array.from(state.problematicKeys)]]]);
  }
  const baseFilter = conditions.length === 0 ? null : conditions.length === 1 ? conditions[0] : ["all", ...conditions];

  // Merged members stay hidden even in "preview all" (preview only ignores
  // operator/disabled hides).
  const mergedMembers = state.mergeCanonicalByMember instanceof Map
    ? Array.from(state.mergeCanonicalByMember.keys())
    : [];
  const memberFilter = mergedMembers.length
    ? ["!", ["in", ["get", "line_key"], ["literal", mergedMembers]]]
    : null;
  let filter = state.visibilityPreviewAll ? null : baseFilter;
  if (memberFilter) {
    filter = filter ? ["all", filter, memberFilter] : memberFilter;
  }

  for (const id of ["routes-base-main", "routes-casing", "routes-main", "routes-hit"]) {
    if (state.map.getLayer(id)) {
      state.map.setFilter(id, filter);
    }
  }
}

async function loadAdminMerges() {
  try {
    const payload = await apiRequest("/api/admin/overrides/route", { method: "GET" });
    const byCanonical = new Map();
    const byMember = new Map();
    for (const row of payload?.overrides || []) {
      const members = Array.isArray(row?.payload?.mergedLineKeys) ? row.payload.mergedLineKeys.map(String) : [];
      if (members.length) {
        byCanonical.set(String(row.line_key), members);
        for (const member of members) {
          byMember.set(member, String(row.line_key));
        }
      }
    }
    state.mergeMembersByCanonical = byCanonical;
    state.mergeCanonicalByMember = byMember;
  } catch {
    // ignore
  }
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
}

function setVisibilityPreviewAll(enabled) {
  state.visibilityPreviewAll = Boolean(enabled);
  if (els.operatorPreviewAllCb) {
    els.operatorPreviewAllCb.checked = !state.visibilityPreviewAll;
  }
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
}

async function loadOperatorsForViewport() {
  // Source query (not rendered): hidden operators must stay listed/toggleable.
  const features = state.map && state.mapReady
    ? state.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" })
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

    const toggle = document.createElement("label");
    toggle.className = "switch";
    toggle.title = hidden ? "Hidden by default" : "Shown by default";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = !hidden;
    toggleInput.addEventListener("change", async () => {
      const nextHidden = !toggleInput.checked;
      toggleInput.disabled = true;
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
        toggleInput.checked = !toggleInput.checked;
        setEditStatus(els.routeEditStatus || els.stationEditStatus, error.message, true);
      } finally {
        toggleInput.disabled = false;
      }
    });
    const toggleSlider = document.createElement("span");
    toggleSlider.className = "switch-slider";
    toggle.append(toggleInput, toggleSlider);

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

  if (els.adminActionToastClose) {
    els.adminActionToastClose.addEventListener("click", hideAdminAction);
  }

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

  if (els.runBackupBtn) {
    els.runBackupBtn.addEventListener("click", () => {
      apiRequest("/api/admin/actions/backup-nonrecoverable", { method: "POST" })
        .then(() => showAdminAction("Backup written."))
        .catch((error) => showAdminAction(`Backup failed: ${error.message}`, true));
    });
  }
  if (els.rebuildTilesBtn) {
    els.rebuildTilesBtn.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Rebuild ALL map tiles for everyone? This regenerates the whole archive and is served to all users."
      );
      if (!confirmed) {
        return;
      }
      apiRequest("/api/admin/actions/rebuild-tiles", { method: "POST" })
        .then(() => {
          showAdminAction("Rebuilding all tiles…");
          startRebuildWatch();
        })
        .catch((error) => showAdminAction(`Rebuild failed: ${error.message}`, true));
    });
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
      scheduleUnderlayRefresh();
    });
  }
  if (els.routeModeFilterSelect) {
    els.routeModeFilterSelect.addEventListener("change", () => {
      state.routeModeFilter = String(els.routeModeFilterSelect.value || "").trim();
      applyUnderlaySearchFilter();
    });
  }
  if (els.routeFrequencyFilterSelect) {
    els.routeFrequencyFilterSelect.addEventListener("change", () => {
      state.routeFrequencyFilter = String(els.routeFrequencyFilterSelect.value || "").trim();
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
  if (els.cityMetaSaveBtn) {
    els.cityMetaSaveBtn.addEventListener("click", () => {
      saveCityMetadata().catch(() => {});
    });
  }
  if (els.cityMetaPublished) {
    els.cityMetaPublished.addEventListener("change", updateCityPublishButton);
  }
  if (els.cityMetaPublishBtn) {
    els.cityMetaPublishBtn.addEventListener("click", () => {
      saveCityPublish().catch(() => {});
    });
  }
  if (els.cityPreviewCb) {
    els.cityPreviewCb.addEventListener("change", () => {
      setCityPreview(els.cityPreviewCb.checked);
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
  if (els.cityAddVisibleOperatorsBtn) {
    els.cityAddVisibleOperatorsBtn.addEventListener("click", () => {
      addVisibleOperatorsToCity().catch(() => {});
    });
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
  if (els.routeOrdering) {
    els.routeOrdering.addEventListener("change", updateStopOrderLockState);
  }
  if (els.routeFrequency) {
    els.routeFrequency.addEventListener("change", () => {
      const bucket = String(els.routeFrequency.value || "");
      if (["frequent", "regular", "local"].includes(bucket) && els.routeFrequencyMinutes) {
        els.routeFrequencyMinutes.value = bucket === "frequent" ? "10" : bucket === "regular" ? "20" : "45";
      } else if (bucket === "unknown" || bucket === "__default__" || bucket === "") {
        if (els.routeFrequencyMinutes) els.routeFrequencyMinutes.value = "";
      }
    });
  }
  if (els.routeFrequencyMinutes) {
    els.routeFrequencyMinutes.addEventListener("input", () => {
      const minutes = Number(els.routeFrequencyMinutes.value);
      if (!els.routeFrequency || !Number.isFinite(minutes) || minutes <= 0) {
        return;
      }
      const bucket = minutes <= 10 ? "frequent" : minutes < 30 ? "regular" : "local";
      els.routeFrequency.value = bucket;
    });
  }
  els.discardRouteBtn.addEventListener("click", () => {
    closeRouteOverlapPopup();
    clearSelection();
  });
  if (els.routeEditZoomBtn) {
    els.routeEditZoomBtn.addEventListener("click", () => {
      if (state.selectedRouteFeature) {
        focusRouteFeature(state.selectedRouteFeature);
      }
    });
  }
  els.saveStationBtn.addEventListener("click", saveStationEdits);
  els.discardStationBtn.addEventListener("click", () => {
    els.stationEditPanel.hidden = true;
    state.selectedStationKey = "";
  });

  els.saveStopOrderBtn.addEventListener("click", saveStopOrder);
  els.clearStopOrderBtn.addEventListener("click", clearStopOrder);
  if (els.clearStopChangesBtn) {
    els.clearStopChangesBtn.addEventListener("click", () => {
      clearStopChanges().catch(() => {});
    });
  }
  if (els.addStopBtn) {
    els.addStopBtn.addEventListener("click", addCustomStop);
  }
  if (els.addBranchGroupBtn) {
    els.addBranchGroupBtn.addEventListener("click", addBranchGroup);
  }
  if (els.addMergeRouteBtn) {
    els.addMergeRouteBtn.addEventListener("click", addMergeRoute);
  }
  if (els.findMergeCandidatesBtn) {
    els.findMergeCandidatesBtn.addEventListener("click", () => {
      findMergeCandidates().catch(() => {});
    });
  }
  if (els.reloadReviewQueueBtn) {
    els.reloadReviewQueueBtn.addEventListener("click", () => {
      loadReviewQueue().catch(() => {});
    });
  }
  if (els.problematicPreviewCb) {
    els.problematicPreviewCb.addEventListener("change", () => {
      state.problematicPreview = els.problematicPreviewCb.checked;
      applyMapRouteVisibility({
        hiddenOperators: state.hiddenOperators,
        disabledLineKeys: state.disabledRouteKeys
      });
    });
  }
  if (els.mergeRouteKeyInput) {
    els.mergeRouteKeyInput.addEventListener("input", renderMergeRouteKeyResults);
    els.mergeRouteKeyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addMergeRoute();
      }
    });
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

  if (els.operatorPreviewAllCb) {
    els.operatorPreviewAllCb.checked = !state.visibilityPreviewAll;
    els.operatorPreviewAllCb.addEventListener("change", () => {
      setVisibilityPreviewAll(!els.operatorPreviewAllCb.checked);
    });
  }
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
    setCityPreview(false);
    return;
  }
  setEditStatus(els.cityPanelStatus, "Loading city…");
  try {
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(key)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || null;
    if (els.cityPanelBody) {
      els.cityPanelBody.hidden = !state.cityPanelCity;
    }
    // Keep any active preset preview in sync with the loaded city.
    setCityPreview(state.cityPreviewKeys instanceof Set && state.cityPanelCity);
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

// Preview the preset on the map: only the city's resolved routes render.
function setCityPreview(enabled) {
  const city = state.cityPanelCity;
  const on = Boolean(enabled) && city && Array.isArray(city.routeKeys);
  state.cityPreviewKeys = on ? new Set(city.routeKeys) : null;
  if (els.cityPreviewCb) {
    els.cityPreviewCb.checked = on;
  }
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
}

function renderCityPanel() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  if (els.cityPanelSummary) {
    const explicit = city.routes || [];
    const includedExplicit = explicit.filter((route) => route.included).length;
    const excludedExplicit = explicit.filter((route) => !route.included).length;
    els.cityPanelSummary.textContent =
      `${city.name || city.slug} · ${city.published ? "Published" : "Draft"} · ` +
      `${city.routeCount || 0} route(s) · ${(city.operators || []).length} operator rule(s) · ` +
      `${includedExplicit} included · ${excludedExplicit} excluded`;
  }
  renderCityOperators();
  renderCityRoutes();
  renderCitySelectedRoute();
  if (els.cityMetaName) {
    els.cityMetaName.value = city.name || "";
  }
  if (els.cityMetaPublished) {
    els.cityMetaPublished.checked = Boolean(city.published);
  }
  if (els.cityMetaPublishBtn) {
    els.cityMetaPublishBtn.hidden = true;
  }
}

function updateCityPublishButton() {
  const button = els.cityMetaPublishBtn;
  const checkbox = els.cityMetaPublished;
  if (!button || !checkbox || !state.cityPanelCity) {
    return;
  }
  const saved = Boolean(state.cityPanelCity.published);
  const current = Boolean(checkbox.checked);
  if (current === saved) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.textContent = current
    ? "Yes, publish this city (visible to users)"
    : "Yes, unpublish this city (keep as draft)";
}

async function saveCityMetadata() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  setEditStatus(els.cityMetaStatus, "Saving…");
  try {
    await apiRequest("/api/admin/cities", {
      method: "POST",
      body: {
        slug: city.slug,
        name: String(els.cityMetaName?.value || "").trim()
      }
    });
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || city;
    renderCityPanel();
    await loadCityPanelList();
    els.cityPanelSelect.value = city.slug;
    setEditStatus(els.cityMetaStatus, "Name updated.");
  } catch (error) {
    setEditStatus(els.cityMetaStatus, `Failed to save: ${error.message}`, true);
  }
}

async function saveCityPublish() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  setEditStatus(els.cityMetaStatus, "Saving…");
  try {
    await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}/publish`, {
      method: "POST",
      body: { published: Boolean(els.cityMetaPublished?.checked) }
    });
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || city;
    renderCityPanel();
    await loadCityPanelList();
    els.cityPanelSelect.value = city.slug;
    setEditStatus(els.cityMetaStatus, "Publish state updated.");
  } catch (error) {
    setEditStatus(els.cityMetaStatus, `Failed to update publish state: ${error.message}`, true);
  }
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
  actions.className = "city-actions-row";

  const selectedProps = state.selectedRouteFeature ? featureLineProps(state.selectedRouteFeature) : null;
  const operatorName = String(selectedProps?.operatorName || "").trim();
  const operatorRule = (city.operators || []).find((op) => op.operatorName === operatorName) || null;
  const operatorIncluded = Boolean(operatorRule) && operatorRule.included !== false;

  const explicitIncluded = explicit?.included === true;
  const explicitExcluded = Boolean(explicit) && !explicit.included;

  // Show only the applicable direction per entity, not both.
  const routeButton = document.createElement("button");
  routeButton.type = "button";
  routeButton.className = "btn btn-subtle";
  if (explicitIncluded) {
    routeButton.textContent = "Exclude route";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: false }]));
  } else if (explicitExcluded) {
    routeButton.textContent = "Include route";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: true }]));
  } else if (operatorIncluded) {
    routeButton.textContent = "Exclude route";
    routeButton.title = "Exclude just this route; the operator rule stays";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: false }]));
  } else {
    routeButton.textContent = "Include route";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: true }]));
  }
  actions.append(routeButton);

  if (operatorName) {
    const opButton = document.createElement("button");
    opButton.type = "button";
    opButton.className = "btn btn-subtle";
    if (operatorIncluded) {
      opButton.textContent = `Exclude operator: ${operatorName}`;
      opButton.title = `Remove every route by ${operatorName} from this city`;
      opButton.addEventListener("click", () => patchCityOperators([{ operatorName, included: false }]));
    } else {
      opButton.textContent = `Include operator: ${operatorName}`;
      opButton.title = `Include every current route by ${operatorName}`;
      opButton.addEventListener("click", () => patchCityOperators([{ operatorName, included: true }]));
    }
    actions.append(opButton);
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
    remove.className = "city-remove-rule";
    remove.textContent = "Remove rule";
    remove.title = "Delete this operator rule (routes may still be added by other rules)";
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
    actions.className = "city-actions-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-subtle";
    toggle.textContent = route.included ? "Exclude" : "Include";
    toggle.addEventListener("click", () =>
      patchCityRoutes([{ lineKey: route.lineKey, included: !route.included }])
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "city-remove-rule";
    remove.textContent = "Remove rule";
    remove.title = "Delete this route rule; an operator rule can add the route again";
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
    if (state.cityPreviewKeys instanceof Set) {
      setCityPreview(true);
    }
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

// Add an operator rule for every operator currently rendered in the viewport.
async function addVisibleOperatorsToCity() {
  if (!state.cityPanelCity) {
    setEditStatus(els.cityPanelStatus, "Select a city first.", true);
    return;
  }
  const features = state.map && state.mapReady
    ? state.map.queryRenderedFeatures({ layers: ["routes-main"] })
    : [];
  const names = new Set();
  for (const feature of features) {
    const name = String(feature.properties?.operator_name || "").trim();
    if (name) {
      names.add(name);
    }
  }
  const existing = new Set((state.cityPanelCity.operators || []).map((entry) => entry.operatorName));
  const toAdd = Array.from(names).filter((name) => !existing.has(name));
  if (!toAdd.length) {
    setEditStatus(els.cityPanelStatus, "No new operators in the current view.", true);
    return;
  }
  await patchCityOperators(toAdd.map((operatorName) => ({ operatorName, included: true })));
  setEditStatus(els.cityPanelStatus, `Added ${toAdd.length} operator rule(s) from the view.`);
}

async function bootApp() {
  await loadCities();
  await loadCityPanelList();
  await initMap();
  state.map.once("load", () => {
    setTimeout(() => {
      loadExistingEdits();
      loadOperatorsForViewport();
      loadReviewQueue();
      loadAdminMerges();
      loadProblematicRoutes();
    }, 1500);
  });
}

// Click a panel heading to fold it away; state persists per panel.
function initCollapsiblePanels() {
  document.querySelectorAll(".override-sidebar .panel").forEach((panel) => {
    const heading = panel.querySelector(":scope > h2");
    if (!heading) {
      return;
    }
    const text = (heading.textContent || "").trim();
    const key = `metromark_admin_panel_${text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    // Sidebar panels start collapsed since there are many of them.
    let collapsed = true;
    try {
      const stored = localStorage.getItem(key);
      if (stored === "1" || stored === "0") {
        collapsed = stored === "1";
      }
    } catch {
      // storage unavailable
    }
    panel.classList.toggle("is-collapsed", collapsed);

    const toggle = () => {
      const next = !panel.classList.contains("is-collapsed");
      panel.classList.toggle("is-collapsed", next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // storage unavailable
      }
    };

    heading.setAttribute("role", "button");
    heading.tabIndex = 0;
    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  });
}

async function init() {
  els.adminEmailInput.value = "";
  els.adminPasswordInput.value = "";
  initCollapsiblePanels();
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
