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

// Ensure Line View functions are accessible (defensive programming)
if (typeof openLineView === 'undefined') {
  console.warn('openLineView not found in global scope - check core-state-ui.js loading');
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

  if (els.showAllStopsBtn) {
    els.showAllStopsBtn.addEventListener("click", () => {
      setShowAllStops(!state.showAllStops);
    });
  }

  if (els.lineViewBtn) {
    els.lineViewBtn.addEventListener("click", () => {
      if (!state.focusedLineKey) {
        return;
      }

      if (state.lineViewOpen) {
        if (typeof closeLineView !== 'undefined') {
          closeLineView({ restore: true });
        } else {
          console.error('closeLineView function not found');
        }
      } else {
        if (typeof openLineView !== 'undefined') {
          openLineView(state.focusedLineKey).catch((error) => {
            setStatus(error.message, "error");
          });
        } else {
          console.error('openLineView function not found - core-state-ui.js may not have loaded');
          setStatus('Line View feature is not available', 'error');
        }
      }
    });
  }

  if (els.toggleLineViewAutoBtn) {
    els.toggleLineViewAutoBtn.addEventListener("click", () => {
      state.lineViewAutoOpenEnabled = !state.lineViewAutoOpenEnabled;
      if (typeof saveUserPreferences === "function") {
        saveUserPreferences({ lineViewAutoOpenEnabled: state.lineViewAutoOpenEnabled }).catch(() => {});
      }
      renderUserStatus();
      const status = state.lineViewAutoOpenEnabled ? "enabled" : "disabled";
      setStatus(`Line view auto-open ${status} for desktop`, "ok");
    });
  }

  if (els.lineViewReturnBtn) {
    els.lineViewReturnBtn.addEventListener("click", () => {
      if (typeof closeLineView !== 'undefined') {
        closeLineView({ restore: true });
      }
    });
  }

  if (els.lineViewMapBtn) {
    els.lineViewMapBtn.addEventListener("click", () => {
      if (typeof openLineViewMap !== 'undefined') {
        openLineViewMap().catch((error) => {
          setStatus(error.message, "error");
        });
      } else {
        console.error('openLineViewMap function not found');
      }
    });
  }

  els.accountPopupBtn.addEventListener("click", () => {
    if (state.activePopup !== "account") {
      setAuthFeedback();
    }
    setActivePopup("account");
  });
  els.closeAuthPopupBtn.addEventListener("click", closePopups);

  // Wire simple settings toggles in the account panel
  try {
    const showPrivateEl = document.getElementById("showPrivateOperators");
    if (showPrivateEl) {
      showPrivateEl.checked = Boolean(state.showPrivateOperators);
      showPrivateEl.addEventListener("change", () => {
        state.showPrivateOperators = Boolean(showPrivateEl.checked);
        if (typeof saveUserPreferences === "function") {
          saveUserPreferences({ showPrivateOperators: state.showPrivateOperators }).catch(() => {});
        }
        if (typeof saveDefaultPresetDebounced === "function") {
          try { saveDefaultPresetDebounced(); } catch (e) {}
        }
      });
    }

    const showProblemEl = document.getElementById("showProblematicGeometries");
    if (showProblemEl) {
      showProblemEl.checked = Boolean(state.showProblematicGeometries);
      showProblemEl.addEventListener("change", () => {
        state.showProblematicGeometries = Boolean(showProblemEl.checked);
        if (typeof saveUserPreferences === "function") {
          saveUserPreferences({ showProblematicGeometries: state.showProblematicGeometries }).catch(() => {});
        }
        if (typeof saveDefaultPresetDebounced === "function") {
          try { saveDefaultPresetDebounced(); } catch (e) {}
        }
      });
    }
  } catch (e) {
    // ignore
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.lineViewOpen) {
        closeLineView({ restore: true });
      }
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
    if (state.loadedLineSummaries) {
      state.loadedLineSummaries = [];
    }
    if (state.routeStopsAutoLoadAttempts) {
      state.routeStopsAutoLoadAttempts.clear();
    }
    if (state.routeStopCountLoadAttempts) {
      state.routeStopCountLoadAttempts.clear();
    }
    state.inFlightLineStopKeys.clear();
    if (state.inFlightRouteStopCountKeys) {
      state.inFlightRouteStopCountKeys.clear();
    }
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

  const forceRefreshBtn = document.getElementById("forceRefreshBtn");
  if (forceRefreshBtn) {
    forceRefreshBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Re-fetch transit data for the current viewport from Transitland? This may use API quota."
      );
      if (!confirmed) return;
      setBackendStatus("Reloading viewport from Transitland...");
      try {
        // Clear focused route's stop cache so geometry re-fetches fresh
        if (state.focusedLineKey) {
          const stopCacheKey = typeof routeStopCacheKey === "function" ? routeStopCacheKey(state.focusedLineKey) : `${state.focusedLineKey}|types:${ROUTE_STOP_TYPES_KEY}`;
          state.lineStopsCache.delete(stopCacheKey);
          state.inFlightLineStopKeys.delete(stopCacheKey);
        }
        await loadVisibleTransit({ forceRefresh: true, reason: "manual-refresh" });
        // Wait for the full Transitland phase to complete (fires 100ms later)
        await new Promise((resolve) => {
          const poll = () => {
            if (state.fetchQueue.length === 0 && state.inFlightAreaKeys.size === 0) {
              // Small extra wait for the final responses to be processed
              setTimeout(resolve, 200);
            } else {
              setTimeout(poll, 300);
            }
          };
          setTimeout(poll, 300);
        });
        // Re-fetch focused route stops from Transitland to get full geometry
        if (state.focusedLineKey && typeof ensureLineStopsLoaded === "function") {
          await ensureLineStopsLoaded(state.focusedLineKey, { forceRefresh: true, silent: true });
          rebuildCombinedTransit();
          renderMapData();
        }
        setBackendStatus("Transitland reload complete.");
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
  }

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
    const remember = String(formData.get("remember") || "") === "on" || String(formData.get("remember") || "") === "true";

    try {
      await loginWithPayload(
        apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        }),
        { successMessage: "Logged in successfully.", remember }
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
    if (state.lineViewOrderingVoteClickSetsByLineKey) {
      state.lineViewOrderingVoteClickSetsByLineKey.clear();
    }
    state.visitedByLine = new Map();

    updateAuthUi();
    closePopups();
    renderMapData();
    renderProgress();

    setStatus("Logged out.", "ok");
  });
}

async function init() {
  const initT0 = performance.now();
  document.body.classList.remove("app-ready");
  setTheme(state.theme);
  syncMobilePanelLayout();
  normalizeModeSelection();
  normalizeFrequencySelection();
  normalizeManualVisibilityOverrides();
  renderApiCounter();
  restoreUserStatusFromFocus();

  bindEvents();
  console.log(`[perf] init: pre-map setup in ${(performance.now() - initT0).toFixed(1)}ms`);
  initializeMap();

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

  const startupDataPromise = Promise.all([loadCities(), hydrateSession()]);
  const mapReadyPromise = waitForMapReady();
  const mapT0 = performance.now();

  try {
    await mapReadyPromise;
    console.log(`[perf] init: map ready in ${(performance.now() - mapT0).toFixed(1)}ms`);

    // Apply map theme now that the map style is loaded
    if (state.theme === "dark" || state.theme === "light") {
      setTheme(state.theme, { persist: false });
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.body.classList.add("app-ready");
        if (state.map && typeof state.map.resize === "function") {
          state.map.resize();
        }
        triggerInitialLoad();
      });
    });

    window.setTimeout(triggerInitialLoad, 1400);

    const startupT0 = performance.now();
    await startupDataPromise;
    console.log(`[perf] init: startup data (cities + session) in ${(performance.now() - startupT0).toFixed(1)}ms`);

    await loadProgress();

    const activeModeLabels = MODE_DEFS.filter((modeDef) => state.activeModeKeys.has(modeDef.key)).map(
      (modeDef) => modeDef.label
    );

    setStatus(
      "Route loading is automatic for the map area you are viewing.",
      "ok",
      `Visible by default: ${activeModeLabels.join(", ")} | All Frequencies. Stops load only when you focus a route.`
    );
    console.log(`[perf] init: total app init in ${(performance.now() - initT0).toFixed(1)}ms`);
  } catch (error) {
    setStatus(error.message, "error");
  }

  initializeDiagnostics();
}

init();
