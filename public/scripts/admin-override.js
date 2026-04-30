const ADMIN_STORAGE_KEY = "metromark_admin_key";
const OVERRIDE_STORAGE_KEY = "metromark_admin_override_key";

const state = {
  adminKey: localStorage.getItem(ADMIN_STORAGE_KEY) || "",
  overrideKey: localStorage.getItem(OVERRIDE_STORAGE_KEY) || "",
  map: null,
  mapReady: false,
  routes: [],
  currentOverride: null,
  selectedLineKey: "",
  editedStops: [],
  mapMode: "streets",
  draggingStopIndex: null
};

const els = {
  overrideMap: document.getElementById("overrideMap"),
  overrideStreetsModeBtn: document.getElementById("overrideStreetsModeBtn"),
  overrideSatelliteModeBtn: document.getElementById("overrideSatelliteModeBtn"),
  overrideRouteSelect: document.getElementById("overrideRouteSelect"),
  overrideStatus: document.getElementById("overrideStatus"),
  overrideEditPanel: document.getElementById("overrideEditPanel"),
  overrideAgency: document.getElementById("overrideAgency"),
  overrideMode: document.getElementById("overrideMode"),
  overrideFrequency: document.getElementById("overrideFrequency"),
  overrideStopsList: document.getElementById("overrideStopsList"),
  saveOverrideBtn: document.getElementById("saveOverrideBtn"),
  discardOverrideBtn: document.getElementById("discardOverrideBtn")
};

async function getAdminKey() {
  state.adminKey = String(localStorage.getItem(ADMIN_STORAGE_KEY) || "").trim();
  state.overrideKey = String(localStorage.getItem(OVERRIDE_STORAGE_KEY) || "").trim();
  
  if (!state.adminKey && !state.overrideKey) {
    setStatus("⚠ No admin key stored. Please authenticate via main admin console first.");
    return null;
  }
  
  return state.overrideKey || state.adminKey;
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
      "x-admin-key": key,
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

async function selectRoute(lineKey) {
  if (!lineKey) {
    state.selectedLineKey = "";
    state.currentOverride = null;
    els.overrideEditPanel.hidden = true;
    setStatus("Route deselected");
    return;
  }

  try {
    setStatus("Loading route...");
    const data = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`);
    state.selectedLineKey = lineKey;
    state.currentOverride = data.override || null;
    
    if (state.currentOverride && state.currentOverride.payload) {
      const payload = state.currentOverride.payload;
      els.overrideAgency.value = payload.agency || "";
      els.overrideMode.value = String(payload.mode || "");
      els.overrideFrequency.value = payload.frequency || "";
      state.editedStops = Array.isArray(payload.stops) ? [...payload.stops] : [];
    } else {
      // No override yet - load base route data if available
      els.overrideAgency.value = "";
      els.overrideMode.value = "";
      els.overrideFrequency.value = "";
      state.editedStops = [];
    }

    renderStopsList();
    els.overrideEditPanel.hidden = false;
    setStatus(`Editing: ${lineKey}`);
  } catch (err) {
    setStatus(`⚠ Failed to load route: ${err.message}`, "error");
  }
}

function renderStopsList() {
  if (!els.overrideStopsList) return;

  els.overrideStopsList.innerHTML = "";

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

    const name = document.createElement("div");
    name.className = "override-stop-name";
    name.textContent = stop.name || `Stop ${index + 1}`;

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

    item.append(handle, name, deleteBtn);
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

    setStatus("✓ Override saved successfully");
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
  els.overrideRouteSelect?.addEventListener("change", (e) => {
    selectRoute(String(e.target.value || "").trim());
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
