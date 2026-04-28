function waitForMapReady() {
  return new Promise((resolve) => {
    if (state.mapReady) {
      resolve();
      return;
    }
    state.mapReadyResolver = resolve;
  });
}

function setAuthFeedback(message = "", kind = "neutral") {
  if (!els.authFeedback) {
    return;
  }

  const text = String(message || "").trim();
  els.authFeedback.classList.remove("ok", "error");

  if (!text) {
    els.authFeedback.hidden = true;
    els.authFeedback.textContent = "";
    return;
  }

  els.authFeedback.hidden = false;
  els.authFeedback.textContent = text;

  if (kind === "ok" || kind === "error") {
    els.authFeedback.classList.add(kind);
  }
}

function bindEvents() {
  els.themeToggleBtn.addEventListener("click", toggleTheme);

  if (els.mobileDrawerTab) {
    els.mobileDrawerTab.addEventListener("click", () => {
      setMobilePanelsOpen(!state.mobilePanelsOpen);
    });
  }

  els.streetsModeBtn.addEventListener("click", () => setMapMode("streets"));
  els.satelliteModeBtn.addEventListener("click", () => setMapMode("satellite"));

  els.accountPopupBtn.addEventListener("click", () => {
    if (state.activePopup !== "account") {
      setAuthFeedback();
    }
    setActivePopup("account");
  });
  els.closeAuthPopupBtn.addEventListener("click", closePopups);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.mobilePanelsOpen) {
        setMobilePanelsOpen(false);
      }
      closeRouteSelectionPopup();
      onStopHoverLeave();
      onRouteHoverLeave();
      closePopups();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;

    if (state.mobilePanelsOpen && isPortraitMobileLayout()) {
      const clickedInsideSidebar = target.closest(".sidebar");
      const clickedDrawerTab = els.mobileDrawerTab && els.mobileDrawerTab.contains(target);
      if (!clickedInsideSidebar && !clickedDrawerTab) {
        setMobilePanelsOpen(false);
      }
    }

    if (!state.activePopup) {
      return;
    }

    const clickedToggle = els.accountPopupBtn.contains(target);
    const clickedPanel = els.authPopup.contains(target);

    if (!clickedToggle && !clickedPanel) {
      closePopups();
    }
  });

  window.addEventListener("resize", syncMobilePanelLayout);
  window.addEventListener("orientationchange", syncMobilePanelLayout);

  els.clearSessionCacheBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Clear local in-browser cache for this session? Use this only if you suspect stale transit data."
    );

    if (!confirmed) {
      return;
    }

    state.areaCache.clear();
    state.lineStopsCache.clear();
    state.inFlightLineStopKeys.clear();
    resetViewAggregation();

    rebuildCombinedTransit();
    refreshUiFromState();

    setBackendStatus("Local session cache cleared by user (route tiles and route stops).");

    try {
      await loadVisibleTransit({ forceRefresh: false, reason: "clear-cache" });
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  if (els.clearRouteProgressBtn) {
    els.clearRouteProgressBtn.addEventListener("click", () => {
      const routeLineKey = state.userStatus.routeLineKey || state.focusedLineKey;
      const normalizedLineKey = String(routeLineKey || "").trim();
      if (!normalizedLineKey) {
        return;
      }

      if (state.clearRouteProgressConfirmLineKey !== normalizedLineKey) {
        resetClearRouteProgressConfirmation();
        state.clearRouteProgressConfirmLineKey = normalizedLineKey;
        state.clearRouteProgressConfirmTimeoutId = window.setTimeout(() => {
          resetClearRouteProgressConfirmation({ renderNow: true });
        }, 7000);
        renderUserStatus();
        return;
      }

      clearRouteProgress(normalizedLineKey).catch(() => {});
    });
  }

  if (els.deselectRouteBtn) {
    els.deselectRouteBtn.addEventListener("click", () => {
      clearFocusedLine("Route focus cleared.", "Showing all filtered routes again.");
    });
  }

  els.lineSearch.addEventListener("input", () => {
    state.lineSearchQuery = String(els.lineSearch.value || "").trim().toLowerCase();
    clearStatusPin();
    resetClearRouteProgressConfirmation();

    const shown = getShownLines();
    if (state.focusedLineKey && !shown.some((line) => line.lineKey === state.focusedLineKey)) {
      state.focusedLineKey = "";
    }

    renderLineList();
    renderMapData();
    renderProgress();
    restoreUserStatusFromFocus();
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthFeedback();

    const formData = new FormData(els.loginForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      await loginWithPayload(
        apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        }),
        { successMessage: "Logged in successfully." }
      );
      els.loginForm.reset();
    } catch (error) {
      setAuthFeedback(error.message, "error");
      setStatus(error.message, "error");
    }
  });

  els.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthFeedback();

    const formData = new FormData(els.registerForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const displayName = String(formData.get("displayName") || "").trim();

    try {
      await loginWithPayload(
        apiRequest("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName })
        }),
        { successMessage: "Account created successfully. You are now signed in." }
      );
      els.registerForm.reset();
    } catch (error) {
      setAuthFeedback(error.message, "error");
      setStatus(error.message, "error");
    }
  });

  els.logoutBtn.addEventListener("click", () => {
    setToken("");
    state.user = null;
    state.visitedByLine = new Map();

    updateAuthUi();
    closePopups();
    renderMapData();
    renderProgress();

    setStatus("Logged out.", "ok");
  });
}

async function init() {
  document.body.classList.remove("app-ready");
  setTheme(state.theme);
  syncMobilePanelLayout();
  normalizeModeSelection();
  normalizeFrequencySelection();
  normalizeManualVisibilityOverrides();
  renderApiCounter();
  restoreUserStatusFromFocus();

  bindEvents();
  initializeMap();

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.body.classList.add("app-ready");
    });
  });

  try {
    await Promise.all([loadCities(), hydrateSession()]);
    await waitForMapReady();

    const city = selectedCityPreset();

    let initialTriggered = false;
    const triggerInitialLoad = () => {
      if (initialTriggered) {
        return;
      }
      initialTriggered = true;

      loadVisibleTransit({ forceRefresh: false, reason: "initial" }).catch((error) => {
        setBackendStatus(`Initial load failed: ${error.message}`);
      });
    };

    if (city) {
      state.map.once("moveend", triggerInitialLoad);
      fitToArea(city);
    } else {
      triggerInitialLoad();
    }

    window.setTimeout(triggerInitialLoad, 1400);

    await loadProgress();

    const activeModeLabels = MODE_DEFS.filter((modeDef) => state.activeModeKeys.has(modeDef.key)).map(
      (modeDef) => modeDef.label
    );

    setStatus(
      "Route loading is automatic for the map area you are viewing.",
      "ok",
      `Visible by default: ${activeModeLabels.join(", ")} | All Frequencies. Stops load only when you focus a route.`
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

init();
