const MIN_VIEWPORT_FETCH_ZOOM = 5;
const MAX_BBOX_SPAN_DEGREES = 2.2;
const MAX_TARGET_TILES_PER_VIEW = 30;
const MAX_NEW_FETCHES_PER_VIEW = 12;
const MAX_PARALLEL_FETCHES = 2;
const MAX_SESSION_AREAS = 220;
const MIN_MOVE_FETCH_INTERVAL_MS = 850;

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

const STOP_TYPE_PRESETS = {
  core: {
    label: "Stations + Platforms",
    values: [0, 1]
  },
  withEntrances: {
    label: "Stations + Platforms + Entrances",
    values: [0, 1, 2]
  },
  all: {
    label: "All Stop Types",
    values: [0, 1, 2, 3, 4]
  }
};

function validStopPreset(value) {
  return Object.prototype.hasOwnProperty.call(STOP_TYPE_PRESETS, value) ? value : "core";
}

function stopTypesForPreset(preset) {
  return STOP_TYPE_PRESETS[validStopPreset(preset)].values;
}

function stopTypesKeyForPreset(preset) {
  return stopTypesForPreset(preset).join("-");
}

function stopTypesQueryForPreset(preset) {
  return stopTypesForPreset(preset).join(",");
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
  requestedAreaKeys: new Set(),
  activeAreaKeys: new Set(),
  fetchQueue: [],
  queuedAreaKeys: new Set(),
  inFlightAreaKeys: new Set(),
  queueDrainRunning: false,
  focusedLineKey: "",
  activeModeFilter: "all",
  lineSearchQuery: "",
  stopTypePreset: validStopPreset(localStorage.getItem("metromark_stop_types") || "core"),
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
  citySelect: document.getElementById("citySelect"),
  gotoCityBtn: document.getElementById("gotoCityBtn"),
  clearSessionCacheBtn: document.getElementById("clearSessionCacheBtn"),
  resetLineFocusBtn: document.getElementById("resetLineFocusBtn"),
  lineSearch: document.getElementById("lineSearch"),
  stopTypeSelect: document.getElementById("stopTypeSelect"),
  modeFilterBar: document.getElementById("modeFilterBar"),
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
    lineMode(line),
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

function setStopTypePreset(preset) {
  state.stopTypePreset = validStopPreset(preset);
  localStorage.setItem("metromark_stop_types", state.stopTypePreset);
  els.stopTypeSelect.value = state.stopTypePreset;
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

function bboxStepFromZoom(zoom) {
  if (zoom >= 13) return 0.025;
  if (zoom >= 11) return 0.04;
  if (zoom >= 9) return 0.06;
  if (zoom >= 7) return 0.09;
  if (zoom >= 5) return 0.12;
  return 0.15;
}

function tileSpanFromZoom(zoom) {
  if (zoom >= 13) return 0.6;
  if (zoom >= 11) return 1.0;
  if (zoom >= 9) return 1.4;
  if (zoom >= 7) return 1.8;
  return 2.0;
}

function normalizeBboxForClientCache(rawBbox, zoom, stopTypesKey) {
  const step = bboxStepFromZoom(zoom);
  const snapped = [
    Math.floor(rawBbox[0] / step) * step,
    Math.floor(rawBbox[1] / step) * step,
    Math.ceil(rawBbox[2] / step) * step,
    Math.ceil(rawBbox[3] / step) * step
  ];

  const normalizedBbox = [
    clamp(snapped[0], -180, 180),
    clamp(snapped[1], -85, 85),
    clamp(snapped[2], -180, 180),
    clamp(snapped[3], -85, 85)
  ];

  return {
    areaKey: `bbox:${step.toFixed(3)}:${normalizedBbox.map((value) => value.toFixed(4)).join(",")}:types:${stopTypesKey}`,
    bbox: normalizedBbox,
    step
  };
}

function bboxQueryText(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function buildViewportTileRequests(rawBbox, zoom, stopTypesKey) {
  const span = Math.min(MAX_BBOX_SPAN_DEGREES, tileSpanFromZoom(zoom));
  const padded = expandBbox(rawBbox, span * 0.28);
  const viewCenter = bboxCenter(rawBbox);

  const westStart = Math.floor(padded[0] / span) * span;
  const southStart = Math.floor(padded[1] / span) * span;

  const requestsByKey = new Map();

  for (let west = westStart; west < padded[2]; west += span) {
    const east = clamp(west + span, -180, 180);
    if (east <= west) {
      continue;
    }

    for (let south = southStart; south < padded[3]; south += span) {
      const north = clamp(south + span, -85, 85);
      if (north <= south) {
        continue;
      }

      const normalized = normalizeBboxForClientCache([west, south, east, north], zoom, stopTypesKey);
      const center = bboxCenter(normalized.bbox);
      const dx = center[0] - viewCenter[0];
      const dy = center[1] - viewCenter[1];
      const distanceScore = dx * dx + dy * dy;

      const existing = requestsByKey.get(normalized.areaKey);
      if (!existing || distanceScore < existing.distanceScore) {
        requestsByKey.set(normalized.areaKey, {
          areaKey: normalized.areaKey,
          bbox: normalized.bbox,
          zoom,
          stopTypesKey,
          stopTypesQuery: stopTypesQueryForPreset(state.stopTypePreset),
          distanceScore
        });
      }
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
  const stopByLineAndStation = new Map();
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

    for (const feature of payload?.stopsGeoJson?.features || []) {
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
          lineName: existing.lineName || line.lineName,
          lineShortName: existing.lineShortName || line.lineShortName,
          lineLongName: existing.lineLongName || line.lineLongName,
          operatorName: existing.operatorName || line.operatorName,
          mode: existing.mode || line.mode,
          routeType: Number.isFinite(existing.routeType) ? existing.routeType : line.routeType,
          routeFeedId: existing.routeFeedId || line.routeFeedId,
          color: existing.color || line.color
        });
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
    stopCount: stopCountsByLine.get(lineKey) || 0,
    mode: line.mode || modeLabelFromRouteType(line.routeType)
  }));

  lineSummaries.sort((a, b) => {
    const stopDiff = Number(b.stopCount || 0) - Number(a.stopCount || 0);
    if (stopDiff !== 0) {
      return stopDiff;
    }
    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  if (state.focusedLineKey && !lineSummaries.some((line) => line.lineKey === state.focusedLineKey)) {
    state.focusedLineKey = "";
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
    if (state.activeModeFilter !== "all" && lineMode(line) !== state.activeModeFilter) {
      return false;
    }
    if (query && !lineSearchText(line).includes(query)) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
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
  const allowedStopTypes = new Set(stopTypesForPreset(state.stopTypePreset));

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

  const stops = state.transit.stopsGeoJson.features
    .filter((feature) => visibleLineKeys.has(feature.properties.line_key))
    .filter((feature) => {
      const stopType = Number(feature.properties.stop_location_type);
      const normalizedStopType = Number.isFinite(stopType) ? stopType : 0;
      return allowedStopTypes.has(normalizedStopType);
    })
    .map((feature) => {
      const visited = getVisitedSetForLine(feature.properties.line_key).has(feature.properties.station_key)
        ? 1
        : 0;
      const focused = !hasFocus || feature.properties.line_key === state.focusedLineKey ? 1 : 0;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          visited,
          is_focused: focused
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
    els.progressSummary.textContent = "Pan or zoom the map and transit will load automatically.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const filtered = getFilteredData();
  const totalStops = filtered.stops.features.length;
  const visitedStops = filtered.stops.features.filter((feature) => feature.properties.visited === 1).length;
  const percent = totalStops ? ((visitedStops / totalStops) * 100).toFixed(1) : "0.0";

  if (!state.user) {
    els.progressSummary.textContent = `${totalStops} visible stations loaded. Sign in to mark visited stations.`;
  } else {
    els.progressSummary.textContent = `${visitedStops}/${totalStops} visible stations visited (${percent}%).`;
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

  const chips = [
    {
      key: "all",
      label: "All",
      count: state.lineSummaries.length
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

      const label = chip.key === "all" ? "all modes" : chip.label;
      setStatus("Filter updated.", "ok", `Showing routes for ${label}.`);
    });

    els.modeFilterBar.append(button);
  }
}

function renderLineList() {
  els.lineList.innerHTML = "";
  els.resetLineFocusBtn.hidden = !state.focusedLineKey;

  if (!state.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Transit appears here once nearby areas are loaded.";
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
    meta.textContent = `${lineMode(line)} - ${lineOperatorLabel(line)}`;

    labelBlock.append(name, meta);

    const stopCount = document.createElement("span");
    stopCount.className = "line-stop-count";
    stopCount.textContent = `${line.stopCount} stops`;

    row.append(dot, labelBlock, stopCount);

    row.addEventListener("click", () => {
      state.focusedLineKey = state.focusedLineKey === line.lineKey ? "" : line.lineKey;
      renderLineList();
      renderMapData();
      renderProgress();

      if (state.focusedLineKey) {
        setStatus(
          `Focused on ${lineDisplayName(line)}.`,
          "ok",
          "Other routes remain visible in a faded state."
        );
      } else {
        setStatus("Showing all routes for the current filter.", "ok");
      }
    });

    fragment.append(row);
  }

  els.lineList.append(fragment);
}

function refreshUiFromState() {
  renderModeFilterBar();
  renderLineList();
  renderMapData();
  renderProgress();
}

function updateLoadingStatus() {
  const loadingCount = state.inFlightAreaKeys.size;
  const queuedCount = state.fetchQueue.length;

  if (loadingCount > 0 || queuedCount > 0) {
    setStatus(
      "Loading transit for the current map view...",
      "ok",
      `${state.lastLoadStats.cached} cached - ${loadingCount} loading - ${Math.max(
        queuedCount,
        state.lastLoadStats.deferred
      )} pending`
    );
    return;
  }

  if (state.lineSummaries.length > 0) {
    setStatus(
      "Transit is ready for this view.",
      "ok",
      `${state.activeAreaKeys.size} nearby areas in session cache (${STOP_TYPE_PRESETS[state.stopTypePreset].label}).`
    );
    return;
  }

  if (state.lastLoadStats.failed > 0) {
    setStatus(
      "Transit could not be loaded for this area.",
      "error",
      `${state.lastLoadStats.failed} area requests failed. Check the backend note below.`
    );
    return;
  }

  if (state.lastLoadStats.requested > 0) {
    setStatus(
      "No transit data was returned for this map area.",
      "error",
      "Try panning a little or switching Stop Visibility." 
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
      stopTypesQuery: request.stopTypesQuery,
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
      zoom: Number(job.zoom || 0).toFixed(2),
      stopTypes: job.stopTypesQuery
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
    const stations = Number(payload?.stopsGeoJson?.features?.length || 0);
    setBackendStatus(`Fetched ${job.cacheKey} (${payload.cacheStatus || "miss"} cache, ${lines} lines, ${stations} stops).`);
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
      "Zoom in a bit more and transit will load automatically.",
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

  const stopTypesKey = stopTypesKeyForPreset(state.stopTypePreset);
  const requests = buildViewportTileRequests(rawBbox, zoom, stopTypesKey);

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
      "Showing transit for the current map view.",
      "ok",
      `${cached}/${requests.length} nearby areas loaded from session cache.`
    );
    setBackendStatus("No network fetch was needed for this view.");
    return;
  }

  const queued = queueTileFetches(nextBatch, {
    forceRefresh: Boolean(options.forceRefresh)
  });

  state.lastLoadStats.queued = queued;

  setStatus(
    "Loading transit for the current map view...",
    "ok",
    `${cached} cached - ${queued} loading${
      state.lastLoadStats.deferred > 0 ? ` - ${state.lastLoadStats.deferred} deferred` : ""
    }`
  );

  setBackendStatus(
    `Stop visibility preset: ${STOP_TYPE_PRESETS[state.stopTypePreset].label} (${stopTypesQueryForPreset(
      state.stopTypePreset
    )}).`
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
  return state.cities.find((city) => city.slug === els.citySelect.value) || null;
}

async function loadCities() {
  const payload = await apiRequest("/api/catalog/cities", { method: "GET" });
  state.cities = Array.isArray(payload.cities) ? payload.cities : [];

  els.citySelect.innerHTML = "";

  for (const city of state.cities) {
    const option = document.createElement("option");
    option.value = city.slug;
    option.textContent = `${city.name}, ${city.country}`;
    els.citySelect.append(option);
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

  els.gotoCityBtn.addEventListener("click", () => {
    const city = selectedCityPreset();
    if (!city) {
      setStatus("Select a preset city first.", "error");
      return;
    }

    const trigger = () => {
      loadVisibleTransit({ forceRefresh: false, reason: "goto-city" }).catch((error) => {
        setBackendStatus(`City jump load failed: ${error.message}`);
      });
    };

    state.map.once("moveend", trigger);
    fitToArea(city);

    setStatus(
      `Moved to ${city.name}.`,
      "ok",
      "Transit will fill in automatically as this map view settles."
    );
  });

  els.clearSessionCacheBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Clear local in-browser cache for this session? Use this only if you suspect stale transit data."
    );

    if (!confirmed) {
      return;
    }

    state.areaCache.clear();
    resetViewAggregation();

    rebuildCombinedTransit();
    refreshUiFromState();

    setBackendStatus("Local session cache cleared by user.");

    try {
      await loadVisibleTransit({ forceRefresh: false, reason: "clear-cache" });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.stopTypeSelect.addEventListener("change", async () => {
    setStopTypePreset(els.stopTypeSelect.value);

    resetViewAggregation();
    rebuildCombinedTransit();
    refreshUiFromState();

    setStatus(
      "Stop visibility updated.",
      "ok",
      `Now using ${STOP_TYPE_PRESETS[state.stopTypePreset].label}.`
    );

    try {
      await loadVisibleTransit({ forceRefresh: false, reason: "stop-type-change" });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.resetLineFocusBtn.addEventListener("click", () => {
    state.focusedLineKey = "";
    renderLineList();
    renderMapData();
    renderProgress();
    setStatus("Showing all routes for the current filter.", "ok");
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
  setStopTypePreset(state.stopTypePreset);

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
      "Transit loading is automatic for the map area you are viewing.",
      "ok",
      `Current stop visibility: ${STOP_TYPE_PRESETS[state.stopTypePreset].label}.`
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

init();
