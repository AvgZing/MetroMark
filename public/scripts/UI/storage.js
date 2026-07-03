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

function persistBooleanToStorage(storageKey, value) {
  localStorage.setItem(storageKey, value ? "true" : "false");
}

function persistSetToStorage(storageKey, values) {
  localStorage.setItem(storageKey, JSON.stringify(Array.from(values)));
}

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
