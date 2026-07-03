const SESSION_KEY = "metromark_admin_session_token";

const state = {
  adminKey: sessionStorage.getItem(SESSION_KEY) || "",
  overrideKey: "",
  map: null,
  mapReady: false,
  routes: [],
  currentRouteTransit: null,
  currentOverride: null,
  selectedLineKey: "",
  selectedCitySlug: "",
  editedStops: [],
  mapMode: "streets",
  draggingStopIndex: null,
  currentRouteReview: null,
  operatorReviews: new Map(),
  cityOperators: new Set()
};

const els = {
  overrideMap: document.getElementById("overrideMap"),
  overrideStreetsModeBtn: document.getElementById("overrideStreetsModeBtn"),
  overrideSatelliteModeBtn: document.getElementById("overrideSatelliteModeBtn"),
  overrideLineKey: document.getElementById("overrideLineKey"),
  loadOverrideRouteBtn: document.getElementById("loadOverrideRouteBtn"),
  overrideRouteSelect: document.getElementById("overrideRouteSelect"),
  overrideStatus: document.getElementById("overrideStatus"),
  overrideEditPanel: document.getElementById("overrideEditPanel"),
  overrideAgency: document.getElementById("overrideAgency"),
  overrideMode: document.getElementById("overrideMode"),
  overrideFrequency: document.getElementById("overrideFrequency"),
  overrideOrderingMode: document.getElementById("overrideOrderingMode"),
  overrideStopsList: document.getElementById("overrideStopsList"),
  saveOverrideBtn: document.getElementById("saveOverrideBtn"),
  discardOverrideBtn: document.getElementById("discardOverrideBtn"),
  problematicGeometryCheckbox: document.getElementById("problematicGeometryCheckbox"),
  operatorReviewList: document.getElementById("operatorReviewList")
};

async function getAdminKey() {
  state.adminKey = String(sessionStorage.getItem(SESSION_KEY) || "").trim();

  if (!state.adminKey) {
    setStatus("Please log in at /admin first.");
    return null;
  }

  return state.adminKey;
}

function setStatus(message, kind = "neutral") {
  if (els.overrideStatus) {
    els.overrideStatus.textContent = message;
    els.overrideStatus.className = `override-status status-${kind}`;
  }
  console.log(`[Override] ${message}`);
}

async function apiRequest(path, options = {}) {
  const key = await getAdminKey();
  if (!key) throw new Error("Admin key required");
  
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function initializeMap() {
  if (state.mapReady) return;

  state.map = new maplibregl.Map({
    container: els.overrideMap,
    style: "https://demotiles.maplibre.org/style.json",
    center: [-122.33, 47.6],
    zoom: 11,
    attributionControl: true
  });

  state.map.on("load", () => {
    state.mapReady = true;
    setStatus("Map ready");
    renderRouteMap();
  });

  state.map.on("style.load", () => {
    renderRouteMap();
  });

  state.map.on("error", (err) => {
    console.error("Map error:", err);
  });

  // Map mode buttons
  els.overrideStreetsModeBtn?.addEventListener("click", () => {
    state.mapMode = "streets";
    state.map.setStyle("https://demotiles.maplibre.org/style.json");
  });

  els.overrideSatelliteModeBtn?.addEventListener("click", () => {
    state.mapMode = "satellite";
    state.map.setStyle("https://demotiles.maplibre.org/styles/osm-bright-gl-style/style-cdn.json").catch(() => {
      // Fallback to streets if satellite unavailable
      state.map.setStyle("https://demotiles.maplibre.org/style.json");
    });
  });
}

function routeStopsFromTransitPayload(payload) {
  const features = Array.isArray(payload?.stopsGeoJson?.features) ? payload.stopsGeoJson.features : [];
  return features.map((feature, index) => {
    const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const props = feature?.properties || {};
    return {
      key: String(props.station_key || props.stop_id || props.source_sample_id || index).trim(),
      name: String(props.station_name || props.stop_name || "Unnamed Stop").trim(),
      lat: Number(coords[1]),
      lon: Number(coords[0])
    };
  });
}

function renderRouteMap() {
  if (!state.map || !state.mapReady || !state.currentRouteTransit) {
    return;
  }

  const routesGeoJson = state.currentRouteTransit.routesGeoJson || { type: "FeatureCollection", features: [] };
  const stopsGeoJson = state.currentRouteTransit.stopsGeoJson || { type: "FeatureCollection", features: [] };

  const updateSource = (sourceId, data) => {
    const source = state.map.getSource(sourceId);
    if (source && typeof source.setData === "function") {
      source.setData(data);
      return true;
    }
    return false;
  };

  if (!updateSource("override-route-source", routesGeoJson)) {
    if (!state.map.getSource("override-route-source")) {
      state.map.addSource("override-route-source", {
        type: "geojson",
        data: routesGeoJson
      });
      if (!state.map.getLayer("override-route-line")) {
        state.map.addLayer({
          id: "override-route-line",
          type: "line",
          source: "override-route-source",
          paint: {
            "line-color": "#177ca2",
            "line-width": 4,
            "line-opacity": 0.9
          }
        });
      }
    }
  }

  if (!updateSource("override-stop-source", stopsGeoJson)) {
    if (!state.map.getSource("override-stop-source")) {
      state.map.addSource("override-stop-source", {
        type: "geojson",
        data: stopsGeoJson
      });
      if (!state.map.getLayer("override-stop-circles")) {
        state.map.addLayer({
          id: "override-stop-circles",
          type: "circle",
          source: "override-stop-source",
          paint: {
            "circle-radius": 5,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#177ca2",
            "circle-stroke-width": 2
          }
        });
      }
    }
  }

  const routeFeatures = Array.isArray(routesGeoJson.features) ? routesGeoJson.features : [];
  const bounds = new maplibregl.LngLatBounds();
  let hasBounds = false;

  for (const feature of routeFeatures) {
    const geometry = feature?.geometry;
    if (!geometry || !Array.isArray(geometry.coordinates)) {
      continue;
    }

    const walkCoordinates = (coords) => {
      if (!Array.isArray(coords)) {
        return;
      }
      if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        bounds.extend(coords);
        hasBounds = true;
        return;
      }
      coords.forEach(walkCoordinates);
    };

    walkCoordinates(geometry.coordinates);
  }

  if (hasBounds) {
    state.map.fitBounds(bounds, { padding: 70, duration: 250, maxZoom: 14 });
  }
}

function syncRouteFieldsFromSelection(lineKey) {
  if (els.overrideLineKey) {
    els.overrideLineKey.value = lineKey;
  }
  if (els.overrideRouteSelect && els.overrideRouteSelect.value !== lineKey) {
    els.overrideRouteSelect.value = lineKey;
  }
}

async function loadTransitRoute(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  setStatus("Loading route geometry...");
  const data = await apiRequest(`/api/transit/route-stops?lineKey=${encodeURIComponent(normalizedLineKey)}`);
  state.currentRouteTransit = data || null;
  renderRouteMap();
  return data;
}

function replaceEditedStops(nextStops) {
  state.editedStops = Array.isArray(nextStops) ? nextStops.map((stop, index) => ({
    key: String(stop?.key || stop?.station_key || stop?.stop_id || `manual-${index}`).trim(),
    name: String(stop?.name || stop?.station_name || stop?.stop_name || `Stop ${index + 1}`).trim(),
    lat: Number(stop?.lat),
    lon: Number(stop?.lon)
  })) : [];
}

function addEditedStop() {
  state.editedStops.push({
    key: `manual-${Date.now()}-${state.editedStops.length + 1}`,
    name: `Stop ${state.editedStops.length + 1}`,
    lat: null,
    lon: null
  });
  renderStopsList();
}

function moveEditedStop(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= state.editedStops.length) {
    return;
  }

  const [item] = state.editedStops.splice(index, 1);
  state.editedStops.splice(targetIndex, 0, item);
  renderStopsList();
}

async function loadRoutes() {
  try {
    setStatus("Loading routes...");
    const data = await apiRequest("/api/admin/overrides/route");
    state.routes = Array.isArray(data.overrides) ? data.overrides : [];
    renderRouteSelect();
    setStatus(`Loaded ${state.routes.length} routes`);
  } catch (err) {
    setStatus(`⚠ Failed to load routes: ${err.message}`, "error");
  }
}

function renderRouteSelect() {
  if (!els.overrideRouteSelect) return;

  const selected = els.overrideRouteSelect.value;
  els.overrideRouteSelect.innerHTML = '<option value="">Select a route to edit...</option>';

  state.routes.forEach((route) => {
    const option = document.createElement("option");
    option.value = route.line_key;
    option.textContent = `${route.line_key} (${route.city_slug})`;
    els.overrideRouteSelect.appendChild(option);
  });

  if (selected) {
    els.overrideRouteSelect.value = selected;
  }
}

async function loadReviews(citySlug) {
  try {
    const data = await apiRequest(`/api/transit/reviews?citySlug=${encodeURIComponent(citySlug)}`);
    
    // Load route review
    const routeReviews = Array.isArray(data.routeReviews) ? data.routeReviews : [];
    state.currentRouteReview = routeReviews.find((r) => r.line_key === state.selectedLineKey) || null;
    
    // Load operator reviews
    state.operatorReviews.clear();
    const agencyReviews = Array.isArray(data.agencyReviews) ? data.agencyReviews : [];
    agencyReviews.forEach((review) => {
      state.operatorReviews.set(review.operator_name, review);
    });
    
    // Collect all operators from the current override to build operator list
    state.cityOperators.clear();
    if (state.currentOverride?.payload?.agency) {
      state.cityOperators.add(state.currentOverride.payload.agency);
    }
    // Also add operators from all reviews for this city
    agencyReviews.forEach((review) => {
      state.cityOperators.add(review.operator_name);
    });
  } catch (err) {
    console.warn("Failed to load reviews:", err);
    state.currentRouteReview = null;
    state.operatorReviews.clear();
  }
}

function renderReviews() {
  // Render problematic geometry checkbox
  if (els.problematicGeometryCheckbox) {
    els.problematicGeometryCheckbox.checked = state.currentRouteReview?.problematic_override === true;
  }

  // Render operator list
  if (els.operatorReviewList) {
    if (state.cityOperators.size === 0) {
      els.operatorReviewList.innerHTML = '<p class="microcopy">No operators for this city yet.</p>';
      return;
    }

    els.operatorReviewList.innerHTML = "";
    const sortedOperators = Array.from(state.cityOperators).sort();
    
    sortedOperators.forEach((operatorName) => {
      const review = state.operatorReviews.get(operatorName);
      const allowedOverride = review?.allowed_override;
      
      const item = document.createElement("div");
      item.className = "operator-review-item";
      
      const nameSpan = document.createElement("span");
      nameSpan.className = "operator-name";
      nameSpan.textContent = operatorName;
      
      const togglesDiv = document.createElement("div");
      togglesDiv.className = "operator-review-toggles";
      
      // Allow button
      const allowBtn = document.createElement("button");
      allowBtn.type = "button";
      allowBtn.className = "operator-toggle-btn";
      if (allowedOverride === true) {
        allowBtn.classList.add("allowed");
      }
      allowBtn.textContent = allowedOverride === true ? "✓" : "•";
      allowBtn.title = "Allow operator";
      allowBtn.addEventListener("click", () => {
        const newState = allowedOverride === true ? null : true;
        state.operatorReviews.set(operatorName, { operator_name: operatorName, allowed_override: newState });
        renderReviews();
      });
      
      // Block button
      const blockBtn = document.createElement("button");
      blockBtn.type = "button";
      blockBtn.className = "operator-toggle-btn";
      if (allowedOverride === false) {
        blockBtn.classList.add("blocked");
      }
      blockBtn.textContent = allowedOverride === false ? "✕" : "•";
      blockBtn.title = "Block operator";
      blockBtn.addEventListener("click", () => {
        const newState = allowedOverride === false ? null : false;
        state.operatorReviews.set(operatorName, { operator_name: operatorName, allowed_override: newState });
        renderReviews();
      });
      
      togglesDiv.append(allowBtn, blockBtn);
      item.append(nameSpan, togglesDiv);
      els.operatorReviewList.appendChild(item);
    });
  }
}

async function selectRoute(lineKey) {
  if (!lineKey) {
    state.selectedLineKey = "";
    state.currentOverride = null;
    state.currentRouteTransit = null;
    els.overrideEditPanel.hidden = true;
    renderRouteMap();
    setStatus("Route deselected");
    return;
  }

  try {
    setStatus("Loading route...");
    const data = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`);
    state.selectedLineKey = lineKey;
    state.currentOverride = data.override || null;
    state.selectedCitySlug = state.currentOverride?.city_slug || "";

    const transitData = await loadTransitRoute(lineKey);
    
    if (state.currentOverride && state.currentOverride.payload) {
      const payload = state.currentOverride.payload;
      els.overrideAgency.value = payload.agency || "";
      els.overrideMode.value = String(payload.mode || "");
      els.overrideFrequency.value = payload.frequency || "";
      if (els.overrideOrderingMode) {
        els.overrideOrderingMode.value = String(payload.orderingMode || "");
      }
      replaceEditedStops(payload.stops);
    } else {
      // No override yet - load base route data if available
      els.overrideAgency.value = "";
      els.overrideMode.value = "";
      els.overrideFrequency.value = "";
      if (els.overrideOrderingMode) {
        els.overrideOrderingMode.value = "";
      }
      replaceEditedStops(routeStopsFromTransitPayload(transitData));
    }

    if (!state.editedStops.length) {
      replaceEditedStops(routeStopsFromTransitPayload(transitData));
    }

    // Load reviews for this city
    if (state.selectedCitySlug) {
      await loadReviews(state.selectedCitySlug);
    }

    syncRouteFieldsFromSelection(lineKey);
    renderStopsList();
    renderReviews();
    els.overrideEditPanel.hidden = false;
    setStatus(`Editing: ${lineKey}`);
  } catch (err) {
    setStatus(`⚠ Failed to load route: ${err.message}`, "error");
  }
}

function renderStopsList() {
  if (!els.overrideStopsList) return;

  els.overrideStopsList.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "override-stops-toolbar";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-subtle";
  addBtn.textContent = "Add stop";
  addBtn.addEventListener("click", addEditedStop);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn-subtle";
  resetBtn.textContent = "Reset from route";
  resetBtn.addEventListener("click", () => {
    replaceEditedStops(routeStopsFromTransitPayload(state.currentRouteTransit));
    renderStopsList();
  });

  toolbar.append(addBtn, resetBtn);
  els.overrideStopsList.appendChild(toolbar);

  state.editedStops.forEach((stop, index) => {
    const item = document.createElement("div");
    item.className = "override-stop-item";
    if (state.draggingStopIndex === index) {
      item.classList.add("is-dragging");
    }

    const handle = document.createElement("div");
    handle.className = "override-stop-drag-handle";
    handle.textContent = "⋮";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      state.draggingStopIndex = index;
      e.dataTransfer.effectAllowed = "move";
      renderStopsList();
    });
    handle.addEventListener("dragend", () => {
      state.draggingStopIndex = null;
      renderStopsList();
    });

    const fields = document.createElement("div");
    fields.className = "override-stop-fields";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "override-stop-name-input";
    nameInput.value = stop.name || `Stop ${index + 1}`;
    nameInput.addEventListener("input", () => {
      state.editedStops[index].name = String(nameInput.value || "").trim();
    });

    const latInput = document.createElement("input");
    latInput.type = "number";
    latInput.step = "any";
    latInput.className = "override-stop-coordinate-input";
    latInput.placeholder = "Lat";
    latInput.value = Number.isFinite(Number(stop.lat)) ? String(stop.lat) : "";
    latInput.addEventListener("input", () => {
      const value = latInput.value === "" ? null : Number(latInput.value);
      state.editedStops[index].lat = Number.isFinite(value) ? value : null;
    });

    const lonInput = document.createElement("input");
    lonInput.type = "number";
    lonInput.step = "any";
    lonInput.className = "override-stop-coordinate-input";
    lonInput.placeholder = "Lon";
    lonInput.value = Number.isFinite(Number(stop.lon)) ? String(stop.lon) : "";
    lonInput.addEventListener("input", () => {
      const value = lonInput.value === "" ? null : Number(lonInput.value);
      state.editedStops[index].lon = Number.isFinite(value) ? value : null;
    });

    const orderControls = document.createElement("div");
    orderControls.className = "override-stop-order-controls";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "override-stop-order-btn";
    upBtn.textContent = "Up";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => moveEditedStop(index, -1));

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "override-stop-order-btn";
    downBtn.textContent = "Down";
    downBtn.disabled = index === state.editedStops.length - 1;
    downBtn.addEventListener("click", () => moveEditedStop(index, 1));

    orderControls.append(upBtn, downBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "override-stop-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      state.editedStops.splice(index, 1);
      renderStopsList();
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (state.draggingStopIndex !== null && state.draggingStopIndex !== index) {
        const [dragged] = state.editedStops.splice(state.draggingStopIndex, 1);
        const insertIndex = index > state.draggingStopIndex ? index - 1 : index;
        state.editedStops.splice(insertIndex, 0, dragged);
        state.draggingStopIndex = null;
        renderStopsList();
      }
    });

    fields.append(nameInput, latInput, lonInput, orderControls);
    item.append(handle, fields, deleteBtn);
    els.overrideStopsList.appendChild(item);
  });
}

async function saveOverride() {
  if (!state.selectedLineKey) {
    setStatus("⚠ No route selected", "error");
    return;
  }

  try {
    setStatus("Saving...");
    const payload = {
      agency: els.overrideAgency.value || null,
      mode: els.overrideMode.value ? Number(els.overrideMode.value) : null,
      frequency: els.overrideFrequency.value ? Number(els.overrideFrequency.value) : null,
      orderingMode: els.overrideOrderingMode ? String(els.overrideOrderingMode.value || "").trim() || null : null,
      stops: state.editedStops
    };

    const result = await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: {
        lineKey: state.selectedLineKey,
        citySlug: state.currentOverride?.city_slug || "",
        payload
      }
    });

    // Save problematic geometry review
    const problematicOverride = els.problematicGeometryCheckbox?.checked === true ? true : false;
    await apiRequest("/api/admin/reviews/route", {
      method: "POST",
      body: {
        lineKey: state.selectedLineKey,
        citySlug: state.selectedCitySlug,
        problematicOverride
      }
    }).catch((err) => console.warn("Failed to save route review:", err));

    // Save operator allow/deny reviews
    const agencyReviewsToSave = Array.from(state.operatorReviews.values()).filter(
      (review) => review.allowed_override !== null
    );
    
    for (const agencyReview of agencyReviewsToSave) {
      await apiRequest("/api/admin/reviews/agencies", {
        method: "POST",
        body: {
          citySlug: state.selectedCitySlug,
          operatorName: agencyReview.operator_name,
          allowedOverride: agencyReview.allowed_override
        }
      }).catch((err) => console.warn(`Failed to save agency review for ${agencyReview.operator_name}:`, err));
    }

    setStatus("✓ Override and reviews saved successfully");
    state.currentOverride = result.override;
    await loadRoutes();
  } catch (err) {
    setStatus(`⚠ Failed to save: ${err.message}`, "error");
  }
}

function discardChanges() {
  selectRoute(state.selectedLineKey).catch((err) => {
    setStatus(`⚠ Failed to reload: ${err.message}`, "error");
  });
}

function bindEvents() {
  els.loadOverrideRouteBtn?.addEventListener("click", () => {
    const lineKey = String(els.overrideLineKey?.value || "").trim();
    if (!lineKey) {
      setStatus("Enter a route lineKey first.", "error");
      return;
    }
    selectRoute(lineKey).catch((err) => {
      setStatus(`⚠ Failed to load route: ${err.message}`, "error");
    });
  });

  els.overrideRouteSelect?.addEventListener("change", (e) => {
    const lineKey = String(e.target.value || "").trim();
    if (els.overrideLineKey) {
      els.overrideLineKey.value = lineKey;
    }
    selectRoute(lineKey);
  });

  els.saveOverrideBtn?.addEventListener("click", saveOverride);
  els.discardOverrideBtn?.addEventListener("click", discardChanges);
}

async function init() {
  try {
    const key = await getAdminKey();
    if (!key) {
      setStatus("Please authenticate at /admin first", "error");
      return;
    }

    try {
      await apiRequest("/api/admin/session");
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      state.adminKey = "";
      setStatus("Admin session expired. Log in again at /admin.", "error");
      return;
    }

    bindEvents();
    initializeMap();

    // Wait for map to be ready before loading routes
    if (!state.mapReady) {
      await new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (state.mapReady) {
            clearInterval(checkReady);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkReady);
          resolve();
        }, 3000);
      });
    }

    await loadRoutes();
  } catch (err) {
    setStatus(`⚠ Initialization failed: ${err.message}`, "error");
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", init);
