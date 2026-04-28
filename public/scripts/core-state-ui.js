const MIN_VIEWPORT_FETCH_ZOOM = 10.6;
const MAX_TARGET_TILES_PER_VIEW = 6;
const MAX_NEW_FETCHES_PER_VIEW = 6;
const MAX_PARALLEL_FETCHES = 2;
const MAX_SESSION_AREAS = 220;
const MAX_SESSION_ROUTE_STOP_PAYLOADS = 120;
const MIN_MOVE_FETCH_INTERVAL_MS = 1800;

const ROUTE_STOP_TYPES = [0, 1];
const ROUTE_STOP_TYPES_KEY = ROUTE_STOP_TYPES.join("-");
const ROUTE_STOP_TYPES_QUERY = ROUTE_STOP_TYPES.join(",");

const MODE_FILTER_ALL = "all";
const MODE_FILTER_BUS = "bus";
const MODE_FILTER_FERRY = "ferry";
const MODE_FILTER_METRO = "metro";
const MODE_FILTER_TRAM = "tram";
const MODE_FILTER_RAIL = "rail";
const MODE_FILTER_OTHER = "other";

const MODE_DEFS = [
  { key: MODE_FILTER_ALL, label: "All Modes", routeTypes: [] },
  { key: MODE_FILTER_BUS, label: "Bus", routeTypes: [3, 11] },
  { key: MODE_FILTER_FERRY, label: "Ferries", routeTypes: [4] },
  { key: MODE_FILTER_METRO, label: "Metro", routeTypes: [1] },
  { key: MODE_FILTER_TRAM, label: "Tram", routeTypes: [0] },
  { key: MODE_FILTER_RAIL, label: "Rail", routeTypes: [2] },
  { key: MODE_FILTER_OTHER, label: "Other", routeTypes: [5, 6, 7, 12] }
];

const MODE_DEF_BY_KEY = new Map(MODE_DEFS.map((entry) => [entry.key, entry]));
const DEFAULT_ACTIVE_MODE_KEYS = [MODE_FILTER_ALL];

const FREQUENCY_FILTER_ALL = "all";
const FREQUENCY_FILTER_FREQUENT = "frequent";
const FREQUENCY_FILTER_REGULAR = "regular";
const FREQUENCY_FILTER_LOCAL = "local";
const FREQUENCY_FILTER_UNKNOWN = "unknown";
const DEFAULT_ACTIVE_FREQUENCY_KEYS = [FREQUENCY_FILTER_ALL];

const GTFS_MODE_LABELS = {
  0: "Tram",
  1: "Metro",
  2: "Rail",
  3: "Bus",
  4: "Ferry",
  5: "Cable Tram",
  6: "Aerial",
  7: "Funicular",
  11: "Trolleybus",
  12: "Monorail"
};

function parseSetFromStorage(storageKey, defaults) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return new Set(defaults);
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set(defaults);
    }

    const normalized = parsed.map((value) => String(value || "").trim()).filter(Boolean);
    return normalized.length ? new Set(normalized) : new Set(defaults);
  } catch {
    return new Set(defaults);
  }
}

function persistSetToStorage(storageKey, values) {
  localStorage.setItem(storageKey, JSON.stringify(Array.from(values)));
}

function parseVisibilityOverridesFromStorage(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }

    const visibilityMap = new Map();
    for (const [lineKeyRaw, valueRaw] of Object.entries(parsed)) {
      const lineKey = String(lineKeyRaw || "").trim();
      const value = String(valueRaw || "").trim().toLowerCase();
      if (!lineKey) {
        continue;
      }
      if (value === "on" || value === "off") {
        visibilityMap.set(lineKey, value);
      }
    }

    return visibilityMap;
  } catch {
    return new Map();
  }
}

function persistVisibilityOverridesToStorage(storageKey, visibilityMap) {
  const payload = {};
  for (const [lineKeyRaw, valueRaw] of visibilityMap.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    const value = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (value !== "on" && value !== "off") {
      continue;
    }
    payload[lineKey] = value;
  }

  localStorage.setItem(storageKey, JSON.stringify(payload));
}

const state = {
  map: null,
  mapReady: false,
  mapReadyResolver: null,
  mapMode: "streets",
  token: localStorage.getItem("metromark_token") || "",
  user: null,
  cities: [],
  transit: null,
  lineSummaries: [],
  areaCache: new Map(),
  lineStopsCache: new Map(),
  inFlightLineStopKeys: new Set(),
  inFlightHeadwayLineKeys: new Set(),
  requestedAreaKeys: new Set(),
  visibleAreaKeys: new Set(),
  activeAreaKeys: new Set(),
  fetchQueue: [],
  queuedAreaKeys: new Set(),
  inFlightAreaKeys: new Set(),
  queueDrainRunning: false,
  focusedLineKey: "",
  activeModeKeys: parseSetFromStorage("metromark_mode_filter_keys", DEFAULT_ACTIVE_MODE_KEYS),
  activeFrequencyKeys: parseSetFromStorage(
    "metromark_frequency_filter_keys",
    DEFAULT_ACTIVE_FREQUENCY_KEYS
  ),
  manualLineVisibility: parseVisibilityOverridesFromStorage("metromark_route_visibility_overrides"),
  lineSearchQuery: "",
  initialCitySlug: localStorage.getItem("metromark_initial_city_slug") || "seattle",
  theme: localStorage.getItem("metromark_theme") || "light",
  lastMoveFetchAt: 0,
  activePopup: "",
  hoverPopup: null,
  routeHoverPopup: null,
  routeSelectPopup: null,
  lastStopClickAt: 0,
  lastRouteClickAt: 0,
  mobilePanelsOpen: false,
  userStatusPinnedKind: "",
  clearRouteProgressConfirmLineKey: "",
  clearRouteProgressConfirmTimeoutId: null,
  userFeedback: {
    message: "",
    kind: "neutral"
  },
  visitedByLine: new Map(),
  userStatus: {
    title: "No route selected.",
    subtitle: "Select a route or station.",
    details: [],
    routeLineKey: "",
    progress: null
  },
  clientApiRequestCount: 0,
  transitlandRestApiRequestCount: 0,
  transitlandRestApiFailureCount: 0,
  transitlandVectorTileRequestCount: 0,
  transitlandVectorTileFailureCount: 0,
  transitlandRoutingApiRequestCount: 0,
  transitlandRoutingApiFailureCount: 0,
  loadEpoch: 0,
  lastLoadStats: {
    requested: 0,
    cached: 0,
    queued: 0,
    deferred: 0,
    failed: 0,
    successful: 0
  }
};

const els = {
  statusText: document.getElementById("statusText"),
  statusMeta: document.getElementById("statusMeta"),
  backendStatusText: document.getElementById("backendStatusText"),
  clearSessionCacheBtn: document.getElementById("clearSessionCacheBtn"),
  lineSearch: document.getElementById("lineSearch"),
  modeFilterBar: document.getElementById("modeFilterBar"),
  frequencyFilterBar: document.getElementById("frequencyFilterBar"),
  mobileDrawerTab: document.getElementById("mobileDrawerTab"),
  userStatusTitle: document.getElementById("userStatusTitle"),
  userStatusSubtitle: document.getElementById("userStatusSubtitle"),
  userStatusFeedback: document.getElementById("userStatusFeedback"),
  userStatusDetails: document.getElementById("userStatusDetails"),
  userStatusRouteProgress: document.getElementById("userStatusRouteProgress"),
  userStatusRouteProgressText: document.getElementById("userStatusRouteProgressText"),
  userStatusRouteProgressFill: document.getElementById("userStatusRouteProgressFill"),
  clearRouteProgressBtn: document.getElementById("clearRouteProgressBtn"),
  clearRouteProgressConfirmText: document.getElementById("clearRouteProgressConfirmText"),
  deselectRouteBtn: document.getElementById("deselectRouteBtn"),
  lineList: document.getElementById("lineList"),
  routeListSummary: document.getElementById("routeListSummary"),
  routeListDropdown: document.getElementById("routeListDropdown"),
  progressSummary: document.getElementById("progressSummary"),
  lineProgressList: document.getElementById("lineProgressList"),
  apiRequestCounter: document.getElementById("apiRequestCounter"),
  apiRequestCounterDetail: document.getElementById("apiRequestCounterDetail"),
  streetsModeBtn: document.getElementById("streetsModeBtn"),
  satelliteModeBtn: document.getElementById("satelliteModeBtn"),
  accountPopupBtn: document.getElementById("accountPopupBtn"),
  authPopup: document.getElementById("authPopup"),
  closeAuthPopupBtn: document.getElementById("closeAuthPopupBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  authLoggedOut: document.getElementById("authLoggedOut"),
  authLoggedIn: document.getElementById("authLoggedIn"),
  authFeedback: document.getElementById("authFeedback"),
  currentUserLabel: document.getElementById("currentUserLabel"),
  demoLoginBtn: document.getElementById("demoLoginBtn"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  logoutBtn: document.getElementById("logoutBtn")
};

function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function focusMaskFeatureCollection(active) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-180, -85],
              [180, -85],
              [180, 85],
              [-180, 85],
              [-180, -85]
            ]
          ]
        },
        properties: {
          active: active ? 1 : 0
        }
      }
    ]
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(message, kind = "neutral", meta = "") {
  els.statusText.textContent = message;
  els.statusMeta.textContent = meta;

  els.statusText.classList.remove("error", "ok");
  if (kind === "error") {
    els.statusText.classList.add("error");
  }
  if (kind === "ok") {
    els.statusText.classList.add("ok");
  }
}

function setBackendStatus(message) {
  els.backendStatusText.textContent = String(message || "");
}

function renderApiCounter() {
  els.apiRequestCounter.textContent =
    `Client API calls: ${state.clientApiRequestCount} | ` +
    `Transitland REST: ${state.transitlandRestApiRequestCount}/10000 | ` +
    `Vector Tiles: ${state.transitlandVectorTileRequestCount}/100000 | ` +
    `Routing: ${state.transitlandRoutingApiRequestCount}/1000`;

  if (els.apiRequestCounterDetail) {
    els.apiRequestCounterDetail.textContent =
      `Failures - REST: ${state.transitlandRestApiFailureCount}, ` +
      `Vector Tiles: ${state.transitlandVectorTileFailureCount}, ` +
      `Routing: ${state.transitlandRoutingApiFailureCount}`;
  }
}

function resetClearRouteProgressConfirmation(options = {}) {
  if (state.clearRouteProgressConfirmTimeoutId) {
    window.clearTimeout(state.clearRouteProgressConfirmTimeoutId);
    state.clearRouteProgressConfirmTimeoutId = null;
  }

  state.clearRouteProgressConfirmLineKey = "";

  if (options.renderNow) {
    renderUserStatus();
  }
}

function setStatusPin(kind) {
  state.userStatusPinnedKind = String(kind || "").trim();
}

function clearStatusPin() {
  state.userStatusPinnedKind = "";
}

function setUserFeedback(message, kind = "neutral") {
  state.userFeedback = {
    message: String(message || "").trim(),
    kind
  };

  renderUserFeedback();
}

function renderUserFeedback() {
  if (!els.userStatusFeedback) {
    return;
  }

  const message = String(state.userFeedback?.message || "").trim();

  els.userStatusFeedback.classList.remove("ok", "error");
  if (state.userFeedback?.kind === "ok") {
    els.userStatusFeedback.classList.add("ok");
  }
  if (state.userFeedback?.kind === "error") {
    els.userStatusFeedback.classList.add("error");
  }

  if (!message) {
    els.userStatusFeedback.hidden = true;
    els.userStatusFeedback.textContent = "";
    return;
  }

  els.userStatusFeedback.hidden = false;
  els.userStatusFeedback.textContent =
    message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function renderUserStatus() {
  els.userStatusTitle.textContent = state.userStatus.title;
  els.userStatusSubtitle.textContent = state.userStatus.subtitle;

  if (els.userStatusDetails) {
    els.userStatusDetails.innerHTML = "";
    for (const item of state.userStatus.details || []) {
      if (!item || !item.label || !item.value) {
        continue;
      }

      const dt = document.createElement("dt");
      dt.textContent = String(item.label);
      const dd = document.createElement("dd");
      dd.textContent = String(item.value);
      els.userStatusDetails.append(dt, dd);
    }
  }

  if (els.userStatusRouteProgress && els.userStatusRouteProgressText && els.userStatusRouteProgressFill) {
    const progress = state.userStatus.progress;
    const hasProgress = Boolean(progress) && Number(progress.total || 0) > 0;

    if (hasProgress) {
      const visited = Number(progress.visited || 0);
      const total = Number(progress.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      els.userStatusRouteProgress.hidden = false;
      els.userStatusRouteProgressText.textContent = `${visited}/${total} stations visited (${percent}%)`;
      els.userStatusRouteProgressFill.style.width = `${percent}%`;
    } else {
      els.userStatusRouteProgress.hidden = true;
      els.userStatusRouteProgressText.textContent = "";
      els.userStatusRouteProgressFill.style.width = "0%";
    }
  }

  if (els.clearRouteProgressBtn) {
    const routeLineKey = String(state.userStatus.routeLineKey || state.focusedLineKey || "").trim();
    const showClear = Boolean(state.user) && Boolean(routeLineKey);
    els.clearRouteProgressBtn.hidden = !showClear;
    els.clearRouteProgressBtn.disabled = !showClear;
  }

  if (els.clearRouteProgressConfirmText) {
    const routeLineKey = String(state.userStatus.routeLineKey || state.focusedLineKey || "").trim();
    const pending =
      Boolean(routeLineKey) && state.clearRouteProgressConfirmLineKey === routeLineKey;

    els.clearRouteProgressConfirmText.hidden = !pending;
    els.clearRouteProgressConfirmText.textContent = pending
      ? "Click Clear Route Progress again to confirm reset."
      : "";
  }

  if (els.deselectRouteBtn) {
    els.deselectRouteBtn.hidden = !state.focusedLineKey;
  }

  renderUserFeedback();
}

function setUserStatus(title, subtitle, options = {}) {
  state.userStatus = {
    title: String(title || "").trim() || "No route selected.",
    subtitle: String(subtitle || "").trim() || "Select a route or station.",
    details: Array.isArray(options.details) ? options.details : [],
    routeLineKey: String(options.routeLineKey || "").trim(),
    progress: options.progress || null
  };

  if (Object.prototype.hasOwnProperty.call(options, "feedback")) {
    setUserFeedback(options.feedback, options.feedbackKind || "neutral");
  }

  renderUserStatus();
}

function modeLabelFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }
  return GTFS_MODE_LABELS[numeric] || "Unknown";
}

function modeKeyFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return MODE_FILTER_OTHER;
  }

  if (numeric === 3 || numeric === 11) return MODE_FILTER_BUS;
  if (numeric === 4) return MODE_FILTER_FERRY;
  if (numeric === 1) return MODE_FILTER_METRO;
  if (numeric === 0) return MODE_FILTER_TRAM;
  if (numeric === 2) return MODE_FILTER_RAIL;
  return MODE_FILTER_OTHER;
}

function modeLabelFromModeKey(modeKey) {
  const modeDef = MODE_DEF_BY_KEY.get(modeKey);
  if (modeDef) {
    return modeDef.label;
  }
  return "Unknown";
}

function lineModeKey(line) {
  return modeKeyFromRouteType(line?.routeType);
}

function lineMode(line) {
  return modeLabelFromModeKey(lineModeKey(line));
}

function isBusLikeRouteType(routeType) {
  const numeric = Number(routeType);
  return numeric === 3 || numeric === 11;
}

function isRailLikeRouteType(routeType) {
  const numeric = Number(routeType);
  return numeric === 0 || numeric === 1 || numeric === 2 || numeric === 12;
}

function lineServiceTier(line) {
  const explicit = String(line?.serviceTier || "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  if (isRailLikeRouteType(line?.routeType)) {
    return "rail";
  }

  if (isBusLikeRouteType(line?.routeType)) {
    return "bus";
  }

  return "other";
}

function lineSortWeight(line) {
  const tier = lineServiceTier(line);
  if (tier === "rail") return 0;
  if (tier === "special") return 1;
  if (tier === "other") return 2;
  return 3;
}

function normalizeModeSelection() {
  const valid = new Set(
    Array.from(state.activeModeKeys).filter((modeKey) => MODE_DEF_BY_KEY.has(modeKey))
  );

  if (valid.has(MODE_FILTER_ALL) && valid.size > 1) {
    valid.clear();
    valid.add(MODE_FILTER_ALL);
  }

  if (!valid.size) {
    for (const key of DEFAULT_ACTIVE_MODE_KEYS) {
      valid.add(key);
    }
  }

  state.activeModeKeys = valid;
  persistSetToStorage("metromark_mode_filter_keys", state.activeModeKeys);
}

function normalizeFrequencySelection() {
  const allowed = new Set([
    FREQUENCY_FILTER_ALL,
    FREQUENCY_FILTER_FREQUENT,
    FREQUENCY_FILTER_REGULAR,
    FREQUENCY_FILTER_LOCAL,
    FREQUENCY_FILTER_UNKNOWN
  ]);

  const valid = new Set(
    Array.from(state.activeFrequencyKeys).filter((frequencyKey) => allowed.has(frequencyKey))
  );

  if (!valid.size) {
    valid.add(FREQUENCY_FILTER_ALL);
  }

  const explicitFrequencyCount = [
    FREQUENCY_FILTER_FREQUENT,
    FREQUENCY_FILTER_REGULAR,
    FREQUENCY_FILTER_LOCAL,
    FREQUENCY_FILTER_UNKNOWN
  ].filter((key) => valid.has(key)).length;

  if (!valid.has(FREQUENCY_FILTER_ALL) && explicitFrequencyCount === 4) {
    valid.clear();
    valid.add(FREQUENCY_FILTER_ALL);
  }

  if (valid.has(FREQUENCY_FILTER_ALL) && valid.size > 1) {
    valid.clear();
    valid.add(FREQUENCY_FILTER_ALL);
  }

  state.activeFrequencyKeys = valid;
  persistSetToStorage("metromark_frequency_filter_keys", state.activeFrequencyKeys);
}

function normalizeManualVisibilityOverrides() {
  const normalized = new Map();

  for (const [lineKeyRaw, valueRaw] of state.manualLineVisibility.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    const value = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (value === "on" || value === "off") {
      normalized.set(lineKey, value);
    }
  }

  state.manualLineVisibility = normalized;
  persistVisibilityOverridesToStorage("metromark_route_visibility_overrides", state.manualLineVisibility);
}

function lineVisibilityOverride(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return "";
  }

  const value = String(state.manualLineVisibility.get(normalizedLineKey) || "").trim().toLowerCase();
  return value === "on" || value === "off" ? value : "";
}

function setLineVisibilityOverride(lineKey, value) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "on" || normalizedValue === "off") {
    state.manualLineVisibility.set(normalizedLineKey, normalizedValue);
  } else {
    state.manualLineVisibility.delete(normalizedLineKey);
  }

  persistVisibilityOverridesToStorage("metromark_route_visibility_overrides", state.manualLineVisibility);
}

function lineVisibleFromFilters(line, options = {}) {
  const ignoreMode = Boolean(options.ignoreMode);
  const ignoreFrequency = Boolean(options.ignoreFrequency);

  if (!ignoreMode && !lineMatchesModeSelection(line)) {
    return false;
  }

  if (!ignoreFrequency && !lineMatchesFrequencySelection(line)) {
    return false;
  }

  return true;
}

function lineIsVisible(line, options = {}) {
  const override = lineVisibilityOverride(line?.lineKey);
  if (override === "on") {
    return true;
  }
  if (override === "off") {
    return false;
  }

  return lineVisibleFromFilters(line, options);
}

function selectedRouteTypesForFetch() {
  // Always fetch all route types for the loaded viewport tiles.
  // Mode chips then act as instant client-side visibility filters.
  return [];
}

function modeCacheKeyFromRouteTypes(routeTypes) {
  const normalized = Array.isArray(routeTypes) ? routeTypes : [];
  return normalized.length ? normalized.join("-") : "all";
}

function viewportRequestsForMode(rawBbox, zoom, routeTypes) {
  const selectedTypes = Array.isArray(routeTypes) ? routeTypes : [];
  const modeCacheKey = modeCacheKeyFromRouteTypes(selectedTypes);

  return buildViewportTileRequests(rawBbox, zoom).map((request) => ({
    ...request,
    routeTypes: selectedTypes,
    areaKey: `${request.areaKey}:modes:${modeCacheKey}`
  }));
}

function lineMatchesModeSelection(line) {
  if (state.activeModeKeys.has(MODE_FILTER_ALL)) {
    return true;
  }

  return state.activeModeKeys.has(lineModeKey(line));
}

function lineMatchesFrequencySelection(line) {
  if (state.activeFrequencyKeys.has(FREQUENCY_FILTER_ALL)) {
    return true;
  }

  return state.activeFrequencyKeys.has(lineFrequencyBucket(line));
}

function frequencyBucketFromHeadwayMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return FREQUENCY_FILTER_UNKNOWN;
  }

  if (minutes <= 10) {
    return FREQUENCY_FILTER_FREQUENT;
  }

  if (minutes < 30) {
    return FREQUENCY_FILTER_REGULAR;
  }

  return FREQUENCY_FILTER_LOCAL;
}

function lineHeadwayBestMinutes(line) {
  const minutes = Number(line?.headwayBestMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function lineFrequencyBucket(line) {
  const bestHeadwayMinutes = lineHeadwayBestMinutes(line);
  if (bestHeadwayMinutes !== null) {
    return frequencyBucketFromHeadwayMinutes(bestHeadwayMinutes);
  }

  const explicit = String(line?.frequencyBucket || "").trim().toLowerCase();
  if (
    explicit === FREQUENCY_FILTER_FREQUENT ||
    explicit === FREQUENCY_FILTER_REGULAR ||
    explicit === FREQUENCY_FILTER_LOCAL ||
    explicit === FREQUENCY_FILTER_UNKNOWN
  ) {
    return explicit;
  }

  return FREQUENCY_FILTER_UNKNOWN;
}

function frequencyBucketLabel(bucket) {
  if (bucket === FREQUENCY_FILTER_ALL) return "All Frequencies";
  if (bucket === FREQUENCY_FILTER_FREQUENT) return "Frequent (Up to 10m)";
  if (bucket === FREQUENCY_FILTER_REGULAR) return "Regular (11-29m)";
  if (bucket === FREQUENCY_FILTER_LOCAL) return "Local (30m+)";
  return "Frequency Unknown";
}

function lineHeadwayLabel(line) {
  const bestHeadwayMinutes = lineHeadwayBestMinutes(line);
  if (bestHeadwayMinutes !== null) {
    return `Peak headway ~${bestHeadwayMinutes} min`;
  }

  return frequencyBucketLabel(lineFrequencyBucket(line));
}

function canFetchViewportRoutes() {
  if (!state.mapReady || !state.map) {
    return false;
  }

  return state.map.getZoom() >= MIN_VIEWPORT_FETCH_ZOOM;
}

function areFilterCountsUncertain() {
  if (!canFetchViewportRoutes()) {
    return false;
  }

  return (
    state.inFlightAreaKeys.size > 0 ||
    state.fetchQueue.length > 0 ||
    Number(state.lastLoadStats?.deferred || 0) > 0
  );
}

function filterChipCountLabel(count, uncertain) {
  if (uncertain) {
    return "?";
  }

  const numeric = Number(count);
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : "0";
}

function lineOperatorLabel(line) {
  return String(line.operatorName || line.routeFeedId || "Operator unavailable");
}

function lineDisplayName(line) {
  const shortName = String(line.lineShortName || "").trim();
  const longName = String(line.lineLongName || "").trim();

  if (shortName && longName && !longName.toLowerCase().includes(shortName.toLowerCase())) {
    return `${shortName} | ${longName}`;
  }

  return shortName || longName || line.lineName || "Line";
}

function lineSearchText(line) {
  return [
    line.lineName,
    line.lineShortName,
    line.lineLongName,
    line.routeOnestopId,
    line.headwayBestMinutes,
    lineMode(line),
    lineServiceTier(line),
    frequencyBucketLabel(lineFrequencyBucket(line)),
    lineOperatorLabel(line),
    line.routeFeedId
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function stopLocationTypeLabel(value) {
  const numeric = Number(value);
  if (numeric === 0) return "Platform/Stop";
  if (numeric === 1) return "Station";
  if (numeric === 2) return "Entrance/Exit";
  if (numeric === 3) return "Generic Node";
  if (numeric === 4) return "Boarding Area";
  return "Unknown";
}

function lineLikeFromFeatureProperties(properties) {
  const headwayBestMinutes = Number(
    properties?.headway_best_minutes ?? properties?.headwayBestMinutes
  );

  return {
    lineKey: String(properties?.line_key || properties?.lineKey || "").trim(),
    lineName: properties?.line_name || properties?.lineName,
    lineShortName: properties?.line_short_name || properties?.lineShortName,
    lineLongName: properties?.line_long_name || properties?.lineLongName,
    operatorName: properties?.operator_name || properties?.operatorName,
    mode: properties?.mode,
    routeType: Number(properties?.route_type ?? properties?.routeType),
    routeFeedId: properties?.route_feed_id || properties?.routeFeedId,
    frequencyBucket: properties?.frequency_bucket || properties?.frequencyBucket,
    headwayBestMinutes: Number.isFinite(headwayBestMinutes) ? headwayBestMinutes : null,
    stopCount: Number((properties?.stop_count ?? properties?.stopCount) || 0)
  };
}

function lineFromPropertiesForHover(properties) {
  const lineKey = String(properties?.line_key || properties?.lineKey || "").trim();
  if (lineKey) {
    const fromSummary = state.lineSummaries.find((entry) => entry.lineKey === lineKey);
    if (fromSummary) {
      return fromSummary;
    }
  }

  return lineLikeFromFeatureProperties(properties);
}

function stopHoverHtml(properties) {
  const lineLabel = [properties.line_short_name, properties.line_long_name || properties.line_name]
    .filter(Boolean)
    .join(" | ");

  const line = lineFromPropertiesForHover(properties);
  const operatorLabel = lineOperatorLabel(line);
  const modeLabel = lineMode(line);
  const hubCount = Math.max(1, Number(properties.hub_member_count || 1));
  const visited = Number(properties.visited) === 1;
  const progressLabel = state.user
    ? visited
      ? "Visited"
      : "Not visited"
    : "Sign in to track progress";

  return `
    <div class="station-hover">
      <h4>${escapeHtml(properties.station_name || "Unnamed Station")}</h4>
      <p class="hover-subtitle">${escapeHtml(
        lineLabel || properties.line_name || properties.line_key || "Route details"
      )}</p>
      <dl class="hover-grid">
        <dt>Mode</dt>
        <dd>${escapeHtml(modeLabel)}</dd>
        <dt>Operator</dt>
        <dd>${escapeHtml(operatorLabel)}</dd>
        <dt>Frequency</dt>
        <dd>${escapeHtml(lineHeadwayLabel(line))}</dd>
        <dt>Stop Type</dt>
        <dd>${escapeHtml(stopLocationTypeLabel(properties.stop_location_type))}</dd>
        <dt>Hub</dt>
        <dd>${hubCount} linked stops</dd>
        <dt>Status</dt>
        <dd>${escapeHtml(progressLabel)}</dd>
      </dl>
    </div>
  `;
}

function lineHoverHtml(lines, totalLineCount = lines.length) {
  const rows = lines
    .map(
      (line) =>
        `<li class="hover-route-row">
          <p class="hover-route-name">${escapeHtml(lineDisplayName(line))}</p>
          <p class="hover-route-meta">${escapeHtml(lineMode(line))} | ${escapeHtml(
          lineOperatorLabel(line)
        )} | ${escapeHtml(lineHeadwayLabel(line))}${
          Number(line.stopCount || 0) > 0 ? ` | ${Number(line.stopCount)} stops` : ""
        }</p>
        </li>`
    )
    .join("");

  const hiddenCount = Math.max(0, Number(totalLineCount || 0) - lines.length);

  return `
    <div class="station-hover">
      <h4>Routes Under Cursor</h4>
      <p class="hover-subtitle">${
        totalLineCount > 1
          ? "Interlined segment. Tap/click to pick a route."
          : "Tap/click to focus this route."
      }</p>
      <ul class="hover-route-list">${rows || "<li class=\"hover-route-row\">No route details available.</li>"}</ul>
      ${
        hiddenCount > 0
          ? `<p class="hover-subtitle">+${hiddenCount} more route${hiddenCount === 1 ? "" : "s"} at this location</p>`
          : ""
      }
    </div>
  `;
}

function routeSelectionPopupHtml(lines) {
  const rows = lines
    .map(
      (line) =>
        `<button class="route-select-btn" type="button" data-route-select="${escapeHtml(
          line.lineKey
        )}">
          <span class="route-select-name">${escapeHtml(lineDisplayName(line))}</span>
          <span class="route-select-meta">${escapeHtml(lineMode(line))} | ${escapeHtml(
          lineOperatorLabel(line)
        )} | ${escapeHtml(lineHeadwayLabel(line))}</span>
        </button>`
    )
    .join("");

  return `
    <div class="station-hover route-select-popup">
      <h4>Select Route</h4>
      <p class="hover-subtitle">${lines.length} routes overlap here.</p>
      <div class="route-select-list">${rows}</div>
    </div>
  `;
}

function closeRouteSelectionPopup() {
  if (state.routeSelectPopup) {
    state.routeSelectPopup.remove();
  }
}

function openRouteSelectionPopup(lines, lngLat) {
  if (!state.routeSelectPopup || !state.map) {
    return;
  }

  closeRouteSelectionPopup();
  state.routeSelectPopup.setLngLat(lngLat).setHTML(routeSelectionPopupHtml(lines)).addTo(state.map);

  const popupElement = state.routeSelectPopup.getElement();
  if (!popupElement) {
    return;
  }

  const buttons = popupElement.querySelectorAll("[data-route-select]");
  buttons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const lineKey = String(button.getAttribute("data-route-select") || "").trim();
      if (!lineKey) {
        return;
      }

      closeRouteSelectionPopup();
      setFocusedLine(lineKey).catch((error) => {
        setStatus(error.message, "error");
      });
    });
  });
}

function lineProgressMetrics(lineKey, fallbackTotal = 0) {
  const normalizedLineKey = String(lineKey || "").trim();
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(normalizedLineKey));
  const stopFeatures = Array.isArray(cacheEntry?.payload?.stopsGeoJson?.features)
    ? cacheEntry.payload.stopsGeoJson.features
    : [];

  const stationKeys = new Set();
  for (const feature of stopFeatures) {
    const stationKey = String(feature?.properties?.station_key || "").trim();
    if (stationKey) {
      stationKeys.add(stationKey);
    }
  }

  const fallback = Number(fallbackTotal);
  const total = stationKeys.size > 0 ? stationKeys.size : Number.isFinite(fallback) ? fallback : 0;
  const visitedSet = getVisitedSetForLine(normalizedLineKey);

  let visited = 0;
  if (stationKeys.size > 0) {
    for (const stationKey of visitedSet) {
      if (stationKeys.has(stationKey)) {
        visited += 1;
      }
    }
  } else {
    visited = visitedSet.size;
  }

  if (total > 0) {
    visited = Math.min(visited, total);
  }

  const percent = total > 0 ? (visited / total) * 100 : 0;
  return {
    visited,
    total,
    percent
  };
}

function setUserStatusFromLine(line) {
  if (!line) {
    setUserStatus("No route selected.", "Select a route or station.", {
      details: [],
      feedback: ""
    });
    return;
  }

  clearStatusPin();

  const progress = lineProgressMetrics(line.lineKey, Number(line.stopCount || 0));
  const focusedLineActions = state.focusedLineKey === line.lineKey ? line.lineKey : "";

  setUserStatus(lineDisplayName(line), `${lineMode(line)} Line`, {
    details: [
      {
        label: "Operator",
        value: lineOperatorLabel(line)
      },
      {
        label: "Frequency",
        value: lineHeadwayLabel(line)
      },
      {
        label: "Stops",
        value: progress.total > 0 ? `${progress.total} route stations loaded` : "Stops not loaded yet"
      }
    ],
    routeLineKey: focusedLineActions,
    progress,
    feedback: ""
  });
}

function setUserStatusFromStation(properties, extraMessage = "") {
  const stationName = String(properties?.station_name || "Unnamed Station");
  const lineLabel = [properties?.line_short_name, properties?.line_long_name || properties?.line_name]
    .filter(Boolean)
    .join(" | ");
  const lineDescriptor = lineLabel || properties?.line_name || properties?.line_key || "Unknown line";

  const relatedLineKey = String(properties?.line_key || "").trim();
  const relatedLine = state.lineSummaries.find((entry) => entry.lineKey === relatedLineKey);
  const stationHeadwayLine = relatedLine || lineFromPropertiesForHover(properties);
  const progress = relatedLine
    ? lineProgressMetrics(relatedLineKey, Number(relatedLine.stopCount || 0))
    : null;

  setUserStatus(stationName, `Station on ${lineDescriptor}`, {
    details: [
      {
        label: "Line",
        value: lineDescriptor
      },
      {
        label: "Operator",
        value: relatedLine ? lineOperatorLabel(relatedLine) : "Operator unavailable"
      },
      {
        label: "Frequency",
        value: lineHeadwayLabel(stationHeadwayLine)
      },
      {
        label: "Stop type",
        value: stopLocationTypeLabel(properties?.stop_location_type)
      },
      {
        label: "Hub",
        value: `${Number(properties?.hub_member_count || 1)} linked stops`
      }
    ],
    routeLineKey: state.focusedLineKey === relatedLineKey ? relatedLineKey : "",
    progress,
    feedback: extraMessage || ""
  });

  setStatusPin("station");
}

function restoreUserStatusFromFocus() {
  if (state.userStatusPinnedKind === "station") {
    return;
  }

  if (!state.focusedLineKey) {
    const shownLines = getShownLines();
    setUserStatus("No route selected.", "Select a route or station.", {
      details: [
        {
          label: "Visible Routes",
          value: `${shownLines.length} Matching Current Filters`
        }
      ],
      feedback: ""
    });
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === state.focusedLineKey);
  setUserStatusFromLine(line);
}

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", state.theme);
  localStorage.setItem("metromark_theme", state.theme);
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function hoverInteractionsEnabled() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isPortraitMobileLayout() {
  return window.matchMedia("(max-width: 900px) and (orientation: portrait)").matches;
}

function setMobilePanelsOpen(open) {
  const nextOpen = Boolean(open) && isPortraitMobileLayout();
  state.mobilePanelsOpen = nextOpen;

  document.body.classList.toggle("mobile-panels-open", nextOpen);

  if (els.mobileDrawerTab) {
    els.mobileDrawerTab.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    els.mobileDrawerTab.setAttribute("aria-label", nextOpen ? "Close panels" : "Open panels");
    els.mobileDrawerTab.classList.toggle("is-open", nextOpen);
    els.mobileDrawerTab.textContent = nextOpen ? "<" : ">";
  }
}

function syncMobilePanelLayout() {
  if (!isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
    return;
  }

  setMobilePanelsOpen(state.mobilePanelsOpen);
}

function setActivePopup(name) {
  const next = state.activePopup === name ? "" : name;
  state.activePopup = next;

  if (next === "account" && isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
  }

  els.authPopup.hidden = next !== "account";
  els.accountPopupBtn.classList.toggle("btn-primary", next === "account");
  els.accountPopupBtn.setAttribute("aria-expanded", next === "account" ? "true" : "false");
}

function closePopups() {
  setActivePopup("");
}

function setToken(token) {
  state.token = token || "";
  if (state.token) {
    localStorage.setItem("metromark_token", state.token);
  } else {
    localStorage.removeItem("metromark_token");
  }
}

async function apiRequest(path, options = {}) {
  state.clientApiRequestCount += 1;
  renderApiCounter();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));

  const nextRestRequests = Number(payload?.transitlandRestApiRequests);
  const nextRestFailures = Number(payload?.transitlandRestApiRequestFailures);
  const nextVectorRequests = Number(payload?.transitlandVectorTileRequests);
  const nextVectorFailures = Number(payload?.transitlandVectorTileRequestFailures);
  const nextRoutingRequests = Number(payload?.transitlandRoutingApiRequests);
  const nextRoutingFailures = Number(payload?.transitlandRoutingApiRequestFailures);

  if (Number.isFinite(nextRestRequests) && nextRestRequests >= 0) {
    state.transitlandRestApiRequestCount = nextRestRequests;
  }
  if (Number.isFinite(nextRestFailures) && nextRestFailures >= 0) {
    state.transitlandRestApiFailureCount = nextRestFailures;
  }
  if (Number.isFinite(nextVectorRequests) && nextVectorRequests >= 0) {
    state.transitlandVectorTileRequestCount = nextVectorRequests;
  }
  if (Number.isFinite(nextVectorFailures) && nextVectorFailures >= 0) {
    state.transitlandVectorTileFailureCount = nextVectorFailures;
  }
  if (Number.isFinite(nextRoutingRequests) && nextRoutingRequests >= 0) {
    state.transitlandRoutingApiRequestCount = nextRoutingRequests;
  }
  if (Number.isFinite(nextRoutingFailures) && nextRoutingFailures >= 0) {
    state.transitlandRoutingApiFailureCount = nextRoutingFailures;
  }
  renderApiCounter();

  if (!response.ok) {
    const message = payload.error || payload.detail || `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

