// Push the current theme onto the map basemap. Returns false when the style
// is not ready yet, so callers can retry after load.
function applyThemeToMap() {
  const map = appState.map;
  if (!map || typeof applyProtomapsTheme !== "function") {
    return false;
  }
  const applied = applyProtomapsTheme(map, appState.theme);
  if (map.getLayer("focus-dim-layer")) {
    map.setPaintProperty(
      "focus-dim-layer",
      "fill-color",
      appState.theme === "dark" ? "#0a121c" : "#1f262d"
    );
  }
  return applied;
}

function setTheme(theme, options = {}) {
  appState.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", appState.theme);

  if (!applyThemeToMap() && appState.map && typeof appState.map.once === "function") {
    // Hard reload or a late preference load can change the theme before the
    // style finishes loading; re-apply once the map settles.
    appState.map.once("idle", () => applyThemeToMap());
  }

  if (options.persist === false) {
    return;
  }

  if (appState.user) {
    saveUserPreferences({ theme: appState.theme }).catch((error) => {
      console.warn("Unable to save theme preference:", error);
    });
    return;
  }

  if (typeof storageConsentAllowed === "function" && !storageConsentAllowed()) {
    return;
  }

  localStorage.setItem("metromark_theme", appState.theme);
}

function toggleTheme() {
  setTheme(appState.theme === "dark" ? "light" : "dark");
}
