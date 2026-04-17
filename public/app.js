const MIN_VIEWPORT_FETCH_ZOOM = 5;
const MAX_TARGET_TILES_PER_VIEW = 12;
const MAX_NEW_FETCHES_PER_VIEW = 4;
const MAX_PARALLEL_FETCHES = 2;
const MAX_SESSION_AREAS = 220;
const MAX_SESSION_ROUTE_STOP_PAYLOADS = 120;
const MIN_MOVE_FETCH_INTERVAL_MS = 1100;

const ROUTE_STOP_TYPES = [0, 1];
const ROUTE_STOP_TYPES_KEY = ROUTE_STOP_TYPES.join("-");
const ROUTE_STOP_TYPES_QUERY = ROUTE_STOP_TYPES.join(",");

const MODE_FILTER_ALL = "all";
const MODE_FILTER_NON_BUS = "non-bus";

const FREQUENCY_FILTER_ALL = "all";
const FREQUENCY_FILTER_HIGHER = "higher";
const FREQUENCY_FILTER_LOWER = "lower";
const FREQUENCY_FILTER_UNKNOWN = "unknown";

const GTFS_MODE_LABELS = {
  0: "Tram",
  1: "Subway",
  2: "Rail",
  3: "Bus",
  4: "Ferry",
  5: "Cable Tram",
  6: "Aerial",
  7: "Funicular",
  11: "Trolleybus",
  12: "Monorail"
};

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
  requestedAreaKeys: new Set(),
  activeAreaKeys: new Set(),
  fetchQueue: [],
  queuedAreaKeys: new Set(),
  inFlightAreaKeys: new Set(),
  queueDrainRunning: false,
  focusedLineKey: "",
  activeModeFilter: MODE_FILTER_NON_BUS,
  activeFrequencyFilter: FREQUENCY_FILTER_ALL,
  lineSearchQuery: "",
  initialCitySlug: localStorage.getItem("metromark_initial_city_slug") || "seattle",
  theme: localStorage.getItem("metromark_theme") || "light",
  lastMoveFetchAt: 0,
  activePopup: "",
  hoverPopup: null,
  visitedByLine: new Map(),
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
  resetLineFocusBtn: document.getElementById("resetLineFocusBtn"),
  lineSearch: document.getElementById("lineSearch"),
  modeFilterBar: document.getElementById("modeFilterBar"),
  frequencyFilterBar: document.getElementById("frequencyFilterBar"),
  lineList: document.getElementById("lineList"),
  progressSummary: document.getElementById("progressSummary"),
  lineProgressList: document.getElementById("lineProgressList"),
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

function modeLabelFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }
  return GTFS_MODE_LABELS[numeric] || "Unknown";
}

function lineMode(line) {
  return String(line.mode || modeLabelFromRouteType(line.routeType) || "Unknown");
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

function frequencyBucketFromHeadwayMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return FREQUENCY_FILTER_UNKNOWN;
  }

  if (minutes <= 12) {
    return FREQUENCY_FILTER_HIGHER;
  }

  return FREQUENCY_FILTER_LOWER;
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
    explicit === FREQUENCY_FILTER_HIGHER ||
    explicit === FREQUENCY_FILTER_LOWER ||
    explicit === FREQUENCY_FILTER_UNKNOWN
  ) {
    return explicit;
  }

  if (isRailLikeRouteType(line?.routeType)) {
    return FREQUENCY_FILTER_HIGHER;
  }

  if (isBusLikeRouteType(line?.routeType)) {
    return FREQUENCY_FILTER_LOWER;
  }

  return FREQUENCY_FILTER_UNKNOWN;
}

function frequencyBucketLabel(bucket) {
  if (bucket === FREQUENCY_FILTER_HIGHER) return "Higher Frequency";
  if (bucket === FREQUENCY_FILTER_LOWER) return "Lower Frequency";
  return "Frequency Unknown";
}

function lineHeadwayLabel(line) {
  const bestHeadwayMinutes = lineHeadwayBestMinutes(line);
  if (bestHeadwayMinutes !== null) {
    return `Best headway ~${bestHeadwayMinutes} min`;
  }

  return frequencyBucketLabel(lineFrequencyBucket(line));
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

function stopHoverHtml(properties) {
  const lineLabel = [properties.line_short_name, properties.line_long_name || properties.line_name]
    .filter(Boolean)
    .join(" | ");

  const operatorLabel = properties.operator_name || properties.route_feed_id || "Operator unavailable";
  const modeLabel = properties.mode || modeLabelFromRouteType(properties.route_type);
  const assignmentMethod = properties.assignment_method || "distance";
  const feedMatch = properties.feed_match === 1 ? "feed match" : "fallback";

  return `
    <div class="station-hover">
      <h4>${escapeHtml(properties.station_name || "Unnamed Station")}</h4>
      <p><strong>Line:</strong> ${escapeHtml(lineLabel || properties.line_name || properties.line_key || "Unknown")}</p>
      <p><strong>Operator:</strong> ${escapeHtml(operatorLabel)} <span class="muted">(${escapeHtml(modeLabel)})</span></p>
      <p><strong>Matched:</strong> ${escapeHtml(assignmentMethod)} <span class="muted">(${escapeHtml(feedMatch)})</span></p>
      <p><strong>Stop Type:</strong> ${escapeHtml(stopLocationTypeLabel(properties.stop_location_type))}</p>
      <p><strong>Hub:</strong> ${Number(properties.hub_member_count || 1)} linked stops <span class="muted">spread ${Number(properties.hub_spread_m || 0)}m</span></p>
      <p class="muted">stop feed: ${escapeHtml(properties.stop_feed_id || "n/a")}</p>
      <p class="muted">route feed: ${escapeHtml(properties.route_feed_id || "n/a")}</p>
    </div>
  `;
}

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", state.theme);
  localStorage.setItem("metromark_theme", state.theme);
  els.themeToggleBtn.textContent = state.theme === "dark" ? "Light" : "Dark";
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function setActivePopup(name) {
  const next = state.activePopup === name ? "" : name;
  state.activePopup = next;

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

function syncActiveAreaKeys() {
  state.activeAreaKeys = new Set();
  const now = Date.now();

  for (const key of state.requestedAreaKeys) {
    const entry = state.areaCache.get(key);
    if (!entry) {
      continue;
    }

    entry.lastUsedAt = now;
    state.activeAreaKeys.add(key);
  }
}

function resetViewAggregation() {
  state.loadEpoch += 1;
  state.requestedAreaKeys = new Set();
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
    state.transit = null;
    state.lineSummaries = [];
    state.focusedLineKey = "";
    return;
  }

  const routeByLine = new Map();
  const lineByKey = new Map();

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

      if (!lineByKey.has(lineKey)) {
        lineByKey.set(lineKey, {
          ...line,
          mode: line.mode || modeLabelFromRouteType(line.routeType)
        });
      } else {
        const existing = lineByKey.get(lineKey);
        lineByKey.set(lineKey, {
          ...existing,
          routeOnestopId: existing.routeOnestopId || line.routeOnestopId,
          lineName: existing.lineName || line.lineName,
          lineShortName: existing.lineShortName || line.lineShortName,
          lineLongName: existing.lineLongName || line.lineLongName,
          operatorName: existing.operatorName || line.operatorName,
          mode: existing.mode || line.mode,
          routeType: Number.isFinite(existing.routeType) ? existing.routeType : line.routeType,
          routeFeedId: existing.routeFeedId || line.routeFeedId,
          serviceTier: existing.serviceTier || line.serviceTier,
          frequencyBucket: existing.frequencyBucket || line.frequencyBucket,
          headwayBestMinutes: Number.isFinite(Number(existing.headwayBestMinutes))
            ? Number(existing.headwayBestMinutes)
            : Number.isFinite(Number(line.headwayBestMinutes))
              ? Number(line.headwayBestMinutes)
              : null,
          headwaySource: existing.headwaySource || line.headwaySource || "",
          color: existing.color || line.color
        });
      }
    }
  }

  if (state.focusedLineKey && !lineByKey.has(state.focusedLineKey)) {
    state.focusedLineKey = "";
  }

  const stopByLineAndStation = new Map();
  const activeStopTypeKey = ROUTE_STOP_TYPES_KEY;
  const now = Date.now();

  for (const entry of state.lineStopsCache.values()) {
    if (!entry || entry.stopTypesKey !== activeStopTypeKey) {
      continue;
    }

    if (!lineByKey.has(entry.lineKey)) {
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

  const lineSummaries = Array.from(lineByKey.entries()).map(([lineKey, line]) => ({
    ...line,
    routeOnestopId: line.routeOnestopId || "",
    stopCount: stopCountsByLine.get(lineKey) || 0,
    mode: line.mode || modeLabelFromRouteType(line.routeType),
    serviceTier: line.serviceTier || lineServiceTier(line),
    frequencyBucket: line.frequencyBucket || lineFrequencyBucket(line),
    headwayBestMinutes: lineHeadwayBestMinutes(line),
    headwaySource: String(line.headwaySource || "")
  }));

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

  if (
    state.activeModeFilter === MODE_FILTER_NON_BUS &&
    !lineSummaries.some((line) => !isBusLikeRouteType(line.routeType))
  ) {
    state.activeModeFilter = MODE_FILTER_ALL;
  }

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

function getShownLines() {
  const query = String(state.lineSearchQuery || "").trim().toLowerCase();

  const filtered = state.lineSummaries.filter((line) => {
    if (state.activeModeFilter === MODE_FILTER_NON_BUS && isBusLikeRouteType(line.routeType)) {
      return false;
    }

    if (
      state.activeModeFilter !== MODE_FILTER_ALL &&
      state.activeModeFilter !== MODE_FILTER_NON_BUS &&
      lineMode(line) !== state.activeModeFilter
    ) {
      return false;
    }

    if (
      state.activeFrequencyFilter !== FREQUENCY_FILTER_ALL &&
      lineFrequencyBucket(line) !== state.activeFrequencyFilter
    ) {
      return false;
    }

    if (query && !lineSearchText(line).includes(query)) {
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

function getVisibleLineKeys(shownLines) {
  return new Set(shownLines.map((line) => line.lineKey));
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
      shownLines: []
    };
  }

  const shownLines = getShownLines();
  const visibleLineKeys = getVisibleLineKeys(shownLines);
  const allowedStopTypes = new Set(ROUTE_STOP_TYPES);

  if (visibleLineKeys.size === 0) {
    return {
      routes: emptyFeatureCollection(),
      stops: emptyFeatureCollection(),
      shownLines
    };
  }

  const hasFocus = Boolean(state.focusedLineKey);

  const routes = state.transit.routesGeoJson.features
    .filter((feature) => visibleLineKeys.has(feature.properties.line_key))
    .map((feature) => {
      const focused = !hasFocus || feature.properties.line_key === state.focusedLineKey ? 1 : 0;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          is_focused: focused
        }
      };
    });

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
    shownLines
  };
}

function renderMapData() {
  if (!state.mapReady || !state.map) {
    return;
  }

  const filtered = getFilteredData();
  state.map.getSource("routes").setData(filtered.routes);
  state.map.getSource("stops").setData(filtered.stops);
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

  if (!state.focusedLineKey) {
    const activeStopTypeKey = ROUTE_STOP_TYPES_KEY;
    const visibleLineKeys = new Set(state.lineSummaries.map((line) => line.lineKey));
    const cachedRouteStops = Array.from(state.lineStopsCache.values()).filter(
      (entry) => entry?.stopTypesKey === activeStopTypeKey && visibleLineKeys.has(entry.lineKey)
    ).length;

    els.progressSummary.textContent = `${state.lineSummaries.length} routes visible. Select a route to load stops.`;
    els.lineProgressList.innerHTML = "";

    if (cachedRouteStops > 0) {
      const note = document.createElement("p");
      note.className = "microcopy";
      note.textContent = `${cachedRouteStops} focused-route stop sets cached for this view.`;
      els.lineProgressList.append(note);
    }

    return;
  }

  const filtered = getFilteredData();
  const totalStops = filtered.stops.features.length;
  const visitedStops = filtered.stops.features.filter((feature) => feature.properties.visited === 1).length;
  const percent = totalStops ? ((visitedStops / totalStops) * 100).toFixed(1) : "0.0";

  if (totalStops === 0) {
    els.progressSummary.textContent = "Loading stops for the selected route...";
    els.lineProgressList.innerHTML = "";
    return;
  }

  if (!state.user) {
    els.progressSummary.textContent = `${totalStops} route-linked stations loaded. Sign in to mark visited stations.`;
  } else {
    els.progressSummary.textContent = `${visitedStops}/${totalStops} selected-route stations visited (${percent}%).`;
  }

  els.lineProgressList.innerHTML = "";

  const byLine = new Map();
  const lineLookup = lineSummaryByKey();

  for (const feature of filtered.stops.features) {
    const lineKey = feature.properties.line_key;
    const lineName = lineLookup.has(lineKey)
      ? lineDisplayName(lineLookup.get(lineKey))
      : feature.properties.line_name || lineKey;

    const current = byLine.get(lineKey) || { lineName, visited: 0, total: 0 };
    current.total += 1;
    if (feature.properties.visited === 1) {
      current.visited += 1;
    }
    byLine.set(lineKey, current);
  }

  const rows = Array.from(byLine.values()).sort((a, b) => b.total - a.total).slice(0, 18);

  for (const row of rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "line-progress-row";

    const label = document.createElement("div");
    label.textContent = `${row.lineName} (${row.visited}/${row.total})`;

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

  if (!state.lineSummaries.length) {
    return;
  }

  const counts = new Map();
  for (const line of state.lineSummaries) {
    const mode = lineMode(line);
    counts.set(mode, (counts.get(mode) || 0) + 1);
  }

  const nonBusCount = state.lineSummaries.filter((line) => !isBusLikeRouteType(line.routeType)).length;

  const chips = [
    {
      key: MODE_FILTER_ALL,
      label: "All",
      count: state.lineSummaries.length
    },
    {
      key: MODE_FILTER_NON_BUS,
      label: "Rail + Rapid",
      count: nonBusCount
    },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([mode, count]) => ({
        key: mode,
        label: mode,
        count
      }))
  ];

  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-chip";
    button.textContent = `${chip.label} (${chip.count})`;

    if (state.activeModeFilter === chip.key) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      state.activeModeFilter = chip.key;

      const shown = getShownLines();
      if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
        state.focusedLineKey = "";
      }

      renderModeFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();

      let label = chip.label;
      if (chip.key === MODE_FILTER_ALL) {
        label = "all modes";
      }
      if (chip.key === MODE_FILTER_NON_BUS) {
        label = "rail and rapid modes";
      }

      setStatus("Filter updated.", "ok", `Showing routes for ${label}.`);
    });

    els.modeFilterBar.append(button);
  }
}

function renderFrequencyFilterBar() {
  els.frequencyFilterBar.innerHTML = "";

  if (!state.lineSummaries.length) {
    return;
  }

  const buckets = new Map([
    [FREQUENCY_FILTER_HIGHER, 0],
    [FREQUENCY_FILTER_LOWER, 0],
    [FREQUENCY_FILTER_UNKNOWN, 0]
  ]);

  for (const line of state.lineSummaries) {
    const bucket = lineFrequencyBucket(line);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }

  const chips = [
    {
      key: FREQUENCY_FILTER_ALL,
      label: "All Frequencies",
      count: state.lineSummaries.length
    },
    {
      key: FREQUENCY_FILTER_HIGHER,
      label: "Frequent (<=12m)",
      count: buckets.get(FREQUENCY_FILTER_HIGHER) || 0
    },
    {
      key: FREQUENCY_FILTER_LOWER,
      label: "Lower Frequency",
      count: buckets.get(FREQUENCY_FILTER_LOWER) || 0
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

    if (state.activeFrequencyFilter === chip.key) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      state.activeFrequencyFilter = chip.key;

      const shown = getShownLines();
      if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
        state.focusedLineKey = "";
      }

      renderFrequencyFilterBar();
      renderLineList();
      renderMapData();
      renderProgress();

      const label = chip.key === FREQUENCY_FILTER_ALL ? "all frequencies" : chip.label;
      setStatus("Frequency filter updated.", "ok", `Showing routes for ${label}.`);
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

async function ensureLineHeadwayLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (lineHeadwayBestMinutes(line) !== null && !options.forceRefresh) {
    return true;
  }

  const routeLookupKey = String(line.routeOnestopId || normalizedLineKey).trim();

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

    const headwayBestMinutes = Number(payload?.headwayBestMinutes);
    const normalizedHeadwayBestMinutes = Number.isFinite(headwayBestMinutes)
      ? Number(headwayBestMinutes.toFixed(1))
      : null;
    const headwaySource = String(payload?.headwaySource || "");

    const routeStopsEntry = state.lineStopsCache.get(routeStopCacheKey(normalizedLineKey));
    if (routeStopsEntry?.payload?.lineSummaries?.[0]) {
      routeStopsEntry.payload.lineSummaries[0].headwayBestMinutes = normalizedHeadwayBestMinutes;
      routeStopsEntry.payload.lineSummaries[0].headwaySource = headwaySource;
      routeStopsEntry.payload.lineSummaries[0].frequencyBucket =
        payload?.frequencyBucket || routeStopsEntry.payload.lineSummaries[0].frequencyBucket;
      routeStopsEntry.payload.headwaySummary = payload?.headwaySummary || null;
      routeStopsEntry.lastUsedAt = Date.now();
    }

    for (const areaEntry of state.areaCache.values()) {
      const summaries = areaEntry?.payload?.lineSummaries;
      if (!Array.isArray(summaries)) {
        continue;
      }

      const found = summaries.find((summary) => summary?.lineKey === normalizedLineKey);
      if (!found) {
        continue;
      }

      found.headwayBestMinutes = normalizedHeadwayBestMinutes;
      found.headwaySource = headwaySource;
      found.frequencyBucket = payload?.frequencyBucket || found.frequencyBucket;
      areaEntry.lastUsedAt = Date.now();
    }

    rebuildCombinedTransit();
    refreshUiFromState();
    setBackendStatus(
      normalizedHeadwayBestMinutes !== null
        ? `Headway data ready for ${lineDisplayName(line)} (best ~${normalizedHeadwayBestMinutes} min).`
        : `Headway data unavailable for ${lineDisplayName(line)}.`
    );

    return true;
  } catch (error) {
    setBackendStatus(`Headway fetch failed for ${lineDisplayName(line)}: ${error.message}`);
    return false;
  }
}

async function setFocusedLine(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return;
  }

  const shouldClear = state.focusedLineKey === normalizedLineKey && !options.force;
  if (shouldClear) {
    state.focusedLineKey = "";
    renderLineList();
    renderMapData();
    renderProgress();
    setStatus("Route focus cleared.", "ok", "Select any route to load its stops.");
    return;
  }

  state.focusedLineKey = normalizedLineKey;
  renderLineList();
  renderMapData();
  renderProgress();

  setStatus(
    `Focused on ${lineDisplayName(line)}.`,
    "ok",
    "Loading route-linked stops. Other routes stay visible in a faded state."
  );

  await ensureLineStopsLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: false
  });

  ensureLineHeadwayLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh)
  }).catch(() => {});

  renderMapData();
  renderProgress();
}

function renderLineList() {
  els.lineList.innerHTML = "";
  els.resetLineFocusBtn.hidden = !state.focusedLineKey;

  if (!state.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Routes appear here once nearby areas are loaded.";
    els.lineList.append(empty);
    return;
  }

  const shownLines = getShownLines();

  if (!shownLines.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "No routes match this search/filter in the current view.";
    els.lineList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const line of shownLines) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "line-item";

    const focused = state.focusedLineKey && state.focusedLineKey === line.lineKey;
    const faded = state.focusedLineKey && state.focusedLineKey !== line.lineKey;

    if (focused) {
      row.classList.add("is-focused");
    }
    if (faded) {
      row.classList.add("is-faded");
    }

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

    labelBlock.append(name, meta);

    const stopCount = document.createElement("span");
    stopCount.className = "line-stop-count";
    stopCount.textContent = Number(line.stopCount || 0) > 0 ? `${line.stopCount} stops` : "Load stops";

    row.append(dot, labelBlock, stopCount);

    row.addEventListener("click", () => {
      setFocusedLine(line.lineKey).catch((error) => {
        setStatus(error.message, "error");
      });
    });

    fragment.append(row);
  }

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

    const payload = await apiRequest(`/api/transit/bbox?${params.toString()}`, {
      method: "GET"
    });

    if (job.epoch !== state.loadEpoch) {
      return;
    }

    cacheAreaPayload(job.cacheKey, payload, payload.cacheStatus || "miss");
    state.lastLoadStats.successful += 1;

    syncActiveAreaKeys();
    rebuildCombinedTransit();
    refreshUiFromState();

    const lines = Number(payload?.lineSummaries?.length || 0);
    setBackendStatus(
      `Fetched ${job.cacheKey} (${payload.cacheStatus || "miss"} cache, ${lines} routes). Select a route to load stops.`
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
  if (zoom < MIN_VIEWPORT_FETCH_ZOOM) {
    setStatus(
      "Zoom in a bit more and routes will load automatically.",
      "error",
      "At world-scale views, loading is paused to avoid timeouts and unnecessary API calls."
    );
    return;
  }

  const rawBbox = mapBoundsToBbox();
  if (!rawBbox) {
    setStatus(
      "This view crosses the 180-degree line and cannot be loaded yet.",
      "error",
      "Pan away from the dateline and transit will resume loading."
    );
    return;
  }

  const requests = buildViewportTileRequests(rawBbox, zoom);

  state.requestedAreaKeys = new Set(requests.map((request) => request.areaKey));
  trimQueuedFetchesToCurrentView();

  syncActiveAreaKeys();
  rebuildCombinedTransit();
  refreshUiFromState();

  if (!requests.length) {
    setStatus("No nearby request tiles were generated for this view.", "error");
    return;
  }

  const cached = requests.filter((request) => state.areaCache.has(request.areaKey)).length;
  const missing = requests.filter((request) => options.forceRefresh || !state.areaCache.has(request.areaKey));
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
  if (!state.user) {
    setStatus("Sign in first to mark stations.", "error");
    return;
  }

  const feature = event.features && event.features[0];
  if (!feature) {
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
    setStatus(`${nextVisited ? "Visited" : "Unvisited"}: ${stationName}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function onStopHoverMove(event) {
  const feature = event.features && event.features[0];
  if (!feature || !state.hoverPopup) {
    return;
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

    state.map.addLayer({
      id: "routes-casing",
      type: "line",
      source: "routes",
      paint: {
        "line-color": "#0f1b22",
        "line-width": ["case", ["==", ["get", "is_focused"], 1], 5, 4],
        "line-opacity": ["case", ["==", ["get", "is_focused"], 1], 0.3, 0.1]
      }
    });

    state.map.addLayer({
      id: "routes-main",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
        "line-width": ["case", ["==", ["get", "is_focused"], 1], 3.4, 2.5],
        "line-opacity": ["case", ["==", ["get", "is_focused"], 1], 0.95, 0.26]
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
          8,
          ["+", 3, ["min", 9, ["/", ["coalesce", ["get", "hub_spread_m"], 0], 34]]],
          11,
          ["+", 5, ["min", 12, ["/", ["coalesce", ["get", "hub_spread_m"], 0], 28]]],
          14,
          ["+", 8, ["min", 18, ["/", ["coalesce", ["get", "hub_spread_m"], 0], 22]]]
        ],
        "circle-color": ["case", ["==", ["get", "visited"], 1], "#1a9b66", "#d9563a"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": [
          "+",
          1,
          ["min", 2.2, ["/", ["coalesce", ["get", "hub_member_count"], 1], 8]]
        ],
        "circle-opacity": ["case", ["==", ["get", "is_focused"], 1], 0.94, 0.32],
        "circle-stroke-opacity": ["case", ["==", ["get", "is_focused"], 1], 1, 0.45]
      }
    });

    state.map.on("click", "routes-main", (event) => {
      const feature = event.features && event.features[0];
      const lineKey = feature?.properties?.line_key;
      if (!lineKey) {
        return;
      }

      setFocusedLine(lineKey).catch((error) => {
        setStatus(error.message, "error");
      });
    });

    state.map.on("mouseenter", "routes-main", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });

    state.map.on("mouseleave", "routes-main", () => {
      state.map.getCanvas().style.cursor = "";
    });

    state.map.on("click", "stops-layer", onStopClicked);
    state.map.on("mouseenter", "stops-layer", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });
    state.map.on("mousemove", "stops-layer", onStopHoverMove);
    state.map.on("mouseleave", "stops-layer", () => {
      state.map.getCanvas().style.cursor = "";
      onStopHoverLeave();
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

  els.streetsModeBtn.addEventListener("click", () => setMapMode("streets"));
  els.satelliteModeBtn.addEventListener("click", () => setMapMode("satellite"));

  els.accountPopupBtn.addEventListener("click", () => setActivePopup("account"));
  els.closeAuthPopupBtn.addEventListener("click", closePopups);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePopups();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!state.activePopup) {
      return;
    }

    const target = event.target;
    const clickedToggle = els.accountPopupBtn.contains(target);
    const clickedPanel = els.authPopup.contains(target);

    if (!clickedToggle && !clickedPanel) {
      closePopups();
    }
  });

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

  els.resetLineFocusBtn.addEventListener("click", () => {
    state.focusedLineKey = "";
    renderLineList();
    renderMapData();
    renderProgress();
    setStatus("Showing all routes for the current filter.", "ok", "Select a route to load stops.");
  });

  els.lineSearch.addEventListener("input", () => {
    state.lineSearchQuery = String(els.lineSearch.value || "").trim().toLowerCase();

    const shown = getShownLines();
    if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
      state.focusedLineKey = "";
    }

    renderLineList();
    renderMapData();
    renderProgress();
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
  setTheme(state.theme);

  bindEvents();
  initializeMap();

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

    setStatus(
      "Route loading is automatic for the map area you are viewing.",
      "ok",
      `Stops load only when you focus a route (location types ${ROUTE_STOP_TYPES_QUERY}).`
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

init();
