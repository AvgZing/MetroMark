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
  appState.adminKey = String(sessionStorage.getItem(SESSION_KEY) || "").trim();

  if (!appState.adminKey) {
    setStatus("Please log in at /admin first.");
    return null;
  }

  return appState.adminKey;
}

function setStatus(message, kind = "neutral") {
  if (dom.overrideStatus) {
    dom.overrideStatus.textContent = message;
    dom.overrideStatus.className = `override-status status-${kind}`;
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
  if (appState.mapReady) return;

  appState.map = new maplibregl.Map({
    container: dom.overrideMap,
    style: "https://demotiles.maplibre.org/style.json",
    center: [-122.33, 47.6],
    zoom: 11,
    attributionControl: true
  });

  appState.map.on("load", () => {
    appState.mapReady = true;
    setStatus("Map ready");
    renderRouteMap();
  });

  appState.map.on("style.load", () => {
    renderRouteMap();
  });

  appState.map.on("error", (err) => {
    console.error("Map error:", err);
  });

  // Map mode buttons
  dom.overrideStreetsModeBtn?.addEventListener("click", () => {
    appState.mapMode = "streets";
    appState.map.setStyle("https://demotiles.maplibre.org/style.json");
  });

  dom.overrideSatelliteModeBtn?.addEventListener("click", () => {
    appState.mapMode = "satellite";
    appState.map.setStyle("https://demotiles.maplibre.org/styles/osm-bright-gl-style/style-cdn.json").catch(() => {
      // Fallback to streets if satellite unavailable
      appState.map.setStyle("https://demotiles.maplibre.org/style.json");
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
  if (!appState.map || !appState.mapReady || !appState.currentRouteTransit) {
    return;
  }

  const routesGeoJson = appState.currentRouteTransit.routesGeoJson || { type: "FeatureCollection", features: [] };
  const stopsGeoJson = appState.currentRouteTransit.stopsGeoJson || { type: "FeatureCollection", features: [] };

  const updateSource = (sourceId, data) => {
    const source = appState.map.getSource(sourceId);
    if (source && typeof source.setData === "function") {
      source.setData(data);
      return true;
    }
    return false;
  };

  if (!updateSource("override-route-source", routesGeoJson)) {
    if (!appState.map.getSource("override-route-source")) {
      appState.map.addSource("override-route-source", {
        type: "geojson",
        data: routesGeoJson
      });
      if (!appState.map.getLayer("override-route-line")) {
        appState.map.addLayer({
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
    if (!appState.map.getSource("override-stop-source")) {
      appState.map.addSource("override-stop-source", {
        type: "geojson",
        data: stopsGeoJson
      });
      if (!appState.map.getLayer("override-stop-circles")) {
        appState.map.addLayer({
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
    appState.map.fitBounds(bounds, { padding: 70, duration: 250, maxZoom: 14 });
  }
}

function syncRouteFieldsFromSelection(lineKey) {
  if (dom.overrideLineKey) {
    dom.overrideLineKey.value = lineKey;
  }
  if (dom.overrideRouteSelect && dom.overrideRouteSelect.value !== lineKey) {
    dom.overrideRouteSelect.value = lineKey;
  }
}

async function loadTransitRoute(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  setStatus("Loading route geometry...");
  const data = await apiRequest(`/api/transit/route-stops?lineKey=${encodeURIComponent(normalizedLineKey)}`);
  appState.currentRouteTransit = data || null;
  renderRouteMap();
  return data;
}

function replaceEditedStops(nextStops) {
  appState.editedStops = Array.isArray(nextStops) ? nextStops.map((stop, index) => ({
    key: String(stop?.key || stop?.station_key || stop?.stop_id || `manual-${index}`).trim(),
    name: String(stop?.name || stop?.station_name || stop?.stop_name || `Stop ${index + 1}`).trim(),
    lat: Number(stop?.lat),
    lon: Number(stop?.lon)
  })) : [];
}

function addEditedStop() {
  appState.editedStops.push({
    key: `manual-${Date.now()}-${appState.editedStops.length + 1}`,
    name: `Stop ${appState.editedStops.length + 1}`,
    lat: null,
    lon: null
  });
  renderStopsList();
}

function moveEditedStop(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= appState.editedStops.length) {
    return;
  }

  const [item] = appState.editedStops.splice(index, 1);
  appState.editedStops.splice(targetIndex, 0, item);
  renderStopsList();
}

async function loadRoutes() {
  try {
    setStatus("Loading routes...");
    const data = await apiRequest("/api/admin/overrides/route");
    appState.routes = Array.isArray(data.overrides) ? data.overrides : [];
    renderRouteSelect();
    setStatus(`Loaded ${appState.routes.length} routes`);
  } catch (err) {
    setStatus(`Ã¢Å¡Â  Failed to load routes: ${err.message}`, "error");
  }
}

function renderRouteSelect() {
  if (!dom.overrideRouteSelect) return;

  const selected = dom.overrideRouteSelect.value;
  dom.overrideRouteSelect.innerHTML = '<option value="">Select a route to edit...</option>';

  appState.routes.forEach((route) => {
    const option = document.createElement("option");
    option.value = route.line_key;
    option.textContent = `${route.line_key} (${route.city_slug})`;
    dom.overrideRouteSelect.appendChild(option);
  });

  if (selected) {
    dom.overrideRouteSelect.value = selected;
  }
}

async function loadReviews(citySlug) {
  try {
    const data = await apiRequest(`/api/transit/reviews?citySlug=${encodeURIComponent(citySlug)}`);
    
    // Load route review
    const routeReviews = Array.isArray(data.routeReviews) ? data.routeReviews : [];
    appState.currentRouteReview = routeReviews.find((r) => r.line_key === appState.selectedLineKey) || null;
    
    // Load operator reviews
    appState.operatorReviews.clear();
    const agencyReviews = Array.isArray(data.agencyReviews) ? data.agencyReviews : [];
    agencyReviews.forEach((review) => {
      appState.operatorReviews.set(review.operator_name, review);
    });
    
    // Collect all operators from the current override to build operator list
    appState.cityOperators.clear();
    if (appState.currentOverride?.payload?.agency) {
      appState.cityOperators.add(appState.currentOverride.payload.agency);
    }
    // Also add operators from all reviews for this city
    agencyReviews.forEach((review) => {
      appState.cityOperators.add(review.operator_name);
    });
  } catch (err) {
    console.warn("Failed to load reviews:", err);
    appState.currentRouteReview = null;
    appState.operatorReviews.clear();
  }
}

function renderReviews() {
  // Render problematic geometry checkbox
  if (dom.problematicGeometryCheckbox) {
    dom.problematicGeometryCheckbox.checked = appState.currentRouteReview?.problematic_override === true;
  }

  // Render operator list
  if (dom.operatorReviewList) {
    if (appState.cityOperators.size === 0) {
      dom.operatorReviewList.innerHTML = '<p class="microcopy">No operators for this city yet.</p>';
      return;
    }

    dom.operatorReviewList.innerHTML = "";
    const sortedOperators = Array.from(appState.cityOperators).sort();
    
    sortedOperators.forEach((operatorName) => {
      const review = appState.operatorReviews.get(operatorName);
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
      allowBtn.textContent = allowedOverride === true ? "Ã¢Å“â€œ" : "Ã¢â‚¬Â¢";
      allowBtn.title = "Allow operator";
      allowBtn.addEventListener("click", () => {
        const newState = allowedOverride === true ? null : true;
        appState.operatorReviews.set(operatorName, { operator_name: operatorName, allowed_override: newState });
        renderReviews();
      });
      
      // Block button
      const blockBtn = document.createElement("button");
      blockBtn.type = "button";
      blockBtn.className = "operator-toggle-btn";
      if (allowedOverride === false) {
        blockBtn.classList.add("blocked");
      }
      blockBtn.textContent = allowedOverride === false ? "Ã¢Å“â€¢" : "Ã¢â‚¬Â¢";
      blockBtn.title = "Block operator";
      blockBtn.addEventListener("click", () => {
        const newState = allowedOverride === false ? null : false;
        appState.operatorReviews.set(operatorName, { operator_name: operatorName, allowed_override: newState });
        renderReviews();
      });
      
      togglesDiv.append(allowBtn, blockBtn);
      item.append(nameSpan, togglesDiv);
      dom.operatorReviewList.appendChild(item);
    });
  }
}

async function selectRoute(lineKey) {
  if (!lineKey) {
    appState.selectedLineKey = "";
    appState.currentOverride = null;
    appState.currentRouteTransit = null;
    dom.overrideEditPanel.hidden = true;
    renderRouteMap();
    setStatus("Route deselected");
    return;
  }

  try {
    setStatus("Loading route...");
    const data = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`);
    appState.selectedLineKey = lineKey;
    appState.currentOverride = data.override || null;
    appState.selectedCitySlug = appState.currentOverride?.city_slug || "";

    const transitData = await loadTransitRoute(lineKey);
    
    if (appState.currentOverride && appState.currentOverride.payload) {
      const payload = appState.currentOverride.payload;
      dom.overrideAgency.value = payload.agency || "";
      dom.overrideMode.value = String(payload.mode || "");
      dom.overrideFrequency.value = payload.frequency || "";
      if (dom.overrideOrderingMode) {
        dom.overrideOrderingMode.value = String(payload.orderingMode || "");
      }
      replaceEditedStops(payload.stops);
    } else {
      // No override yet - load base route data if available
      dom.overrideAgency.value = "";
      dom.overrideMode.value = "";
      dom.overrideFrequency.value = "";
      if (dom.overrideOrderingMode) {
        dom.overrideOrderingMode.value = "";
      }
      replaceEditedStops(routeStopsFromTransitPayload(transitData));
    }

    if (!appState.editedStops.length) {
      replaceEditedStops(routeStopsFromTransitPayload(transitData));
    }

    // Load reviews for this city
    if (appState.selectedCitySlug) {
      await loadReviews(appState.selectedCitySlug);
    }

    syncRouteFieldsFromSelection(lineKey);
    renderStopsList();
    renderReviews();
    dom.overrideEditPanel.hidden = false;
    setStatus(`Editing: ${lineKey}`);
  } catch (err) {
    setStatus(`Ã¢Å¡Â  Failed to load route: ${err.message}`, "error");
  }
}

function renderStopsList() {
  if (!dom.overrideStopsList) return;

  dom.overrideStopsList.innerHTML = "";

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
    replaceEditedStops(routeStopsFromTransitPayload(appState.currentRouteTransit));
    renderStopsList();
  });

  toolbar.append(addBtn, resetBtn);
  dom.overrideStopsList.appendChild(toolbar);

  appState.editedStops.forEach((stop, index) => {
    const item = document.createElement("div");
    item.className = "override-stop-item";
    if (appState.draggingStopIndex === index) {
      item.classList.add("is-dragging");
    }

    const handle = document.createElement("div");
    handle.className = "override-stop-drag-handle";
    handle.textContent = "Ã¢â€¹Â®";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      appState.draggingStopIndex = index;
      e.dataTransfer.effectAllowed = "move";
      renderStopsList();
    });
    handle.addEventListener("dragend", () => {
      appState.draggingStopIndex = null;
      renderStopsList();
    });

    const fields = document.createElement("div");
    fields.className = "override-stop-fields";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "override-stop-name-input";
    nameInput.value = stop.name || `Stop ${index + 1}`;
    nameInput.addEventListener("input", () => {
      appState.editedStops[index].name = String(nameInput.value || "").trim();
    });

    const latInput = document.createElement("input");
    latInput.type = "number";
    latInput.step = "any";
    latInput.className = "override-stop-coordinate-input";
    latInput.placeholder = "Lat";
    latInput.value = Number.isFinite(Number(stop.lat)) ? String(stop.lat) : "";
    latInput.addEventListener("input", () => {
      const value = latInput.value === "" ? null : Number(latInput.value);
      appState.editedStops[index].lat = Number.isFinite(value) ? value : null;
    });

    const lonInput = document.createElement("input");
    lonInput.type = "number";
    lonInput.step = "any";
    lonInput.className = "override-stop-coordinate-input";
    lonInput.placeholder = "Lon";
    lonInput.value = Number.isFinite(Number(stop.lon)) ? String(stop.lon) : "";
    lonInput.addEventListener("input", () => {
      const value = lonInput.value === "" ? null : Number(lonInput.value);
      appState.editedStops[index].lon = Number.isFinite(value) ? value : null;
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
    downBtn.disabled = index === appState.editedStops.length - 1;
    downBtn.addEventListener("click", () => moveEditedStop(index, 1));

    orderControls.append(upBtn, downBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "override-stop-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      appState.editedStops.splice(index, 1);
      renderStopsList();
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (appState.draggingStopIndex !== null && appState.draggingStopIndex !== index) {
        const [dragged] = appState.editedStops.splice(appState.draggingStopIndex, 1);
        const insertIndex = index > appState.draggingStopIndex ? index - 1 : index;
        appState.editedStops.splice(insertIndex, 0, dragged);
        appState.draggingStopIndex = null;
        renderStopsList();
      }
    });

    fields.append(nameInput, latInput, lonInput, orderControls);
    item.append(handle, fields, deleteBtn);
    dom.overrideStopsList.appendChild(item);
  });
}

async function saveOverride() {
  if (!appState.selectedLineKey) {
    setStatus("Ã¢Å¡Â  No route selected", "error");
    return;
  }

  try {
    setStatus("Saving...");
    const payload = {
      agency: dom.overrideAgency.value || null,
      mode: dom.overrideMode.value ? Number(dom.overrideMode.value) : null,
      frequency: dom.overrideFrequency.value ? Number(dom.overrideFrequency.value) : null,
      orderingMode: dom.overrideOrderingMode ? String(dom.overrideOrderingMode.value || "").trim() || null : null,
      stops: appState.editedStops
    };

    const result = await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: {
        lineKey: appState.selectedLineKey,
        citySlug: appState.currentOverride?.city_slug || "",
        payload
      }
    });

    // Save problematic geometry review
    const problematicOverride = dom.problematicGeometryCheckbox?.checked === true ? true : false;
    await apiRequest("/api/admin/reviews/route", {
      method: "POST",
      body: {
        lineKey: appState.selectedLineKey,
        citySlug: appState.selectedCitySlug,
        problematicOverride
      }
    }).catch((err) => console.warn("Failed to save route review:", err));

    // Save operator allow/deny reviews
    const agencyReviewsToSave = Array.from(appState.operatorReviews.values()).filter(
      (review) => review.allowed_override !== null
    );
    
    for (const agencyReview of agencyReviewsToSave) {
      await apiRequest("/api/admin/reviews/agencies", {
        method: "POST",
        body: {
          citySlug: appState.selectedCitySlug,
          operatorName: agencyReview.operator_name,
          allowedOverride: agencyReview.allowed_override
        }
      }).catch((err) => console.warn(`Failed to save agency review for ${agencyReview.operator_name}:`, err));
    }

    setStatus("Ã¢Å“â€œ Override and reviews saved successfully");
    appState.currentOverride = result.override;
    await loadRoutes();
  } catch (err) {
    setStatus(`Ã¢Å¡Â  Failed to save: ${err.message}`, "error");
  }
}

function discardChanges() {
  selectRoute(appState.selectedLineKey).catch((err) => {
    setStatus(`Ã¢Å¡Â  Failed to reload: ${err.message}`, "error");
  });
}

function bindEvents() {
  dom.loadOverrideRouteBtn?.addEventListener("click", () => {
    const lineKey = String(dom.overrideLineKey?.value || "").trim();
    if (!lineKey) {
      setStatus("Enter a route lineKey first.", "error");
      return;
    }
    selectRoute(lineKey).catch((err) => {
      setStatus(`Ã¢Å¡Â  Failed to load route: ${err.message}`, "error");
    });
  });

  dom.overrideRouteSelect?.addEventListener("change", (e) => {
    const lineKey = String(e.target.value || "").trim();
    if (dom.overrideLineKey) {
      dom.overrideLineKey.value = lineKey;
    }
    selectRoute(lineKey);
  });

  dom.saveOverrideBtn?.addEventListener("click", saveOverride);
  dom.discardOverrideBtn?.addEventListener("click", discardChanges);
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
      appState.adminKey = "";
      setStatus("Admin session expired. Log in again at /admin.", "error");
      return;
    }

    bindEvents();
    initializeMap();

    // Wait for map to be ready before loading routes
    if (!appState.mapReady) {
      await new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (appState.mapReady) {
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
    setStatus(`Ã¢Å¡Â  Initialization failed: ${err.message}`, "error");
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", init);
