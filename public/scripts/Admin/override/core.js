// Admin Map Editor — shared state, DOM cache, session/API helpers, action toast, rebuild watch, manual-edits log.
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
  stopOrderStatus: document.getElementById("stopOrderStatus"),
  adminModeFilter: document.getElementById("adminModeFilter"),
  adminFrequencyFilter: document.getElementById("adminFrequencyFilter"),
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
  adminModeFilter: new Set(),
  adminFrequencyFilter: new Set(),
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
