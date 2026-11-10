function createMapStyle(themeOverride) {
  // Shared by the app and the admin override map. Callers may pass a theme
  // (the admin has no appState); the app falls back to appState.theme.
  const theme = themeOverride || (typeof appState !== "undefined" && appState.theme) || "light";
  const style = protomapsMapStyle(theme);
  if (!style) {
    throw new Error("Basemap style unavailable.");
  }
  return style;
}

function updateMapModeButtons() {
  const streetsActive = appState.mapMode === "streets";
  dom.streetsModeBtn.classList.toggle("btn-primary", streetsActive);
  dom.satelliteModeBtn.classList.toggle("btn-primary", !streetsActive);
}

function setMapMode(mode) {
  appState.mapMode = mode;
  if (!appState.map || !appState.map.getLayer("satellite-base")) {
    return;
  }

  document.body.classList.add("basemap-switching");
  window.setTimeout(() => document.body.classList.remove("basemap-switching"), 260);
  appState.map.setLayoutProperty("satellite-base", "visibility", mode === "satellite" ? "visible" : "none");
  updateMapModeButtons();
}

function routeStopCacheKey(lineKey) {
  return `${String(lineKey || "")}|types:${ROUTE_STOP_TYPES_KEY}`;
}

function pruneLineStopsCache() {
  if (appState.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
    return;
  }

  const focusedCacheKey = appState.focusedLineKey ? routeStopCacheKey(appState.focusedLineKey) : "";

  const sorted = Array.from(appState.lineStopsCache.entries()).sort(
    (a, b) => Number(a[1]?.lastUsedAt || 0) - Number(b[1]?.lastUsedAt || 0)
  );

  for (const [cacheKey] of sorted) {
    if (appState.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
      break;
    }
    if (cacheKey === focusedCacheKey || appState.inFlightLineStopKeys.has(cacheKey)) {
      continue;
    }
    appState.lineStopsCache.delete(cacheKey);
  }
}
