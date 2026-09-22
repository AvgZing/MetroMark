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

function syncLineViewAutoToggle() {
  const toggleBtn = dom.toggleLineViewAutoBtn;
  if (!toggleBtn) {
    return;
  }
  const enabled = Boolean(appState.lineViewAutoOpenEnabled);
  toggleBtn.textContent = enabled ? "Auto-open: on" : "Auto-open: off";
  toggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function bindEvents() {
  dom.themeToggleBtn.addEventListener("click", () => {
    toggleTheme();
    dom.themeToggleBtn.classList.remove("theme-spin");
    void dom.themeToggleBtn.offsetWidth;
    dom.themeToggleBtn.classList.add("theme-spin");
    window.setTimeout(() => dom.themeToggleBtn.classList.remove("theme-spin"), 360);
  });

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
      syncLineViewAutoToggle();
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

    const colorblindEl = document.getElementById("colorblindModeToggle");
    if (colorblindEl) {
      colorblindEl.checked = Boolean(appState.colorblindMode);
      colorblindEl.addEventListener("change", () => {
        appState.colorblindMode = Boolean(colorblindEl.checked);
        document.body.classList.toggle("colorblind-mode", appState.colorblindMode);
        if (typeof applyStopStatusIcons === "function") {
          applyStopStatusIcons();
        }
        if (typeof saveUserPreferences === "function") {
          saveUserPreferences({ colorblindMode: appState.colorblindMode }).catch(() => {});
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

    appState.lineStopsCache.clear();
    if (appState.loadedLineSummaries) {
      appState.loadedLineSummaries = [];
    }
    if (appState.routeStopsAutoLoadAttempts) {
      appState.routeStopsAutoLoadAttempts.clear();
    }
    appState.inFlightLineStopKeys.clear();

    if (typeof rebuildLineMetadataFromTiles === "function") {
      appState.lastTileMetadataSignature = "";
      rebuildLineMetadataFromTiles();
    }
    refreshUiFromState();

    setBackendStatus("Local session cache cleared by user (route stops).");
  });

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

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const query = new URLSearchParams(window.location.search);
  const forced = String(query.get("sw") || "").trim();
  if (forced === "0") {
    return;
  }
  if (forced === "1") {
    await registerSw();
    return;
  }

  let swEnabled = false;
  try {
    const healthResponse = await fetch("/api/health", { cache: "no-store" });
    if (healthResponse.ok) {
      const payload = await healthResponse.json();
      swEnabled = Boolean(payload.swEnabled);
    }
  } catch {
    // Health unreachable — skip SW registration rather than blocking startup.
  }

  if (swEnabled) {
    await registerSw();
  }
}

function monitorServiceWorkerUpdates(registration) {
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        // A newer app version is installed and waiting; surface an event the
        // UI can hook to offer a reload.
        window.dispatchEvent(new CustomEvent("metromark:update-available"));
        console.info("[sw] A new version is available — reload to apply.");
      }
    });
  });

  // Re-check for updates whenever the app comes back into view (feels like an
  // app re-opening rather than a stale cached tab).
  const checkForUpdates = () => {
    registration.update().catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdates();
    }
  });
  window.addEventListener("pageshow", checkForUpdates);
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  // Reload the app once when a freshly activated service worker takes control,
  // so an installed update actually applies instead of leaving the old bundle
  // running until the next manual reload. Fresh installs (no controller yet)
  // are skipped — the first claim is just the initial activation.
  let hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) {
      return;
    }
    if (!hadController) {
      hadController = true;
      return;
    }
    refreshing = true;
    console.info("[sw] A new app version was installed — reloading.");
    window.location.reload();
  });

  try {
    // updateViaCache: "none" forces the browser to byte-check /sw.js against
    // the network on every update check, so a deployed service worker is not
    // served from the HTTP cache for up to 24h.
    const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    monitorServiceWorkerUpdates(registration);
    // Explicit check right after registration; combined with the
    // visibilitychange/pageshow checks this applies updates on the next launch.
    registration.update().catch(() => {});
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  } catch (error) {
    console.warn("[sw] Service worker registration failed:", error);
  }
}

async function init() {
  const initT0 = performance.now();
  registerServiceWorker();
  document.body.classList.remove("app-ready");
  setTheme(appState.theme);
  syncMobilePanelLayout();
  normalizeModeSelection();
  normalizeFrequencySelection();
  normalizeManualVisibilityOverrides();
  renderApiCounter();
  restoreUserStatusFromFocus();

  bindEvents();

  // Ensure the CARTO basemap key is loaded before the map style is built.
  if (typeof fetchBasemapKey === "function") {
    await fetchBasemapKey();
  }
  console.log(`[perf] init: pre-map setup in ${(performance.now() - initT0).toFixed(1)}ms`);
  initializeMap();

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
      });
    });

  const startupT0 = performance.now();
  await startupDataPromise;
  console.log(`[perf] init: startup data (cities + session) in ${(performance.now() - startupT0).toFixed(1)}ms`);

    if (typeof initProgressQueueSync === "function") {
      initProgressQueueSync();
    }

    if (typeof loadReviewsForCity === "function" && appState.initialCitySlug) {
      loadReviewsForCity(appState.initialCitySlug).catch(() => {});
    }

    if (typeof maybeShowWhatsNew === "function") {
      maybeShowWhatsNew();
    }
    syncLineViewAutoToggle();

    if (typeof isPortraitMobileLayout === "function" && isPortraitMobileLayout() && dom.lineViewPanel) {
      appState.lineViewOpen = true;
      dom.lineViewPanel.hidden = false;
      document.body.classList.add("line-view-open");
      if (typeof renderLineView === "function") {
        renderLineView("");
      }
    }


    await loadProgress();

    if (typeof loadTilesStats === "function") {
      loadTilesStats().catch(() => {});
      window.setInterval(() => {
        if (typeof loadTilesStats === "function") {
          loadTilesStats().catch(() => {});
        }
      }, 10000);
    }

    const activeModeLabels = MODE_DEFS.filter((modeDef) => appState.activeModeKeys.has(modeDef.key)).map(
      (modeDef) => modeDef.label
    );

    setStatus(
      "Routes render from vector tiles for the area you are viewing.",
      "ok",
      `Showing ${activeModeLabels.join(", ")} at all frequencies.`
    );
    console.log(`[perf] init: total app init in ${(performance.now() - initT0).toFixed(1)}ms`);
  } catch (error) {
    setStatus(error.message, "error");
  }

  initializeDiagnostics();
}

init();
