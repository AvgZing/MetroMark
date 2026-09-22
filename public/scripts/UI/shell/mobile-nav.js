// Mobile bottom navigation: Map / Filters / Progress / Profile screens on the
// portrait layout. Desktop is untouched.

(function () {
  function isPortrait() {
    return typeof isPortraitMobileLayout === "function" ? isPortraitMobileLayout() : false;
  }

  function currentScreen() {
    const body = document.body;
    const cities = document.getElementById("citiesBackdrop");
    if (cities && !cities.hidden) return "cities";
    if (body.classList.contains("mobile-profile-open")) return "profile";
    if (body.classList.contains("filters-panel-open")) return "filters";
    const progress = document.getElementById("progressOverlay");
    if (progress && !progress.hidden) return "progress";
    return "map";
  }

  function updateTabs(screen) {
    document.querySelectorAll("#mobileTabbar [data-screen]").forEach((btn) => {
      if (btn.dataset.screen === screen) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    });
  }

  function panelFor(screen) {
    if (screen === "filters") return { el: document.getElementById("filtersPanel"), set: window.setFiltersPanelOpen };
    if (screen === "cities") return { el: document.getElementById("citiesPanel"), set: window.setCitiesSheetOpen };
    if (screen === "progress") {
      const overlay = document.getElementById("progressOverlay");
      return { el: overlay ? overlay.querySelector(".filters-panel") : null, set: window.setProgressOverlayOpen };
    }
    return { el: null, set: null };
  }

  function toggleSheetHalfFull(screen) {
    const { el, set } = panelFor(screen);
    if (!el || typeof set !== "function") {
      return;
    }
    const backdrop = el.closest(".filters-panel-backdrop");
    const wasOpen = backdrop ? !backdrop.hidden : !el.hidden;
    if (!wasOpen) {
      set(true);
      if (typeof window.setPageSheetState === "function") {
        window.setPageSheetState(el, "full");
      }
      return;
    }
    const next = el.dataset.sheetState === "full" ? "half" : "full";
    if (typeof window.setPageSheetState === "function") {
      window.setPageSheetState(el, next);
    } else {
      el.classList.remove("sheet-peek", "sheet-half", "sheet-full");
      el.classList.add(`sheet-${next}`);
      el.dataset.sheetState = next;
      if (typeof window.updateChromeVisibility === "function") {
        window.updateChromeVisibility();
      }
    }
  }

  function setScreen(screen) {
    if (!isPortrait()) {
      return;
    }

    const activeScreen = currentScreen();

    if (screen === "map") {
      document.body.classList.remove("mobile-profile-open");
      if (window.setFiltersPanelOpen) window.setFiltersPanelOpen(false);
      if (window.setProgressOverlayOpen) window.setProgressOverlayOpen(false);
      if (window.setCitiesSheetOpen) window.setCitiesSheetOpen(false);
      if (appState.activePopup) closePopups();
      if (appState.focusedLineKey) {
        document.body.classList.add("route-selected");
        if (window.setMobileSheetState) window.setMobileSheetState("half");
      } else {
        document.body.classList.remove("route-selected");
        if (window.setMobileSheetState) window.setMobileSheetState("peek");
      }
      updateTabs("map");
      return;
    }

    if (screen === "cities") {
      if (activeScreen === "cities") {
        toggleSheetHalfFull("cities");
      } else {
        if (window.setFiltersPanelOpen) window.setFiltersPanelOpen(false);
        if (window.setProgressOverlayOpen) window.setProgressOverlayOpen(false);
        if (window.setCitiesSheetOpen) window.setCitiesSheetOpen(true);
      }
      updateTabs("cities");
      return;
    }

    if (screen === activeScreen) {
      toggleSheetHalfFull(screen);
      updateTabs(screen);
      return;
    }

    const body = document.body;
    body.classList.toggle("mobile-profile-open", screen === "profile");
    if (typeof window.setCitiesSheetOpen === "function") {
      window.setCitiesSheetOpen(false);
    }
    if (typeof window.setFiltersPanelOpen === "function") {
      window.setFiltersPanelOpen(screen === "filters");
    }
    if (typeof window.setProgressOverlayOpen === "function") {
      window.setProgressOverlayOpen(screen === "progress");
    }

    if (screen === "profile") {
      if (appState.activePopup !== "account") {
        setActivePopup("account");
      }
    } else if (appState.activePopup) {
      closePopups();
    }

    if (screen === "progress" && typeof renderProgress === "function") {
      renderProgress();
    }

    updateTabs(screen);
  }

  function resetScreens() {
    document.body.classList.remove("mobile-progress-open", "mobile-profile-open");
    if (typeof window.setFiltersPanelOpen === "function") {
      window.setFiltersPanelOpen(false);
    }
    if (appState.activePopup === "account") {
      closePopups();
    }
    updateTabs("map");
  }

  function bind() {
    const bar = document.getElementById("mobileTabbar");
    if (!bar) {
      return;
    }

    bar.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-screen]");
      if (!btn) {
        return;
      }
      event.stopPropagation();
      setScreen(btn.dataset.screen);
    });

    document.addEventListener("pointerdown", (event) => {
      if (!isPortrait() || !document.body.classList.contains("mobile-progress-open")) {
        return;
      }
      const target = event.target;
      if (!target.closest("#progressPanel") && !target.closest("#mobileTabbar")) {
        setScreen("map");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isPortrait() && currentScreen() !== "map") {
        setScreen("map");
      }
    });

    window.addEventListener("resize", () => {
      if (!isPortrait()) {
        resetScreens();
      }
    });
    window.addEventListener("orientationchange", () => {
      if (!isPortrait()) {
        resetScreens();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.setMobileScreen = setScreen;
})();
