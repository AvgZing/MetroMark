// Desktop Progress expansion: opens an expanded progress view as a centered
// dialog while leaving the sidebar progress panel untouched.

(function () {
  function isOpen() {
    return document.body.classList.contains("progress-overlay-open");
  }

  function setOpen(open) {
    const overlay = document.getElementById("progressOverlay");
    const btn = document.getElementById("topbarProgressBtn");
    if (!overlay) {
      return;
    }
    overlay.hidden = !open;
    document.body.classList.toggle("progress-overlay-open", open);
    if (typeof window.updateChromeVisibility === "function") {
      window.updateChromeVisibility();
    }
    const panelEl = overlay.querySelector(".filters-panel");
    if (panelEl) {
      const portrait = typeof isPortraitMobileLayout === "function" && isPortraitMobileLayout();
      const state = portrait && open ? "full" : "peek";
      if (typeof window.setPageSheetState === "function") {
        window.setPageSheetState(panelEl, state);
      } else {
        panelEl.classList.remove("sheet-peek", "sheet-half", "sheet-full");
        panelEl.classList.add(`sheet-${state}`);
        panelEl.dataset.sheetState = state;
      }
    }
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open && typeof renderProgress === "function") {
      renderProgress();
    }
  }

  function bind() {
    const btn = document.getElementById("topbarProgressBtn");
    const closeBtn = document.getElementById("progressOverlayCloseBtn");
    const overlay = document.getElementById("progressOverlay");
    const adjustBtn = document.getElementById("overlayAdjustFiltersBtn");

    if (btn) {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        setOpen(!isOpen());
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => setOpen(false));
    }
    if (overlay) {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          setOpen(false);
        }
      });
    }
    const overlayList = document.getElementById("overlayProgressList");
    if (overlayList) {
      overlayList.addEventListener("click", (event) => {
        const btn = event.target.closest(".line-progress-name");
        if (btn && btn.dataset.lineKey && typeof openLineView === "function") {
          openLineView(btn.dataset.lineKey, { zoom: true });
        }
      });
    }
    if (adjustBtn) {
      adjustBtn.addEventListener("click", () => {
        setOpen(false);
        if (typeof window.setFiltersPanelOpen === "function") {
          window.setFiltersPanelOpen(true, { fromProgress: true });
        }
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
      }
    });
  }

  window.setProgressOverlayOpen = setOpen;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
