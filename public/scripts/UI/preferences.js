const USER_PREFERENCE_STORAGE_KEYS = {
  theme: "metromark_theme",
  initialCitySlug: "metromark_initial_city_slug",
  lineViewAutoOpenEnabled: "metromark_line_view_auto_open",
  showAllStops: SHOW_ALL_STOPS_STORAGE_KEY,
  showPrivateOperators: "metromark_show_private_operators",
  showProblematicGeometries: "metromark_show_problematic_geometries",
  activeModeKeys: "metromark_mode_filter_keys",
  activeFrequencyKeys: "metromark_frequency_filter_keys",
  manualLineVisibility: "metromark_route_visibility_overrides"
};

function normalizePreferenceTheme(value) {
  return String(value || "").trim() === "dark" ? "dark" : "light";
}

function normalizePreferenceBoolean(value, defaultValue = false) {
  if (value === null || value === undefined) {
    return Boolean(defaultValue);
  }
  return Boolean(value);
}

function normalizePreferenceString(value) {
  return String(value || "").trim();
}

function normalizePreferenceStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => normalizePreferenceString(entry))
        .filter(Boolean)
    )
  );
}

function normalizePreferenceVisibilityMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const visibilityMap = {};
  for (const [lineKeyRaw, valueRaw] of Object.entries(value)) {
    const lineKey = normalizePreferenceString(lineKeyRaw);
    const normalizedValue = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (normalizedValue === "on" || normalizedValue === "off") {
      visibilityMap[lineKey] = normalizedValue;
    }
  }

  return visibilityMap;
}

function readStoredPreference(key, fallback = null) {
  const storageKey = USER_PREFERENCE_STORAGE_KEYS[key];
  if (!storageKey) {
    return fallback;
  }

  try {
    if (key === "activeModeKeys" || key === "activeFrequencyKeys") {
      return parseSetFromStorage(storageKey, fallback || []).values();
    }
    if (key === "manualLineVisibility") {
      return parseVisibilityOverridesFromStorage(storageKey);
    }
    if (key === "showAllStops" || key === "showPrivateOperators" || key === "showProblematicGeometries" || key === "lineViewAutoOpenEnabled") {
      return parseBooleanFromStorage(storageKey, fallback);
    }
    return localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function writeStoredPreference(key, value) {
  const storageKey = USER_PREFERENCE_STORAGE_KEYS[key];
  if (!storageKey) {
    return;
  }

  if (key === "activeModeKeys" || key === "activeFrequencyKeys") {
    persistSetToStorage(storageKey, new Set(normalizePreferenceStringList(value)));
    return;
  }

  if (key === "manualLineVisibility") {
    persistVisibilityOverridesToStorage(storageKey, normalizePreferenceVisibilityMap(value));
    return;
  }

  if (key === "showAllStops" || key === "showPrivateOperators" || key === "showProblematicGeometries" || key === "lineViewAutoOpenEnabled") {
    persistBooleanToStorage(storageKey, Boolean(value));
    return;
  }

  if (value === null || value === undefined || value === "") {
    localStorage.removeItem(storageKey);
    return;
  }

  localStorage.setItem(storageKey, String(value));
}

function normalizePreferencePatch(patch = {}) {
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(source, "theme")) {
    normalized.theme = normalizePreferenceTheme(source.theme);
  }
  if (Object.prototype.hasOwnProperty.call(source, "initialCitySlug")) {
    normalized.initialCitySlug = normalizePreferenceString(source.initialCitySlug);
  }
  if (Object.prototype.hasOwnProperty.call(source, "lineViewAutoOpenEnabled")) {
    normalized.lineViewAutoOpenEnabled = Boolean(source.lineViewAutoOpenEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(source, "showAllStops")) {
    normalized.showAllStops = Boolean(source.showAllStops);
  }
  if (Object.prototype.hasOwnProperty.call(source, "showPrivateOperators")) {
    normalized.showPrivateOperators = Boolean(source.showPrivateOperators);
  }
  if (Object.prototype.hasOwnProperty.call(source, "showProblematicGeometries")) {
    normalized.showProblematicGeometries = Boolean(source.showProblematicGeometries);
  }
  if (Object.prototype.hasOwnProperty.call(source, "activeModeKeys")) {
    normalized.activeModeKeys = normalizePreferenceStringList(source.activeModeKeys);
  }
  if (Object.prototype.hasOwnProperty.call(source, "activeFrequencyKeys")) {
    normalized.activeFrequencyKeys = normalizePreferenceStringList(source.activeFrequencyKeys);
  }
  if (Object.prototype.hasOwnProperty.call(source, "manualLineVisibility")) {
    normalized.manualLineVisibility = normalizePreferenceVisibilityMap(source.manualLineVisibility);
  }

  return normalized;
}

function applyUserPreferences(preferences = {}) {
  const normalized = normalizePreferencePatch(preferences);

  if (Object.prototype.hasOwnProperty.call(normalized, "theme")) {
    state.theme = normalized.theme;
    document.body.setAttribute("data-theme", state.theme);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "initialCitySlug")) {
    state.initialCitySlug = normalized.initialCitySlug || state.initialCitySlug;
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "lineViewAutoOpenEnabled")) {
    state.lineViewAutoOpenEnabled = Boolean(normalized.lineViewAutoOpenEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "showAllStops")) {
    state.showAllStops = Boolean(normalized.showAllStops);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "showPrivateOperators")) {
    state.showPrivateOperators = Boolean(normalized.showPrivateOperators);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "showProblematicGeometries")) {
    state.showProblematicGeometries = Boolean(normalized.showProblematicGeometries);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "activeModeKeys")) {
    state.activeModeKeys = new Set(normalized.activeModeKeys);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "activeFrequencyKeys")) {
    state.activeFrequencyKeys = new Set(normalized.activeFrequencyKeys);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, "manualLineVisibility")) {
    state.manualLineVisibility = new Map(Object.entries(normalized.manualLineVisibility));
  }

  renderModeFilterBar();
  renderFrequencyFilterBar();
  renderLineList();
  renderMapData();
  renderProgress();
  renderUserStatus();
}

async function saveUserPreferences(patch = {}) {
  const normalized = normalizePreferencePatch(patch);
  const keys = Object.keys(normalized);
  if (!keys.length) {
    return null;
  }

  if (!state.user) {
    for (const [key, value] of Object.entries(normalized)) {
      writeStoredPreference(key, value);
    }
    applyUserPreferences(normalized);
    return normalized;
  }

  const payload = await apiRequest("/api/auth/me/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferences: normalized })
  });

  state.user = payload.user;
  applyUserPreferences(payload.user?.preferences || {});
  return payload.user?.preferences || normalized;
}

function initializeUserPreferencesFromStorage() {
  applyUserPreferences({
    theme: readStoredPreference("theme", "light"),
    initialCitySlug: readStoredPreference("initialCitySlug", "seattle"),
    lineViewAutoOpenEnabled: readStoredPreference("lineViewAutoOpenEnabled", true),
    showAllStops: readStoredPreference("showAllStops", false),
    showPrivateOperators: readStoredPreference("showPrivateOperators", false),
    showProblematicGeometries: readStoredPreference("showProblematicGeometries", false),
    activeModeKeys: Array.from(parseSetFromStorage(USER_PREFERENCE_STORAGE_KEYS.activeModeKeys, DEFAULT_ACTIVE_MODE_KEYS)),
    activeFrequencyKeys: Array.from(
      parseSetFromStorage(USER_PREFERENCE_STORAGE_KEYS.activeFrequencyKeys, DEFAULT_ACTIVE_FREQUENCY_KEYS)
    ),
    manualLineVisibility: Object.fromEntries(
      parseVisibilityOverridesFromStorage(USER_PREFERENCE_STORAGE_KEYS.manualLineVisibility)
    )
  });
}
