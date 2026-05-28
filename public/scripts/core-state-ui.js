// Postgres (cache-only) is primary at all zoom levels.
// Transitland fallback only triggers when zoomed in (zoom 10+) to avoid excessive API usage.
const MIN_VIEWPORT_FETCH_ZOOM = 10.0;
// Low-zoom views can span multiple metro regions; keep a larger request budget so
// distant cached areas (e.g. Seattle + DC at US scale) can load together.
const MAX_TARGET_TILES_PER_VIEW = 24;
const MAX_NEW_FETCHES_PER_VIEW = 18;
const MAX_PARALLEL_FETCHES = 2;
const MAX_SESSION_AREAS = 220;
const MAX_SESSION_ROUTE_STOP_PAYLOADS = 120;
const MIN_MOVE_FETCH_INTERVAL_MS = 1800;

const ROUTE_STOP_TYPES = [0, 1];
const ROUTE_STOP_TYPES_KEY = ROUTE_STOP_TYPES.join("-");
const ROUTE_STOP_TYPES_QUERY = ROUTE_STOP_TYPES.join(",");

const SHOW_ALL_STOPS_STORAGE_KEY = "metromark_show_all_stops";

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
const DEFAULT_ACTIVE_MODE_KEYS = [MODE_FILTER_METRO, MODE_FILTER_TRAM, MODE_FILTER_RAIL, MODE_FILTER_OTHER];

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

const LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY = "metromark_line_view_ordering_preferences";

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

function parseBooleanFromStorage(storageKey, defaultValue = false) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) {
      return defaultValue;
    }

    return raw === "true";
  } catch {
    return defaultValue;
  }
}

function persistBooleanToStorage(storageKey, value) {
  localStorage.setItem(storageKey, value ? "true" : "false");
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

function parseLineViewOrderingPreferencesFromStorage(storageKey) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }

    const preferenceMap = new Map();
    for (const [lineKeyRaw, valueRaw] of Object.entries(parsed)) {
      const lineKey = String(lineKeyRaw || "").trim();
      if (!lineKey || !valueRaw || typeof valueRaw !== "object" || Array.isArray(valueRaw)) {
        continue;
      }

      preferenceMap.set(lineKey, {
        mode: normalizeLineViewOrderingMode(valueRaw.mode),
        reversed: Boolean(valueRaw.reversed)
      });
    }

    return preferenceMap;
  } catch {
    return new Map();
  }
}

function persistLineViewOrderingPreferencesToStorage(storageKey, preferenceMap) {
  const payload = {};

  for (const [lineKeyRaw, valueRaw] of preferenceMap.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    if (!lineKey) {
      continue;
    }

    payload[lineKey] = {
      mode: normalizeLineViewOrderingMode(valueRaw?.mode),
      reversed: Boolean(valueRaw?.reversed)
    };
  }

  sessionStorage.setItem(storageKey, JSON.stringify(payload));
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

function normalizeLineViewOrderingMode(orderingMode) {
  const mode = String(orderingMode || "geometry-revised").trim();

  if (mode === "auto" || mode === "geometry-revised" || mode === "legacy-geometry" || mode === "fractions") {
    return mode;
  }

  if (mode === "geometry-only") {
    return "legacy-geometry";
  }

  if (mode === "geometry") {
    return "legacy-geometry";
  }

  if (mode === "fractions-only") {
    return "fractions";
  }

  if (mode === "geometry-revised-endpoint-anchored") {
    return "geometry-revised";
  }

  return "geometry-revised";
}

const state = {
  map: null,
  mapReady: false,
  mapReadyResolver: null,
  mapMode: "streets",
  token: localStorage.getItem("metromark_token") || sessionStorage.getItem("metromark_token") || "",
  user: null,
  cities: [],
  transit: null,
  lineSummaries: [],
  loadedLineSummaries: [],
  areaCache: new Map(),
  lineStopsCache: new Map(),
  routeStopsAutoLoadAttempts: new Map(),
  inFlightLineStopKeys: new Set(),
  inFlightHeadwayLineKeys: new Set(),
  requestedAreaKeys: new Set(),
  currentViewportBbox: null,
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
  showAllStops: parseBooleanFromStorage(SHOW_ALL_STOPS_STORAGE_KEY, false),
  showPrivateOperators: parseBooleanFromStorage("metromark_show_private_operators", false),
  showProblematicGeometries: parseBooleanFromStorage("metromark_show_problematic_geometries", false),
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
  lineViewOpen: false,
  lineViewLineKey: "",
  lineViewReturn: null,
  lineViewOrderingPreferencesByLineKey: parseLineViewOrderingPreferencesFromStorage(LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY),
  lineViewOrderingVoteClickSetsByLineKey: new Map(),
  lineViewOrderingMode: "auto",
  lineViewOrderingReversed: false,
  lineViewOrderingResolved: "geometry-revised",
  lineViewAutoOpenEnabled: localStorage.getItem("metromark_line_view_auto_open") !== "false", // Default to true
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
  postgresQueryCount: 0,
  postgresQueryFailureCount: 0,
  viewportRequestCount: 0,
  postgresViewportHitCount: 0,
  postgresViewportMissCount: 0,
  transitlandViewportFetchCount: 0,
  transitlandRestApiRequestCount: 0,
  transitlandRestApiFailureCount: 0,
  transitlandVectorTileRequestCount: 0,
  transitlandVectorTileFailureCount: 0,
  transitlandRoutingApiRequestCount: 0,
  transitlandRoutingApiFailureCount: 0,
  transitApiCooldownUntil: 0,
  loadEpoch: 0,
  lastLoadStats: {
    requested: 0,
    cached: 0,
    queued: 0,
    deferred: 0,
    failed: 0,
    successful: 0
  },
  routeReviewsByCity: new Map(),
  agencyReviewsByCity: new Map()
};

const els = {
  statusText: document.getElementById("statusText"),
  statusMeta: document.getElementById("statusMeta"),
  backendStatusText: document.getElementById("backendStatusText"),
  mapNotice: document.getElementById("mapNotice"),
  mapLoadingBadge: document.getElementById("mapLoadingBadge"),
  clearSessionCacheBtn: document.getElementById("clearSessionCacheBtn"),
  lineSearch: document.getElementById("lineSearch"),
  filterPresetsBtn: document.getElementById("filterPresetsBtn"),
  filterPresetsPanel: document.getElementById("filterPresetsPanel"),
  filterPresetList: document.getElementById("filterPresetList"),
  filterPresetName: document.getElementById("filterPresetName"),
  saveFilterPresetBtn: document.getElementById("saveFilterPresetBtn"),
  applyFilterPresetBtn: document.getElementById("applyFilterPresetBtn"),
  deleteFilterPresetBtn: document.getElementById("deleteFilterPresetBtn"),
  filterPresetsStatus: document.getElementById("filterPresetsStatus"),
  showAllStopsBtn: document.getElementById("showAllStopsBtn"),
  modeFilterBar: document.getElementById("modeFilterBar"),
  frequencyFilterBar: document.getElementById("frequencyFilterBar"),
  mobileDrawerTab: document.getElementById("mobileDrawerTab"),
  routeSelectPanel: document.getElementById("routeSelectPanel"),
  lineViewBtn: document.getElementById("lineViewBtn"),
  toggleLineViewAutoBtn: document.getElementById("toggleLineViewAutoBtn"),
  lineViewPanel: document.getElementById("lineViewPanel"),
  lineViewReturnBtn: document.getElementById("lineViewReturnBtn"),
  lineViewMapBtn: document.getElementById("lineViewMapBtn"),
  lineViewColor: document.getElementById("lineViewColor"),
  lineViewName: document.getElementById("lineViewName"),
  lineViewMeta: document.getElementById("lineViewMeta"),
  lineViewStatus: document.getElementById("lineViewStatus"),
  lineViewProgress: document.getElementById("lineViewProgress"),
  lineViewProgressText: document.getElementById("lineViewProgressText"),
  lineViewProgressFill: document.getElementById("lineViewProgressFill"),
  lineViewStops: document.getElementById("lineViewStops"),
  lineViewOrderingAutoBtn: document.getElementById("lineViewOrderingAutoBtn"),
  lineViewOrderingGeometryRevisedBtn: document.getElementById("lineViewOrderingGeometryRevisedBtn"),
  lineViewOrderingGeometryBtn: document.getElementById("lineViewOrderingGeometryBtn"),
  lineViewOrderingFractionsBtn: document.getElementById("lineViewOrderingFractionsBtn"),
  lineViewOrderingReverseBtn: document.getElementById("lineViewOrderingReverseBtn"),
  lineViewOrderingResolved: document.getElementById("lineViewOrderingResolved"),
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
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  logoutBtn: document.getElementById("logoutBtn")
};

const USER_PREFERENCE_STORAGE_KEYS = {
  theme: "metromark_theme",
  initialCitySlug: "metromark_initial_city_slug",
  lineViewAutoOpenEnabled: "metromark_line_view_auto_open",
  showAllStops: SHOW_ALL_STOPS_STORAGE_KEY,
  showPrivateOperators: "metromark_show_private_operators",
  showProblematicGeometries: "metromark_show_problematic_geometries",
  activeModeKeys: "metromark_mode_filter_keys",
  activeFrequencyKeys: "metromark_frequency_filter_keys",
  manualLineVisibility: "metromark_route_visibility_overrides"
};

function normalizePreferenceTheme(value) {
  return String(value || "").trim() === "dark" ? "dark" : "light";
}

function normalizePreferenceBoolean(value, defaultValue = false) {
  if (value === null || value === undefined) {
    return Boolean(defaultValue);
  }
  return Boolean(value);
}

function normalizePreferenceString(value) {
  return String(value || "").trim();
}

function normalizePreferenceStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => normalizePreferenceString(entry))
        .filter(Boolean)
    )
  );
}

function normalizePreferenceVisibilityMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const visibilityMap = {};
  for (const [lineKeyRaw, valueRaw] of Object.entries(value)) {
    const lineKey = normalizePreferenceString(lineKeyRaw);
    const normalizedValue = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (normalizedValue === "on" || normalizedValue === "off") {
      visibilityMap[lineKey] = normalizedValue;
    }
  }

  return visibilityMap;
}

function readStoredPreference(key, fallback = null) {
  const storageKey = USER_PREFERENCE_STORAGE_KEYS[key];
  if (!storageKey) {
    return fallback;
  }

  try {
    if (key === "activeModeKeys" || key === "activeFrequencyKeys") {
      return parseSetFromStorage(storageKey, fallback || []).values();
    }
    if (key === "manualLineVisibility") {
      return parseVisibilityOverridesFromStorage(storageKey);
    }
    if (key === "showAllStops" || key === "showPrivateOperators" || key === "showProblematicGeometries" || key === "lineViewAutoOpenEnabled") {
      return parseBooleanFromStorage(storageKey, fallback);
    }
    return localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function writeStoredPreference(key, value) {
  const storageKey = USER_PREFERENCE_STORAGE_KEYS[key];
  if (!storageKey) {
    return;
  }

  if (key === "activeModeKeys" || key === "activeFrequencyKeys") {
    persistSetToStorage(storageKey, new Set(normalizePreferenceStringList(value)));
    return;
  }

  if (key === "manualLineVisibility") {
    persistVisibilityOverridesToStorage(storageKey, normalizePreferenceVisibilityMap(value));
    return;
  }

  if (key === "showAllStops" || key === "showPrivateOperators" || key === "showProblematicGeometries" || key === "lineViewAutoOpenEnabled") {
    persistBooleanToStorage(storageKey, Boolean(value));
    return;
  }

  if (value === null || value === undefined || value === "") {
    localStorage.removeItem(storageKey);
    return;
  }

  localStorage.setItem(storageKey, String(value));
}

function normalizePreferencePatch(patch = {}) {
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(source, "theme")) {
    normalized.theme = normalizePreferenceTheme(source.theme);
  }
  if (Object.prototype.hasOwnProperty.call(source, "initialCitySlug")) {
    normalized.initialCitySlug = normalizePreferenceString(source.initialCitySlug);
  }
  if (Object.prototype.hasOwnProperty.call(source, "lineViewAutoOpenEnabled")) {
    normalized.lineViewAutoOpenEnabled = Boolean(source.lineViewAutoOpenEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(source, "showAllStops")) {
    normalized.showAllStops = Boolean(source.showAllStops);
  }
  if (Object.prototype.hasOwnProperty.call(source, "showPrivateOperators")) {
    normalized.showPrivateOperators = Boolean(source.showPrivateOperators);
  }
  if (Object.prototype.hasOwnProperty.call(source, "showProblematicGeometries")) {
    normalized.showProblematicGeometries = Boolean(source.showProblematicGeometries);
  }
  if (Object.prototype.hasOwnProperty.call(source, "activeModeKeys")) {
    normalized.activeModeKeys = normalizePreferenceStringList(source.activeModeKeys);
  }
  if (Object.prototype.hasOwnProperty.call(source, "activeFrequencyKeys")) {
    normalized.activeFrequencyKeys = normalizePreferenceStringList(source.activeFrequencyKeys);
  }
  if (Object.prototype.hasOwnProperty.call(source, "manualLineVisibility")) {
    normalized.manualLineVisibility = normalizePreferenceVisibilityMap(source.manualLineVisibility);
  }

  return normalized;
}

function applyUserPreferences(preferences = {}) {
  const normalized = normalizePreferencePatch(preferences);

  if (Object.prototype.hasOwnProperty.call(normalized, "theme")) {
    state.theme = normalized.theme;
    document.body.setAttribute("data-theme", state.theme);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "initialCitySlug")) {
    state.initialCitySlug = normalized.initialCitySlug || state.initialCitySlug;
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "lineViewAutoOpenEnabled")) {
    state.lineViewAutoOpenEnabled = Boolean(normalized.lineViewAutoOpenEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "showAllStops")) {
    state.showAllStops = Boolean(normalized.showAllStops);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "showPrivateOperators")) {
    state.showPrivateOperators = Boolean(normalized.showPrivateOperators);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "showProblematicGeometries")) {
    state.showProblematicGeometries = Boolean(normalized.showProblematicGeometries);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "activeModeKeys")) {
    state.activeModeKeys = new Set(normalized.activeModeKeys);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "activeFrequencyKeys")) {
    state.activeFrequencyKeys = new Set(normalized.activeFrequencyKeys);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "manualLineVisibility")) {
    state.manualLineVisibility = new Map(Object.entries(normalized.manualLineVisibility));
  }

  renderModeFilterBar();
  renderFrequencyFilterBar();
  renderLineList();
  renderMapData();
  renderProgress();
  renderUserStatus();
}

async function saveUserPreferences(patch = {}) {
  const normalized = normalizePreferencePatch(patch);
  const keys = Object.keys(normalized);
  if (!keys.length) {
    return null;
  }

  if (!state.user) {
    for (const [key, value] of Object.entries(normalized)) {
      writeStoredPreference(key, value);
    }
    applyUserPreferences(normalized);
    return normalized;
  }

  const payload = await apiRequest("/api/auth/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferences: normalized })
  });

  state.user = payload.user;
  applyUserPreferences(payload.user?.preferences || {});
  return payload.user?.preferences || normalized;
}

function initializeUserPreferencesFromStorage() {
  applyUserPreferences({
    theme: readStoredPreference("theme", "light"),
    initialCitySlug: readStoredPreference("initialCitySlug", "seattle"),
    lineViewAutoOpenEnabled: readStoredPreference("lineViewAutoOpenEnabled", true),
    showAllStops: readStoredPreference("showAllStops", false),
    showPrivateOperators: readStoredPreference("showPrivateOperators", false),
    showProblematicGeometries: readStoredPreference("showProblematicGeometries", false),
    activeModeKeys: Array.from(parseSetFromStorage(USER_PREFERENCE_STORAGE_KEYS.activeModeKeys, DEFAULT_ACTIVE_MODE_KEYS)),
    activeFrequencyKeys: Array.from(
      parseSetFromStorage(USER_PREFERENCE_STORAGE_KEYS.activeFrequencyKeys, DEFAULT_ACTIVE_FREQUENCY_KEYS)
    ),
    manualLineVisibility: Object.fromEntries(
      parseVisibilityOverridesFromStorage(USER_PREFERENCE_STORAGE_KEYS.manualLineVisibility)
    )
  });
}

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
  const raw = String(message || "");
  const escaped = escapeHtml(raw);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  const zoom = state.map && state.mapReady ? Number(state.map.getZoom()).toFixed(2) : "n/a";
  els.backendStatusText.innerHTML = `<span class="backend-status-zoom">Current zoom level: ${zoom}</span><br>${linked}`;
}

function clearMapNotice() {
  if (!els.mapNotice) {
    return;
  }

  els.mapNotice.hidden = true;
  els.mapNotice.innerHTML = "";
}

function setMapNotice(title, meta = "", kind = "neutral", placement = "center", detailIsHtml = false) {
  if (!els.mapNotice) {
    return;
  }

  const message = String(title || "").trim();
  const detail = String(meta || "").trim();

  // Corner placement is handled by the small badge element.
  if (placement === "corner") {
    if (!message) {
      hideMapLoadingBadge();
      return;
    }
    // show a compact badge for loading/brief status
    showMapLoadingBadge();
    return;
  }

  // Center placement: show a full map notice card. Errors use error styling;
  // neutral messages are allowed here when the map has no visible routes.
  if (!message) {
    clearMapNotice();
    return;
  }

  const className = kind === "error" ? "error" : kind === "ok" ? "ok" : "";
  els.mapNotice.className = `map-notice${className ? ` ${className}` : ""}`;
  els.mapNotice.innerHTML = `
    <div class="map-notice-card">
      <p class="map-notice-title">${escapeHtml(message)}</p>
      ${detail ? `<p class="map-notice-meta">${detailIsHtml ? detail : escapeHtml(detail)}</p>` : ""}
    </div>
  `;
  els.mapNotice.hidden = false;
}

function showMapLoadingBadge() {
  if (!els.mapLoadingBadge) return;
  els.mapLoadingBadge.hidden = false;
  els.mapLoadingBadge.textContent = "Loading...";
}

function hideMapLoadingBadge() {
  if (!els.mapLoadingBadge) return;
  els.mapLoadingBadge.hidden = true;
  els.mapLoadingBadge.textContent = "";
}

function renderApiCounter() {
  els.apiRequestCounter.textContent =
    `Queries - REST: ${state.transitlandRestApiRequestCount}, ` +
    `Vector: ${state.transitlandVectorTileRequestCount}, ` +
    `Routing: ${state.transitlandRoutingApiRequestCount}, ` +
    `Postgres: ${state.postgresQueryCount}`;

  if (els.apiRequestCounterDetail) {
    els.apiRequestCounterDetail.textContent =
      `Failures - REST: ${state.transitlandRestApiFailureCount}, ` +
      `Vector: ${state.transitlandVectorTileFailureCount}, ` +
      `Routing: ${state.transitlandRoutingApiFailureCount}, ` +
      `Postgres: ${state.postgresQueryFailureCount}`;
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
  const statusLineKey = String(
    state.userStatus?.routeLineKey || state.lineViewLineKey || state.focusedLineKey || ""
  ).trim();
  const statusLine = state.lineSummaries.find((entry) => entry.lineKey === statusLineKey);
  const statusLineColor = statusLine?.color || "#177ca2";

  if (els.userStatusTitle) {
    els.userStatusTitle.style.setProperty("--status-line-color", statusLineColor);
  }

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
    const hasProgress = Boolean(state.user) && Boolean(progress) && Number(progress.total || 0) > 0;

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

  if (els.lineViewBtn) {
    const hasLine = Boolean(state.focusedLineKey);
    els.lineViewBtn.hidden = !hasLine;
    els.lineViewBtn.disabled = !hasLine;
    els.lineViewBtn.classList.toggle("is-active", state.lineViewOpen);
    els.lineViewBtn.setAttribute("aria-pressed", state.lineViewOpen ? "true" : "false");
  }

  if (els.deselectRouteBtn) {
    els.deselectRouteBtn.hidden = !state.focusedLineKey;
  }

  renderUserFeedback();
}

function captureMapView() {
  if (!state.map) {
    return null;
  }

  const center = state.map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: state.map.getZoom(),
    bearing: state.map.getBearing(),
    pitch: state.map.getPitch()
  };
}

function restoreMapView(view) {
  if (!state.map || !view) {
    return;
  }

  state.map.jumpTo({
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch
  });
}

function collectCoordsFromGeometry(geometry, bbox) {
  if (!geometry) {
    return bbox;
  }

  const type = geometry.type;
  const coords = geometry.coordinates;
  if (!coords) {
    return bbox;
  }

  const update = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }
    bbox.minLng = Math.min(bbox.minLng, lng);
    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.maxLng = Math.max(bbox.maxLng, lng);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
  };

  if (type === "LineString") {
    coords.forEach(([lng, lat]) => update(lng, lat));
    return bbox;
  }

  if (type === "MultiLineString") {
    coords.forEach((line) => line.forEach(([lng, lat]) => update(lng, lat)));
    return bbox;
  }

  return bbox;
}

function buildLineBboxFromStops(lineKey) {
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(lineKey));
  const stopFeatures = Array.isArray(cacheEntry?.payload?.stopsGeoJson?.features)
    ? cacheEntry.payload.stopsGeoJson.features
    : [];

  if (!stopFeatures.length) {
    return null;
  }

  const bbox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  stopFeatures.forEach((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return;
    }
    const [lng, lat] = coords;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      bbox.minLng = Math.min(bbox.minLng, lng);
      bbox.minLat = Math.min(bbox.minLat, lat);
      bbox.maxLng = Math.max(bbox.maxLng, lng);
      bbox.maxLat = Math.max(bbox.maxLat, lat);
    }
  });

  if (!Number.isFinite(bbox.minLng)) {
    return null;
  }

  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
}

function buildLineBboxFromRoutes(lineKey) {
  const features = Array.isArray(state.transit?.routesGeoJson?.features)
    ? state.transit.routesGeoJson.features
    : [];

  if (!features.length) {
    return null;
  }

  const bbox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  for (const feature of features) {
    const featureLineKey = String(feature?.properties?.line_key || "").trim();
    if (featureLineKey !== lineKey) {
      continue;
    }

    collectCoordsFromGeometry(feature.geometry, bbox);
  }

  if (!Number.isFinite(bbox.minLng)) {
    return null;
  }

  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
}

function fitMapToLine(lineKey) {
  if (!state.map || !lineKey) {
    return;
  }

  const bbox = buildLineBboxFromStops(lineKey) || buildLineBboxFromRoutes(lineKey);
  if (!bbox) {
    return;
  }

  // On mobile, account for the line view header and status panel (roughly 160px at top)
  const isMobileLayout = isPortraitMobileLayout();
  const padding = isMobileLayout ? { top: 160, right: 50, bottom: 50, left: 50 } : 70;

  state.map.fitBounds(
    [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]]
    ],
    {
      padding: padding,
      duration: 650,
      maxZoom: 12.5
    }
  );
}

function stopKeyForFeature(feature) {
  const props = feature?.properties || {};
  return String(props.station_key || props.stop_id || "").trim();
}

function uniqueStopFeaturesForLine(lineKey) {
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(lineKey));
  const stopFeatures = Array.isArray(cacheEntry?.payload?.stopsGeoJson?.features)
    ? cacheEntry.payload.stopsGeoJson.features
    : [];

  const seen = new Set();
  const unique = stopFeatures.filter((feature) => {
    const key = stopKeyForFeature(feature);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique;
}

async function toggleVisitedForStation(properties, coords) {
  const lineKey = String(properties?.line_key || "").trim();
  const stationKey = String(properties?.station_key || properties?.stop_id || "").trim();
  const stationName = String(properties?.station_name || properties?.stop_name || "Unnamed Station");
  const [lon, lat] = Array.isArray(coords) ? coords : [];

  if (!lineKey || !stationKey || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return;
  }

  if (!state.user) {
    setUserStatusFromStation(properties || {}, "Sign in to mark this station as visited.");
    setStatus("Sign in first to mark stations.", "error");
    return;
  }

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
    renderLineView();

    setUserStatusFromStation(
      properties || {},
      nextVisited ? "Marked as visited in your progress." : "Marked as unvisited in your progress."
    );

    setStatus(`${nextVisited ? "Visited" : "Unvisited"}: ${stationName}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function createLineConnector(lineColor) {
  if (!els.lineViewStops) {
    return;
  }

  const existingSvg = els.lineViewStops.querySelector("#lineViewConnectorSvg");
  if (existingSvg) {
    existingSvg.remove();
  }

  const stopRows = Array.from(els.lineViewStops.querySelectorAll(".line-view-stop-row"));
  if (stopRows.length < 2) {
    return;
  }

  const containerRect = els.lineViewStops.getBoundingClientRect();
  const scrollTop = els.lineViewStops.scrollTop;
  const scrollLeft = els.lineViewStops.scrollLeft;
  const dotPositions = stopRows.map((row) => {
    const dot = row.querySelector(".line-view-stop-dot");
    if (!dot) {
      return null;
    }

    const dotRect = dot.getBoundingClientRect();

    const relativeY = dotRect.top - containerRect.top + scrollTop + dotRect.height / 2;
    const relativeX = dotRect.left - containerRect.left + scrollLeft + dotRect.width / 2;

    return {
      y: relativeY,
      x: relativeX
    };
  });

  const validPositions = dotPositions.filter((p) => p !== null);
  if (validPositions.length < 2) {
    return;
  }

  const maxY = Math.max(...validPositions.map((p) => p.y));
  const containerWidth = els.lineViewStops.offsetWidth;
  const containerHeight = Math.max(els.lineViewStops.scrollHeight, maxY + 20);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "lineViewConnectorSvg";
  svg.setAttribute("viewBox", `0 0 ${containerWidth} ${containerHeight}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = `${containerHeight}px`;
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "0";

  const pathData = validPositions
    .map((pos, idx) => {
      if (idx === 0) {
        return `M ${pos.x} ${pos.y}`;
      }
      return `L ${pos.x} ${pos.y}`;
    })
    .join(" ");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("stroke", lineColor);
  path.setAttribute("stroke-width", "4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linecap", "butt");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("opacity", "0.85");

  svg.append(path);
  els.lineViewStops.insertBefore(svg, els.lineViewStops.firstChild);
}

function lineViewOrderingModeLabel(mode) {
  const normalizedMode = normalizeLineViewOrderingMode(mode);

  if (normalizedMode === "auto") {
    return "Auto";
  }

  if (normalizedMode === "geometry-revised") {
    return "Main";
  }

  if (normalizedMode === "legacy-geometry") {
    return "U-Shape";
  }

  if (normalizedMode === "fractions") {
    return "Loop";
  }

  return "Main";
}

function lineViewOrderingTechnicalLabel(mode) {
  const normalizedMode = normalizeLineViewOrderingMode(mode);

  if (normalizedMode === "auto") {
    return "Automatic route-shape detection";
  }

  if (normalizedMode === "geometry-revised") {
    return "Geometry Revised Endpoint Anchored";
  }

  if (normalizedMode === "legacy-geometry") {
    return "Trip Pattern Geometry";
  }

  if (normalizedMode === "fractions") {
    return "Fractions Only";
  }

  return "Geometry Revised Endpoint Anchored";
}

function lineViewOrderingStatusLabel() {
  const mode = normalizeLineViewOrderingMode(state.lineViewOrderingMode);
  const resolvedMode = normalizeLineViewOrderingMode(state.lineViewOrderingResolved || mode);
  const activeMode = mode === "auto" ? resolvedMode : mode;
  const label = mode === "auto"
    ? `Auto - ${lineViewOrderingModeLabel(activeMode)} (${lineViewOrderingTechnicalLabel(activeMode)})`
    : `${lineViewOrderingModeLabel(activeMode)} (${lineViewOrderingTechnicalLabel(activeMode)})`;
  return state.lineViewOrderingReversed ? `${label} · Reversed Route` : label;
}

function getLineViewOrderingPreference(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const stored = state.lineViewOrderingPreferencesByLineKey.get(normalizedLineKey);
  if (!stored) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  return {
    mode: normalizeLineViewOrderingMode(stored.mode),
    reversed: Boolean(stored.reversed)
  };
}

function setLineViewOrderingPreference(lineKey, preference = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const current = getLineViewOrderingPreference(normalizedLineKey);
  const nextPreference = {
    mode: normalizeLineViewOrderingMode(
      Object.prototype.hasOwnProperty.call(preference, "mode") ? preference.mode : current.mode
    ),
    reversed: Object.prototype.hasOwnProperty.call(preference, "reversed")
      ? Boolean(preference.reversed)
      : Boolean(current.reversed)
  };

  state.lineViewOrderingPreferencesByLineKey.set(normalizedLineKey, nextPreference);
  persistLineViewOrderingPreferencesToStorage(
    LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY,
    state.lineViewOrderingPreferencesByLineKey
  );

  return nextPreference;
}

function applyLineViewOrderingPreference(lineKey) {
  const preference = getLineViewOrderingPreference(lineKey);
  state.lineViewOrderingMode = preference.mode;
  state.lineViewOrderingReversed = Boolean(preference.reversed);
  return preference;
}

function lineViewOrderingVoteModeForCurrentState() {
  const selectedMode = normalizeLineViewOrderingMode(state.lineViewOrderingMode);
  if (selectedMode !== "auto") {
    return selectedMode;
  }

  return normalizeLineViewOrderingMode(state.lineViewOrderingResolved || "geometry-revised");
}

function updateRouteOrderingMetadataForLine(lineKey, metadata = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey || !metadata || typeof metadata !== "object") {
    return;
  }

  const nextLineSummaries = state.lineSummaries.map((line) => {
    if (String(line?.lineKey || "").trim() !== normalizedLineKey) {
      return line;
    }

    return {
      ...line,
      lineViewOrderingDefaultMode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
      lineViewOrderingDefaultSource: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
      lineViewOrderingAdminMode: String(metadata.orderingModeAdminMode || "").trim(),
      lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
      lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
    };
  });

  state.lineSummaries = nextLineSummaries;

  if (Array.isArray(state.loadedLineSummaries) && state.loadedLineSummaries.length > 0) {
    state.loadedLineSummaries = state.loadedLineSummaries.map((line) => {
      if (String(line?.lineKey || "").trim() !== normalizedLineKey) {
        return line;
      }

      return {
        ...line,
        lineViewOrderingDefaultMode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
        lineViewOrderingDefaultSource: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
        lineViewOrderingAdminMode: String(metadata.orderingModeAdminMode || "").trim(),
        lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
        lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
      };
    });
  }

  if (state.transit?.routesGeoJson?.features) {
    state.transit.routesGeoJson.features = state.transit.routesGeoJson.features.map((feature) => {
      if (String(feature?.properties?.line_key || "").trim() !== normalizedLineKey) {
        return feature;
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          line_view_ordering_default_mode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
          line_view_ordering_default_source: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
          line_view_ordering_admin_mode: String(metadata.orderingModeAdminMode || "").trim(),
          line_view_ordering_vote_total: Number(metadata.orderingModeVoteTotal || 0)
        }
      };
    });
  }
}

async function submitLineViewOrderingVote(lineKey, orderingMode) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedMode = normalizeLineViewOrderingMode(orderingMode);
  if (!normalizedLineKey || normalizedMode === "auto" || !state.user) {
    return null;
  }

  const payload = await apiRequest("/api/transit/route-ordering/vote", {
    method: "POST",
    body: {
      lineKey: normalizedLineKey,
      citySlug: String(state.initialCitySlug || "").trim(),
      orderingMode: normalizedMode
    }
  });

  if (payload?.metadata) {
    updateRouteOrderingMetadataForLine(normalizedLineKey, payload.metadata);
  }

  if (state.lineViewOpen && String(state.lineViewLineKey || "").trim() === normalizedLineKey) {
    renderLineView();
  }

  return payload;
}

function noteLineViewOrderingVoteClick(lineKey, stopKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedStopKey = String(stopKey || "").trim();
  if (!normalizedLineKey || !normalizedStopKey || !state.user) {
    return;
  }

  let clickSet = state.lineViewOrderingVoteClickSetsByLineKey.get(normalizedLineKey);
  if (!clickSet) {
    clickSet = new Set();
    state.lineViewOrderingVoteClickSetsByLineKey.set(normalizedLineKey, clickSet);
  }

  if (clickSet.has(normalizedStopKey)) {
    return;
  }

  clickSet.add(normalizedStopKey);
  if (clickSet.size < 2) {
    return;
  }

  clickSet.clear();
  const voteMode = lineViewOrderingVoteModeForCurrentState();
  if (!voteMode || voteMode === "auto") {
    return;
  }

  submitLineViewOrderingVote(normalizedLineKey, voteMode).catch((error) => {
    console.warn("Unable to record route ordering vote:", error);
  });
}

function syncLineViewOrderingControls() {
  const mode = normalizeLineViewOrderingMode(state.lineViewOrderingMode);
  state.lineViewOrderingMode = mode;

  const buttonByMode = {
    auto: els.lineViewOrderingAutoBtn,
    "geometry-revised": els.lineViewOrderingGeometryRevisedBtn,
    "legacy-geometry": els.lineViewOrderingGeometryBtn,
    fractions: els.lineViewOrderingFractionsBtn
  };

  const buttonLabelByMode = {
    auto: "Auto",
    "geometry-revised": "Main",
    "legacy-geometry": "U-Shape",
    fractions: "Loop"
  };

  const buttonTitleByMode = {
    auto: "Automatic route-shape detection",
    "geometry-revised": "Geometry Revised Endpoint Anchored",
    "legacy-geometry": "Trip Pattern Geometry",
    fractions: "Fractions Only"
  };

  for (const [buttonMode, button] of Object.entries(buttonByMode)) {
    if (!button) {
      continue;
    }

    const isActive = buttonMode === mode;
    button.textContent = buttonLabelByMode[buttonMode] || button.textContent;
    button.title = buttonTitleByMode[buttonMode] || button.title || "";
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (els.lineViewOrderingReverseBtn) {
    const isActive = Boolean(state.lineViewOrderingReversed);
    els.lineViewOrderingReverseBtn.textContent = "Reverse Route";
    els.lineViewOrderingReverseBtn.title = "Reverse the current stop order";
    els.lineViewOrderingReverseBtn.classList.toggle("is-active", isActive);
    els.lineViewOrderingReverseBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (els.lineViewOrderingResolved) {
    els.lineViewOrderingResolved.textContent = lineViewOrderingStatusLabel();
  }
}

async function renderLineViewStops(lineKey, lineColor, options = {}) {
  if (!els.lineViewStops) {
    return;
  }

  els.lineViewStops.style.setProperty("--line-color", lineColor || "#177ca2");

  const cacheKey = routeStopCacheKey(lineKey);
  const isLoading = state.inFlightLineStopKeys.has(cacheKey);
  const sameLine = String(els.lineViewStops.dataset.lineKey || "") === String(lineKey || "");
  const stopFeatures = uniqueStopFeaturesForLine(lineKey);
  const hasRenderedStopRows = !!els.lineViewStops.querySelector('.line-view-stop-row');
  const forceRefresh = Boolean(options?.forceRefresh);

  syncLineViewOrderingControls();

  if (!stopFeatures.length) {
    if (isLoading && sameLine && hasRenderedStopRows) {
      return;
    }

    els.lineViewStops.innerHTML = "";
    els.lineViewStops.dataset.lineKey = String(lineKey || "");
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = isLoading ? "Loading stops..." : "Stops are not loaded yet.";
    els.lineViewStops.append(empty);
    return;
  }

  if (isLoading && sameLine && hasRenderedStopRows && !forceRefresh) {
    return;
  }

  if (forceRefresh || String(els.lineViewStops.dataset.lineKey || "") !== String(lineKey || "") || !hasRenderedStopRows) {
    els.lineViewStops.innerHTML = "";
    els.lineViewStops.dataset.lineKey = String(lineKey || "");
  } else {
    return;
  }

  const visitedSet = getVisitedSetForLine(lineKey);

  // Get direction sequences from cache payload if available
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(lineKey));
  const line = state.lineSummaries.find((entry) => entry.lineKey === lineKey);
  const routeLookupKey = String(line?.routeOnestopId || lineKey || "").trim();
  const directionSequences = cacheEntry?.payload?.directionStopSequences || null;
  const directionPatterns = cacheEntry?.payload?.directionStopPatterns || directionSequences?.patterns || null;
  const orderingMode = String(
    options?.orderingMode ||
    state.lineViewOrderingMode ||
    'geometry-revised'
  ).trim() || 'geometry-revised';

  syncLineViewOrderingControls();

  const featuresToRender = await orderStopsForLineView(
    stopFeatures,
    lineKey,
    directionSequences,
    orderingMode,
    routeLookupKey,
    null,
    directionPatterns
  );

  if (state.lineViewOrderingReversed) {
    featuresToRender.reverse();
  }

  syncLineViewOrderingControls();

  featuresToRender.forEach((feature, index) => {
    const props = feature?.properties || {};
    const stationName = String(props.station_name || props.stop_name || "Unnamed Station");
    const stationKey = stopKeyForFeature(feature);
    const coords = feature?.geometry?.coordinates;
    const visited = stationKey && visitedSet.has(stationKey);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "line-view-stop-row";
    if (index === 0) {
      row.classList.add("is-first");
    }
    if (index === featuresToRender.length - 1) {
      row.classList.add("is-last");
    }
    if (visited) {
      row.classList.add("is-visited");
    }

    if (!state.user) {
      row.disabled = true;
    }

    const marker = document.createElement("div");
    marker.className = "line-view-stop-marker";

    const dot = document.createElement("span");
    dot.className = "line-view-stop-dot";
    marker.append(dot);

    const content = document.createElement("div");

    const name = document.createElement("p");
    name.className = "line-view-stop-name";
    name.textContent = stationName;

    const status = document.createElement("p");
    status.className = "line-view-stop-status";
    status.textContent = state.user
      ? visited
        ? "Visited"
        : "Not visited"
      : "Sign in to track";

    content.append(name, status);
    row.append(marker, content);

    if (state.user) {
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleVisitedForStation(props, coords);
        noteLineViewOrderingVoteClick(lineKey, stationKey);
      });
    }

    els.lineViewStops.append(row);
  });

  createLineConnector(lineColor);
}

function renderLineView() {
  if (!els.lineViewPanel) {
    return;
  }

  if (!state.lineViewOpen) {
    els.lineViewPanel.hidden = true;
    return;
  }

  const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
  if (!lineKey) {
    els.lineViewPanel.hidden = true;
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === lineKey);
  const lineColor = line?.color || "#177ca2";
  const lineLabel = line ? lineDisplayName(line) : "Selected Route";

  applyLineViewOrderingPreference(lineKey);

  // Ensure panel is visible and not hidden
  if (els.lineViewPanel) {
    els.lineViewPanel.hidden = false;
    els.lineViewPanel.removeAttribute("hidden");
  }

  if (els.lineViewColor) {
    els.lineViewColor.style.backgroundColor = lineColor;
  }

  if (els.lineViewName) {
    els.lineViewName.textContent = lineLabel;
  }

  if (els.lineViewMeta) {
    els.lineViewMeta.textContent = line
      ? `${lineMode(line)} | ${lineOperatorLabel(line)}`
      : "Route details";
  }

  const progress = line ? lineProgressMetrics(lineKey, Number(line.stopCount || 0)) : null;
  const stopsLoaded = state.lineStopsCache.has(routeStopCacheKey(lineKey));
  const stopsLoading = state.inFlightLineStopKeys.has(routeStopCacheKey(lineKey));

  if (els.lineViewStatus) {
    if (!stopsLoaded && stopsLoading) {
      els.lineViewStatus.textContent = "Loading stops...";
    } else if (!stopsLoaded) {
      els.lineViewStatus.textContent = "Stops not loaded yet.";
    } else if (!state.user) {
      els.lineViewStatus.textContent = "Sign in to track visited stops.";
    } else if (progress && progress.total > 0) {
      els.lineViewStatus.textContent = `Visited ${progress.visited} of ${progress.total} stations.`;
    } else {
      els.lineViewStatus.textContent = "Stops loaded. Tap to mark visited.";
    }
  }

  if (els.lineViewProgress && els.lineViewProgressText && els.lineViewProgressFill) {
    const hasProgress = Boolean(state.user) && Boolean(progress) && Number(progress?.total || 0) > 0;
    if (hasProgress) {
      const visited = Number(progress.visited || 0);
      const total = Number(progress.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      els.lineViewProgress.hidden = false;
      els.lineViewProgressText.textContent = `${visited}/${total} stations visited (${percent}%)`;
      els.lineViewProgressFill.style.width = `${percent}%`;
    } else {
      els.lineViewProgress.hidden = true;
      els.lineViewProgressText.textContent = "";
      els.lineViewProgressFill.style.width = "0%";
    }
  }

  // Update button labels based on layout
  const isMobileLayout = isPortraitMobileLayout();
  if (els.lineViewReturnBtn) {
    els.lineViewReturnBtn.textContent = isMobileLayout ? "←" : "Close";
    els.lineViewReturnBtn.classList.toggle("mobile-icon-only", isMobileLayout);
  }
  if (els.lineViewMapBtn) {
    els.lineViewMapBtn.textContent = isMobileLayout ? "Map" : "Zoom";
  }

  // renderLineViewStops will manage dataset.lineKey itself to detect line changes
  renderLineViewStops(lineKey, lineColor).catch(() => {});
}

async function openLineView(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  if (!state.lineViewOpen) {
    state.lineViewReturn = {
      focusedLineKey: state.focusedLineKey,
      mapView: captureMapView(),
      mobilePanelsOpen: state.mobilePanelsOpen,
      activePopup: state.activePopup
    };
  }

  state.lineViewOpen = true;
  state.lineViewLineKey = normalizedLineKey;
  document.body.classList.toggle("line-view-open", true);
  closeRouteSelectionPopup();

  if (isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
  }

  if (normalizedLineKey !== state.focusedLineKey) {
    setFocusedLine(normalizedLineKey, { forceRefresh: false }).catch((error) => {
      setStatus(error.message, "error");
    });
  }

  renderLineView();
  renderUserStatus();

  await Promise.all([
    ensureLineStopsLoaded(normalizedLineKey, { silent: true }),
    ensureLineHeadwayLoaded(normalizedLineKey, { forceRefresh: false, silent: true })
  ]).catch(() => {});

  renderLineView();
}

function restoreLineViewReturnState() {
  const saved = state.lineViewReturn;
  if (!saved) {
    return;
  }

  if (saved.mapView) {
    restoreMapView(saved.mapView);
  }

  if (saved.focusedLineKey) {
    setFocusedLine(saved.focusedLineKey, { forceRefresh: false }).catch((error) => {
      setStatus(error.message, "error");
    });
  } else if (state.focusedLineKey) {
    clearFocusedLine("Route focus cleared.", "Returning to previous view.");
  }

  if (saved.activePopup) {
    setActivePopup(saved.activePopup);
  } else {
    closePopups();
  }

  if (saved.mobilePanelsOpen && isPortraitMobileLayout()) {
    setMobilePanelsOpen(true);
  }
}

function closeLineView(options = {}) {
  const shouldRestore = options.restore !== false;

  state.lineViewOpen = false;
  state.lineViewLineKey = "";
  document.body.classList.toggle("line-view-open", false);

  if (els.lineViewPanel) {
    els.lineViewPanel.hidden = true;
  }

  if (shouldRestore) {
    restoreLineViewReturnState();
  }

  state.lineViewReturn = null;
  renderUserStatus();
}

async function openLineViewMap() {
  const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
  if (!lineKey) {
    closeLineView({ restore: true });
    return;
  }

  const shouldClosePanel = isPortraitMobileLayout();
  if (shouldClosePanel) {
    closeLineView({ restore: false });
  }

  await setFocusedLine(lineKey, { forceRefresh: false });
  fitMapToLine(lineKey);
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
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeModeKeys: Array.from(state.activeModeKeys) }).catch(() => {});
  }
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
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ activeFrequencyKeys: Array.from(state.activeFrequencyKeys) }).catch(() => {});
  }
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
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ manualLineVisibility: Object.fromEntries(state.manualLineVisibility) }).catch(() => {});
  }
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

  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({ manualLineVisibility: Object.fromEntries(state.manualLineVisibility) }).catch(() => {});
  }
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

function lineIntersectsCurrentViewport(line) {
  const viewportBbox = normalizeBboxArray(state.currentViewportBbox);
  if (!viewportBbox) {
    return true;
  }

  const lineKey = String(line?.lineKey || "").trim();
  if (!lineKey) {
    return false;
  }

  const features = state.transit?.routesGeoJson?.features;
  if (!Array.isArray(features) || !features.length) {
    return false;
  }

  const routeFeature = features.find((feature) => String(feature?.properties?.line_key || "").trim() === lineKey);
  if (!routeFeature || typeof geometryIntersectsBbox !== "function") {
    return false;
  }

  return geometryIntersectsBbox(routeFeature.geometry, viewportBbox);
}

function lineIsVisible(line, options = {}) {
  const override = lineVisibilityOverride(line?.lineKey);
  if (override === "off") {
    return false;
  }

  if (!lineIntersectsCurrentViewport(line)) {
    return false;
  }

  if (override === "on") {
    return true;
  }

  // Check problematic geometry review
  if (!state.showProblematicGeometries && line?.lineKey) {
    const routeReview = state.routeReviewsByCity.get(line.lineKey);
    if (routeReview?.problematic_override === true) {
      return false;
    }
  }

  // Check operator allow/deny review
  if (!state.showPrivateOperators && line?.operatorName) {
    const agencyReview = state.agencyReviewsByCity.get(line.operatorName);
    if (agencyReview?.allowed_override === false) {
      return false;
    }
  }

  return lineVisibleFromFilters(line, options);
}

async function loadReviewsForCity(citySlug) {
  try {
    const response = await fetch(`/api/transit/reviews?citySlug=${encodeURIComponent(citySlug)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    
    // Clear existing reviews
    state.routeReviewsByCity.clear();
    state.agencyReviewsByCity.clear();
    
    // Load route reviews keyed by lineKey
    if (Array.isArray(data.routeReviews)) {
      data.routeReviews.forEach((review) => {
        state.routeReviewsByCity.set(review.line_key, review);
      });
    }
    
    // Load agency reviews keyed by operatorName
    if (Array.isArray(data.agencyReviews)) {
      data.agencyReviews.forEach((review) => {
        state.agencyReviewsByCity.set(review.operator_name, review);
      });
    }
  } catch (err) {
    console.warn(`Failed to load reviews for city ${citySlug}:`, err);
  }
}

function selectedRouteTypesForFetch() {
  // If the user has selected the special "all" mode, fetch everything.
  if (state.activeModeKeys.has(MODE_FILTER_ALL)) {
    return [];
  }

  const types = new Set();
  for (const key of Array.from(state.activeModeKeys)) {
    const def = MODE_DEF_BY_KEY.get(key);
    if (def && Array.isArray(def.routeTypes)) {
      def.routeTypes.forEach((t) => types.add(t));
    }
  }

  return Array.from(types);
}

function modeCacheKeyFromRouteTypes(routeTypes) {
  const normalized = Array.isArray(routeTypes) ? routeTypes : [];
  return normalized.length ? normalized.join("-") : "all";
}

function viewportRequestsForMode(rawBbox, zoom, routeTypes) {
  const modeKey = modeCacheKeyFromRouteTypes(routeTypes);
  return buildViewportTileRequests(rawBbox, zoom).map((request) => ({
    ...request,
    routeTypes: Array.isArray(routeTypes) ? routeTypes : [],
    areaKey: `${request.areaKey}:types:${modeKey}`
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

  // Always allow viewport fetches at any zoom level; server will decide
  // whether to return cached Postgres payloads or to fallback to Transitland.
  return true;
}

function areFilterCountsUncertain() {
  if (!canFetchViewportRoutes()) {
    return false;
  }

  if (
    (Array.isArray(state.loadedLineSummaries) && state.loadedLineSummaries.length > 0) ||
    (Array.isArray(state.lineSummaries) && state.lineSummaries.length > 0)
  ) {
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

// Interlining offset calculation - DISABLED
// This was used for rendering interlined routes with visual offset,
// but it wasn't working well. Abandoned in favor of letting overlapping
// lines stack naturally on the map.
/*
function hashLineKeyOffset(lineKey, totalLines = 1) {
  const normalized = String(lineKey || "").trim();
  if (!normalized || Number(totalLines || 0) <= 1) {
    return 0;
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0;
  }

  const spread = Math.min(4, Math.max(1, Math.floor(Number(totalLines) / 3)));
  const span = spread * 2 + 1;
  const bucket = Math.abs(hash) % span;
  return bucket - spread;
}
*/

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

function calculateLineSearchScore(line, query) {
  // query should already be lowercased and trimmed
  if (!query) return 0;
  
  const searchText = lineSearchText(line);
  if (!searchText.includes(query)) {
    return -999; // No match
  }
  
  const shortName = String(line.lineShortName || "").toLowerCase();
  const longName = String(line.lineLongName || "").toLowerCase();
  const lineName = String(line.lineName || "").toLowerCase();
  
  // Exact match on short name (best)
  if (shortName === query) return 1000;
  
  // Exact match on line name
  if (lineName === query) return 950;
  
  // Exact match on long name
  if (longName === query) return 900;
  
  // Prefix match on short name (very good)
  if (shortName.startsWith(query)) return 800;
  
  // Prefix match on line name
  if (lineName.startsWith(query)) return 750;
  
  // Prefix match on long name
  if (longName.startsWith(query)) return 700;
  
  // Substring match (good)
  const shortNameIndex = shortName.indexOf(query);
  if (shortNameIndex !== -1) {
    // Earlier matches in short name score higher
    return 500 - shortNameIndex;
  }
  
  // Substring match anywhere else
  if (searchText.includes(query)) {
    return 100;
  }
  
  return -999; // Should not reach here
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

function routeSelectionPopupHtml(lines, options = {}) {
  const includeClose = Boolean(options.includeClose);
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
      <div class="route-select-header">
        <h4>Select Route</h4>
        ${
          includeClose
            ? "<button class=\"route-select-close\" type=\"button\" data-route-select-close>Close</button>"
            : ""
        }
      </div>
      <p class="hover-subtitle">${lines.length} routes overlap here.</p>
      <div class="route-select-list">${rows}</div>
    </div>
  `;
}

function closeRouteSelectionPopup() {
  if (state.routeSelectPopup) {
    state.routeSelectPopup.remove();
  }

  if (els.routeSelectPanel) {
    els.routeSelectPanel.hidden = true;
    els.routeSelectPanel.innerHTML = "";
  }
}

function bindRouteSelectionButtons(container) {
  if (!container) {
    return;
  }

  const buttons = container.querySelectorAll("[data-route-select]");
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

  const closeButton = container.querySelector("[data-route-select-close]");
  if (closeButton) {
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      closeRouteSelectionPopup();
    });
  }
}

function openRouteSelectionPopup(lines, lngLat) {
  if (isPortraitMobileLayout() && els.routeSelectPanel) {
    closeRouteSelectionPopup();
    els.routeSelectPanel.hidden = false;
    els.routeSelectPanel.innerHTML = routeSelectionPopupHtml(lines, { includeClose: true });
    bindRouteSelectionButtons(els.routeSelectPanel);
    return;
  }

  if (!state.routeSelectPopup || !state.map) {
    return;
  }

  closeRouteSelectionPopup();
  state.routeSelectPopup.setLngLat(lngLat).setHTML(routeSelectionPopupHtml(lines)).addTo(state.map);

  const popupElement = state.routeSelectPopup.getElement();
  if (!popupElement) {
    return;
  }

  bindRouteSelectionButtons(popupElement);
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

  const details = [
    {
      label: "Operator",
      value: lineOperatorLabel(line)
    },
    {
      label: "Frequency",
      value: lineHeadwayLabel(line)
    }
  ];

  if (!isPortraitMobileLayout()) {
    details.push({
      label: "Stops",
      value: progress.total > 0 ? `${progress.total} stations loaded` : "Stops not loaded yet"
    });
  }

  setUserStatus(lineDisplayName(line), `${lineMode(line)} Line`, {
    details,
    routeLineKey: focusedLineActions,
    progress,
    feedback: ""
  });
}

function setUserStatusFromStation(properties, extraMessage = "") {
  const stationName = String(properties?.station_name || "Unnamed Station");
  const lineDescriptor = lineDisplayName({
    lineShortName: properties?.line_short_name,
    lineLongName: properties?.line_long_name || properties?.line_name,
    lineName: properties?.line_name
  }) || properties?.line_key || "Unknown line";

  const relatedLineKey = String(properties?.line_key || "").trim();
  const relatedLine = state.lineSummaries.find((entry) => entry.lineKey === relatedLineKey);
  const stationHeadwayLine = relatedLine || lineFromPropertiesForHover(properties);
  const progress = relatedLine
    ? lineProgressMetrics(relatedLineKey, Number(relatedLine.stopCount || 0))
    : null;

  // Simplified status for stations - only show essential info
  // Stop type and hub info can be shown in advanced info later if needed
  setUserStatus(stationName, `Station on ${lineDescriptor}`, {
    details: [],
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
    if (shownLines.length === 0) {
      setUserStatus("Zoom in to see stops.", "Pan or zoom the map to load transit.", {
        details: [
          {
            label: "Visible Routes",
            value: "0 Matching Current Filters"
          }
        ],
        feedback: ""
      });
      return;
    }

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

function setTheme(theme, options = {}) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", state.theme);

  if (options.persist === false) {
    return;
  }

  if (state.user) {
    saveUserPreferences({ theme: state.theme }).catch((error) => {
      console.warn("Unable to save theme preference:", error);
    });
    return;
  }

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

function setToken(token, remember = true) {
  state.token = token || "";
  if (!state.token) {
    localStorage.removeItem("metromark_token");
    sessionStorage.removeItem("metromark_token");
    return;
  }

  if (remember) {
    localStorage.setItem("metromark_token", state.token);
    sessionStorage.removeItem("metromark_token");
  } else {
    sessionStorage.setItem("metromark_token", state.token);
    localStorage.removeItem("metromark_token");
  }
}

async function apiRequest(path, options = {}) {
  const requestPath = String(path || "");
  const now = Date.now();
  const isTransitRequest = requestPath.startsWith("/api/transit/");

  if (isTransitRequest && Number(state.transitApiCooldownUntil || 0) > now) {
    throw new Error("Transit API temporarily unavailable. Retrying shortly.");
  }

  state.clientApiRequestCount += 1;
  renderApiCounter();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers
    });
  } catch (error) {
    if (isTransitRequest) {
      state.transitApiCooldownUntil = Date.now() + 30000;
      setBackendStatus("Transit backend connection failed. Pausing transit requests briefly before retrying.");
    }
    throw error;
  }

  const payload = await response.json().catch(() => ({}));

  const nextRestRequests = Number(payload?.transitlandRestApiRequests);
  const nextRestFailures = Number(payload?.transitlandRestApiRequestFailures);
  const nextVectorRequests = Number(payload?.transitlandVectorTileRequests);
  const nextVectorFailures = Number(payload?.transitlandVectorTileRequestFailures);
  const nextRoutingRequests = Number(payload?.transitlandRoutingApiRequests);
  const nextRoutingFailures = Number(payload?.transitlandRoutingApiRequestFailures);
  const nextPostgresQueries = Number(payload?.postgresQueryCount);
  const nextPostgresFailures = Number(payload?.postgresQueryFailureCount);

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
  if (Number.isFinite(nextPostgresQueries) && nextPostgresQueries >= 0) {
    state.postgresQueryCount = nextPostgresQueries;
  }
  if (Number.isFinite(nextPostgresFailures) && nextPostgresFailures >= 0) {
    state.postgresQueryFailureCount = nextPostgresFailures;
  }
  renderApiCounter();

  if (!response.ok) {
    const message = payload.error || payload.detail || `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

// Initialize line view ordering controls
function initializeDiagnostics() {
  const rerenderCurrentLineView = () => {
    if (!state.lineViewOpen || !state.lineViewLineKey) {
      syncLineViewOrderingControls();
      return;
    }

    const lineKey = String(state.lineViewLineKey).trim();
    applyLineViewOrderingPreference(lineKey);
    renderLineViewStops(
      lineKey,
      state.lineSummaries.find((entry) => entry.lineKey === lineKey)?.color || '#177ca2',
      { forceRefresh: true, orderingMode: state.lineViewOrderingMode }
    ).catch((error) => console.error('Error re-rendering line view stops:', error));
  };

  const setOrderingMode = (newMode) => {
    const normalizedMode = normalizeLineViewOrderingMode(newMode);
    const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
    if (!lineKey) {
      state.lineViewOrderingMode = normalizedMode;
      syncLineViewOrderingControls();
      return;
    }

    const current = getLineViewOrderingPreference(lineKey);
    if (current.mode === normalizedMode) {
      applyLineViewOrderingPreference(lineKey);
      syncLineViewOrderingControls();
      return;
    }

    setLineViewOrderingPreference(lineKey, { mode: normalizedMode });
    applyLineViewOrderingPreference(lineKey);
    rerenderCurrentLineView();
  };

  const toggleReverse = () => {
    const lineKey = String(state.lineViewLineKey || state.focusedLineKey || "").trim();
    if (!lineKey) {
      state.lineViewOrderingReversed = !state.lineViewOrderingReversed;
      syncLineViewOrderingControls();
      return;
    }

    const current = getLineViewOrderingPreference(lineKey);
    setLineViewOrderingPreference(lineKey, { reversed: !current.reversed });
    applyLineViewOrderingPreference(lineKey);
    rerenderCurrentLineView();
  };

  if (els.lineViewOrderingAutoBtn) {
    els.lineViewOrderingAutoBtn.addEventListener('click', () => setOrderingMode('auto'));
  }

  if (els.lineViewOrderingGeometryRevisedBtn) {
    els.lineViewOrderingGeometryRevisedBtn.addEventListener('click', () => setOrderingMode('geometry-revised'));
  }

  if (els.lineViewOrderingGeometryBtn) {
    els.lineViewOrderingGeometryBtn.addEventListener('click', () => setOrderingMode('legacy-geometry'));
  }

  if (els.lineViewOrderingFractionsBtn) {
    els.lineViewOrderingFractionsBtn.addEventListener('click', () => setOrderingMode('fractions'));
  }

  if (els.lineViewOrderingReverseBtn) {
    els.lineViewOrderingReverseBtn.addEventListener('click', toggleReverse);
  }

  syncLineViewOrderingControls();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDiagnostics);
} else {
  initializeDiagnostics();
}

