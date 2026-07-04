function waitForMapReady() {
  return new Promise((resolve) => {
    if (appState.mapReady) {
      resolve();
      return;
    }
    appState.mapReadyResolver = resolve;
  });
}

function setAuthFeedback(message = "", kind = "neutral") {
  if (!dom.authFeedback) {
    return;
  }

  const text = String(message || "").trim();
  dom.authFeedback.classList.remove("ok", "error");

  if (!text) {
    dom.authFeedback.hidden = true;
    dom.authFeedback.textContent = "";
    return;
  }

  dom.authFeedback.hidden = false;
  dom.authFeedback.textContent = text;

  if (kind === "ok" || kind === "error") {
    dom.authFeedback.classList.add(kind);
  }
}

// Ensure Line View functions are accessible (defensive programming)
if (typeof openLineView === 'undefined') {
  console.warn('openLineView not found in global scope - check route-ui.js loading');
}

function bindEvents() {
  dom.themeToggleBtn.addEventListener("click", toggleTheme);

  if (dom.mobileDrawerTab) {
    dom.mobileDrawerTab.addEventListener("click", () => {
      setMobilePanelsOpen(!appState.mobilePanelsOpen);
    });
  }

  dom.streetsModeBtn.addEventListener("click", () => setMapMode("streets"));
  dom.satelliteModeBtn.addEventListener("click", () => setMapMode("satellite"));

  if (dom.showAllStopsBtn) {
    dom.showAllStopsBtn.addEventListener("click", () => {
      setShowAllStops(!appState.showAllStops);
    });
  }

  if (dom.lineViewBtn) {
    dom.lineViewBtn.addEventListener("click", () => {
      if (!appState.focusedLineKey) {
        return;
      }

      if (appState.lineViewOpen) {
        if (typeof closeLineView !== 'undefined') {
          closeLineView({ restore: true });
        } else {
          console.error('closeLineView function not found');
        }
      } else {
        if (typeof openLineView !== 'undefined') {
          openLineView(appState.focusedLineKey).catch((error) => {
            setStatus(error.message, "error");
          });
        } else {
          console.error('openLineView function not found - route-ui.js may not have loaded');
          setStatus('Line View feature is not available', 'error');
        }
      }
    });
  }

  if (dom.toggleLineViewAutoBtn) {
    dom.toggleLineViewAutoBtn.addEventListener("click", () => {
      appState.lineViewAutoOpenEnabled = !appState.lineViewAutoOpenEnabled;
      if (typeof saveUserPreferences === "function") {
        saveUserPreferences({ lineViewAutoOpenEnabled: appState.lineViewAutoOpenEnabled }).catch(() => {});
      }
      renderUserStatus();
      const status = appState.lineViewAutoOpenEnabled ? "enabled" : "disabled";
      setStatus(`Line view auto-open ${status} for desktop`, "ok");
    });
  }

  if (dom.lineViewReturnBtn) {
    dom.lineViewReturnBtn.addEventListener("click", () => {
      if (typeof closeLineView !== 'undefined') {
        closeLineView({ restore: true });
      }
    });
  }

  if (dom.lineViewMapBtn) {
    dom.lineViewMapBtn.addEventListener("click", () => {
      if (typeof openLineViewMap !== 'undefined') {
        openLineViewMap().catch((error) => {
          setStatus(error.message, "error");
        });
      } else {
        console.error('openLineViewMap function not found');
      }
    });
  }

  dom.accountPopupBtn.addEventListener("click", () => {
    if (appState.activePopup !== "account") {
      setAuthFeedback();
    }
    setActivePopup("account");
  });
  dom.closeAuthPopupBtn.addEventListener("click", closePopups);

  // Wire simple settings toggles in the account panel
  try {
    const showPrivateEl = document.getElementById("showPrivateOperators");
    if (showPrivateEl) {
      showPrivateEl.checked = Boolean(appState.showPrivateOperators);
      showPrivateEl.addEventListener("change", () => {
        appState.showPrivateOperators = Boolean(showPrivateEl.checked);
        if (typeof saveUserPreferences === "function") {
          saveUserPreferences({ showPrivateOperators: appState.showPrivateOperators }).catch(() => {});
        }
        if (typeof saveDefaultPresetDebounced === "function") {
          try { saveDefaultPresetDebounced(); } catch (e) {}
        }
      });
    }

    const showProblemEl = document.getElementById("showProblematicGeometries");
    if (showProblemEl) {
      showProblemEl.checked = Boolean(appState.showProblematicGeometries);
      showProblemEl.addEventListener("change", () => {
        appState.showProblematicGeometries = Boolean(showProblemEl.checked);
        if (typeof saveUserPreferences === "function") {
          saveUserPreferences({ showProblematicGeometries: appState.showProblematicGeometries }).catch(() => {});
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
      if (appState.lineViewOpen) {
        closeLineView({ restore: true });
      }
      if (appState.mobilePanelsOpen) {
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

    if (appState.mobilePanelsOpen && isPortraitMobileLayout()) {
      const clickedInsideSidebar = target.closest(".sidebar");
      const clickedDrawerTab = dom.mobileDrawerTab && dom.mobileDrawerTab.contains(target);
      if (!clickedInsideSidebar && !clickedDrawerTab) {
        setMobilePanelsOpen(false);
      }
    }

    if (!appState.activePopup) {
      return;
    }

    const clickedToggle = dom.accountPopupBtn.contains(target);
    const clickedPanel = dom.authPopup.contains(target);

    if (!clickedToggle && !clickedPanel) {
      closePopups();
    }
  });

  window.addEventListener("resize", syncMobilePanelLayout);
  window.addEventListener("orientationchange", syncMobilePanelLayout);

  dom.clearSessionCacheBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Clear local in-browser cache for this session? Use this only if you suspect stale transit data."
    );

    if (!confirmed) {
      return;
    }

    appState.areaCache.clear();
    appState.lineStopsCache.clear();
    if (appState.loadedLineSummaries) {
      appState.loadedLineSummaries = [];
    }
    if (appState.routeStopsAutoLoadAttempts) {
      appState.routeStopsAutoLoadAttempts.clear();
    }
    if (appState.routeStopCountLoadAttempts) {
      appState.routeStopCountLoadAttempts.clear();
    }
    appState.inFlightLineStopKeys.clear();
    if (appState.inFlightRouteStopCountKeys) {
      appState.inFlightRouteStopCountKeys.clear();
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
        if (appState.focusedLineKey) {
          const stopCacheKey = typeof routeStopCacheKey === "function" ? routeStopCacheKey(appState.focusedLineKey) : `${appState.focusedLineKey}|types:${ROUTE_STOP_TYPES_KEY}`;
          appState.lineStopsCache.delete(stopCacheKey);
          appState.inFlightLineStopKeys.delete(stopCacheKey);
        }
        await loadVisibleTransit({ forceRefresh: true, reason: "manual-refresh" });
        // Wait for the full Transitland phase to complete (fires 100ms later)
        await new Promise((resolve) => {
          const poll = () => {
            if (appState.fetchQueue.length === 0 && appState.inFlightAreaKeys.size === 0) {
              // Small extra wait for the final responses to be processed
              setTimeout(resolve, 200);
            } else {
              setTimeout(poll, 300);
            }
          };
          setTimeout(poll, 300);
        });
        // Re-fetch focused route stops from Transitland to get full geometry
        if (appState.focusedLineKey && typeof ensureLineStopsLoaded === "function") {
          await ensureLineStopsLoaded(appState.focusedLineKey, { forceRefresh: true, silent: true });
          rebuildCombinedTransit();
          renderMapData();
        }
        setBackendStatus("Transitland reload complete.");
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
  }

  if (dom.clearRouteProgressBtn) {
    dom.clearRouteProgressBtn.addEventListener("click", () => {
      const routeLineKey = appState.userStatus.routeLineKey || appState.focusedLineKey;
      const normalizedLineKey = String(routeLineKey || "").trim();
      if (!normalizedLineKey) {
        return;
      }

      if (appState.clearRouteProgressConfirmLineKey !== normalizedLineKey) {
        resetClearRouteProgressConfirmation();
        appState.clearRouteProgressConfirmLineKey = normalizedLineKey;
        appState.clearRouteProgressConfirmTimeoutId = window.setTimeout(() => {
          resetClearRouteProgressConfirmation({ renderNow: true });
        }, 7000);
        renderUserStatus();
        return;
      }

      clearRouteProgress(normalizedLineKey).catch(() => {});
    });
  }

  if (dom.deselectRouteBtn) {
    dom.deselectRouteBtn.addEventListener("click", () => {
      clearFocusedLine("Route focus cleared.", "Showing all filtered routes again.");
    });
  }

  dom.lineSearch.addEventListener("input", () => {
    appState.lineSearchQuery = String(dom.lineSearch.value || "").trim().toLowerCase();
    clearStatusPin();
    resetClearRouteProgressConfirmation();

    const shown = getShownLines();
    if (appState.focusedLineKey && !shown.some((line) => line.lineKey === appState.focusedLineKey)) {
      appState.focusedLineKey = "";
    }

    renderLineList();
    renderMapData();
    renderProgress();
    restoreUserStatusFromFocus();
  });

  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthFeedback();

    const formData = new FormData(dom.loginForm);
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
      dom.loginForm.reset();
    } catch (error) {
      setAuthFeedback(error.message, "error");
      setStatus(error.message, "error");
    }
  });

  dom.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthFeedback();

    const formData = new FormData(dom.registerForm);
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
      dom.registerForm.reset();
    } catch (error) {
      setAuthFeedback(error.message, "error");
      setStatus(error.message, "error");
    }
  });

  dom.logoutBtn.addEventListener("click", () => {
    setToken("");
    appState.user = null;
    if (appState.lineViewOrderingVoteClickSetsByLineKey) {
      appState.lineViewOrderingVoteClickSetsByLineKey.clear();
    }
    appState.visitedByLine = new Map();

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
  setTheme(appState.theme);
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
    if (appState.theme === "dark" || appState.theme === "light") {
      setTheme(appState.theme, { persist: false });
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.body.classList.add("app-ready");
        if (appState.map && typeof appState.map.resize === "function") {
          appState.map.resize();
        }
        triggerInitialLoad();
      });
    });

    window.setTimeout(triggerInitialLoad, 1400);

    const startupT0 = performance.now();
    await startupDataPromise;
    console.log(`[perf] init: startup data (cities + session) in ${(performance.now() - startupT0).toFixed(1)}ms`);

    await loadProgress();

    const activeModeLabels = MODE_DEFS.filter((modeDef) => appState.activeModeKeys.has(modeDef.key)).map(
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
