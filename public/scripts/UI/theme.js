function setTheme(theme, options = {}) {
  appState.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", appState.theme);

  // Update streets basemap to match theme (light or dark Carto tiles)
  if (appState.map && appState.map.getSource("streets") && appState.mapMode !== "satellite") {
    const tiles = appState.theme === "dark"
      ? ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"]
      : ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"];
    try {
      appState.map.getSource("streets").setTiles(tiles);
      appState.map.triggerRepaint();
    } catch {
      // fallback: re-add source if setTiles not supported
      try {
        appState.map.removeSource("streets");
        appState.map.addSource("streets", {
          type: "raster",
          tiles,
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
        });
        appState.map.triggerRepaint();
      } catch (e) {
        console.warn("Could not update map theme:", e);
      }
    }
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

  localStorage.setItem("metromark_theme", appState.theme);
}

function toggleTheme() {
  setTheme(appState.theme === "dark" ? "light" : "dark");
}
