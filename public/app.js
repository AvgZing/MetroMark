const MIN_VIEWPORT_FETCH_ZOOM = 9;
const MAX_BBOX_SPAN_DEGREES = 2.2;

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
  mapMode: "streets",
  token: localStorage.getItem("metromark_token") || "",
  user: null,
  cities: [],
  currentCitySlug: "",
  transit: null,
  lineSummaries: [],
  activeLineKeys: new Set(),
  lineSelectionTouched: false,
  visitedByLine: new Map(),
  areaCache: new Map(),
  currentAreaKey: "",
  theme: localStorage.getItem("metromark_theme") || "light",
  autoFetchEnabled: localStorage.getItem("metromark_auto_fetch") !== "0",
  fetchInFlightKey: "",
  lastAutoFetchAt: 0,
  activePopup: "",
  hoverPopup: null
};

const els = {
  statusText: document.getElementById("statusText"),
  citySelect: document.getElementById("citySelect"),
  gotoCityBtn: document.getElementById("gotoCityBtn"),
  loadCityBtn: document.getElementById("loadCityBtn"),
  loadVisibleBtn: document.getElementById("loadVisibleBtn"),
  autoFetchCheckbox: document.getElementById("autoFetchCheckbox"),
  refreshCheckbox: document.getElementById("refreshCheckbox"),
  clearSessionCacheBtn: document.getElementById("clearSessionCacheBtn"),
  modeFilterSelect: document.getElementById("modeFilterSelect"),
  operatorFilterSelect: document.getElementById("operatorFilterSelect"),
  lineSortSelect: document.getElementById("lineSortSelect"),
  lineSearch: document.getElementById("lineSearch"),
  lineList: document.getElementById("lineList"),
  selectAllLinesBtn: document.getElementById("selectAllLinesBtn"),
  clearLinesBtn: document.getElementById("clearLinesBtn"),
  progressSummary: document.getElementById("progressSummary"),
  lineProgressList: document.getElementById("lineProgressList"),
  streetsModeBtn: document.getElementById("streetsModeBtn"),
  satelliteModeBtn: document.getElementById("satelliteModeBtn"),
  accountPopupBtn: document.getElementById("accountPopupBtn"),
  filtersPopupBtn: document.getElementById("filtersPopupBtn"),
  authPopup: document.getElementById("authPopup"),
  filtersPopup: document.getElementById("filtersPopup"),
  closeAuthPopupBtn: document.getElementById("closeAuthPopupBtn"),
  closeFiltersPopupBtn: document.getElementById("closeFiltersPopupBtn"),
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

function setStatus(message, kind = "neutral") {
  els.statusText.textContent = message;
  els.statusText.classList.remove("error", "ok");
  if (kind === "error") {
    els.statusText.classList.add("error");
  }
  if (kind === "ok") {
    els.statusText.classList.add("ok");
  }
}

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", state.theme);
  localStorage.setItem("metromark_theme", state.theme);
  els.themeToggleBtn.textContent =
    state.theme === "dark" ? "Switch To Light Mode" : "Switch To Dark Mode";
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function setAutoFetchEnabled(enabled) {
  state.autoFetchEnabled = Boolean(enabled);
  els.autoFetchCheckbox.checked = state.autoFetchEnabled;
  localStorage.setItem("metromark_auto_fetch", state.autoFetchEnabled ? "1" : "0");
}

function setActivePopup(name) {
  const next = state.activePopup === name ? "" : name;
  state.activePopup = next;

  els.authPopup.hidden = next !== "account";
  els.filtersPopup.hidden = next !== "filters";

  els.accountPopupBtn.classList.toggle("btn-primary", next === "account");
  els.filtersPopupBtn.classList.toggle("btn-primary", next === "filters");
}

function closePopups() {
  setActivePopup("");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function modeLabelFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  return GTFS_MODE_LABELS[numeric] || "";
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
    lineOperatorLabel(line),
    lineMode(line),
    line.routeFeedId
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function stopHoverHtml(properties) {
  const lineLabel = [properties.line_short_name, properties.line_long_name || properties.line_name]
    .filter(Boolean)
    .join(" | ");

  const operatorLabel = properties.operator_name || properties.route_feed_id || "Operator unavailable";
  const modeLabel = properties.mode || modeLabelFromRouteType(properties.route_type) || "Mode unknown";
  const assignmentMethod = properties.assignment_method || "distance";
  const feedMatch = properties.feed_match === 1 ? "feed match" : "fallback";
  const hubSpread = Number(properties.hub_spread_m || 0);

  return `
    <div class="station-hover">
      <h4>${escapeHtml(properties.station_name || "Unnamed Station")}</h4>
      <p><strong>Line:</strong> ${escapeHtml(lineLabel || properties.line_name || properties.line_key || "Unknown")}</p>
      <p><strong>Operator:</strong> ${escapeHtml(operatorLabel)} <span class="muted">(${escapeHtml(modeLabel)})</span></p>
      <p><strong>Matched:</strong> ${escapeHtml(assignmentMethod)} <span class="muted">(${escapeHtml(feedMatch)})</span></p>
      <p><strong>Distance:</strong> ${Number(properties.distance_m || 0)}m <span class="muted">source points: ${Number(properties.source_count || 1)}</span></p>
      <p><strong>Hub:</strong> ${Number(properties.hub_member_count || 1)} linked stops <span class="muted">spread: ${hubSpread}m (${escapeHtml(properties.centralization_method || "n/a")})</span></p>
      <p class="muted">stop feed: ${escapeHtml(properties.stop_feed_id || "n/a")}</p>
      <p class="muted">route feed: ${escapeHtml(properties.route_feed_id || "n/a")}</p>
    </div>
  `;
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

function mapBoundsToBbox() {
  const bounds = state.map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  if (west > east) {
    return null;
  }

  return [west, south, east, north];
}

function bboxStepFromZoom(zoom) {
  if (zoom >= 13) return 0.01;
  if (zoom >= 11) return 0.02;
  if (zoom >= 9) return 0.03;
  return 0.03;
}

function normalizeBboxForClientCache(rawBbox, zoom) {
  const step = bboxStepFromZoom(zoom);
  const snapped = [
    Math.floor(rawBbox[0] / step) * step,
    Math.floor(rawBbox[1] / step) * step,
    Math.ceil(rawBbox[2] / step) * step,
    Math.ceil(rawBbox[3] / step) * step
  ];

  return {
    areaKey: `bbox:${step.toFixed(3)}:${snapped.map((value) => value.toFixed(4)).join(",")}`,
    bbox: snapped,
    step
  };
}

function bboxQueryText(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function updateMapModeButtons() {
  const streetsActive = state.mapMode === "streets";
  els.streetsModeBtn.classList.toggle("btn-primary", streetsActive);
  els.satelliteModeBtn.classList.toggle("btn-primary", !streetsActive);
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
        "line-width": 5,
        "line-opacity": 0.26
      }
    });

    state.map.addLayer({
      id: "routes-main",
      type: "line",
      source: "routes",
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#d44d1f"],
        "line-width": 3,
        "line-opacity": 0.95
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
        "circle-opacity": 0.94
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
    state.map.on("click", () => {
      closePopups();
    });

    state.mapReady = true;
    renderMapData();
    updateMapModeButtons();
  });
}

function setMapMode(mode) {
  state.mapMode = mode;
  if (!state.map || !state.map.getLayer("satellite-base")) {
    return;
  }

  const satelliteVisibility = mode === "satellite" ? "visible" : "none";
  state.map.setLayoutProperty("satellite-base", "visibility", satelliteVisibility);
  updateMapModeButtons();
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

function rebuildCombinedTransit() {
  if (state.areaCache.size === 0) {
    state.transit = null;
    state.lineSummaries = [];
    state.activeLineKeys.clear();
    state.lineSelectionTouched = false;
    return;
  }

  const routeByLine = new Map();
  const stopByKey = new Map();
  const lineByKey = new Map();

  for (const payload of state.areaCache.values()) {
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

      const key = `${lineKey}|${stationKey}`;
      if (!stopByKey.has(key)) {
        stopByKey.set(key, feature);
      } else {
        stopByKey.set(key, mergeStopFeature(stopByKey.get(key), feature));
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

  const countByLine = new Map();
  for (const feature of stopByKey.values()) {
    const lineKey = feature.properties.line_key;
    countByLine.set(lineKey, (countByLine.get(lineKey) || 0) + 1);
  }

  const lineSummaries = [];
  for (const [lineKey, line] of lineByKey.entries()) {
    lineSummaries.push({
      ...line,
      mode: line.mode || modeLabelFromRouteType(line.routeType),
      stopCount: countByLine.get(lineKey) || 0
    });
  }

  lineSummaries.sort((a, b) => lineDisplayName(a).localeCompare(lineDisplayName(b)));

  const allLineKeys = new Set(lineSummaries.map((line) => line.lineKey));
  if (!state.lineSelectionTouched) {
    state.activeLineKeys = new Set(allLineKeys);
  } else {
    state.activeLineKeys = new Set([...state.activeLineKeys].filter((lineKey) => allLineKeys.has(lineKey)));
  }

  state.transit = {
    routesGeoJson: {
      type: "FeatureCollection",
      features: Array.from(routeByLine.values())
    },
    stopsGeoJson: {
      type: "FeatureCollection",
      features: Array.from(stopByKey.values())
    }
  };
  state.lineSummaries = lineSummaries;
}

function sortLines(lines) {
  const sortBy = String(els.lineSortSelect.value || "name");

  const sorted = [...lines];
  sorted.sort((a, b) => {
    if (sortBy === "mode") {
      const modeCompare = lineMode(a).localeCompare(lineMode(b));
      if (modeCompare !== 0) {
        return modeCompare;
      }
    }

    if (sortBy === "operator") {
      const operatorCompare = lineOperatorLabel(a).localeCompare(lineOperatorLabel(b));
      if (operatorCompare !== 0) {
        return operatorCompare;
      }
    }

    if (sortBy === "stopCount") {
      const stopCompare = Number(b.stopCount || 0) - Number(a.stopCount || 0);
      if (stopCompare !== 0) {
        return stopCompare;
      }
    }

    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  return sorted;
}

function lineMatchesFilter(line) {
  const query = String(els.lineSearch.value || "").trim().toLowerCase();
  if (query && !lineSearchText(line).includes(query)) {
    return false;
  }

  const modeFilter = String(els.modeFilterSelect.value || "all");
  if (modeFilter !== "all" && lineMode(line) !== modeFilter) {
    return false;
  }

  const operatorFilter = String(els.operatorFilterSelect.value || "all");
  if (operatorFilter !== "all" && lineOperatorLabel(line) !== operatorFilter) {
    return false;
  }

  return true;
}

function getShownLines() {
  return sortLines(state.lineSummaries.filter((line) => lineMatchesFilter(line)));
}

function populateFilterOptions() {
  const currentMode = els.modeFilterSelect.value || "all";
  const currentOperator = els.operatorFilterSelect.value || "all";

  const modeSet = new Set(["all"]);
  const operatorSet = new Set(["all"]);

  for (const line of state.lineSummaries) {
    modeSet.add(lineMode(line));
    operatorSet.add(lineOperatorLabel(line));
  }

  const modes = Array.from(modeSet).sort((a, b) => (a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)));
  const operators = Array.from(operatorSet).sort((a, b) => (a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)));

  els.modeFilterSelect.innerHTML = "";
  for (const mode of modes) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode === "all" ? "All Types" : mode;
    els.modeFilterSelect.append(option);
  }

  els.operatorFilterSelect.innerHTML = "";
  for (const operator of operators) {
    const option = document.createElement("option");
    option.value = operator;
    option.textContent = operator === "all" ? "All Operators" : operator;
    els.operatorFilterSelect.append(option);
  }

  els.modeFilterSelect.value = modes.includes(currentMode) ? currentMode : "all";
  els.operatorFilterSelect.value = operators.includes(currentOperator) ? currentOperator : "all";
}

function getVisibleLineKeys() {
  if (!state.lineSummaries.length || state.activeLineKeys.size === 0) {
    return new Set();
  }

  const shownKeys = new Set(getShownLines().map((line) => line.lineKey));
  return new Set([...state.activeLineKeys].filter((lineKey) => shownKeys.has(lineKey)));
}

function getFilteredData() {
  if (!state.transit) {
    return {
      routes: emptyFeatureCollection(),
      stops: emptyFeatureCollection()
    };
  }

  const visibleLineKeys = getVisibleLineKeys();
  if (visibleLineKeys.size === 0) {
    return {
      routes: emptyFeatureCollection(),
      stops: emptyFeatureCollection()
    };
  }

  const routes = state.transit.routesGeoJson.features.filter((feature) =>
    visibleLineKeys.has(feature.properties.line_key)
  );

  const stops = state.transit.stopsGeoJson.features
    .filter((feature) => visibleLineKeys.has(feature.properties.line_key))
    .map((feature) => {
      const visited = getVisitedSetForLine(feature.properties.line_key).has(feature.properties.station_key)
        ? 1
        : 0;

      return {
        ...feature,
        properties: {
          ...feature.properties,
          visited
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
    }
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
    els.progressSummary.textContent = "Load a preset city or visible area to view progress metrics.";
    els.lineProgressList.innerHTML = "";
    return;
  }

  const filtered = getFilteredData();
  const totalStops = filtered.stops.features.length;
  const visitedStops = filtered.stops.features.filter((feature) => feature.properties.visited === 1).length;

  const percent = totalStops ? ((visitedStops / totalStops) * 100).toFixed(1) : "0.0";

  if (!state.user) {
    els.progressSummary.textContent = `${totalStops} visible stations loaded. Log in to mark visited stations.`;
  } else {
    els.progressSummary.textContent = `${visitedStops}/${totalStops} visible stations visited (${percent}%).`;
  }

  els.lineProgressList.innerHTML = "";
  const byLine = new Map();
  const lineLookup = lineSummaryByKey();

  for (const feature of filtered.stops.features) {
    const lineKey = feature.properties.line_key;
    const summary = lineLookup.get(lineKey);
    const lineName = summary ? lineDisplayName(summary) : feature.properties.line_name || lineKey;
    const current = byLine.get(lineKey) || { lineName, visited: 0, total: 0 };
    current.total += 1;
    if (feature.properties.visited === 1) {
      current.visited += 1;
    }
    byLine.set(lineKey, current);
  }

  const lines = Array.from(byLine.values()).sort((a, b) => b.total - a.total).slice(0, 24);

  for (const row of lines) {
    const wrapper = document.createElement("div");
    wrapper.className = "line-progress-row";

    const label = document.createElement("div");
    const percentLine = row.total ? Math.round((row.visited / row.total) * 100) : 0;
    label.textContent = `${row.lineName} (${row.visited}/${row.total})`;

    const meter = document.createElement("div");
    meter.className = "progress-track";

    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = `${percentLine}%`;

    meter.append(fill);
    wrapper.append(label, document.createTextNode(`${percentLine}%`));
    wrapper.append(meter);
    els.lineProgressList.append(wrapper);
  }
}

function renderLineList() {
  els.lineList.innerHTML = "";

  if (!state.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Load transit data to view lines.";
    els.lineList.append(empty);
    return;
  }

  const shownLines = getShownLines();
  if (shownLines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "No lines match current filters.";
    els.lineList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const line of shownLines) {
    const row = document.createElement("label");
    row.className = "line-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.activeLineKeys.has(line.lineKey);
    checkbox.addEventListener("change", () => {
      state.lineSelectionTouched = true;
      if (checkbox.checked) {
        state.activeLineKeys.add(line.lineKey);
      } else {
        state.activeLineKeys.delete(line.lineKey);
      }
      renderMapData();
      renderProgress();
    });

    const labelBlock = document.createElement("div");
    const lineName = document.createElement("p");
    lineName.className = "line-name";
    lineName.textContent = lineDisplayName(line);

    const lineOperator = document.createElement("p");
    lineOperator.className = "line-operator";
    lineOperator.textContent = `${lineOperatorLabel(line)} • ${lineMode(line)}`;

    labelBlock.append(lineName, lineOperator);

    const stopCount = document.createElement("span");
    stopCount.className = "line-stop-count";
    stopCount.textContent = `${line.stopCount} stops`;

    const dot = document.createElement("span");
    dot.className = "line-color-dot";
    dot.style.backgroundColor = line.color;

    row.append(checkbox, dot, labelBlock, stopCount);
    fragment.append(row);
  }

  els.lineList.append(fragment);
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
      duration: 600
    }
  );
}

function selectedCityPreset() {
  return state.cities.find((city) => city.slug === els.citySelect.value) || null;
}

function applyAreaPayload(payload, options = {}) {
  const cacheKey = options.cacheKey || payload.cacheKey || payload.area?.key;
  if (cacheKey) {
    state.currentAreaKey = cacheKey;
    state.areaCache.set(cacheKey, payload);
  }

  rebuildCombinedTransit();
  populateFilterOptions();
  renderLineList();
  renderMapData();
  renderProgress();
}

function matchingStatsLabel(payload) {
  const stats = payload?.matchingStats || {};
  const centralizedStops = Number(stats.centralizedStops || stats.dedupedStops || payload?.stopsGeoJson?.features?.length || 0);
  const hubCount = Number(stats.hubCount || 0);
  const feedMatched = Number(stats.feedMatchedAssignments || 0);
  const fallback = Number(stats.fallbackAssignments || 0);
  return `${centralizedStops} stations, ${hubCount || "n/a"} hubs, feed-matched ${feedMatched}, fallback ${fallback}`;
}

async function loadCities() {
  const payload = await apiRequest("/api/catalog/cities", { method: "GET" });
  state.cities = payload.cities || [];

  els.citySelect.innerHTML = "";
  for (const city of state.cities) {
    const option = document.createElement("option");
    option.value = city.slug;
    option.textContent = `${city.name}, ${city.country}`;
    els.citySelect.append(option);
  }

  state.currentCitySlug = state.cities[0]?.slug || "";
  if (state.currentCitySlug) {
    els.citySelect.value = state.currentCitySlug;
  }
}

async function loadCityTransit(options = {}) {
  const city = selectedCityPreset();
  if (!city) {
    setStatus("Select a preset city first.", "error");
    return;
  }

  const forceRefresh = Boolean(options.forceRefresh || els.refreshCheckbox.checked);
  const localCacheKey = `city:${city.slug}`;

  if (!forceRefresh && state.areaCache.has(localCacheKey)) {
    applyAreaPayload(state.areaCache.get(localCacheKey), { cacheKey: localCacheKey });
    await loadProgress();
    if (options.fit !== false) {
      fitToArea(city);
    }
    setStatus(`Loaded ${city.name} from in-browser area cache. Session areas: ${state.areaCache.size}.`, "ok");
    return;
  }

  setStatus(`Loading ${city.name} transit data...`);

  const refreshSuffix = forceRefresh ? "?refresh=1" : "";
  const payload = await apiRequest(`/api/transit/city/${city.slug}${refreshSuffix}`, {
    method: "GET"
  });

  applyAreaPayload(payload, { cacheKey: payload.cacheKey || localCacheKey });
  await loadProgress();

  if (options.fit !== false) {
    fitToArea(payload.area || payload.city || city);
  }

  setStatus(
    `Loaded ${city.name}: ${matchingStatsLabel(payload)} (${payload.cacheStatus} server cache). ${payload.cacheStatus === "hit" ? "Enable Force refresh to bypass cached server data." : "Live data fetched from Transitland."}`,
    "ok"
  );
}

async function loadVisibleAreaTransit(options = {}) {
  if (!state.mapReady) {
    setStatus("Map is still loading.", "error");
    return;
  }

  const zoom = state.map.getZoom();
  if (zoom < MIN_VIEWPORT_FETCH_ZOOM) {
    if (!options.fromAuto) {
      setStatus(`Zoom to ${MIN_VIEWPORT_FETCH_ZOOM}+ before loading visible-area transit.`, "error");
    }
    return;
  }

  const rawBbox = mapBoundsToBbox();
  if (!rawBbox) {
    if (!options.fromAuto) {
      setStatus("Dateline-wrapping views are not supported yet. Pan away from the 180° meridian.", "error");
    }
    return;
  }

  const width = rawBbox[2] - rawBbox[0];
  const height = rawBbox[3] - rawBbox[1];
  if (width > MAX_BBOX_SPAN_DEGREES || height > MAX_BBOX_SPAN_DEGREES) {
    if (!options.fromAuto) {
      setStatus(`Zoom in before loading; visible span must stay under ${MAX_BBOX_SPAN_DEGREES} degrees.`, "error");
    }
    return;
  }

  const normalized = normalizeBboxForClientCache(rawBbox, zoom);
  const forceRefresh = Boolean(options.forceRefresh || els.refreshCheckbox.checked);

  if (!forceRefresh && state.areaCache.has(normalized.areaKey)) {
    applyAreaPayload(state.areaCache.get(normalized.areaKey), { cacheKey: normalized.areaKey });
    await loadProgress();
    if (!options.fromAuto) {
      setStatus(`Loaded visible area from in-browser cache. Session areas: ${state.areaCache.size}.`, "ok");
    }
    return;
  }

  if (state.fetchInFlightKey && state.fetchInFlightKey === normalized.areaKey) {
    return;
  }

  state.fetchInFlightKey = normalized.areaKey;

  try {
    if (!options.fromAuto) {
      setStatus("Loading visible-area transit data...");
    }

    const params = new URLSearchParams({
      bbox: bboxQueryText(rawBbox),
      zoom: zoom.toFixed(2)
    });

    if (forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/bbox?${params.toString()}`, {
      method: "GET"
    });

    applyAreaPayload(payload, { cacheKey: payload.cacheKey || normalized.areaKey });
    await loadProgress();

    if (!options.fromAuto) {
      setStatus(
        `Loaded visible area: ${matchingStatsLabel(payload)} (${payload.cacheStatus} server cache). Session areas: ${state.areaCache.size}. ${payload.cacheStatus === "hit" ? "Enable Force refresh to bypass cached server data." : "Live data fetched from Transitland."}`,
        "ok"
      );
    }
  } finally {
    if (state.fetchInFlightKey === normalized.areaKey) {
      state.fetchInFlightKey = "";
    }
  }
}

function onMapMoveEnd() {
  if (!state.autoFetchEnabled || !state.mapReady) {
    return;
  }

  const now = Date.now();
  if (now - state.lastAutoFetchAt < 1200) {
    return;
  }
  state.lastAutoFetchAt = now;

  loadVisibleAreaTransit({ fromAuto: true }).catch(() => {
    // Intentionally silent in auto mode.
  });
}

function setToken(token) {
  state.token = token || "";
  if (state.token) {
    localStorage.setItem("metromark_token", state.token);
  } else {
    localStorage.removeItem("metromark_token");
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
  els.currentUserLabel.textContent = loggedIn
    ? `${state.user.displayName} (${state.user.email})`
    : "-";
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

function bindEvents() {
  els.streetsModeBtn.addEventListener("click", () => setMapMode("streets"));
  els.satelliteModeBtn.addEventListener("click", () => setMapMode("satellite"));

  els.accountPopupBtn.addEventListener("click", () => setActivePopup("account"));
  els.filtersPopupBtn.addEventListener("click", () => setActivePopup("filters"));
  els.closeAuthPopupBtn.addEventListener("click", closePopups);
  els.closeFiltersPopupBtn.addEventListener("click", closePopups);

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
    const clickedToggle = els.accountPopupBtn.contains(target) || els.filtersPopupBtn.contains(target);
    const clickedPanel = els.authPopup.contains(target) || els.filtersPopup.contains(target);

    if (!clickedToggle && !clickedPanel) {
      closePopups();
    }
  });

  els.themeToggleBtn.addEventListener("click", toggleTheme);

  els.gotoCityBtn.addEventListener("click", () => {
    const city = selectedCityPreset();
    if (!city) {
      setStatus("Select a preset city first.", "error");
      return;
    }
    fitToArea(city);
  });

  els.loadCityBtn.addEventListener("click", async () => {
    try {
      await loadCityTransit({ fit: true });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.loadVisibleBtn.addEventListener("click", async () => {
    try {
      await loadVisibleAreaTransit({ fromAuto: false });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.autoFetchCheckbox.addEventListener("change", () => {
    setAutoFetchEnabled(els.autoFetchCheckbox.checked);
    setStatus(
      state.autoFetchEnabled
        ? "Auto-fetch enabled. Panning/zooming at 9+ loads and keeps visible areas in session."
        : "Auto-fetch disabled.",
      "ok"
    );
  });

  els.clearSessionCacheBtn.addEventListener("click", () => {
    state.areaCache.clear();
    state.currentAreaKey = "";
    state.transit = null;
    state.lineSummaries = [];
    state.activeLineKeys.clear();
    state.lineSelectionTouched = false;
    renderLineList();
    renderMapData();
    renderProgress();
    setStatus("Cleared in-browser session cache and current overlays. Load a city or visible area to continue.", "ok");
  });

  els.citySelect.addEventListener("change", () => {
    state.currentCitySlug = els.citySelect.value;
  });

  const onFilterChange = () => {
    renderLineList();
  };

  els.lineSearch.addEventListener("input", onFilterChange);
  els.modeFilterSelect.addEventListener("change", onFilterChange);
  els.operatorFilterSelect.addEventListener("change", onFilterChange);
  els.lineSortSelect.addEventListener("change", onFilterChange);

  els.selectAllLinesBtn.addEventListener("click", () => {
    const shownLines = getShownLines();
    state.lineSelectionTouched = true;
    for (const line of shownLines) {
      state.activeLineKeys.add(line.lineKey);
    }
    renderLineList();
    renderMapData();
    renderProgress();
  });

  els.clearLinesBtn.addEventListener("click", () => {
    const shownLines = getShownLines();
    state.lineSelectionTouched = true;
    for (const line of shownLines) {
      state.activeLineKeys.delete(line.lineKey);
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
    setStatus("Logged out.");
  });
}

async function init() {
  setTheme(state.theme);
  setAutoFetchEnabled(state.autoFetchEnabled);

  bindEvents();
  initializeMap();

  try {
    await loadCities();
    await hydrateSession();
    await loadCityTransit({ fit: true });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

init();
