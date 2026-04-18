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
  routeVisibilityProgressByLine: new Map(),
  routeVisibilityAnimationFrameId: 0,
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
  if (state.activeModeKeys.has(MODE_FILTER_ALL)) {
    return [];
  }

  const selectedRouteTypes = new Set();

  for (const modeKey of state.activeModeKeys) {
    const modeDef = MODE_DEF_BY_KEY.get(modeKey);
    if (!modeDef) {
      continue;
    }

    for (const routeType of modeDef.routeTypes || []) {
      selectedRouteTypes.add(routeType);
    }
  }

  return Array.from(selectedRouteTypes).sort((a, b) => a - b);
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
          label: "Visible routes",
          value: `${shownLines.length} matching current filters`
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

function createMapStyle() {
  return {
    version: 8,
    projection: {
      type: "globe"
    },
    sources: {
      streets: {
        type: "raster",
        tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
      },
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        tileSize: 256,
        attribution: "Esri"
      }
    },
    layers: [
      {
        id: "streets-base",
        type: "raster",
        source: "streets"
      },
      {
        id: "satellite-base",
        type: "raster",
        source: "satellite",
        layout: {
          visibility: "none"
        }
      }
    ]
  };
}

function updateMapModeButtons() {
  const streetsActive = state.mapMode === "streets";
  els.streetsModeBtn.classList.toggle("btn-primary", streetsActive);
  els.satelliteModeBtn.classList.toggle("btn-primary", !streetsActive);
}

function setMapMode(mode) {
  state.mapMode = mode;
  if (!state.map || !state.map.getLayer("satellite-base")) {
    return;
  }

  state.map.setLayoutProperty("satellite-base", "visibility", mode === "satellite" ? "visible" : "none");
  updateMapModeButtons();
}

function mapBoundsToBbox() {
  if (!state.map) {
    return null;
  }

  const bounds = state.map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = clamp(bounds.getSouth(), -85, 85);
  const north = clamp(bounds.getNorth(), -85, 85);

  if (west > east) {
    return null;
  }

  return [west, south, east, north];
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function normalizeBboxArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length !== 4) {
    return null;
  }

  const parsed = candidate.map((value) => Number(value));
  if (parsed.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [west, south, east, north] = parsed;
  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cacheEntryBbox(cacheKey, entry) {
  const payload = entry?.payload;
  const fromArea =
    normalizeBboxArray(payload?.area?.bbox) ||
    normalizeBboxArray(payload?.normalizedBbox) ||
    normalizeBboxArray(payload?.bbox);

  if (fromArea) {
    return fromArea;
  }

  const tileMatch = /^tile:(\d+):(\d+):(\d+):modes:/.exec(String(cacheKey || ""));
  if (!tileMatch) {
    return null;
  }

  const zoom = Number.parseInt(tileMatch[1], 10);
  const x = Number.parseInt(tileMatch[2], 10);
  const y = Number.parseInt(tileMatch[3], 10);

  if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return tileToBbox(x, y, zoom);
}

function visibleCachedAreaKeysForViewport(rawBbox, routeTypes) {
  const normalizedViewportBbox = normalizeBboxArray(rawBbox);
  if (!normalizedViewportBbox) {
    return new Set();
  }

  const modeSuffix = `:modes:${modeCacheKeyFromRouteTypes(routeTypes)}`;
  const visible = new Set();

  for (const [cacheKey, entry] of state.areaCache.entries()) {
    if (!String(cacheKey).endsWith(modeSuffix)) {
      continue;
    }

    const cachedBbox = cacheEntryBbox(cacheKey, entry);
    if (!cachedBbox) {
      continue;
    }

    if (bboxIntersects(normalizedViewportBbox, cachedBbox)) {
      visible.add(cacheKey);
    }
  }

  return visible;
}

function expandBbox(bbox, paddingDegrees) {
  return [
    clamp(bbox[0] - paddingDegrees, -180, 180),
    clamp(bbox[1] - paddingDegrees, -85, 85),
    clamp(bbox[2] + paddingDegrees, -180, 180),
    clamp(bbox[3] + paddingDegrees, -85, 85)
  ];
}

function tileZoomFromMapZoom(zoom) {
  if (zoom >= 13) return 12;
  if (zoom >= 11) return 11;
  if (zoom >= 9) return 10;
  if (zoom >= 7) return 9;
  return 8;
}

function lngLatToTile(lon, lat, zoom) {
  const latClamped = clamp(lat, -85.05112878, 85.05112878);
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  return {
    x,
    y: clamp(y, 0, n - 1)
  };
}

function tileToBbox(x, y, zoom) {
  const n = 2 ** zoom;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;

  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));

  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;

  return [west, south, east, north];
}

function normalizeTileX(x, zoom) {
  const n = 2 ** zoom;
  return ((x % n) + n) % n;
}

function normalizeTileY(y, zoom) {
  const n = 2 ** zoom;
  return clamp(y, 0, n - 1);
}

function bboxQueryText(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function buildViewportTileRequests(rawBbox, zoom) {
  const tileZoom = tileZoomFromMapZoom(zoom);
  const padded = expandBbox(rawBbox, 0.18);
  const center = bboxCenter(rawBbox);
  const centerTile = lngLatToTile(center[0], center[1], tileZoom);

  const northWest = lngLatToTile(padded[0], padded[3], tileZoom);
  const southEast = lngLatToTile(padded[2], padded[1], tileZoom);

  const minX = Math.min(northWest.x, southEast.x) - 1;
  const maxX = Math.max(northWest.x, southEast.x) + 1;
  const minY = Math.min(northWest.y, southEast.y) - 1;
  const maxY = Math.max(northWest.y, southEast.y) + 1;

  const requestsByKey = new Map();

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const nx = normalizeTileX(x, tileZoom);
      const ny = normalizeTileY(y, tileZoom);
      const areaKey = `tile:${tileZoom}:${nx}:${ny}`;
      if (requestsByKey.has(areaKey)) {
        continue;
      }

      const bbox = tileToBbox(nx, ny, tileZoom);
      const dx = nx - centerTile.x;
      const dy = ny - centerTile.y;
      const distanceScore = dx * dx + dy * dy;

      requestsByKey.set(areaKey, {
        areaKey,
        bbox,
        zoom,
        distanceScore
      });
    }
  }

  return Array.from(requestsByKey.values())
    .sort((a, b) => a.distanceScore - b.distanceScore)
    .slice(0, MAX_TARGET_TILES_PER_VIEW);
}

function mergeStopFeature(existing, incoming) {
  return {
    ...incoming,
    properties: {
      ...existing.properties,
      ...incoming.properties,
      source_count: Math.max(
        Number(existing.properties.source_count || 1),
        Number(incoming.properties.source_count || 1)
      ),
      hub_member_count: Math.max(
        Number(existing.properties.hub_member_count || 1),
        Number(incoming.properties.hub_member_count || 1)
      ),
      hub_spread_m: Math.max(
        Number(existing.properties.hub_spread_m || 0),
        Number(incoming.properties.hub_spread_m || 0)
      ),
      distance_m: Math.min(
        Number(existing.properties.distance_m || 0),
        Number(incoming.properties.distance_m || 0)
      )
    }
  };
}

function cacheAreaPayload(cacheKey, payload, cacheStatus) {
  state.areaCache.set(cacheKey, {
    cacheKey,
    payload,
    cacheStatus,
    lastUsedAt: Date.now()
  });

  pruneAreaCache();
}

function pruneAreaCache() {
  if (state.areaCache.size <= MAX_SESSION_AREAS) {
    return;
  }

  const protectedKeys = new Set([
    ...state.requestedAreaKeys,
    ...state.inFlightAreaKeys,
    ...state.queuedAreaKeys
  ]);

  const sorted = Array.from(state.areaCache.entries()).sort(
    (a, b) => Number(a[1].lastUsedAt || 0) - Number(b[1].lastUsedAt || 0)
  );

  for (const [key] of sorted) {
    if (state.areaCache.size <= MAX_SESSION_AREAS) {
      break;
    }
    if (protectedKeys.has(key)) {
      continue;
    }
    state.areaCache.delete(key);
  }
}

function routeStopCacheKey(lineKey) {
  return `${String(lineKey || "")}|types:${ROUTE_STOP_TYPES_KEY}`;
}

function pruneLineStopsCache() {
  if (state.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
    return;
  }

  const focusedCacheKey = state.focusedLineKey ? routeStopCacheKey(state.focusedLineKey) : "";

  const sorted = Array.from(state.lineStopsCache.entries()).sort(
    (a, b) => Number(a[1]?.lastUsedAt || 0) - Number(b[1]?.lastUsedAt || 0)
  );

  for (const [cacheKey] of sorted) {
    if (state.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
      break;
    }
    if (cacheKey === focusedCacheKey || state.inFlightLineStopKeys.has(cacheKey)) {
      continue;
    }
    state.lineStopsCache.delete(cacheKey);
  }
}

function syncActiveAreaKeys(options = {}) {
  const now = Date.now();
  const retainedVisibleKeys = options.retainVisibleKeys || null;

  state.activeAreaKeys = new Set(state.areaCache.keys());
  state.visibleAreaKeys = new Set();

  for (const key of state.requestedAreaKeys) {
    const entry = state.areaCache.get(key);
    if (!entry) {
      continue;
    }

    entry.lastUsedAt = now;
    state.visibleAreaKeys.add(key);
  }

  if (retainedVisibleKeys instanceof Set && options.mergeRetainedVisibleKeys) {
    for (const key of retainedVisibleKeys) {
      if (state.areaCache.has(key) && state.requestedAreaKeys.has(key)) {
        state.visibleAreaKeys.add(key);
      }
    }
  } else if (state.visibleAreaKeys.size === 0 && retainedVisibleKeys instanceof Set) {
    for (const key of retainedVisibleKeys) {
      if (state.areaCache.has(key) && state.requestedAreaKeys.has(key)) {
        state.visibleAreaKeys.add(key);
      }
    }
  }

  if (state.visibleAreaKeys.size === 0 && options.fallbackToAllCached) {
    state.visibleAreaKeys = new Set(state.activeAreaKeys);
  }
}

function resetViewAggregation() {
  if (state.routeVisibilityAnimationFrameId) {
    window.cancelAnimationFrame(state.routeVisibilityAnimationFrameId);
    state.routeVisibilityAnimationFrameId = 0;
  }
  state.routeVisibilityProgressByLine.clear();

  state.loadEpoch += 1;
  state.requestedAreaKeys = new Set();
  state.visibleAreaKeys = new Set();
  state.activeAreaKeys = new Set();
  state.fetchQueue = [];
  state.queuedAreaKeys.clear();
  state.focusedLineKey = "";
  state.lastLoadStats = {
    requested: 0,
    cached: 0,
    queued: 0,
    deferred: 0,
    failed: 0,
    successful: 0
  };
}

function rebuildCombinedTransit() {
  if (state.activeAreaKeys.size === 0) {
    state.routeVisibilityProgressByLine.clear();
    state.transit = null;
    state.lineSummaries = [];
    state.focusedLineKey = "";
    return;
  }

  const mergeLineEntries = (existing, line) => {
    const existingHeadway = Number(existing?.headwayBestMinutes);
    const lineHeadway = Number(line?.headwayBestMinutes);
    const mergedHeadwayBestMinutes = Number.isFinite(existingHeadway)
      ? existingHeadway
      : Number.isFinite(lineHeadway)
        ? lineHeadway
        : null;

    const existingBucket = String(existing?.frequencyBucket || "").trim().toLowerCase();
    const lineBucket = String(line?.frequencyBucket || "").trim().toLowerCase();

    let mergedFrequencyBucket = "unknown";
    if (Number.isFinite(mergedHeadwayBestMinutes)) {
      mergedFrequencyBucket = frequencyBucketFromHeadwayMinutes(mergedHeadwayBestMinutes);
    } else if (existingBucket && existingBucket !== "unknown") {
      mergedFrequencyBucket = existingBucket;
    } else if (lineBucket) {
      mergedFrequencyBucket = lineBucket;
    }

    return {
      ...(existing || {}),
      ...(line || {}),
      routeOnestopId: existing?.routeOnestopId || line?.routeOnestopId || "",
      lineName: existing?.lineName || line?.lineName || "",
      lineShortName: existing?.lineShortName || line?.lineShortName || "",
      lineLongName: existing?.lineLongName || line?.lineLongName || "",
      operatorName: existing?.operatorName || line?.operatorName || "",
      mode: existing?.mode || line?.mode || modeLabelFromRouteType(line?.routeType),
      routeType: Number.isFinite(Number(existing?.routeType))
        ? Number(existing.routeType)
        : Number.isFinite(Number(line?.routeType))
          ? Number(line.routeType)
          : null,
      routeFeedId: existing?.routeFeedId || line?.routeFeedId || "",
      serviceTier: existing?.serviceTier || line?.serviceTier || lineServiceTier(line),
      frequencyBucket: mergedFrequencyBucket,
      headwayBestMinutes: Number.isFinite(mergedHeadwayBestMinutes)
        ? Number(mergedHeadwayBestMinutes)
        : null,
      headwaySource: existing?.headwaySource || line?.headwaySource || "",
      headwayChecked: Number(existing?.headwayChecked || line?.headwayChecked || 0) === 1 ? 1 : 0,
      color: existing?.color || line?.color
    };
  };

  const routeByLine = new Map();
  const lineByKeyAll = new Map();
  const visibleLineKeys = new Set();

  for (const cacheKey of state.activeAreaKeys) {
    const payload = state.areaCache.get(cacheKey)?.payload;
    if (!payload) {
      continue;
    }

    for (const feature of payload?.routesGeoJson?.features || []) {
      const lineKey = feature?.properties?.line_key;
      if (!lineKey) {
        continue;
      }
      if (!routeByLine.has(lineKey)) {
        routeByLine.set(lineKey, feature);
      }
    }

    for (const line of payload?.lineSummaries || []) {
      const lineKey = line?.lineKey;
      if (!lineKey) {
        continue;
      }

      const merged = mergeLineEntries(lineByKeyAll.get(lineKey), line);
      lineByKeyAll.set(lineKey, merged);

      if (state.visibleAreaKeys.has(cacheKey)) {
        visibleLineKeys.add(lineKey);
      }
    }
  }

  if (state.focusedLineKey && !lineByKeyAll.has(state.focusedLineKey)) {
    state.focusedLineKey = "";
  }

  const stopByLineAndStation = new Map();
  const activeStopTypeKey = ROUTE_STOP_TYPES_KEY;
  const now = Date.now();

  for (const entry of state.lineStopsCache.values()) {
    if (!entry || entry.stopTypesKey !== activeStopTypeKey) {
      continue;
    }

    if (!lineByKeyAll.has(entry.lineKey)) {
      continue;
    }

    entry.lastUsedAt = now;

    for (const feature of entry.payload?.stopsGeoJson?.features || []) {
      const lineKey = feature?.properties?.line_key;
      const stationKey = feature?.properties?.station_key;
      if (!lineKey || !stationKey) {
        continue;
      }

      const stopKey = `${lineKey}|${stationKey}`;
      if (!stopByLineAndStation.has(stopKey)) {
        stopByLineAndStation.set(stopKey, feature);
      } else {
        stopByLineAndStation.set(stopKey, mergeStopFeature(stopByLineAndStation.get(stopKey), feature));
      }
    }
  }

  const stopCountsByLine = new Map();
  for (const feature of stopByLineAndStation.values()) {
    const lineKey = feature?.properties?.line_key;
    if (!lineKey) {
      continue;
    }
    stopCountsByLine.set(lineKey, (stopCountsByLine.get(lineKey) || 0) + 1);
  }

  const allowGlobalFallbackLines = state.requestedAreaKeys.size === 0;
  const effectiveVisibleLineKeys =
    visibleLineKeys.size > 0
      ? visibleLineKeys
      : allowGlobalFallbackLines
        ? new Set(Array.from(lineByKeyAll.keys()))
        : new Set();

  const lineSummaries = Array.from(effectiveVisibleLineKeys)
    .map((lineKey) => {
      const line = lineByKeyAll.get(lineKey);
      if (!line) {
        return null;
      }

      return {
        ...line,
        lineKey,
        routeOnestopId: line.routeOnestopId || "",
        stopCount: stopCountsByLine.get(lineKey) || Number(line.stopCount || 0) || 0,
        mode: line.mode || modeLabelFromRouteType(line.routeType),
        serviceTier: line.serviceTier || lineServiceTier(line),
        frequencyBucket: line.frequencyBucket || lineFrequencyBucket(line),
        headwayBestMinutes: lineHeadwayBestMinutes(line),
        headwaySource: String(line.headwaySource || ""),
        headwayChecked: Number(line.headwayChecked || 0) === 1 ? 1 : 0
      };
    })
    .filter(Boolean);

  lineSummaries.sort((a, b) => {
    const tierDiff = lineSortWeight(a) - lineSortWeight(b);
    if (tierDiff !== 0) {
      return tierDiff;
    }

    const stopDiff = Number(b.stopCount || 0) - Number(a.stopCount || 0);
    if (stopDiff !== 0) {
      return stopDiff;
    }
    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  state.transit = {
    routesGeoJson: {
      type: "FeatureCollection",
      features: Array.from(routeByLine.values())
    },
    stopsGeoJson: {
      type: "FeatureCollection",
      features: Array.from(stopByLineAndStation.values())
    }
  };
  state.lineSummaries = lineSummaries;
}

function getShownLines(options = {}) {
  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const ignoreFrequency = Boolean(options.ignoreFrequency);
  const ignoreSearch = options.ignoreSearch === undefined ? true : Boolean(options.ignoreSearch);

  const filtered = state.lineSummaries.filter((line) => {
    if (!lineIsVisible(line, { ignoreFrequency })) {
      return false;
    }

    if (!ignoreSearch && query && !lineSearchText(line).includes(query)) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const tierDiff = lineSortWeight(a) - lineSortWeight(b);
    if (tierDiff !== 0) {
      return tierDiff;
    }

    const stopDiff = Number(b.stopCount || 0) - Number(a.stopCount || 0);
    if (stopDiff !== 0) {
      return stopDiff;
    }
    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  return filtered;
}

function getRouteListLines() {
  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const hasQuery = Boolean(query);

  const listed = state.lineSummaries.filter((line) => {
    if (hasQuery) {
      return lineSearchText(line).includes(query);
    }

    if (lineVisibilityOverride(line.lineKey)) {
      return true;
    }

    return lineIsVisible(line);
  });

  listed.sort((a, b) => {
    const tierDiff = lineSortWeight(a) - lineSortWeight(b);
    if (tierDiff !== 0) {
      return tierDiff;
    }

    const stopDiff = Number(b.stopCount || 0) - Number(a.stopCount || 0);
    if (stopDiff !== 0) {
      return stopDiff;
    }

    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  return listed;
}

function getVisibleLineKeys(shownLines) {
  return new Set(shownLines.map((line) => line.lineKey));
}

function pruneRouteVisibilityProgress(validLineKeys) {
  for (const lineKey of state.routeVisibilityProgressByLine.keys()) {
    if (!validLineKeys.has(lineKey)) {
      state.routeVisibilityProgressByLine.delete(lineKey);
    }
  }
}

function visibilityProgressForLine(lineKey, targetVisible) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      progress: targetVisible ? 1 : 0,
      needsAnimation: false
    };
  }

  const target = targetVisible ? 1 : 0;
  const existing = Number(state.routeVisibilityProgressByLine.get(normalizedLineKey));
  const current = Number.isFinite(existing) ? clamp(existing, 0, 1) : targetVisible ? 0 : 0;

  let next = current;
  if (Math.abs(target - current) <= 0.015) {
    next = target;
  } else {
    next = Number((current + (target - current) * 0.26).toFixed(4));
  }

  state.routeVisibilityProgressByLine.set(normalizedLineKey, next);

  return {
    progress: next,
    needsAnimation: next !== target
  };
}

function scheduleRouteVisibilityAnimationFrame() {
  if (state.routeVisibilityAnimationFrameId) {
    return;
  }

  state.routeVisibilityAnimationFrameId = window.requestAnimationFrame(() => {
    state.routeVisibilityAnimationFrameId = 0;
    renderMapData();
  });
}

function getVisitedSetForLine(lineKey) {
  const set = state.visitedByLine.get(lineKey);
  if (set) {
    return set;
  }
  const fresh = new Set();
  state.visitedByLine.set(lineKey, fresh);
  return fresh;
}

function getFilteredData() {
  if (!state.transit) {
    return {
      routes: emptyFeatureCollection(),
      stops: emptyFeatureCollection(),
      shownLines: [],
      needsAnimation: false
    };
  }

  const shownLines = getShownLines();
  const visibleLineKeys = getVisibleLineKeys(shownLines);
  const allowedStopTypes = new Set(ROUTE_STOP_TYPES);
  const hasFocus = Boolean(state.focusedLineKey) && visibleLineKeys.has(state.focusedLineKey);
  const allRouteLineKeys = new Set();
  let needsAnimation = false;

  const routes = state.transit.routesGeoJson.features
    .map((feature) => {
      const lineKey = String(feature?.properties?.line_key || "").trim();
      if (lineKey) {
        allRouteLineKeys.add(lineKey);
      }

      const targetVisible = visibleLineKeys.has(lineKey);
      const visibility = visibilityProgressForLine(lineKey, targetVisible);
      if (visibility.needsAnimation) {
        needsAnimation = true;
      }

      const focused = targetVisible && (!hasFocus || lineKey === state.focusedLineKey) ? 1 : 0;
      const interactive = targetVisible && visibility.progress > 0.2 ? 1 : 0;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          is_focused: focused,
          has_focus: hasFocus ? 1 : 0,
          is_interactive: interactive,
          visibility_progress: Number(visibility.progress.toFixed(3))
        }
      };
    });

  pruneRouteVisibilityProgress(allRouteLineKeys);

  const stopSource = hasFocus
    ? state.transit.stopsGeoJson.features.filter(
        (feature) => feature?.properties?.line_key === state.focusedLineKey
      )
    : [];

  const stops = stopSource
    .filter((feature) => {
      const stopType = Number(feature.properties.stop_location_type);
      const normalizedStopType = Number.isFinite(stopType) ? stopType : 0;
      return allowedStopTypes.has(normalizedStopType);
    })
    .map((feature) => {
      const visited = getVisitedSetForLine(feature.properties.line_key).has(feature.properties.station_key)
        ? 1
        : 0;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          visited,
          is_focused: 1
        }
      };
    });

  return {
    routes: {
      type: "FeatureCollection",
      features: routes
    },
    stops: {
      type: "FeatureCollection",
      features: stops
    },
    shownLines,
    needsAnimation
  };
}

function renderMapData() {
  if (!state.mapReady || !state.map) {
    return;
  }

  const filtered = getFilteredData();
  const routesSource = state.map.getSource("routes");
  const stopsSource = state.map.getSource("stops");
  const focusMaskSource = state.map.getSource("focus-mask");

  if (routesSource) {
    routesSource.setData(filtered.routes);
  }
  if (stopsSource) {
    stopsSource.setData(filtered.stops);
  }
  if (focusMaskSource) {
    focusMaskSource.setData(focusMaskFeatureCollection(Boolean(state.focusedLineKey)));
  }

  if (filtered.needsAnimation) {
    scheduleRouteVisibilityAnimationFrame();
  }
}

function lineSummaryByKey() {
  return new Map(state.lineSummaries.map((line) => [line.lineKey, line]));
}

function renderProgress() {
  if (!state.transit) {
    els.progressSummary.textContent = "Pan or zoom the map and routes will load automatically.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const visibleLines = getShownLines();
  if (!visibleLines.length) {
    els.progressSummary.textContent = "No routes are visible for the active mode/frequency filters.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const rows = visibleLines
    .map((line) => {
      const metrics = lineProgressMetrics(line.lineKey, Number(line.stopCount || 0));

      return {
        lineName: lineDisplayName(line),
        visited: metrics.visited,
        total: metrics.total,
        percent: metrics.percent
      };
    })
    .sort((a, b) => {
      const percentDiff = b.percent - a.percent;
      if (percentDiff !== 0) {
        return percentDiff;
      }

      const visitedDiff = b.visited - a.visited;
      if (visitedDiff !== 0) {
        return visitedDiff;
      }

      return a.lineName.localeCompare(b.lineName);
    });

  const withKnownStops = rows.filter((row) => row.total > 0).length;
  els.progressSummary.textContent = `${visibleLines.length} visible routes. ${withKnownStops} with loaded stop totals.`;

  els.lineProgressList.innerHTML = "";

  for (const row of rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "line-progress-row";

    const label = document.createElement("div");
    label.textContent =
      row.total > 0
        ? `${row.lineName} (${row.visited}/${row.total})`
        : `${row.lineName} (${row.visited} visited, total unknown)`;

    const meter = document.createElement("div");
    meter.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";

    const linePercent = row.total ? Math.round((row.visited / row.total) * 100) : 0;
    fill.style.width = `${linePercent}%`;

    meter.append(fill);
    wrapper.append(label, document.createTextNode(`${linePercent}%`));
    wrapper.append(meter);

    els.lineProgressList.append(wrapper);
  }
}

function renderModeFilterBar() {
  els.modeFilterBar.innerHTML = "";

  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const counts = new Map(MODE_DEFS.map((mode) => [mode.key, 0]));
  let totalMatchingSearch = 0;

  for (const line of state.lineSummaries) {
    if (query && !lineSearchText(line).includes(query)) {
      continue;
    }

    totalMatchingSearch += 1;

    const modeKey = lineModeKey(line);
    counts.set(modeKey, (counts.get(modeKey) || 0) + 1);
  }

  const chips = MODE_DEFS.map((modeDef) => ({
    key: modeDef.key,
    label: modeDef.label,
    count: modeDef.key === MODE_FILTER_ALL ? totalMatchingSearch : counts.get(modeDef.key) || 0
  }));
  const uncertainCounts = areFilterCountsUncertain();

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${filterChipCountLabel(chip.count, uncertainCounts)})`;
    if (uncertainCounts) {
      button.title = "Route totals are still loading for this view.";
    }

    if (state.activeModeKeys.has(chip.key)) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (chip.key === MODE_FILTER_ALL) {
        state.activeModeKeys = new Set([MODE_FILTER_ALL]);
      } else {
        if (state.activeModeKeys.has(chip.key)) {
          state.activeModeKeys.delete(chip.key);
        } else {
          state.activeModeKeys.delete(MODE_FILTER_ALL);
          state.activeModeKeys.add(chip.key);
        }

        if (!state.activeModeKeys.size) {
          state.activeModeKeys.add(MODE_FILTER_ALL);
        }
      }

      normalizeModeSelection();
      clearStatusPin();
      resetClearRouteProgressConfirmation();

      const shown = getShownLines();
      if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
        state.focusedLineKey = "";
      }

      renderModeFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();
      restoreUserStatusFromFocus();

      const selectedLabels = MODE_DEFS.filter((modeDef) => state.activeModeKeys.has(modeDef.key)).map(
        (modeDef) => modeDef.label
      );

      setStatus("Mode filter updated.", "ok", `Showing: ${selectedLabels.join(", ")}.`);

      loadVisibleTransit({ forceRefresh: false, reason: "mode-filter-change" }).catch((error) => {
        setBackendStatus(`Mode-filter fetch failed: ${error.message}`);
      });
    });

    els.modeFilterBar.append(button);
  }
}

function renderFrequencyFilterBar() {
  els.frequencyFilterBar.innerHTML = "";

  const baseLines = getShownLines({ ignoreFrequency: true });

  const buckets = new Map([
    [FREQUENCY_FILTER_FREQUENT, 0],
    [FREQUENCY_FILTER_REGULAR, 0],
    [FREQUENCY_FILTER_LOCAL, 0],
    [FREQUENCY_FILTER_UNKNOWN, 0]
  ]);

  for (const line of baseLines) {
    const bucket = lineFrequencyBucket(line);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }

  const chips = [
    {
      key: FREQUENCY_FILTER_ALL,
      label: frequencyBucketLabel(FREQUENCY_FILTER_ALL),
      count: baseLines.length
    },
    {
      key: FREQUENCY_FILTER_FREQUENT,
      label: frequencyBucketLabel(FREQUENCY_FILTER_FREQUENT),
      count: buckets.get(FREQUENCY_FILTER_FREQUENT) || 0
    },
    {
      key: FREQUENCY_FILTER_REGULAR,
      label: frequencyBucketLabel(FREQUENCY_FILTER_REGULAR),
      count: buckets.get(FREQUENCY_FILTER_REGULAR) || 0
    },
    {
      key: FREQUENCY_FILTER_LOCAL,
      label: frequencyBucketLabel(FREQUENCY_FILTER_LOCAL),
      count: buckets.get(FREQUENCY_FILTER_LOCAL) || 0
    },
    {
      key: FREQUENCY_FILTER_UNKNOWN,
      label: "Unknown",
      count: buckets.get(FREQUENCY_FILTER_UNKNOWN) || 0
    }
  ];

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${chip.count})`;

    if (state.activeFrequencyKeys.has(chip.key)) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      if (chip.key === FREQUENCY_FILTER_ALL) {
        state.activeFrequencyKeys = new Set([FREQUENCY_FILTER_ALL]);
      } else {
        if (state.activeFrequencyKeys.has(chip.key)) {
          state.activeFrequencyKeys.delete(chip.key);
        } else {
          state.activeFrequencyKeys.delete(FREQUENCY_FILTER_ALL);
          state.activeFrequencyKeys.add(chip.key);
        }

        if (!state.activeFrequencyKeys.size) {
          state.activeFrequencyKeys.add(FREQUENCY_FILTER_ALL);
        }
      }

      normalizeFrequencySelection();
      clearStatusPin();
      resetClearRouteProgressConfirmation();

      const shown = getShownLines();
      if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
        state.focusedLineKey = "";
      }

      renderFrequencyFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();
      restoreUserStatusFromFocus();

      const selected = Array.from(state.activeFrequencyKeys)
        .map((value) => frequencyBucketLabel(value))
        .join(", ");

      setStatus("Frequency filter updated.", "ok", `Active frequencies: ${selected}.`);
    });

    els.frequencyFilterBar.append(button);
  }
}

async function ensureLineStopsLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const cacheKey = routeStopCacheKey(normalizedLineKey);
  const existing = state.lineStopsCache.get(cacheKey);
  if (existing && !options.forceRefresh) {
    existing.lastUsedAt = Date.now();
    return true;
  }

  if (state.inFlightLineStopKeys.has(cacheKey)) {
    return false;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineLabel = line ? lineDisplayName(line) : normalizedLineKey;
  const routeStopLookupKey = String(line?.routeOnestopId || normalizedLineKey).trim();

  state.inFlightLineStopKeys.add(cacheKey);
  updateLoadingStatus();

  if (!options.silent) {
    setStatus(`Loading stops for ${lineLabel}...`, "ok", "Using route membership from Transitland.");
  }

  try {
    const params = new URLSearchParams({
      lineKey: routeStopLookupKey,
      stopTypes: ROUTE_STOP_TYPES_QUERY
    });

    if (options.forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/route-stops?${params.toString()}`, {
      method: "GET"
    });

    state.lineStopsCache.set(cacheKey, {
      lineKey: normalizedLineKey,
      stopTypesKey: ROUTE_STOP_TYPES_KEY,
      payload,
      cacheStatus: payload.cacheStatus || "miss",
      lastUsedAt: Date.now()
    });

    pruneLineStopsCache();
    rebuildCombinedTransit();
    refreshUiFromState();
    restoreUserStatusFromFocus();

    const stationCount = Number(payload?.stopsGeoJson?.features?.length || 0);
    setBackendStatus(
      `Route stops ready for ${lineLabel} (${payload.cacheStatus || "miss"} cache, ${stationCount} stops).`
    );

    if (!options.silent) {
      setStatus(`Loaded ${stationCount} route-linked stops for ${lineLabel}.`, "ok");
    }

    return true;
  } catch (error) {
    setBackendStatus(`Route stop fetch failed for ${lineLabel}: ${error.message}`);
    if (!options.silent) {
      setStatus(`Could not load stops for ${lineLabel}.`, "error", error.message);
    }
    return false;
  } finally {
    state.inFlightLineStopKeys.delete(cacheKey);
    updateLoadingStatus();
  }
}

function lineNeedsHeadwayLookup(line) {
  if (!line) {
    return false;
  }

  if (lineHeadwayBestMinutes(line) !== null) {
    return false;
  }

  return Number(line?.headwayChecked || 0) !== 1;
}

function normalizeHeadwayUpdate(payload) {
  const headwayBestMinutes = Number(payload?.headwayBestMinutes);
  const normalizedBestMinutes =
    Number.isFinite(headwayBestMinutes) && headwayBestMinutes > 0
      ? Number(headwayBestMinutes.toFixed(1))
      : null;

  const normalizedBucket = String(payload?.frequencyBucket || "").trim().toLowerCase();
  const frequencyBucket = normalizedBestMinutes
    ? frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
    : normalizedBucket || FREQUENCY_FILTER_UNKNOWN;

  return {
    headwayBestMinutes: normalizedBestMinutes,
    frequencyBucket,
    headwaySource: String(payload?.headwaySource || payload?.headwaySummary?.source || "").trim(),
    headwayChecked: 1
  };
}

function applyHeadwayUpdateToCachedTransit(lineKey, headwayUpdate) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  let updated = false;

  state.lineSummaries = state.lineSummaries.map((line) => {
    if (line.lineKey !== normalizedLineKey) {
      return line;
    }

    updated = true;
    return {
      ...line,
      ...headwayUpdate
    };
  });

  if (state.transit?.routesGeoJson?.features) {
    for (const feature of state.transit.routesGeoJson.features) {
      const featureLineKey = String(feature?.properties?.line_key || "").trim();
      if (featureLineKey !== normalizedLineKey) {
        continue;
      }

      feature.properties = {
        ...feature.properties,
        frequency_bucket: headwayUpdate.frequencyBucket,
        headway_best_minutes: headwayUpdate.headwayBestMinutes,
        headway_source: headwayUpdate.headwaySource,
        headway_checked: headwayUpdate.headwayChecked
      };
    }
  }

  for (const cacheEntry of state.areaCache.values()) {
    const payload = cacheEntry?.payload;
    if (!payload) {
      continue;
    }

    if (Array.isArray(payload.lineSummaries)) {
      let didUpdateLineSummary = false;
      payload.lineSummaries = payload.lineSummaries.map((line) => {
        if (line?.lineKey !== normalizedLineKey) {
          return line;
        }

        didUpdateLineSummary = true;
        return {
          ...line,
          ...headwayUpdate
        };
      });

      if (didUpdateLineSummary) {
        updated = true;
      }
    }

    const routeFeatures = payload?.routesGeoJson?.features;
    if (Array.isArray(routeFeatures)) {
      for (const feature of routeFeatures) {
        const featureLineKey = String(feature?.properties?.line_key || "").trim();
        if (featureLineKey !== normalizedLineKey) {
          continue;
        }

        feature.properties = {
          ...feature.properties,
          frequency_bucket: headwayUpdate.frequencyBucket,
          headway_best_minutes: headwayUpdate.headwayBestMinutes,
          headway_source: headwayUpdate.headwaySource,
          headway_checked: headwayUpdate.headwayChecked
        };
      }
    }
  }

  return updated;
}

async function ensureLineHeadwayLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (!options.forceRefresh && !lineNeedsHeadwayLookup(line)) {
    return false;
  }

  if (state.inFlightHeadwayLineKeys.has(normalizedLineKey)) {
    return false;
  }

  const lineLabel = lineDisplayName(line);
  const routeLookupKey = String(line.routeOnestopId || normalizedLineKey).trim();

  state.inFlightHeadwayLineKeys.add(normalizedLineKey);

  try {
    const params = new URLSearchParams({
      lineKey: routeLookupKey
    });

    if (options.forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/route-headway?${params.toString()}`, {
      method: "GET"
    });

    const headwayUpdate = normalizeHeadwayUpdate(payload);
    const didUpdate = applyHeadwayUpdateToCachedTransit(normalizedLineKey, headwayUpdate);

    if (didUpdate) {
      refreshUiFromState();
      restoreUserStatusFromFocus();
    }

    if (!options.silent && headwayUpdate.headwayBestMinutes !== null) {
      setStatus(`Updated frequency for ${lineLabel}.`, "ok");
    }

    return didUpdate;
  } catch (error) {
    if (!options.silent) {
      setStatus(`Could not refresh frequency for ${lineLabel}.`, "error", error.message);
    }
    return false;
  } finally {
    state.inFlightHeadwayLineKeys.delete(normalizedLineKey);
  }
}

function clearFocusedLine(statusMessage = "Route focus cleared.", statusMeta = "Click a route to focus it.") {
  if (!state.focusedLineKey) {
    closeRouteSelectionPopup();
    return;
  }

  closeRouteSelectionPopup();
  clearStatusPin();
  resetClearRouteProgressConfirmation();

  state.focusedLineKey = "";
  renderLineList();
  renderMapData();
  renderProgress();
  restoreUserStatusFromFocus();
  setStatus(statusMessage, "ok", statusMeta);
}

async function setFocusedLine(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  closeRouteSelectionPopup();

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return;
  }

  clearStatusPin();
  resetClearRouteProgressConfirmation();

  if (state.focusedLineKey === normalizedLineKey && !options.forceRefresh) {
    setUserStatusFromLine(line);
    await ensureLineHeadwayLoaded(normalizedLineKey, {
      forceRefresh: false,
      silent: true
    });
    restoreUserStatusFromFocus();
    return;
  }

  state.focusedLineKey = normalizedLineKey;
  setUserStatusFromLine(line);
  renderLineList();
  renderMapData();
  renderProgress();

  setStatus(
    `Focused on ${lineDisplayName(line)}.`,
    "ok",
    "Loading route-linked stops. Other routes stay visible in a dimmed state."
  );

  const headwayLookupPromise = ensureLineHeadwayLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: true
  });

  await ensureLineStopsLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: false
  });

  await headwayLookupPromise;

  renderMapData();
  renderProgress();
}

function applyLineVisibilityPreference(line, targetVisibility) {
  const lineKey = String(line?.lineKey || "").trim();
  if (!lineKey) {
    return;
  }

  const normalizedTarget = targetVisibility === "on" || targetVisibility === "off" ? targetVisibility : "";
  const nextOverride = normalizedTarget;

  setLineVisibilityOverride(lineKey, nextOverride);
  clearStatusPin();
  resetClearRouteProgressConfirmation();

  const shown = getShownLines({ ignoreSearch: true });
  if (state.focusedLineKey && !shown.some((entry) => entry.lineKey === state.focusedLineKey)) {
    state.focusedLineKey = "";
  }

  refreshUiFromState();
  restoreUserStatusFromFocus();

  const effectiveVisible = lineIsVisible(line);
  const sourceLabel =
    nextOverride === "on"
      ? "Forced ON override"
      : nextOverride === "off"
        ? "Forced OFF override"
        : "Default mode/frequency behavior";

  setStatus(
    `${lineDisplayName(line)} visibility ${effectiveVisible ? "ON" : "OFF"}.`,
    "ok",
    sourceLabel
  );
}

function renderLineList() {
  els.lineList.innerHTML = "";

  const query = String(state.lineSearchQuery || "").trim().toLowerCase();
  const hasQuery = Boolean(query);
  const visibleLines = getShownLines({ ignoreSearch: true });
  const routeListLines = getRouteListLines();

  if (els.routeListSummary) {
    els.routeListSummary.textContent = hasQuery
      ? `Search results (${routeListLines.length}/${state.lineSummaries.length})`
      : `Filtered routes (${visibleLines.length} visible, ${routeListLines.length} listed)`;
  }

  if (els.routeListDropdown && hasQuery && routeListLines.length > 0) {
    els.routeListDropdown.open = true;
  }

  if (!state.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Routes appear here once nearby areas are loaded.";
    els.lineList.append(empty);
    return;
  }

  if (!routeListLines.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = hasQuery
      ? "No loaded routes match this search yet. Pan/zoom to load more nearby routes."
      : "No routes are visible. Adjust filters or search for a route and set it ON.";
    els.lineList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  routeListLines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "line-item";

    const focused = state.focusedLineKey && state.focusedLineKey === line.lineKey;
    const faded = state.focusedLineKey && state.focusedLineKey !== line.lineKey;
    const override = lineVisibilityOverride(line.lineKey);
    const visible = lineIsVisible(line);

    if (focused) {
      row.classList.add("is-focused");
    }
    if (faded) {
      row.classList.add("is-faded");
    }
    if (!visible) {
      row.classList.add("is-hidden");
    }
    if (override === "on") {
      row.classList.add("is-manual-on");
    }
    if (override === "off") {
      row.classList.add("is-manual-off");
    }

    const focusButton = document.createElement("button");
    focusButton.type = "button";
    focusButton.className = "line-item-focus";
    focusButton.disabled = !visible;
    focusButton.title = visible ? "Focus this route on the map" : "Set route visibility to ON to focus it";

    const dot = document.createElement("span");
    dot.className = "line-color-dot";
    dot.style.backgroundColor = line.color;

    const labelBlock = document.createElement("div");

    const name = document.createElement("p");
    name.className = "line-name";
    name.textContent = lineDisplayName(line);

    const meta = document.createElement("p");
    meta.className = "line-meta";
    meta.textContent = `${lineMode(line)} - ${lineOperatorLabel(line)} - ${lineHeadwayLabel(line)}`;

    if (override === "on" || override === "off") {
      meta.textContent = `${meta.textContent} - Manual ${override.toUpperCase()}`;
    }

    if (!visible && !override) {
      meta.textContent = `${meta.textContent} - Hidden by filters`;
    }

    labelBlock.append(name, meta);

    focusButton.append(dot, labelBlock);

    focusButton.addEventListener("click", () => {
      setFocusedLine(line.lineKey).catch((error) => {
        setStatus(error.message, "error");
      });
    });

    const sideStack = document.createElement("div");
    sideStack.className = "line-side-stack";

    const sideTop = document.createElement("div");
    sideTop.className = "line-side-top";

    const routeStopsCacheEntry = state.lineStopsCache.get(routeStopCacheKey(line.lineKey));
    const routeStopsLoaded = Boolean(routeStopsCacheEntry);
    const routeStopsCount = Number(routeStopsCacheEntry?.payload?.stopsGeoJson?.features?.length || 0);
    const routeStopsLoading = state.inFlightLineStopKeys.has(routeStopCacheKey(line.lineKey));

    if (routeStopsLoaded) {
      const stopCount = document.createElement("span");
      stopCount.className = "line-stop-count";
      stopCount.textContent = `${routeStopsCount} stops`;
      sideTop.append(stopCount);
    } else if (routeStopsLoading) {
      const loading = document.createElement("span");
      loading.className = "line-stop-count";
      loading.textContent = "Loading stops...";
      sideTop.append(loading);
    } else {
      const loadStopsBtn = document.createElement("button");
      loadStopsBtn.type = "button";
      loadStopsBtn.className = "line-stop-load-btn";
      loadStopsBtn.textContent = "Load stops";

      loadStopsBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ensureLineStopsLoaded(line.lineKey, {
          forceRefresh: false,
          silent: false
        }).catch((error) => {
          setStatus(error.message, "error");
        });
      });

      sideTop.append(loadStopsBtn);
    }

    const controls = document.createElement("div");
    controls.className = "line-visibility-controls";

    const onButton = document.createElement("button");
    onButton.type = "button";
    onButton.className = "line-visibility-btn is-on";
    onButton.textContent = "ON";

    const defaultButton = document.createElement("button");
    defaultButton.type = "button";
    defaultButton.className = "line-visibility-btn is-default";
    defaultButton.textContent = "-";

    const offButton = document.createElement("button");
    offButton.type = "button";
    offButton.className = "line-visibility-btn is-off";
    offButton.textContent = "OFF";

    if (override === "on") {
      onButton.classList.add("is-active");
    } else if (override === "off") {
      offButton.classList.add("is-active");
    } else {
      defaultButton.classList.add("is-active");
    }

    if (override === "on") {
      onButton.classList.add("is-manual");
    }
    if (override === "off") {
      offButton.classList.add("is-manual");
    }

    onButton.setAttribute("aria-pressed", override === "on" ? "true" : "false");
    defaultButton.setAttribute("aria-pressed", !override ? "true" : "false");
    offButton.setAttribute("aria-pressed", override === "off" ? "true" : "false");

    onButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyLineVisibilityPreference(line, "on");
    });

    defaultButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyLineVisibilityPreference(line, "");
    });

    offButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyLineVisibilityPreference(line, "off");
    });

    controls.append(onButton, defaultButton, offButton);

    sideStack.append(sideTop, controls);

    row.append(focusButton, sideStack);

    fragment.append(row);
  });

  els.lineList.append(fragment);
}

function refreshUiFromState() {
  renderModeFilterBar();
  renderFrequencyFilterBar();
  renderLineList();
  renderMapData();
  renderProgress();
}

function updateLoadingStatus() {
  const areaLoadingCount = state.inFlightAreaKeys.size;
  const queuedCount = state.fetchQueue.length;
  const routeStopLoadingCount = state.inFlightLineStopKeys.size;

  if (areaLoadingCount > 0 || queuedCount > 0 || routeStopLoadingCount > 0) {
    setStatus(
      "Loading routes for the current map view...",
      "ok",
      `${state.lastLoadStats.cached} route tiles cached - ${areaLoadingCount} tiles loading - ${routeStopLoadingCount} routes loading stops - ${Math.max(
        queuedCount,
        state.lastLoadStats.deferred
      )} pending`
    );
    return;
  }

  if (state.lineSummaries.length > 0) {
    const focusLabel = state.focusedLineKey ? "Focused route stop view." : "Select a route to load stops.";
    setStatus(
      "Routes are ready for this view.",
      "ok",
      `${state.activeAreaKeys.size} nearby areas in session cache. ${focusLabel}`
    );
    return;
  }

  if (state.lastLoadStats.failed > 0) {
    setStatus(
      "Routes could not be loaded for this area.",
      "error",
      `${state.lastLoadStats.failed} area requests failed. Check the backend note below.`
    );
    return;
  }

  if (state.lastLoadStats.requested > 0) {
    setStatus(
      "No route data was returned for this map area.",
      "error",
      "Try panning a little or changing zoom level."
    );
  }
}

function queueTileFetches(tileRequests, options = {}) {
  let queued = 0;

  for (const request of tileRequests) {
    const cacheKey = request.areaKey;
    if (!options.forceRefresh && state.areaCache.has(cacheKey)) {
      continue;
    }

    if (state.queuedAreaKeys.has(cacheKey) || state.inFlightAreaKeys.has(cacheKey)) {
      continue;
    }

    state.fetchQueue.push({
      cacheKey,
      bbox: request.bbox,
      zoom: request.zoom,
      routeTypes: Array.isArray(request.routeTypes) ? request.routeTypes : [],
      epoch: state.loadEpoch,
      forceRefresh: Boolean(options.forceRefresh)
    });

    state.queuedAreaKeys.add(cacheKey);
    queued += 1;
  }

  if (queued > 0) {
    drainFetchQueue();
  }

  return queued;
}

function trimQueuedFetchesToCurrentView() {
  if (!state.fetchQueue.length) {
    return;
  }

  const nextQueue = [];
  const nextQueuedKeys = new Set();

  for (const job of state.fetchQueue) {
    if (!state.requestedAreaKeys.has(job.cacheKey)) {
      continue;
    }
    nextQueue.push(job);
    nextQueuedKeys.add(job.cacheKey);
  }

  state.fetchQueue = nextQueue;
  state.queuedAreaKeys = nextQueuedKeys;
}

async function fetchTile(job) {
  state.inFlightAreaKeys.add(job.cacheKey);
  updateLoadingStatus();

  try {
    const params = new URLSearchParams({
      bbox: bboxQueryText(job.bbox),
      zoom: Number(job.zoom || 0).toFixed(2)
    });

    if (job.forceRefresh) {
      params.set("refresh", "1");
    }

    if (Array.isArray(job.routeTypes) && job.routeTypes.length) {
      params.set("routeTypes", job.routeTypes.join(","));
    }

    const payload = await apiRequest(`/api/transit/bbox?${params.toString()}`, {
      method: "GET"
    });

    if (job.epoch !== state.loadEpoch) {
      return;
    }

    cacheAreaPayload(job.cacheKey, payload, payload.cacheStatus || "miss");
    state.lastLoadStats.successful += 1;

    const previousVisibleKeys = new Set(state.visibleAreaKeys);
    const hasPendingTiles = state.fetchQueue.length > 0 || state.inFlightAreaKeys.size > 1;

    syncActiveAreaKeys({
      retainVisibleKeys: previousVisibleKeys,
      mergeRetainedVisibleKeys: hasPendingTiles,
      fallbackToAllCached: false
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    const lines = Number(payload?.lineSummaries?.length || 0);
    const vectorTileCount = Number(payload?.matchingStats?.vectorHeadwayTileCount || 0);
    const omittedVectorTiles = Number(payload?.matchingStats?.vectorHeadwayOmittedTileCount || 0);
    setBackendStatus(
      `Fetched ${job.cacheKey} (${payload.cacheStatus || "miss"} cache, ${lines} routes, ${vectorTileCount} vector tiles${
        omittedVectorTiles > 0 ? `, +${omittedVectorTiles} omitted` : ""
      }). Select a route to load stops.`
    );
  } catch (error) {
    if (job.epoch !== state.loadEpoch) {
      return;
    }
    state.lastLoadStats.failed += 1;
    setBackendStatus(`Fetch failed for ${job.cacheKey}: ${error.message}`);
  } finally {
    state.inFlightAreaKeys.delete(job.cacheKey);
  }
}

function drainFetchQueue() {
  if (state.queueDrainRunning) {
    updateLoadingStatus();
    return;
  }

  state.queueDrainRunning = true;

  const launch = () => {
    while (state.inFlightAreaKeys.size < MAX_PARALLEL_FETCHES && state.fetchQueue.length > 0) {
      const job = state.fetchQueue.shift();
      state.queuedAreaKeys.delete(job.cacheKey);

      fetchTile(job)
        .catch(() => {})
        .finally(() => {
          if (state.fetchQueue.length > 0 || state.inFlightAreaKeys.size > 0) {
            launch();
          } else {
            state.queueDrainRunning = false;
            updateLoadingStatus();
          }
        });
    }

    if (state.fetchQueue.length === 0 && state.inFlightAreaKeys.size === 0) {
      state.queueDrainRunning = false;
    }

    updateLoadingStatus();
  };

  launch();
}

async function loadVisibleTransit(options = {}) {
  if (!state.mapReady || !state.map) {
    return;
  }

  const zoom = state.map.getZoom();
  const rawBbox = mapBoundsToBbox();
  if (!rawBbox) {
    setStatus(
      "This view crosses the 180-degree line and cannot be loaded yet.",
      "error",
      "Pan away from the dateline and transit will resume loading."
    );
    return;
  }

  const modeRouteTypes = selectedRouteTypesForFetch();
  const requests = viewportRequestsForMode(rawBbox, zoom, modeRouteTypes);

  if (zoom < MIN_VIEWPORT_FETCH_ZOOM) {
    const cachedInView = visibleCachedAreaKeysForViewport(rawBbox, modeRouteTypes);
    const cachedNearView = visibleCachedAreaKeysForViewport(expandBbox(rawBbox, 0.05), modeRouteTypes);
    const fallbackVisible = new Set(
      Array.from(state.visibleAreaKeys).filter((cacheKey) => state.areaCache.has(cacheKey))
    );

    state.requestedAreaKeys =
      cachedInView.size > 0
        ? cachedInView
        : cachedNearView.size > 0
          ? cachedNearView
          : fallbackVisible;

    trimQueuedFetchesToCurrentView();

    syncActiveAreaKeys({
      fallbackToAllCached: false
    });
    rebuildCombinedTransit();
    refreshUiFromState();

    const cachedVisible = state.requestedAreaKeys.size;

    state.lastLoadStats = {
      requested: requests.length,
      cached: cachedVisible,
      queued: 0,
      deferred: 0,
      failed: 0,
      successful: 0
    };

    setStatus(
      "Zoomed out. Showing previously loaded nearby routes.",
      "ok",
      `${cachedVisible} nearby cached areas visible. Zoom in slightly to load additional routes.`
    );

    setBackendStatus(
      "Viewport fetch paused at low zoom. Server/client caches are still used for already-loaded in-view tiles."
    );
    return;
  }

  const cachedRequestCount = requests.filter((request) => state.areaCache.has(request.areaKey)).length;
  const missingRequests = requests.filter(
    (request) => options.forceRefresh || !state.areaCache.has(request.areaKey)
  );

  const previousVisibleKeys = new Set(state.visibleAreaKeys);
  const cachedInView = visibleCachedAreaKeysForViewport(rawBbox, modeRouteTypes);
  const cachedNearView = visibleCachedAreaKeysForViewport(expandBbox(rawBbox, 0.05), modeRouteTypes);
  const retainedCachedKeys = cachedInView.size > 0 ? cachedInView : cachedNearView;

  state.requestedAreaKeys = new Set([
    ...requests.map((request) => request.areaKey),
    ...Array.from(retainedCachedKeys)
  ]);
  trimQueuedFetchesToCurrentView();

  syncActiveAreaKeys({
    retainVisibleKeys: previousVisibleKeys,
    mergeRetainedVisibleKeys: missingRequests.length > 0,
    fallbackToAllCached: false
  });
  rebuildCombinedTransit();
  refreshUiFromState();

  if (!requests.length) {
    setStatus("No nearby request tiles were generated for this view.", "error");
    return;
  }

  const cached = cachedRequestCount;
  const missing = missingRequests;
  const nextBatch = missing.slice(0, MAX_NEW_FETCHES_PER_VIEW);

  state.lastLoadStats = {
    requested: requests.length,
    cached,
    queued: 0,
    deferred: Math.max(0, missing.length - nextBatch.length),
    failed: 0,
    successful: 0
  };

  if (!nextBatch.length) {
    setStatus(
      "Showing routes for the current map view.",
      "ok",
      `${cached}/${requests.length} nearby areas loaded from session cache. Select a route to load stops.`
    );
    setBackendStatus("No network fetch was needed for this view.");
    return;
  }

  const queued = queueTileFetches(nextBatch, {
    forceRefresh: Boolean(options.forceRefresh)
  });

  state.lastLoadStats.queued = queued;

  setStatus(
    "Loading routes for the current map view...",
    "ok",
    `${cached} cached - ${queued} loading${
      state.lastLoadStats.deferred > 0 ? ` - ${state.lastLoadStats.deferred} deferred` : ""
    }`
  );

  setBackendStatus(
    `Route-first mode active. Stops are loaded only on focused routes (location types ${ROUTE_STOP_TYPES_QUERY}).`
  );
}

function onMapMoveEnd() {
  if (!state.mapReady) {
    return;
  }

  const now = Date.now();
  if (now - state.lastMoveFetchAt < MIN_MOVE_FETCH_INTERVAL_MS) {
    return;
  }
  state.lastMoveFetchAt = now;

  loadVisibleTransit({ forceRefresh: false, reason: "move" }).catch((error) => {
    setBackendStatus(`Auto-load failed: ${error.message}`);
  });
}

function fitToArea(area) {
  if (!state.map || !state.mapReady || !area?.bbox) {
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = area.bbox;
  state.map.fitBounds(
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
  if (!state.cities.length) {
    return null;
  }

  return state.cities.find((city) => city.slug === state.initialCitySlug) || state.cities[0] || null;
}

async function loadCities() {
  const payload = await apiRequest("/api/catalog/cities", { method: "GET" });
  state.cities = Array.isArray(payload.cities) ? payload.cities : [];

  if (!state.cities.length) {
    return;
  }

  const exists = state.cities.some((city) => city.slug === state.initialCitySlug);
  if (!exists) {
    state.initialCitySlug = state.cities[0].slug;
    localStorage.setItem("metromark_initial_city_slug", state.initialCitySlug);
  }
}

async function hydrateSession() {
  if (!state.token) {
    updateAuthUi();
    return;
  }

  try {
    const me = await apiRequest("/api/auth/me", { method: "GET" });
    state.user = me.user;
    updateAuthUi();
  } catch {
    setToken("");
    state.user = null;
    updateAuthUi();
  }
}

function updateAuthUi() {
  const loggedIn = Boolean(state.user);
  els.authLoggedOut.hidden = loggedIn;
  els.authLoggedIn.hidden = !loggedIn;
  els.currentUserLabel.textContent = loggedIn ? `${state.user.displayName} (${state.user.email})` : "-";
  renderUserStatus();
}

function rebuildVisitedMap(items) {
  state.visitedByLine = new Map();
  for (const item of items) {
    getVisitedSetForLine(item.lineKey).add(item.stationKey);
  }
}

async function loadProgress() {
  if (!state.user) {
    state.visitedByLine = new Map();
    renderMapData();
    renderProgress();
    return;
  }

  const payload = await apiRequest("/api/progress", { method: "GET" });
  rebuildVisitedMap(payload.items || []);
  renderMapData();
  renderProgress();
}

async function clearRouteProgress(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  if (!state.user) {
    setStatus("Sign in first to clear route progress.", "error");
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineName = line ? lineDisplayName(line) : normalizedLineKey;

  resetClearRouteProgressConfirmation();

  try {
    const payload = await apiRequest("/api/progress/clear-route", {
      method: "POST",
      body: JSON.stringify({ lineKey: normalizedLineKey })
    });

    state.visitedByLine.set(normalizedLineKey, new Set());
    renderMapData();
    renderProgress();
    if (line && state.focusedLineKey === normalizedLineKey) {
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

async function loginWithPayload(payloadPromise) {
  const payload = await payloadPromise;
  setToken(payload.token);
  state.user = payload.user;
  updateAuthUi();
  closePopups();
  await loadProgress();
  setStatus(`Signed in as ${payload.user.displayName}.`, "ok");
}

async function onStopClicked(event) {
  const feature = event.features && event.features[0];
  if (!feature) {
    return;
  }

  closeRouteSelectionPopup();
  onRouteHoverLeave();

  state.lastStopClickAt = Date.now();
  resetClearRouteProgressConfirmation();

  if (!state.user) {
    setUserStatusFromStation(feature.properties || {}, "Sign in to mark this station as visited.");
    setStatus("Sign in first to mark stations.", "error");
    return;
  }

  const lineKey = feature.properties.line_key;
  const stationKey = feature.properties.station_key;
  const stationName = feature.properties.station_name;
  const [lon, lat] = feature.geometry.coordinates;

  const visitedSet = getVisitedSetForLine(lineKey);
  const nextVisited = !visitedSet.has(stationKey);

  try {
    await apiRequest("/api/progress/toggle", {
      method: "POST",
      body: JSON.stringify({
        lineKey,
        stationKey,
        stationName,
        lon,
        lat,
        visited: nextVisited
      })
    });

    if (nextVisited) {
      visitedSet.add(stationKey);
    } else {
      visitedSet.delete(stationKey);
    }

    renderMapData();
    renderProgress();

    setUserStatusFromStation(
      feature.properties || {},
      nextVisited ? "Marked as visited in your progress." : "Marked as unvisited in your progress."
    );

    setStatus(`${nextVisited ? "Visited" : "Unvisited"}: ${stationName}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function onStopHoverMove(event) {
  if (!hoverInteractionsEnabled()) {
    onStopHoverLeave();
    return;
  }

  const feature = event.features && event.features[0];
  if (!feature || !state.hoverPopup) {
    return;
  }

  if (state.routeHoverPopup) {
    state.routeHoverPopup.remove();
  }

  state.hoverPopup
    .setLngLat(event.lngLat)
    .setHTML(stopHoverHtml(feature.properties || {}))
    .addTo(state.map);
}

function onStopHoverLeave() {
  if (state.hoverPopup) {
    state.hoverPopup.remove();
  }

  if (state.userStatusPinnedKind !== "station") {
    restoreUserStatusFromFocus();
  }
}

function lineFromRouteFeature(feature) {
  const lineKey = String(feature?.properties?.line_key || "").trim();
  if (!lineKey) {
    return null;
  }

  const fromSummary = state.lineSummaries.find((line) => line.lineKey === lineKey);
  if (fromSummary) {
    return fromSummary;
  }

  const parsed = lineLikeFromFeatureProperties(feature?.properties || {});
  return {
    ...parsed,
    lineKey,
    routeType: Number.isFinite(parsed.routeType) ? parsed.routeType : null,
    color: feature?.properties?.color
  };
}

function onRouteHoverMove(event) {
  if (!hoverInteractionsEnabled()) {
    onRouteHoverLeave();
    return;
  }

  if (!state.routeHoverPopup || !state.map) {
    return;
  }

  if (state.hoverPopup) {
    state.hoverPopup.remove();
  }

  const features = state.map.queryRenderedFeatures(event.point, {
    layers: ["routes-main", "routes-background-main"]
  });

  const uniqueLines = new Map();
  for (const feature of features || []) {
    const line = lineFromRouteFeature(feature);
    if (!line || !lineIsVisible(line) || uniqueLines.has(line.lineKey)) {
      continue;
    }
    uniqueLines.set(line.lineKey, line);
  }

  const allLines = Array.from(uniqueLines.values());
  const lines = allLines.slice(0, 4);
  if (!lines.length) {
    onRouteHoverLeave();
    return;
  }

  state.routeHoverPopup
    .setLngLat(event.lngLat)
    .setHTML(lineHoverHtml(lines, allLines.length))
    .addTo(state.map);
}

function onRouteHoverLeave() {
  if (state.routeHoverPopup) {
    state.routeHoverPopup.remove();
  }

  if (state.userStatusPinnedKind !== "station") {
    restoreUserStatusFromFocus();
  }
}

function initializeMap() {
  state.map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(),
    center: [-30, 25],
    zoom: 1.7,
    maxPitch: 80,
    antialias: true
  });

  state.map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  state.hoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 12
  });
  state.routeHoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10
  });
  state.routeSelectPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    closeOnMove: true,
    offset: 12,
    maxWidth: "340px"
  });

  state.map.on("style.load", () => {
    state.map.setProjection({ type: "globe" });
    state.map.setFog({
      color: "#dce4e7",
      "high-color": "#f5f8ff",
      "horizon-blend": 0.05,
      "space-color": "#0f1b22",
      "star-intensity": 0.03
    });
  });

  state.map.on("load", () => {
    state.map.addSource("routes", {
      type: "geojson",
      data: emptyFeatureCollection()
    });

    state.map.addSource("stops", {
      type: "geojson",
      data: emptyFeatureCollection()
    });

    state.map.addSource("focus-mask", {
      type: "geojson",
      data: focusMaskFeatureCollection(false)
    });

    state.map.addLayer({
      id: "routes-background-casing",
      type: "line",
      source: "routes",
      filter: [
        "all",
        ["==", ["get", "is_focused"], 0],
        [">", ["coalesce", ["to-number", ["get", "visibility_progress"]], 0], 0.02]
      ],
      paint: {
        "line-color": "#111920",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.7,
          3,
          1.1,
          6,
          2.1,
          9,
          3.2,
          12,
          4.3
        ],
        "line-opacity": 0
      }
    });

    state.map.addLayer({
      id: "routes-background-main",
      type: "line",
      source: "routes",
      filter: [
        "all",
        ["==", ["get", "is_focused"], 0],
        [">", ["coalesce", ["to-number", ["get", "visibility_progress"]], 0], 0.02]
      ],
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.45,
          3,
          0.7,
          6,
          1.3,
          9,
          1.9,
          12,
          2.4
        ],
        "line-opacity": [
          "*",
          0.9,
          ["coalesce", ["to-number", ["get", "visibility_progress"]], 1]
        ]
      }
    });

    state.map.addLayer({
      id: "focus-dim-layer",
      type: "fill",
      source: "focus-mask",
      paint: {
        "fill-color": "#1f262d",
        "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.48, 0]
      }
    });

    state.map.addLayer({
      id: "routes-casing",
      type: "line",
      source: "routes",
      filter: [
        "all",
        ["==", ["get", "is_focused"], 1],
        [">", ["coalesce", ["to-number", ["get", "visibility_progress"]], 0], 0.02]
      ],
      paint: {
        "line-color": "#0f1b22",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.95,
          3,
          1.4,
          6,
          2.6,
          9,
          3.9,
          12,
          5.2
        ],
        "line-opacity": [
          "*",
          0.38,
          ["coalesce", ["to-number", ["get", "visibility_progress"]], 1]
        ]
      }
    });

    state.map.addLayer({
      id: "routes-main",
      type: "line",
      source: "routes",
      filter: [
        "all",
        ["==", ["get", "is_focused"], 1],
        [">", ["coalesce", ["to-number", ["get", "visibility_progress"]], 0], 0.02]
      ],
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          0.7,
          3,
          1.05,
          6,
          1.9,
          9,
          2.9,
          12,
          3.6
        ],
        "line-opacity": [
          "*",
          0.96,
          ["coalesce", ["to-number", ["get", "visibility_progress"]], 1]
        ]
      }
    });

    state.map.addLayer({
      id: "stops-layer",
      type: "circle",
      source: "stops",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          2.9,
          8,
          4.2,
          11,
          5.6,
          14,
          7.1
        ],
        "circle-color": ["case", ["==", ["get", "visited"], 1], "#1a9b66", "#d9563a"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.2,
        "circle-opacity": ["case", ["==", ["get", "is_focused"], 1], 0.94, 0.32],
        "circle-stroke-opacity": ["case", ["==", ["get", "is_focused"], 1], 1, 0.45]
      }
    });

    const interactiveRouteLayers = ["routes-main", "routes-background-main"];

    for (const layerId of interactiveRouteLayers) {
      state.map.on("click", layerId, (event) => {
        const now = Date.now();
        if (now - state.lastStopClickAt < 260) {
          return;
        }
        if (now - state.lastRouteClickAt < 160) {
          return;
        }

        const stopHits = state.map.queryRenderedFeatures(event.point, {
          layers: ["stops-layer"]
        });
        if (
          Array.isArray(stopHits) &&
          stopHits.length > 0 &&
          state.userStatusPinnedKind !== "station"
        ) {
          return;
        }

        const routeHits = state.map.queryRenderedFeatures(event.point, {
          layers: interactiveRouteLayers
        });

        const seenLineKeys = new Set();
        const overlappedLines = [];
        for (const hit of routeHits || []) {
          const line = lineFromRouteFeature(hit);
          const candidateLineKey = String(line?.lineKey || "").trim();
          if (!line || !lineIsVisible(line) || !candidateLineKey || seenLineKeys.has(candidateLineKey)) {
            continue;
          }

          seenLineKeys.add(candidateLineKey);
          overlappedLines.push(line);
        }

        if (!overlappedLines.length) {
          return;
        }

        overlappedLines.sort((a, b) => lineDisplayName(a).localeCompare(lineDisplayName(b)));
        state.lastRouteClickAt = now;

        if (overlappedLines.length === 1) {
          closeRouteSelectionPopup();
          setFocusedLine(overlappedLines[0].lineKey).catch((error) => {
            setStatus(error.message, "error");
          });
          return;
        }

        onRouteHoverLeave();
        openRouteSelectionPopup(overlappedLines, event.lngLat);
        setStatus(
          "Multiple routes overlap here.",
          "ok",
          `Pick one from the selector (${overlappedLines.length} routes).`
        );
      });

      state.map.on("mouseenter", layerId, () => {
        if (hoverInteractionsEnabled()) {
          state.map.getCanvas().style.cursor = "pointer";
        }
      });

      state.map.on("mousemove", layerId, (event) => {
        if (hoverInteractionsEnabled()) {
          onRouteHoverMove(event);
        }
      });

      state.map.on("mouseleave", layerId, () => {
        state.map.getCanvas().style.cursor = "";
        onRouteHoverLeave();
      });
    }

    state.map.on("click", "stops-layer", onStopClicked);
    state.map.on("mouseenter", "stops-layer", () => {
      if (hoverInteractionsEnabled()) {
        state.map.getCanvas().style.cursor = "pointer";
      }
    });
    state.map.on("mousemove", "stops-layer", (event) => {
      if (hoverInteractionsEnabled()) {
        onStopHoverMove(event);
      }
    });
    state.map.on("mouseleave", "stops-layer", () => {
      state.map.getCanvas().style.cursor = "";
      onStopHoverLeave();
    });

    state.map.on("click", (event) => {
      const now = Date.now();
      if (now - state.lastStopClickAt < 260 || now - state.lastRouteClickAt < 220) {
        return;
      }

      const point = event.point;
      const closePadding = 14;

      if (state.routeSelectPopup) {
        const nearbyRoutes = state.map.queryRenderedFeatures(
          [
            [point.x - closePadding, point.y - closePadding],
            [point.x + closePadding, point.y + closePadding]
          ],
          {
            layers: interactiveRouteLayers
          }
        );

        if (!Array.isArray(nearbyRoutes) || nearbyRoutes.length === 0) {
          closeRouteSelectionPopup();
        }
      }

      if (!state.focusedLineKey) {
        return;
      }

      const nearby = state.map.queryRenderedFeatures(
        [
          [point.x - closePadding, point.y - closePadding],
          [point.x + closePadding, point.y + closePadding]
        ],
        {
          layers: ["stops-layer", "routes-main", "routes-background-main"]
        }
      );

      if (Array.isArray(nearby) && nearby.length > 0) {
        return;
      }

      clearFocusedLine(
        "Route focus cleared.",
        "Clicked away from routes/stations. Click a route to focus it again."
      );
    });

    state.map.on("touchstart", () => {
      onStopHoverLeave();
      onRouteHoverLeave();
      closeRouteSelectionPopup();
    });

    state.map.on("movestart", () => {
      closeRouteSelectionPopup();
      if (!hoverInteractionsEnabled()) {
        onStopHoverLeave();
        onRouteHoverLeave();
      }
    });

    state.map.on("moveend", onMapMoveEnd);

    state.mapReady = true;
    updateMapModeButtons();
    renderMapData();

    if (typeof state.mapReadyResolver === "function") {
      state.mapReadyResolver();
      state.mapReadyResolver = null;
    }
  });
}

function waitForMapReady() {
  return new Promise((resolve) => {
    if (state.mapReady) {
      resolve();
      return;
    }
    state.mapReadyResolver = resolve;
  });
}

function bindEvents() {
  els.themeToggleBtn.addEventListener("click", toggleTheme);

  if (els.mobileDrawerTab) {
    els.mobileDrawerTab.addEventListener("click", () => {
      setMobilePanelsOpen(!state.mobilePanelsOpen);
    });
  }

  els.streetsModeBtn.addEventListener("click", () => setMapMode("streets"));
  els.satelliteModeBtn.addEventListener("click", () => setMapMode("satellite"));

  els.accountPopupBtn.addEventListener("click", () => setActivePopup("account"));
  els.closeAuthPopupBtn.addEventListener("click", closePopups);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.mobilePanelsOpen) {
        setMobilePanelsOpen(false);
      }
      closeRouteSelectionPopup();
      onStopHoverLeave();
      onRouteHoverLeave();
      closePopups();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;

    if (state.mobilePanelsOpen && isPortraitMobileLayout()) {
      const clickedInsideSidebar = target.closest(".sidebar");
      const clickedDrawerTab = els.mobileDrawerTab && els.mobileDrawerTab.contains(target);
      if (!clickedInsideSidebar && !clickedDrawerTab) {
        setMobilePanelsOpen(false);
      }
    }

    if (!state.activePopup) {
      return;
    }

    const clickedToggle = els.accountPopupBtn.contains(target);
    const clickedPanel = els.authPopup.contains(target);

    if (!clickedToggle && !clickedPanel) {
      closePopups();
    }
  });

  window.addEventListener("resize", syncMobilePanelLayout);
  window.addEventListener("orientationchange", syncMobilePanelLayout);

  els.clearSessionCacheBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Clear local in-browser cache for this session? Use this only if you suspect stale transit data."
    );

    if (!confirmed) {
      return;
    }

    state.areaCache.clear();
    state.lineStopsCache.clear();
    state.inFlightLineStopKeys.clear();
    resetViewAggregation();

    rebuildCombinedTransit();
    refreshUiFromState();

    setBackendStatus("Local session cache cleared by user (route tiles and route stops).");

    try {
      await loadVisibleTransit({ forceRefresh: false, reason: "clear-cache" });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  if (els.clearRouteProgressBtn) {
    els.clearRouteProgressBtn.addEventListener("click", () => {
      const routeLineKey = state.userStatus.routeLineKey || state.focusedLineKey;
      const normalizedLineKey = String(routeLineKey || "").trim();
      if (!normalizedLineKey) {
        return;
      }

      if (state.clearRouteProgressConfirmLineKey !== normalizedLineKey) {
        resetClearRouteProgressConfirmation();
        state.clearRouteProgressConfirmLineKey = normalizedLineKey;
        state.clearRouteProgressConfirmTimeoutId = window.setTimeout(() => {
          resetClearRouteProgressConfirmation({ renderNow: true });
        }, 7000);
        renderUserStatus();
        return;
      }

      clearRouteProgress(normalizedLineKey).catch(() => {});
    });
  }

  if (els.deselectRouteBtn) {
    els.deselectRouteBtn.addEventListener("click", () => {
      clearFocusedLine("Route focus cleared.", "Showing all filtered routes again.");
    });
  }

  els.lineSearch.addEventListener("input", () => {
    state.lineSearchQuery = String(els.lineSearch.value || "").trim().toLowerCase();
    clearStatusPin();
    resetClearRouteProgressConfirmation();

    const shown = getShownLines();
    if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
      state.focusedLineKey = "";
    }

    renderLineList();
    renderMapData();
    renderProgress();
    restoreUserStatusFromFocus();
  });

  els.demoLoginBtn.addEventListener("click", async () => {
    try {
      await loginWithPayload(apiRequest("/api/auth/demo-login", { method: "POST" }));
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(els.loginForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      await loginWithPayload(
        apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        })
      );
      els.loginForm.reset();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(els.registerForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const displayName = String(formData.get("displayName") || "").trim();

    try {
      await loginWithPayload(
        apiRequest("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName })
        })
      );
      els.registerForm.reset();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.logoutBtn.addEventListener("click", () => {
    setToken("");
    state.user = null;
    state.visitedByLine = new Map();

    updateAuthUi();
    closePopups();
    renderMapData();
    renderProgress();

    setStatus("Logged out.", "ok");
  });
}

async function init() {
  document.body.classList.remove("app-ready");
  setTheme(state.theme);
  syncMobilePanelLayout();
  normalizeModeSelection();
  normalizeFrequencySelection();
  normalizeManualVisibilityOverrides();
  renderApiCounter();
  restoreUserStatusFromFocus();

  bindEvents();
  initializeMap();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.body.classList.add("app-ready");
    });
  });

  try {
    await Promise.all([loadCities(), hydrateSession()]);
    await waitForMapReady();

    const city = selectedCityPreset();

    let initialTriggered = false;
    const triggerInitialLoad = () => {
      if (initialTriggered) {
        return;
      }
      initialTriggered = true;

      loadVisibleTransit({ forceRefresh: false, reason: "initial" }).catch((error) => {
        setBackendStatus(`Initial load failed: ${error.message}`);
      });
    };

    if (city) {
      state.map.once("moveend", triggerInitialLoad);
      fitToArea(city);
    } else {
      triggerInitialLoad();
    }

    window.setTimeout(triggerInitialLoad, 1400);

    await loadProgress();

    const activeModeLabels = MODE_DEFS.filter((modeDef) => state.activeModeKeys.has(modeDef.key)).map(
      (modeDef) => modeDef.label
    );

    setStatus(
      "Route loading is automatic for the map area you are viewing.",
      "ok",
      `Visible by default: ${activeModeLabels.join(", ")} | All Frequencies. Stops load only when you focus a route.`
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

init();
