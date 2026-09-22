// Separate Filters panel: own search, mirrored mode/frequency controls, and
// the deeper settings. Kept in sync with the on-map quick filters.

(function () {
  const MIRRORS = [
    { source: "modeFilterBar", mirror: "modeFilterBarMirror" },
    { source: "frequencyFilterBar", mirror: "frequencyFilterBarMirror" }
  ];

  function isPortrait() {
    return typeof isPortraitMobileLayout === "function" ? isPortraitMobileLayout() : false;
  }

  function setOpen(open, options = {}) {
    const next = Boolean(open);
    const backdrop = document.getElementById("filtersPanelBackdrop");
    const btn = document.getElementById("filtersPanelBtn");
    const topbarBtn = document.getElementById("topbarFiltersBtn");
    if (backdrop) {
      backdrop.hidden = !next;
    }
    if (btn) {
      btn.setAttribute("aria-expanded", next ? "true" : "false");
    }
    if (topbarBtn) {
      topbarBtn.setAttribute("aria-expanded", next ? "true" : "false");
    }
    document.body.classList.toggle("filters-panel-open", next);
    if (typeof window.updateChromeVisibility === "function") {
      window.updateChromeVisibility();
    }

    const panelEl = document.getElementById("filtersPanel");
    if (panelEl) {
      const portrait = isPortrait();
      const state = portrait && next ? "full" : "peek";
      if (typeof window.setPageSheetState === "function") {
        window.setPageSheetState(panelEl, state);
      } else {
        panelEl.classList.remove("sheet-peek", "sheet-half", "sheet-full");
        panelEl.classList.add(`sheet-${state}`);
        panelEl.dataset.sheetState = state;
      }
    }

    const fromProgress = next && Boolean(options.fromProgress);
    document.body.classList.toggle("filters-from-progress", fromProgress);
    const backBtn = document.getElementById("filtersBackBtn");
    if (backBtn) {
      backBtn.hidden = !fromProgress;
    }

    if (next) {
      syncMirrors();
    }
  }

  function isOpen() {
    return document.body.classList.contains("filters-panel-open");
  }

  function syncMirrors() {
    for (const { source, mirror } of MIRRORS) {
      const from = document.getElementById(source);
      const to = document.getElementById(mirror);
      if (!from || !to) {
        continue;
      }
      to.innerHTML = from.innerHTML;
    }
  }

  function renderMapSearchResults() {
    const container = document.getElementById("mapSearchResults");
    const input = document.getElementById("lineSearch");
    if (!container || !input) {
      return;
    }
    const query = String(input.value || "").trim();
    // Keep the shared search state in lockstep with the input before reading
    // the filtered route list, otherwise results lag one keystroke behind.
    if (typeof appState !== "undefined") {
      appState.lineSearchQuery = query.toLowerCase();
    }
    if (!query) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    const matches = (typeof getRouteListLines === "function" ? getRouteListLines() : []).slice(0, 20);

    container.innerHTML = "";
    container.hidden = false;
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "microcopy";
      empty.textContent = "No matching routes.";
      container.appendChild(empty);
      return;
    }
    for (const line of matches) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "search-result-row";

      const dot = document.createElement("span");
      dot.className = "line-color-dot";
      dot.style.backgroundColor = line.color || "#177ca2";

      const block = document.createElement("span");
      block.className = "search-result-block";
      const name = document.createElement("span");
      name.className = "search-result-name";
      name.textContent = typeof lineDisplayName === "function" ? lineDisplayName(line) : String(line.lineKey || "");
      const meta = document.createElement("span");
      meta.className = "search-result-meta";
      const parts = [
        typeof lineMode === "function" ? lineMode(line) : "",
        typeof lineOperatorLabel === "function" ? lineOperatorLabel(line) : "",
        typeof lineHeadwayLabel === "function" ? lineHeadwayLabel(line) : ""
      ].filter(Boolean);
      meta.textContent = parts.join(" · ");
      block.append(name, meta);

      const stops = document.createElement("span");
      stops.className = "search-result-stops";
      stops.textContent = Number(line.stopCount || 0) > 0 ? `${line.stopCount} stops` : "";

      row.append(dot, block, stops);
      row.addEventListener("click", () => {
        if (typeof openLineView === "function") {
          openLineView(line.lineKey);
        }
      });
      container.appendChild(row);
    }
  }

  function bindMirrorClicks() {
    for (const { source, mirror } of MIRRORS) {
      const to = document.getElementById(mirror);
      const from = document.getElementById(source);
      if (!to || !from) {
        continue;
      }
      to.addEventListener("click", (event) => {
        const chip = event.target.closest(".mode-chip");
        if (!chip) {
          return;
        }
        const chipsInMirror = [...to.querySelectorAll(".mode-chip")];
        const index = chipsInMirror.indexOf(chip);
        const originals = [...from.querySelectorAll(".mode-chip")];
        const match = originals[index];
        if (match) {
          match.click();
        }
        syncMirrors();
        markMultilineBars();
      });
    }
  }

  function markMultilineBars() {
    document.querySelectorAll(".sidebar-quickfilter .mode-filter-bar").forEach((bar) => {
      const chip = bar.querySelector(".mode-chip");
      if (!chip) {
        return;
      }
      const multiline = bar.getBoundingClientRect().height > chip.getBoundingClientRect().height * 1.5;
      bar.classList.toggle("is-multiline", multiline);
    });
  }

  function observeSources() {
    for (const { source, mirror } of MIRRORS) {
      const from = document.getElementById(source);
      const to = document.getElementById(mirror);
      if (!from || !to) {
        continue;
      }
      new MutationObserver(() => {
        to.innerHTML = from.innerHTML;
        markMultilineBars();
      }).observe(from, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  }

  function bind() {
    const openBtn = document.getElementById("filtersPanelBtn");
    const topbarBtn = document.getElementById("topbarFiltersBtn");
    const closeBtn = document.getElementById("filtersPanelCloseBtn");
    const backdrop = document.getElementById("filtersPanelBackdrop");
    const search = document.getElementById("filterPanelSearch");
    const mapSearch = document.getElementById("lineSearch");

    const toggleFrom = (event) => {
      if (event) {
        event.stopPropagation();
      }
      setOpen(!isOpen());
    };
    if (openBtn) {
      openBtn.addEventListener("click", toggleFrom);
    }
    if (topbarBtn) {
      topbarBtn.addEventListener("click", toggleFrom);
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => setOpen(false));
    }
    const backBtn = document.getElementById("filtersBackBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        setOpen(false);
        if (typeof window.setProgressOverlayOpen === "function") {
          window.setProgressOverlayOpen(true);
        }
      });
    }

    if (backdrop) {
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          setOpen(false);
        }
      });
    }
    if (search && mapSearch) {
      search.addEventListener("input", () => {
        mapSearch.value = search.value;
        mapSearch.dispatchEvent(new Event("input", { bubbles: true }));
        renderMapSearchResults();
      });
      mapSearch.addEventListener("input", () => {
        if (document.activeElement !== search) {
          search.value = mapSearch.value;
        }
        renderMapSearchResults();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
      }
    });

    observeSources();
    bindMirrorClicks();
    markMultilineBars();
    window.addEventListener("resize", markMultilineBars);
  }

  window.setFiltersPanelOpen = setOpen;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
