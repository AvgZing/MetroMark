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
  visitedByLine: new Map()
};

const els = {
  statusText: document.getElementById("statusText"),
  citySelect: document.getElementById("citySelect"),
  loadCityBtn: document.getElementById("loadCityBtn"),
  refreshCheckbox: document.getElementById("refreshCheckbox"),
  lineSearch: document.getElementById("lineSearch"),
  lineList: document.getElementById("lineList"),
  selectAllLinesBtn: document.getElementById("selectAllLinesBtn"),
  clearLinesBtn: document.getElementById("clearLinesBtn"),
  progressSummary: document.getElementById("progressSummary"),
  lineProgressList: document.getElementById("lineProgressList"),
  streetsModeBtn: document.getElementById("streetsModeBtn"),
  satelliteModeBtn: document.getElementById("satelliteModeBtn"),
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
        attribution:
          "&copy; OpenStreetMap contributors &copy; CARTO"
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

function initializeMap() {
  state.map = new maplibregl.Map({
    container: "map",
    style: createMapStyle(),
    center: [-30, 25],
    zoom: 1.7,
    maxPitch: 80,
    antialias: true
  });

  state.map.addControl(new maplibregl.NavigationControl(), "top-right");

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
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 11, 5, 14, 8],
        "circle-color": ["case", ["==", ["get", "visited"], 1], "#1a9b66", "#d9563a"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.25,
        "circle-opacity": 0.94
      }
    });

    state.map.on("click", "stops-layer", onStopClicked);
    state.map.on("mouseenter", "stops-layer", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });
    state.map.on("mouseleave", "stops-layer", () => {
      state.map.getCanvas().style.cursor = "";
    });

    state.mapReady = true;
    renderMapData();
  });
}

function setMapMode(mode) {
  state.mapMode = mode;
  if (!state.map || !state.map.getLayer("satellite-base")) {
    return;
  }

  const satelliteVisibility = mode === "satellite" ? "visible" : "none";
  state.map.setLayoutProperty("satellite-base", "visibility", satelliteVisibility);
}

function normalizeLineName(line) {
  return `${line.lineName || "Line"} ${(line.operatorName || "").trim()}`.trim().toLowerCase();
}

function renderLineList() {
  els.lineList.innerHTML = "";

  if (!state.lineSummaries.length) {
    const empty = document.createElement("p");
    empty.className = "microcopy";
    empty.textContent = "Load a city to view transit lines.";
    els.lineList.append(empty);
    return;
  }

  const query = els.lineSearch.value.trim().toLowerCase();
  const fragment = document.createDocumentFragment();

  for (const line of state.lineSummaries) {
    if (query && !normalizeLineName(line).includes(query)) {
      continue;
    }

    const row = document.createElement("label");
    row.className = "line-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.activeLineKeys.has(line.lineKey);
    checkbox.addEventListener("change", () => {
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
    lineName.textContent = line.lineName;

    const lineOperator = document.createElement("p");
    lineOperator.className = "line-operator";
    lineOperator.textContent = line.operatorName || "Operator unavailable";

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

function getVisitedSetForLine(lineKey) {
  const set = state.visitedByLine.get(lineKey);
  if (set) {
    return set;
  }
  const fresh = new Set();
  state.visitedByLine.set(lineKey, fresh);
  return fresh;
}

function getVisibleLineKeys() {
  if (!state.lineSummaries.length) {
    return new Set();
  }

  if (state.activeLineKeys.size === 0) {
    return new Set();
  }

  return state.activeLineKeys;
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

function renderProgress() {
  if (!state.transit) {
    els.progressSummary.textContent = "Load a city to view progress metrics.";
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

  for (const feature of filtered.stops.features) {
    const lineKey = feature.properties.line_key;
    const lineName = feature.properties.line_name || lineKey;
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

async function loadCityTransit() {
  const citySlug = els.citySelect.value;
  if (!citySlug) {
    return;
  }

  state.currentCitySlug = citySlug;
  setStatus(`Loading ${citySlug} transit data...`);

  const refreshSuffix = els.refreshCheckbox.checked ? "?refresh=1" : "";
  const payload = await apiRequest(`/api/transit/city/${citySlug}${refreshSuffix}`, {
    method: "GET"
  });

  state.transit = payload;
  state.lineSummaries = payload.lineSummaries || [];
  state.activeLineKeys = new Set(state.lineSummaries.map((line) => line.lineKey));

  renderLineList();
  await loadProgress();
  renderMapData();
  renderProgress();

  fitToCity(payload.city);
  setStatus(
    `Loaded ${payload.lineSummaries.length} lines and ${payload.stopsGeoJson.features.length} stations (${payload.cacheStatus} cache).`,
    "ok"
  );
}

function fitToCity(city) {
  if (!state.map || !state.mapReady || !city) {
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = city.bbox;
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
  } catch (error) {
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
    const set = getVisitedSetForLine(item.lineKey);
    set.add(item.stationKey);
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
}

async function loginWithPayload(payloadPromise) {
  const payload = await payloadPromise;
  setToken(payload.token);
  state.user = payload.user;
  updateAuthUi();
  await loadProgress();
  renderMapData();
  renderProgress();
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
  const visited = visitedSet.has(stationKey);
  const nextVisited = !visited;

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

    const action = nextVisited ? "Visited" : "Unvisited";
    setStatus(`${action}: ${stationName}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function bindEvents() {
  els.streetsModeBtn.addEventListener("click", () => setMapMode("streets"));
  els.satelliteModeBtn.addEventListener("click", () => setMapMode("satellite"));

  els.loadCityBtn.addEventListener("click", async () => {
    try {
      await loadCityTransit();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  els.citySelect.addEventListener("change", () => {
    state.currentCitySlug = els.citySelect.value;
  });

  els.lineSearch.addEventListener("input", () => {
    renderLineList();
  });

  els.selectAllLinesBtn.addEventListener("click", () => {
    state.activeLineKeys = new Set(state.lineSummaries.map((line) => line.lineKey));
    renderLineList();
    renderMapData();
    renderProgress();
  });

  els.clearLinesBtn.addEventListener("click", () => {
    state.activeLineKeys.clear();
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
    renderMapData();
    renderProgress();
    setStatus("Logged out.");
  });
}

async function init() {
  bindEvents();
  initializeMap();

  try {
    await loadCities();
    await hydrateSession();
    await loadCityTransit();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

init();
