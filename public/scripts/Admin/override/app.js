// Admin Map Editor — startup: boot sequence, collapsible panels, init.

async function bootApp() {
  await loadCities();
  await loadCityPanelList();
  await initMap();
  state.map.once("load", () => {
    setTimeout(() => {
      loadExistingEdits();
      loadOperatorsForViewport();
      loadReviewQueue();
      loadAdminMerges();
      loadProblematicRoutes();
    }, 1500);
  });
}

// Click a panel heading to fold it away; state persists per panel.
function initCollapsiblePanels() {
  document.querySelectorAll(".override-sidebar .panel").forEach((panel) => {
    const heading = panel.querySelector(":scope > h2");
    if (!heading) {
      return;
    }
    const text = (heading.textContent || "").trim();
    const key = `metromark_admin_panel_${text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    // Sidebar panels start collapsed since there are many of them.
    let collapsed = true;
    try {
      const stored = localStorage.getItem(key);
      if (stored === "1" || stored === "0") {
        collapsed = stored === "1";
      }
    } catch {
      // storage unavailable
    }
    panel.classList.toggle("is-collapsed", collapsed);

    const syncExpanded = () => {
      heading.setAttribute("aria-expanded", String(!panel.classList.contains("is-collapsed")));
    };
    syncExpanded();

    const toggle = () => {
      const next = !panel.classList.contains("is-collapsed");
      panel.classList.toggle("is-collapsed", next);
      syncExpanded();
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // storage unavailable
      }
    };

    heading.setAttribute("role", "button");
    heading.tabIndex = 0;
    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  });
}

async function init() {
  els.adminEmailInput.value = "";
  els.adminPasswordInput.value = "";
  initCollapsiblePanels();
  bindEvents();
  renderAdminModeFilter();
  renderAdminFrequencyFilter();

  // Apply the saved light/dark theme and wire the toggle (basemap swap is
  // handled automatically once the map exists).
  if (typeof initAdminTheme === "function") {
    initAdminTheme(document.getElementById("themeToggleBtn"));
  }

  if (state.token) {
    try {
      await apiRequest("/api/admin/session");
      setAdminLocked(false);
      await bootApp();
      return;
    } catch {
      clearAdminSession();
    }
  }
  setAdminLocked(true);
}

init().catch((error) => {
  els.loginStatusMessage.textContent = error.message;
});
