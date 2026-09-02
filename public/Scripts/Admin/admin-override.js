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
  loginStatusMessage: document.getElementById("loginStatusMessage"),
  logoutBtn: document.getElementById("logoutBtn"),
  refreshMapBtn: document.getElementById("refreshMapBtn"),
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
  routeProblematic: document.getElementById("routeProblematic"),
  routeStopsList: document.getElementById("routeStopsList"),
  saveStopOrderBtn: document.getElementById("saveStopOrderBtn"),
  clearStopOrderBtn: document.getElementById("clearStopOrderBtn"),
  saveRouteBtn: document.getElementById("saveRouteBtn"),
  discardRouteBtn: document.getElementById("discardRouteBtn"),
  routeEditStatus: document.getElementById("routeEditStatus"),
  routeSearchInput: document.getElementById("routeSearchInput"),
  routeModeFilterSelect: document.getElementById("routeModeFilterSelect"),
  routeSearchInfo: document.getElementById("routeSearchInfo"),
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
  selectedRouteOverride: null,
  selectedRouteReview: null,
  routeOverlapPopup: null,
  operatorsByCity: new Map(),
  currentRouteStops: [],
  manualEdits: []
};

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
  el.textContent = message;
  el.style.color = isError ? "#a22828" : "#2e7d32";
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
  // Use the saved theme so the basemap is correct on first paint (before the
  // toggle handler runs). admin-theme.js is loaded before this file.
  const savedTheme = typeof getAdminTheme === "function" ? getAdminTheme() : "light";
  return {
    version: 8,
    sources: {
      streets: {
        type: "raster",
        tiles: cartoTileUrls(savedTheme === "dark" ? "dark_all" : "light_all"),
        tileSize: 256,
        attribution: cartoAttribution()
      },
      "routes-vector": { type: "vector", url: "pmtiles:///api/tiles/routes.pmtiles" },
      "routes-underlay": { type: "geojson", data: EMPTY_FC },
      "routes-edited": { type: "geojson", data: EMPTY_FC },
      stops: { type: "geojson", data: EMPTY_FC },
      "stops-edited": { type: "geojson", data: EMPTY_FC }
    },
    layers: [
      { id: "streets-base", type: "raster", source: "streets" },
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
  });

  state.map.on("moveend", () => {
    updateUnderlay();
    updateCurrentCity();
    loadOperatorsForViewport();
  });
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
      // Cache the raw features so the search/filter controls can narrow which
      // routes are shown and selectable without another API round-trip.
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

  if (els.routeSearchInfo) {
    const total = state.underlayFeatures ? state.underlayFeatures.length : 0;
    els.routeSearchInfo.textContent =
      query || modeFilter ? `${features.length} of ${total} routes shown` : "";
  }
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

    // Deduplicate overlapping routes at the click point and show a selector
    // when multiple lines share the same corridor (like the main map).
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
      const color = String(props.color || "#177ca2").trim();
      return `
        <button class="admin-route-select-btn" type="button" data-admin-route-select="${escapeAdminHtml(props.lineKey)}">
          <span class="admin-route-select-dot" style="background:${escapeAdminHtml(color)}"></span>
          <span class="admin-route-select-name">${escapeAdminHtml(adminLineDisplayName(props))}</span>
          <span class="admin-route-select-meta">${escapeAdminHtml(props.lineKey)}</span>
        </button>`;
    })
    .join("");

  state.routeOverlapPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    offset: 16
  })
    .setLngLat(lngLat)
    .setHTML(
      `<div class="admin-route-select-popup">
        <h4>Select Route</h4>
        <p class="admin-route-select-hint">${features.length} routes overlap here.</p>
        <div class="admin-route-select-list">${rows}</div>
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

// Deduplicate stop features by their station key — the same primary identity
// the line view uses (stopIdentityKey falls back to station_key). The raw
// route-stops payload contains one feature per source stop, so a route that
// loops or interlines produces duplicate station keys; deduping here keeps the
// stop-order list (and the saved custom order) consistent with line view.
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

// Order stop features by a previously saved custom stop order (matched by
// station key), appending any unmatched stops at the end — mirrors line view's
// orderByCustomStopKeys so the editor shows exactly what line view will render.
function orderAdminStopsByCustomOrder(features, customStops) {
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
    const feature = byKey.get(key);
    if (feature) {
      ordered.push(feature);
      seen.add(key);
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
    const params = new URLSearchParams({ lineKey, stopTypes: "0,1" });
    const payload = await fetch(`/api/transit/route-stops?${params.toString()}`).then((r) => r.json());
    if (Array.isArray(payload?.stopsGeoJson?.features)) {
      source.setData(payload.stopsGeoJson);

      // Deduplicate by station key, then apply a saved custom order if the
      // admin has set one, so the editor matches line view exactly.
      let stops = dedupeAdminStopFeatures(payload.stopsGeoJson.features);
      if (state.selectedRouteOverride && Array.isArray(state.selectedRouteOverride.payload?.stops)) {
        stops = orderAdminStopsByCustomOrder(stops, state.selectedRouteOverride.payload.stops);
      }
      state.currentRouteStops = stops.slice();
      renderStopsOrderList();
    }
  } catch {
    // non-critical — stations still editable via other flows
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
  stops.forEach((feature, index) => {
    const p = feature.properties || {};
    const row = document.createElement("div");
    row.className = "stop-order-row";

    const pos = document.createElement("span");
    pos.className = "stop-order-pos";
    pos.textContent = String(index + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "stop-order-name";
    name.textContent = String(p.station_name || p.stop_name || p.station_key || "Stop");

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

    row.append(pos, name, up, down);
    els.routeStopsList.append(row);
  });
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
      return {
        key: String(p.station_key || ""),
        name: String(p.station_name || p.stop_name || p.station_key || ""),
        lat: Number.isFinite(Number(coords[1])) ? Number(coords[1]) : null,
        lon: Number.isFinite(Number(coords[0])) ? Number(coords[0]) : null
      };
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

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    setEditStatus(els.routeEditStatus, `Stop order saved (${stops.length} stops).`);
    recordManualEdit("route", `${lineKey} · stop order`, `${stops.length} stops in custom order`);
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
  els.routeProblematic.checked = false;
  state.problematicTouched = false;
  setEditStatus(els.routeEditStatus, "Loaded from tile properties.");

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
      setEditStatus(els.routeEditStatus, "Loaded existing override + tile properties.");
    }

    // Problematic checkbox reflects the system's auto-detection, but the manual
    // override still wins: once the admin has decided, the checkbox shows their
    // choice (checked = disabled by default).
    const review = (reviewsPayload.reviews || []).find((r) => r.line_key === state.selectedLineKey);
    const manualOverride = review ? review.problematic_override : undefined;
    const autoProblematic = Boolean(headwayPayload?.headwayByLineKey?.[state.selectedLineKey]?.problematicGeometry);
    const effectiveProblematic = manualOverride === true || (manualOverride !== false && autoProblematic);
    if (review) {
      state.selectedRouteReview = review;
    }
    els.routeProblematic.checked = Boolean(effectiveProblematic);

    loadStopsForRoute(state.selectedLineKey);
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
}

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

async function saveRouteEdits() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;

  const payload = {};
  const name = String(els.routeName.value || "").trim();
  const short = String(els.routeShortName.value || "").trim();
  const long = String(els.routeLongName.value || "").trim();
  const operator = String(els.routeOperator.value || "").trim();
  const modeRaw = String(els.routeMode.value || "").trim();
  const color = String(els.routeColor.value || "").trim();
  const ordering = String(els.routeOrdering.value || "").trim();

  if (name) payload.lineName = name;
  if (short) payload.lineShortName = short;
  if (long) payload.lineLongName = long;
  if (operator) payload.operatorName = operator;
  if (modeRaw) payload.mode = Number(modeRaw);
  if (color) payload.color = color;
  if (ordering) payload.orderingMode = ordering;

  try {
    const result = await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });

    // Problematic geometry: persist an explicit decision only when the admin
    // actually changed the toggle. If they left it as loaded (auto-detected or
    // not), write null so the system's auto-detection keeps governing and the
    // toggle keeps reflecting it on the next load. If they changed it, write
    // their explicit true/false as the manual override.
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
    recordManualEdit(
      "route",
      `${lineKey}${name ? " · " + name : ""}`,
      [color ? `color ${color}` : "", ordering ? `ordering ${ordering}` : "", modeRaw ? `mode ${MODE_LABELS[Number(modeRaw)] || modeRaw}` : "", problematic ? "disabled-by-default" : ""].filter(Boolean).join(", ")
    );
    addRouteHighlight(lineKey, result.override?.payload || payload);
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
  try {
    if (state.currentCitySlug) {
      const payload = await apiRequest(`/api/admin/reviews/agencies?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" });
      reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    }
  } catch {
    reviews = [];
  }
  const reviewByOperator = new Map(reviews.map((r) => [r.operator_name, r]));

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
    label.title = hidden ? "Hidden by default (users can re-enable)" : "Shown by default";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn " + (hidden ? "btn-danger" : "btn-subtle");
    toggle.textContent = hidden ? "Shown: click to hide" : "Hide by default";
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
  els.loginBtn.addEventListener("click", async () => {
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
  });

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

  els.batchHideBtn.addEventListener("click", () => batchByMode(true));
  els.batchShowBtn.addEventListener("click", () => batchByMode(false));
  els.hideAllOperatorsBtn.addEventListener("click", () => batchAllOperators(true));
  els.showAllOperatorsBtn.addEventListener("click", () => batchAllOperators(false));
}

async function bootApp() {
  await loadCities();
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
