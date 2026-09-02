// Shared light/dark theme handling for the admin pages (admin.html and
// admin-override.html). Mirrors the main app: reads the saved preference,
// applies data-theme on <body>, and lets the toggle button swap the CARTO
// basemap tiles (light_all <-> dark_all) when a map exists.

var ADMIN_THEME_STORAGE_KEY = "metromark_theme";

// Optional function to retrieve the current map for the basemap tile swap.
// The main app exposes appState; the admin override uses its own `state`.
var ADMIN_THEME_MAP_ACCESSOR = function () {
  if (typeof appState !== "undefined" && appState && appState.map) {
    return appState.map;
  }
  if (typeof state !== "undefined" && state && state.map) {
    return state.map;
  }
  return null;
};

function getAdminTheme() {
  try {
    return localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyAdminTheme(theme) {
  var next = theme === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, next);
  } catch {
    // storage unavailable — still apply for this session
  }
  if (document.body) {
    document.body.setAttribute("data-theme", next);
  }

  // Swap the CARTO basemap tiles on the admin override map (if it exists).
  var map = ADMIN_THEME_MAP_ACCESSOR();
  if (map && map.getSource && map.getSource("streets")) {
    try {
      map.getSource("streets").setTiles(
        next === "dark" ? cartoTileUrls("dark_all") : cartoTileUrls("light_all")
      );
      map.triggerRepaint();
    } catch (e) {
      console.warn("Could not update admin basemap theme:", e);
    }
  }
}

function toggleAdminTheme() {
  var current = getAdminTheme();
  applyAdminTheme(current === "dark" ? "light" : "dark");
}

function initAdminTheme(toggleEl) {
  // Apply the saved preference on load.
  applyAdminTheme(getAdminTheme());

  if (toggleEl) {
    toggleEl.addEventListener("click", function () {
      toggleAdminTheme();
    });
    toggleEl.setAttribute("aria-pressed", getAdminTheme() === "dark" ? "true" : "false");
  }
}
