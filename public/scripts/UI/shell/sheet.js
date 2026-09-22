// Mobile bottom sheets: the map sheet (status / line view) and the
// Progress/Filters/Cities page sheets. Heights: peek, half, full.

(function () {
  const STATE_CLASSES = ["sheet-peek", "sheet-half", "sheet-full"];

  function isPortrait() {
    return typeof isPortraitMobileLayout === "function" && isPortraitMobileLayout();
  }

  function panel() {
    return document.getElementById("lineViewPanel");
  }

  function applyState(el, state) {
    if (!el) {
      return;
    }
    el.classList.remove(...STATE_CLASSES);
    el.classList.add(`sheet-${state}`);
    el.dataset.sheetState = state;
    const handle = el.querySelector(".line-view-sheet-handle, .sheet-handle");
    if (handle) {
      handle.setAttribute("aria-expanded", state !== "peek" ? "true" : "false");
    }
    if (el.id === "lineViewPanel" && state !== "peek" && typeof appState !== "undefined") {
      appState.lineViewPeekPinned = false;
    }
    updateChromeVisibility();
  }

  function openPagePanelState(backdropId, panelSelector) {
    const backdrop = document.getElementById(backdropId);
    if (!backdrop || backdrop.hidden) {
      return null;
    }
    const el = panelSelector ? backdrop.querySelector(panelSelector) : null;
    return el && el.dataset.sheetState === "full" ? "full" : null;
  }

  function updateChromeVisibility() {
    const lineView = panel();
    const lineViewOpen = Boolean(lineView && !lineView.hidden);
    const lineState = lineViewOpen ? lineView.dataset.sheetState : null;
    const routeFocused = document.body.classList.contains("route-selected");
    // A focused route hides the search chrome; the plain map sheet keeps it.
    const lineViewHidesChrome = Boolean(lineViewOpen && (lineState === "full" || (routeFocused && lineState === "half")));
    const mapSheetLifted = Boolean(lineViewOpen && !routeFocused && lineState && lineState !== "peek");
    const pageSheetFull = Boolean(
      openPagePanelState("filtersPanelBackdrop", "#filtersPanel") ||
        openPagePanelState("progressOverlay", ".filters-panel") ||
        openPagePanelState("citiesBackdrop", "#citiesPanel")
    );
    document.body.classList.toggle("map-chrome-hidden", lineViewHidesChrome || pageSheetFull);
    document.body.classList.toggle("map-sheet-lifted", mapSheetLifted);
  }

  /** Height states shared by the Filters / Progress / Cities page sheets. */
  function setPageSheetState(el, state) {
    if (!el) {
      return;
    }
    el.classList.remove(...STATE_CLASSES);
    el.classList.add(`sheet-${state}`);
    el.dataset.sheetState = state;
    updateChromeVisibility();
  }

  function pageSheetFinish(el, startState, dy, measured) {
    const vh = window.innerHeight;
    if (Math.abs(dy) < 25) {
      setPageSheetState(el, startState === "half" ? "half" : startState);
      return;
    }
    const halfHeight = vh * 0.52;
    if (Math.abs(measured - halfHeight) <= vh * 0.12) {
      setPageSheetState(el, "half");
      return;
    }
    setPageSheetState(el, dy < 0 ? "full" : "peek");
  }

  window.setPageSheetState = setPageSheetState;

  function setCitiesSheetOpen(open) {
    const backdrop = document.getElementById("citiesBackdrop");
    const citiesPanel = document.getElementById("citiesPanel");
    if (!backdrop || !citiesPanel) {
      return;
    }
    if (open) {
      backdrop.hidden = false;
      document.body.classList.add("cities-panel-open");
      if (isPortrait()) {
        applyState(citiesPanel, "full");
      }
    } else {
      backdrop.hidden = true;
      document.body.classList.remove("cities-panel-open");
      citiesPanel.classList.remove(...STATE_CLASSES);
      delete citiesPanel.dataset.sheetState;
    }
    updateChromeVisibility();
  }

  window.setCitiesSheetOpen = setCitiesSheetOpen;

  function stateOf(el) {
    return (el && el.dataset.sheetState) || "peek";
  }

  function attachDrag(handle, el, onClose, mode = "pages") {
    let dragging = false;
    let startY = 0;
    let startHeight = 0;
    let startState = "peek";
    let moved = false;

    handle.addEventListener("pointerdown", (event) => {
      if (!isPortrait()) {
        return;
      }
      if (event.target.closest("button, a, input, select, textarea")) {
        return;
      }
      dragging = true;
      moved = false;
      startY = event.clientY;
      startHeight = el.getBoundingClientRect().height;
      startState = stateOf(el);
      el.dataset.dragMoved = "";
      el.classList.add("sheet-dragging");
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Some environments (or synthetic events) cannot capture; drag still works.
      }
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      const delta = event.clientY - startY;
      if (Math.abs(delta) > 6) {
        moved = true;
        el.dataset.dragMoved = "1";
      }
      const next = startHeight - delta;
      el.style.height = `${Math.max(56, Math.min(window.innerHeight - 120, next))}px`;
    });

    const finish = (event) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      const dy = (event.clientY || startY) - startY;
      const measured = el.getBoundingClientRect().height;
      el.style.height = "";
      el.classList.remove("sheet-dragging");

      const routeMode = el.id === "lineViewPanel" && document.body.classList.contains("route-selected");

      if (!routeMode) {
        // Page sheets and the plain map sheet share one snapping behaviour.
        pageSheetFinish(el, startState, dy, measured);
        return;
      }

      const state = stateOf(el);
      if (dy < -50) {
        applyState(el, "full");
      } else if (dy > 80) {
        if (Math.abs(measured - window.innerHeight * 0.52) <= window.innerHeight * 0.12) {
          applyState(el, "half");
        } else {
          applyState(el, "peek");
        }
      } else {
        applyState(el, state);
      }
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function bindCycle(handle, el) {
    if (!handle || !el) {
      return;
    }
    handle.addEventListener("click", () => {
      if (!isPortrait()) {
        return;
      }
      if (el.dataset.dragMoved === "1") {
        el.dataset.dragMoved = "";
        return;
      }
      const state = stateOf(el);
      if (el.id === "lineViewPanel" && !document.body.classList.contains("route-selected")) {
        applyState(el, state === "full" ? "peek" : "full");
        return;
      }
      applyState(el, state === "full" ? "half" : "full");
    });
  }

  function bindSheet() {
    const handle = document.getElementById("lineViewSheetHandle");
    const el = panel();
    if (!el) {
      return;
    }
    const draggable = document.querySelector(".line-view-header") || handle;
    if (!draggable) {
      return;
    }
    if (!el.dataset.sheetState) {
      applyState(el, "peek");
    }
    attachDrag(draggable, el, null, "lineview");
    if (handle && handle !== draggable) {
      attachDrag(handle, el, null, "lineview");
    }
    const statusArea = el.querySelector(".line-view-status");
    if (statusArea) {
      attachDrag(statusArea, el, null, "lineview");
    }
    bindCycle(handle, el);
  }

  function bindGenericSheetHandles() {
    document.querySelectorAll(".sheet-handle[data-sheet-drag]").forEach((handle) => {
      const el = handle.closest(".filters-panel, #citiesMenu");
      if (!el) {
        return;
      }
      const draggable = handle.closest(".filters-panel-header") || el;
      if (!el.dataset.sheetState) {
        applyState(el, "peek");
      }
      attachDrag(draggable, el, null, "pages");
      bindCycle(handle, el);
    });
  }

  function bindQuickfilterToggle() {
    const logo = document.querySelector(".quickfilter-logo");
    const searchInput = document.getElementById("lineSearch");
    if (logo && searchInput) {
      logo.addEventListener("click", () => {
        searchInput.focus();
      });
    }
    const modePill = document.getElementById("mobileModePill");
    const freqPill = document.getElementById("mobileFreqPill");
    const closeDropdowns = () => {
      document.body.classList.remove("qf-mode-open", "qf-freq-open");
    };
    if (modePill) {
      modePill.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasOpen = document.body.classList.contains("qf-mode-open");
        closeDropdowns();
        document.body.classList.toggle("qf-mode-open", !wasOpen);
      });
    }
    if (freqPill) {
      freqPill.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasOpen = document.body.classList.contains("qf-freq-open");
        closeDropdowns();
        document.body.classList.toggle("qf-freq-open", !wasOpen);
      });
    }
    document.addEventListener("pointerdown", (event) => {
      if (!document.body.classList.contains("qf-mode-open") && !document.body.classList.contains("qf-freq-open")) {
        return;
      }
      if (event.target.closest(".sidebar-quickfilter") || event.target.closest(".quickfilter-pill")) {
        return;
      }
      closeDropdowns();
    });
  }

  function bindCitiesMenu() {
    const btn = document.getElementById("citiesButton");
    const backdrop = document.getElementById("citiesBackdrop");
    const closeBtn = document.getElementById("citiesCloseBtn");
    if (!backdrop) {
      return;
    }
    if (btn) {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        setCitiesSheetOpen(backdrop.hidden);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => setCitiesSheetOpen(false));
    }
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        setCitiesSheetOpen(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !backdrop.hidden) {
        setCitiesSheetOpen(false);
      }
    });
    // Legacy name kept for any older call sites.
    window.setCitiesMenuOpen = (open) => setCitiesSheetOpen(open);
  }

  function bindLayers() {
    const btn = document.getElementById("layersBtn");
    const backdrop = document.getElementById("layersSheetBackdrop");
    const closeBtn = document.getElementById("layersSheetCloseBtn");
    if (!btn || !backdrop) {
      return;
    }
    const sheet = backdrop.querySelector(".layers-sheet");
    let closeTimer = null;
    const setOpen = (open) => {
      if (closeTimer) {
        window.clearTimeout(closeTimer);
        closeTimer = null;
      }
      if (open) {
        if (sheet) {
          sheet.classList.remove("layers-sheet-closing");
        }
        backdrop.hidden = false;
        document.body.classList.add("layers-sheet-open");
        btn.setAttribute("aria-expanded", "true");
        if (typeof updateMapModeButtons === "function") {
          updateMapModeButtons();
        }
        return;
      }
      if (backdrop.hidden) {
        return;
      }
      const finishClose = () => {
        closeTimer = null;
        backdrop.hidden = true;
        document.body.classList.remove("layers-sheet-open");
        btn.setAttribute("aria-expanded", "false");
        if (sheet) {
          sheet.classList.remove("layers-sheet-closing");
        }
      };
      if (sheet) {
        sheet.classList.add("layers-sheet-closing");
        closeTimer = window.setTimeout(finishClose, 220);
      } else {
        finishClose();
      }
    };
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(backdrop.hidden);
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", () => setOpen(false));
    }
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        setOpen(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    });
  }

  function migrateElements() {
    const advanced = document.getElementById("advancedInfoPanel");
    const options = document.getElementById("layersOptions");
    const reportHost = document.getElementById("layersReport");
    const streets = document.getElementById("streetsModeBtn");
    const satellite = document.getElementById("satelliteModeBtn");
    const reportBtn = document.getElementById("reportIssueBtn");
    const controls = document.querySelector(".map-overlay-controls");

    if (isPortrait()) {
      if (advanced) {
        const auth = document.getElementById("authPopup");
        if (auth && advanced.parentElement !== auth) {
          auth.appendChild(advanced);
        }
      }
      if (options) {
        if (streets && streets.parentElement !== options) options.append(streets);
        if (satellite && satellite.parentElement !== options) options.append(satellite);
      }
      const streetsLabel = streets ? streets.querySelector(".mode-label") : null;
      if (streetsLabel) streetsLabel.textContent = "Default";
      const satelliteLabel = satellite ? satellite.querySelector(".mode-label") : null;
      if (satelliteLabel) satelliteLabel.textContent = "Satellite";
      if (reportHost && reportBtn && reportBtn.parentElement !== reportHost) {
        reportHost.append(reportBtn);
      }
    } else {
      if (advanced) {
        const sidebar = document.querySelector(".sidebar");
        if (sidebar && advanced.parentElement !== sidebar) {
          sidebar.appendChild(advanced);
        }
      }
      const streetsLabel = document.getElementById("streetsModeBtn")?.querySelector(".mode-label");
      if (streetsLabel) streetsLabel.textContent = "Streets";
      if (controls) {
        [streets, satellite, reportBtn].forEach((el) => {
          if (el && el.parentElement !== controls) {
            controls.append(el);
          }
        });
      }
    }
  }

  function applyElementMigration() {
    const advanced = document.getElementById("advancedInfoPanel");
    if (!advanced) {
      return;
    }
    if (isPortrait()) {
      const auth = document.getElementById("authPopup");
      if (auth && advanced.parentElement !== auth) {
        auth.appendChild(advanced);
      }
    } else {
      const sidebar = document.querySelector(".sidebar");
      if (sidebar && advanced.parentElement !== sidebar) {
        sidebar.appendChild(advanced);
      }
    }
  }

  function migrateTopbarControls() {
    const actions = document.querySelector(".topbar-actions");
    const searchRow = document.querySelector(".quickfilter-search");
    const pillsRow = document.querySelector(".quickfilter-pills");
    const account = document.getElementById("accountPopupBtn");
    const theme = document.getElementById("themeToggleBtn");
    if (!actions || !searchRow || !pillsRow || !account || !theme) {
      return;
    }
    if (isPortrait()) {
      if (account.parentElement !== searchRow) {
        searchRow.appendChild(account);
      }
      if (theme.parentElement !== pillsRow) {
        const layers = document.getElementById("layersBtn");
        if (layers && layers.parentElement === pillsRow) {
          pillsRow.insertBefore(theme, layers);
        } else {
          pillsRow.appendChild(theme);
        }
      }
    } else {
      if (account.parentElement !== actions) {
        actions.appendChild(account);
      }
      if (theme.parentElement !== actions) {
        actions.appendChild(theme);
      }
    }
  }

  window.setMobileSheetState = (state) => applyState(panel(), state);
  window.updateChromeVisibility = updateChromeVisibility;

  function applyLayerPreviews() {
    if (typeof fetchBasemapKey !== "function") {
      return;
    }
    fetchBasemapKey()
      .then((key) => {
        const query = key ? `?key=${encodeURIComponent(key)}` : "";
        const root = document.documentElement.style;
        root.setProperty(
          "--preview-default",
          `url("https://a.basemaps.cartocdn.com/light_all/11/328/731.png${query}")`
        );
        root.setProperty(
          "--preview-satellite",
          'url("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/731/328")'
        );
      })
      .catch(() => {});
  }

  function bind() {
    bindSheet();
    bindQuickfilterToggle();
    bindGenericSheetHandles();
    bindCitiesMenu();
    bindLayers();
    migrateElements();
    migrateTopbarControls();
    applyLayerPreviews();
    window.addEventListener("resize", () => {
      migrateElements();
      migrateTopbarControls();
    });
    window.addEventListener("orientationchange", () => {
      migrateElements();
      migrateTopbarControls();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
