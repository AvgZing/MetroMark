function setTheme(theme, options = {}) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", state.theme);

  // Update streets basemap to match theme (light or dark Carto tiles)
  if (state.map && state.map.getSource("streets") && state.mapMode !== "satellite") {
    const tiles = state.theme === "dark"
      ? ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"]
      : ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"];
    try {
      state.map.getSource("streets").setTiles(tiles);
      state.map.triggerRepaint();
    } catch {
      // fallback: re-add source if setTiles not supported
      try {
        state.map.removeSource("streets");
        state.map.addSource("streets", {
          type: "raster",
          tiles,
          tileSize: 256,
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
        });
        state.map.triggerRepaint();
      } catch (e) {
        console.warn("Could not update map theme:", e);
      }
    }
  }

  if (options.persist === false) {
    return;
  }

  if (state.user) {
    saveUserPreferences({ theme: state.theme }).catch((error) => {
      console.warn("Unable to save theme preference:", error);
    });
    return;
  }

  localStorage.setItem("metromark_theme", state.theme);
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}
