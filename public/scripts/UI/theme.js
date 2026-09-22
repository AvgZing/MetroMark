// Push the current theme onto the map basemap. Returns false when the style
// (or the streets source) is not ready yet, so callers can retry after load.
function applyThemeToMap() {
  const map = appState.map;
  if (!map || typeof map.getSource !== "function") {
    return false;
  }
  const streets = map.getSource("streets");
  if (!streets) {
    return false;
  }

  if (appState.mapMode !== "satellite") {
    const wantsDark = appState.theme === "dark";
    const current = (map.getStyle().sources.streets || {}).tiles || [];
    const currentIsDark = current.some((url) => String(url).includes("dark_all"));
    // Skip redundant swaps: setTiles aborts in-flight tile requests.
    const needsSwap = !current.length || currentIsDark !== wantsDark;
    if (needsSwap) {
      const tiles = wantsDark ? cartoTileUrls("dark_all") : cartoTileUrls("light_all");
      try {
        streets.setTiles(tiles);
        map.triggerRepaint();
      } catch {
        // fallback: re-add source if setTiles not supported
        try {
          map.removeSource("streets");
          map.addSource("streets", {
            type: "raster",
            tiles,
            tileSize: 256,
            attribution: cartoAttribution()
          });
          map.triggerRepaint();
        } catch (e) {
          console.warn("Could not update map theme:", e);
        }
      }
    }
  }

  if (map.getLayer("focus-dim-layer")) {
    map.setPaintProperty(
      "focus-dim-layer",
      "fill-color",
      appState.theme === "dark" ? "#0a121c" : "#1f262d"
    );
  }

  return true;
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
