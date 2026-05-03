function normalizePresetName(raw) {
  return String(raw || "").trim().slice(0, 48);
}

function getActiveCitySlug() {
  // Presets are global by default to simplify reuse across cities.
  // Use 'global' as the presets scope. Individual city-scoped presets
  // are not used by default to avoid accidental overwrites.
  return "global";
}

function setFilterPresetStatus(message) {
  if (!els.filterPresetsStatus) {
    return;
  }

  els.filterPresetsStatus.textContent = String(message || "");
}

function openFilterPresetsPanel(open) {
  const isOpen = Boolean(open);
  if (!els.filterPresetsPanel || !els.filterPresetsBtn) {
    return;
  }

  els.filterPresetsPanel.hidden = !isOpen;
  els.filterPresetsBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function currentFilterSnapshot() {
  return {
    citySlug: getActiveCitySlug(),
    lineSearchQuery: String(state.lineSearchQuery || ""),
    activeModeKeys: Array.from(state.activeModeKeys),
    activeFrequencyKeys: Array.from(state.activeFrequencyKeys),
    manualLineVisibility: Object.fromEntries(state.manualLineVisibility.entries()),
    showPrivateOperators: Boolean(state.showPrivateOperators),
    showProblematicGeometries: Boolean(state.showProblematicGeometries),
    savedAtIso: new Date().toISOString()
  };
}

function applyFilterSnapshot(snapshot) {
  const modeKeys = Array.isArray(snapshot.activeModeKeys) ? snapshot.activeModeKeys : [MODE_FILTER_ALL];
  const frequencyKeys = Array.isArray(snapshot.activeFrequencyKeys)
    ? snapshot.activeFrequencyKeys
    : [FREQUENCY_FILTER_ALL];

  state.activeModeKeys = new Set(modeKeys.map((entry) => String(entry || "").trim()).filter(Boolean));
  state.activeFrequencyKeys = new Set(
    frequencyKeys.map((entry) => String(entry || "").trim()).filter(Boolean)
  );

  normalizeModeSelection();
  normalizeFrequencySelection();

  const visibilityEntries = Object.entries(snapshot.manualLineVisibility || {})
    .map(([lineKey, value]) => [String(lineKey || "").trim(), String(value || "").trim().toLowerCase()])
    .filter(([lineKey, value]) => lineKey && (value === "on" || value === "off"));

  state.manualLineVisibility = new Map(visibilityEntries);
  if (typeof saveUserPreferences === "function") {
    saveUserPreferences({
      activeModeKeys: modeKeys,
      activeFrequencyKeys: frequencyKeys,
      manualLineVisibility: Object.fromEntries(state.manualLineVisibility),
      initialCitySlug: citySlug
    }).catch(() => {});
  }

  state.lineSearchQuery = String(snapshot.lineSearchQuery || "").trim().toLowerCase();
  if (els.lineSearch) {
    els.lineSearch.value = state.lineSearchQuery;
  }

  clearStatusPin();
  resetClearRouteProgressConfirmation();

  const shown = getShownLines();
  if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
    state.focusedLineKey = "";
  }

  renderModeFilterBar();
  renderFrequencyFilterBar();
  renderLineList();
  renderMapData();
  renderProgress();
  restoreUserStatusFromFocus();

  const citySlug = String(snapshot.citySlug || "").trim();
  if (citySlug && citySlug !== state.initialCitySlug) {
    state.initialCitySlug = citySlug;
    if (typeof saveUserPreferences === "function") {
      saveUserPreferences({ initialCitySlug: citySlug }).catch(() => {});
    }

    // Load reviews for the new city
    if (typeof loadReviewsForCity === "function") {
      loadReviewsForCity(citySlug).catch((err) => {
        console.warn("Failed to load reviews for city:", err);
      });
    }

    const city = Array.isArray(state.cities)
      ? state.cities.find((entry) => String(entry.slug || "").trim() === citySlug)
      : null;

    if (city && typeof fitToArea === "function") {
      fitToArea(city);
    }
  }

  if (typeof loadVisibleTransit === "function") {
    loadVisibleTransit({ forceRefresh: false, reason: "filter-preset-apply" }).catch(() => {});
  }
}

// Persist a default snapshot for this user under the reserved name '__defaults__'.
let __saveDefaultPresetTimeout = null;
async function saveDefaultPreset() {
  if (!state.user) return;
  const citySlug = getActiveCitySlug();
  const snapshot = currentFilterSnapshot();
  const name = "__defaults__";

  try {
    await apiRequest("/api/presets/filters", {
      method: "POST",
      body: JSON.stringify({ name, citySlug, snapshot })
    });
  } catch (e) {
    // ignore save errors
  }
}

function saveDefaultPresetDebounced() {
  if (__saveDefaultPresetTimeout) {
    clearTimeout(__saveDefaultPresetTimeout);
  }
  __saveDefaultPresetTimeout = setTimeout(() => saveDefaultPreset(), 900);
}

window.saveDefaultPresetDebounced = saveDefaultPresetDebounced;

let cachedPresets = [];
let cachedCitySlug = "";

function renderFilterPresets() {
  if (!els.filterPresetList) {
    return;
  }

  const citySlug = getActiveCitySlug();
  if (cachedCitySlug !== citySlug) {
    cachedPresets = [];
  }

  const presets = cachedPresets;

  els.filterPresetList.innerHTML = "";

  if (!state.user) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Sign in to use filter presets";
    els.filterPresetList.append(option);
    return;
  }

  if (!presets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved presets for this city";
    els.filterPresetList.append(option);
    return;
  }

  presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = String(preset.id || "");
    option.textContent = preset.name;
    els.filterPresetList.append(option);
  });
}

function updateFilterPresetAuthState() {
  const loggedIn = Boolean(state.user);
  const controls = [
    els.filterPresetList,
    els.filterPresetName,
    els.saveFilterPresetBtn,
    els.applyFilterPresetBtn,
    els.deleteFilterPresetBtn
  ];

  controls.forEach((control) => {
    if (control) {
      control.disabled = !loggedIn;
    }
  });

  if (!loggedIn) {
    cachedPresets = [];
    cachedCitySlug = "";
    setFilterPresetStatus("Sign in to save or load presets.");
  }
}

async function loadFilterPresets(options = {}) {
  if (!state.user) {
    cachedPresets = [];
    cachedCitySlug = "";
    renderFilterPresets();
    return;
  }

  const citySlug = getActiveCitySlug();
  cachedCitySlug = citySlug;

  if (!options.silent) {
    setFilterPresetStatus("Loading presets...");
  }

  try {
    const params = new URLSearchParams({ citySlug });
    const payload = await apiRequest(`/api/presets/filters?${params.toString()}`, {
      method: "GET"
    });
    cachedPresets = Array.isArray(payload.presets) ? payload.presets : [];
    cachedPresets.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    renderFilterPresets();
    if (!options.silent) {
      setFilterPresetStatus(cachedPresets.length ? "" : "No presets saved yet.");
    }
  } catch (error) {
    setFilterPresetStatus(error.message);
  }
}

async function saveCurrentAsPreset() {
  if (!state.user) {
    setFilterPresetStatus("Sign in to save presets.");
    return;
  }

  // Save presets in the global scope and merge manual visibility overrides
  // with any existing preset of the same name so unseen route overrides
  // are preserved.
  const citySlug = getActiveCitySlug();
  const name = normalizePresetName(els.filterPresetName?.value);
  if (!name) {
    setFilterPresetStatus("Enter a preset name first.");
    return;
  }

  const snapshot = currentFilterSnapshot();

  try {
    // Load existing presets in the same scope to merge manual visibility
    await loadFilterPresets({ silent: true });
    const existing = cachedPresets.find((p) => String(p.name || "") === name) || null;

    let mergedSnapshot = snapshot;
    if (existing && existing.snapshot && existing.snapshot.manualLineVisibility) {
      // Merge manualLineVisibility: preserve keys not present in current snapshot
      const existingVis = existing.snapshot.manualLineVisibility || {};
      const currentVis = snapshot.manualLineVisibility || {};
      const mergedVis = { ...existingVis, ...currentVis };
      mergedSnapshot = { ...snapshot, manualLineVisibility: mergedVis };
    }

    const payload = await apiRequest("/api/presets/filters", {
      method: "POST",
      body: JSON.stringify({ name, citySlug, snapshot: mergedSnapshot })
    });

    const preset = payload.preset;
    if (!preset) {
      throw new Error("Preset save failed.");
    }

    const existingIndex = cachedPresets.findIndex((entry) => String(entry.id) === String(preset.id));
    if (existingIndex >= 0) {
      cachedPresets.splice(existingIndex, 1, preset);
    } else {
      cachedPresets.push(preset);
    }

    cachedPresets.sort((a, b) => a.name.localeCompare(b.name));
    renderFilterPresets();
    els.filterPresetList.value = preset.id;
    setFilterPresetStatus(`Saved preset \"${preset.name}\".`);
  } catch (error) {
    setFilterPresetStatus(error.message);
  }
}

function applySelectedPreset() {
  if (!state.user) {
    setFilterPresetStatus("Sign in to apply presets.");
    return;
  }

  const presetId = String(els.filterPresetList?.value || "").trim();
  if (!presetId) {
    setFilterPresetStatus("Select a preset to apply.");
    return;
  }

  const preset = cachedPresets.find((entry) => String(entry.id || "") === presetId);
  if (!preset) {
    setFilterPresetStatus("Preset not found.");
    return;
  }

  applyFilterSnapshot(preset.snapshot || {});
  setFilterPresetStatus(`Applied preset \"${preset.name}\".`);
}

async function deleteSelectedPreset() {
  if (!state.user) {
    setFilterPresetStatus("Sign in to delete presets.");
    return;
  }

  const presetId = String(els.filterPresetList?.value || "").trim();
  if (!presetId) {
    setFilterPresetStatus("Select a preset to delete.");
    return;
  }

  try {
    await apiRequest(`/api/presets/filters/${encodeURIComponent(presetId)}`, {
      method: "DELETE"
    });

    cachedPresets = cachedPresets.filter((entry) => String(entry.id || "") !== presetId);
    renderFilterPresets();
    setFilterPresetStatus("Preset deleted.");
  } catch (error) {
    setFilterPresetStatus(error.message);
  }
}

function bindFilterPresetsEvents() {
  if (!els.filterPresetsBtn || !els.filterPresetsPanel) {
    return;
  }

  els.filterPresetsBtn.addEventListener("click", () => {
    const open = els.filterPresetsPanel.hidden;
    openFilterPresetsPanel(open);
    if (open) {
      loadFilterPresets().catch(() => {});
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (els.filterPresetsPanel.hidden) {
      return;
    }

    const target = event.target;
    const insidePanel = els.filterPresetsPanel.contains(target);
    const insideButton = els.filterPresetsBtn.contains(target);

    if (!insidePanel && !insideButton) {
      openFilterPresetsPanel(false);
    }
  });

  if (els.saveFilterPresetBtn) {
    els.saveFilterPresetBtn.addEventListener("click", saveCurrentAsPreset);
  }

  if (els.applyFilterPresetBtn) {
    els.applyFilterPresetBtn.addEventListener("click", applySelectedPreset);
  }

  if (els.deleteFilterPresetBtn) {
    els.deleteFilterPresetBtn.addEventListener("click", deleteSelectedPreset);
  }
}

bindFilterPresetsEvents();
updateFilterPresetAuthState();
renderFilterPresets();

window.updateFilterPresetAuthState = updateFilterPresetAuthState;
window.refreshFilterPresets = loadFilterPresets;
