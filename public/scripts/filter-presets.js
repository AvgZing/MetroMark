const FILTER_PRESETS_STORAGE_KEY = "metromark_filter_presets_v1";

function normalizePresetName(raw) {
  return String(raw || "").trim().slice(0, 48);
}

function getActiveCitySlug() {
  return String(state.initialCitySlug || "global").trim() || "global";
}

function readFilterPresetsStore() {
  try {
    const raw = localStorage.getItem(FILTER_PRESETS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function writeFilterPresetsStore(store) {
  localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(store));
}

function readPresetsForCity(citySlug) {
  const store = readFilterPresetsStore();
  const presets = Array.isArray(store[citySlug]) ? store[citySlug] : [];

  return presets.filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    if (!normalizePresetName(entry.name)) {
      return false;
    }

    return entry.snapshot && typeof entry.snapshot === "object";
  });
}

function writePresetsForCity(citySlug, presets) {
  const store = readFilterPresetsStore();
  store[citySlug] = presets;
  writeFilterPresetsStore(store);
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
  persistVisibilityOverridesToStorage("metromark_route_visibility_overrides", state.manualLineVisibility);

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
    localStorage.setItem("metromark_initial_city_slug", citySlug);

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

function renderFilterPresets() {
  if (!els.filterPresetList) {
    return;
  }

  const citySlug = getActiveCitySlug();
  const presets = readPresetsForCity(citySlug);

  els.filterPresetList.innerHTML = "";

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

function saveCurrentAsPreset() {
  const citySlug = getActiveCitySlug();
  const name = normalizePresetName(els.filterPresetName?.value);
  if (!name) {
    setFilterPresetStatus("Enter a preset name first.");
    return;
  }

  const presets = readPresetsForCity(citySlug);
  const existingIndex = presets.findIndex(
    (entry) => normalizePresetName(entry.name).toLowerCase() === name.toLowerCase()
  );

  const preset = {
    id: existingIndex >= 0 ? presets[existingIndex].id : `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    name,
    snapshot: currentFilterSnapshot()
  };

  if (existingIndex >= 0) {
    presets.splice(existingIndex, 1, preset);
  } else {
    presets.push(preset);
  }

  presets.sort((a, b) => a.name.localeCompare(b.name));
  writePresetsForCity(citySlug, presets);
  renderFilterPresets();

  els.filterPresetList.value = preset.id;
  setFilterPresetStatus(`Saved preset \"${name}\".`);
}

function applySelectedPreset() {
  const citySlug = getActiveCitySlug();
  const presetId = String(els.filterPresetList?.value || "").trim();
  if (!presetId) {
    setFilterPresetStatus("Select a preset to apply.");
    return;
  }

  const presets = readPresetsForCity(citySlug);
  const preset = presets.find((entry) => String(entry.id || "") === presetId);
  if (!preset) {
    setFilterPresetStatus("Preset not found.");
    return;
  }

  applyFilterSnapshot(preset.snapshot || {});
  setFilterPresetStatus(`Applied preset \"${preset.name}\".`);
}

function deleteSelectedPreset() {
  const citySlug = getActiveCitySlug();
  const presetId = String(els.filterPresetList?.value || "").trim();
  if (!presetId) {
    setFilterPresetStatus("Select a preset to delete.");
    return;
  }

  const presets = readPresetsForCity(citySlug);
  const next = presets.filter((entry) => String(entry.id || "") !== presetId);
  if (next.length === presets.length) {
    setFilterPresetStatus("Preset not found.");
    return;
  }

  writePresetsForCity(citySlug, next);
  renderFilterPresets();
  setFilterPresetStatus("Preset deleted.");
}

function bindFilterPresetsEvents() {
  if (!els.filterPresetsBtn || !els.filterPresetsPanel) {
    return;
  }

  els.filterPresetsBtn.addEventListener("click", () => {
    const open = els.filterPresetsPanel.hidden;
    openFilterPresetsPanel(open);
    if (open) {
      renderFilterPresets();
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
renderFilterPresets();
