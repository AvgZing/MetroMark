/** Retrieve a parsed Set from localStorage, falling back to defaults if missing or corrupt. */
function parseSetFromStorage(storageKey, defaults) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return new Set(defaults);
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set(defaults);
    }

    const normalized = parsed.map((value) => String(value || "").trim()).filter(Boolean);
    return normalized.length ? new Set(normalized) : new Set(defaults);
  } catch {
    return new Set(defaults);
  }
}

/** Retrieve a boolean value from localStorage with a configurable default. */
function parseBooleanFromStorage(storageKey, defaultValue = false) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) {
      return defaultValue;
    }

    return raw === "true";
  } catch {
    return defaultValue;
  }
}

/** Persist a boolean value to localStorage as a "true"/"false" string. */
function persistBooleanToStorage(storageKey, value) {
  localStorage.setItem(storageKey, value ? "true" : "false");
}

/** Persist a Set or array of values to localStorage as a JSON array. */
function persistSetToStorage(storageKey, values) {
  localStorage.setItem(storageKey, JSON.stringify(Array.from(values)));
}

/** Parse per-line visibility overrides (on/off) from localStorage into a Map. */
function parseVisibilityOverridesFromStorage(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }

    const visibilityMap = new Map();
    for (const [lineKeyRaw, valueRaw] of Object.entries(parsed)) {
      const lineKey = String(lineKeyRaw || "").trim();
      const value = String(valueRaw || "").trim().toLowerCase();
      if (!lineKey) {
        continue;
      }
      if (value === "on" || value === "off") {
        visibilityMap.set(lineKey, value);
      }
    }

    return visibilityMap;
  } catch {
    return new Map();
  }
}

/** Parse per-line route ordering preferences (mode + reversed) from sessionStorage into a Map. */
function parseLineViewOrderingPreferencesFromStorage(storageKey) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }

    const preferenceMap = new Map();
    for (const [lineKeyRaw, valueRaw] of Object.entries(parsed)) {
      const lineKey = String(lineKeyRaw || "").trim();
      if (!lineKey || !valueRaw || typeof valueRaw !== "object" || Array.isArray(valueRaw)) {
        continue;
      }

      preferenceMap.set(lineKey, {
        mode: normalizeLineViewOrderingMode(valueRaw.mode),
        reversed: Boolean(valueRaw.reversed)
      });
    }

    return preferenceMap;
  } catch {
    return new Map();
  }
}

/** Persist per-line route ordering preferences from a Map into sessionStorage as JSON. */
function persistLineViewOrderingPreferencesToStorage(storageKey, preferenceMap) {
  const payload = {};

  for (const [lineKeyRaw, valueRaw] of preferenceMap.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    if (!lineKey) {
      continue;
    }

    payload[lineKey] = {
      mode: normalizeLineViewOrderingMode(valueRaw?.mode),
      reversed: Boolean(valueRaw?.reversed)
    };
  }

  sessionStorage.setItem(storageKey, JSON.stringify(payload));
}

/** Persist per-line visibility overrides from a Map into localStorage as a JSON object. */
function persistVisibilityOverridesToStorage(storageKey, visibilityMap) {
  const payload = {};
  for (const [lineKeyRaw, valueRaw] of visibilityMap.entries()) {
    const lineKey = String(lineKeyRaw || "").trim();
    const value = String(valueRaw || "").trim().toLowerCase();
    if (!lineKey) {
      continue;
    }
    if (value !== "on" && value !== "off") {
      continue;
    }
    payload[lineKey] = value;
  }

  localStorage.setItem(storageKey, JSON.stringify(payload));
}

/** Normalize a raw ordering mode string to a recognized enum value (auto, geometry-revised, etc.). */
function normalizeLineViewOrderingMode(orderingMode) {
  const mode = String(orderingMode || "geometry-revised").trim();

  if (mode === "auto" || mode === "geometry-revised" || mode === "legacy-geometry" || mode === "fractions") {
    return mode;
  }

  if (mode === "geometry-only") {
    return "legacy-geometry";
  }

  if (mode === "fractions-only") {
    return "fractions";
  }

  return "geometry-revised";
}
