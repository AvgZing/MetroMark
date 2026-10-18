// Admin Map Editor — DOM event bindings.
// ---------------------------------------------------------------------------
// Auth + boot
// ---------------------------------------------------------------------------

function bindEvents() {
  async function submitAdminLogin() {
    const email = String(els.adminEmailInput.value || "").trim();
    const password = String(els.adminPasswordInput.value || "");
    if (!email || !password) {
      els.loginStatusMessage.textContent = "Email and password are required.";
      return;
    }
    els.loginStatusMessage.textContent = "Signing in...";
    try {
      const result = await apiRequest("/api/admin/login", {
        method: "POST",
        body: { email, password }
      });
      setAdminSession(result.token);
      setAdminLocked(false);
      els.loginStatusMessage.textContent = "Logged in.";
      await bootApp();
    } catch (error) {
      clearAdminSession();
      els.loginStatusMessage.textContent = error.message;
    }
  }

  if (els.adminLoginForm) {
    els.adminLoginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitAdminLogin();
    });
  } else if (els.loginBtn) {
    els.loginBtn.addEventListener("click", () => submitAdminLogin());
  }

  els.logoutBtn.addEventListener("click", () => {
    apiRequest("/api/admin/logout", { method: "POST" }).catch(() => {});
    clearAdminSession();
    setAdminLocked(true);
  });

  if (els.adminActionToastClose) {
    els.adminActionToastClose.addEventListener("click", hideAdminAction);
  }

  els.refreshMapBtn.addEventListener("click", () => {
    if (state.mapReady) {
      updateUnderlay();
      loadOperatorsForViewport();
      loadExistingEdits();
    }
  });

  if (els.areaRefreshBtn) {
    els.areaRefreshBtn.addEventListener("click", () => {
      if (state.areaRefreshOpen) {
        closeAreaRefresh();
      } else {
        openAreaRefresh();
      }
    });
  }
  if (els.areaRefreshCloseBtn) {
    els.areaRefreshCloseBtn.addEventListener("click", closeAreaRefresh);
  }

  if (els.runBackupBtn) {
    els.runBackupBtn.addEventListener("click", () => {
      apiRequest("/api/admin/actions/backup-nonrecoverable", { method: "POST" })
        .then(() => showAdminAction("Backup written."))
        .catch((error) => showAdminAction(`Backup failed: ${error.message}`, true));
    });
  }
  if (els.rebuildTilesBtn) {
    els.rebuildTilesBtn.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Rebuild ALL map tiles for everyone? This regenerates the whole archive and is served to all users."
      );
      if (!confirmed) {
        return;
      }
      apiRequest("/api/admin/actions/rebuild-tiles", { method: "POST" })
        .then(() => {
          showAdminAction("Rebuilding all tiles…");
          startRebuildWatch();
        })
        .catch((error) => showAdminAction(`Rebuild failed: ${error.message}`, true));
    });
  }
  if (els.areaRefreshRunBtn) {
    els.areaRefreshRunBtn.addEventListener("click", () => {
      runAreaRefresh().catch((error) => {
        setEditStatus(els.areaRefreshStatus, `Failed: ${error.message}`, true);
      });
    });
  }

  if (els.routeSearchInput) {
    els.routeSearchInput.addEventListener("input", () => {
      state.routeSearchQuery = String(els.routeSearchInput.value || "").trim();
      applyUnderlaySearchFilter();
      scheduleUnderlayRefresh();
    });
  }
  if (els.refreshSelectedRoutesBtn) {
    els.refreshSelectedRoutesBtn.addEventListener("click", () => {
      refreshSelectedRoutes().catch((error) => {
        setEditStatus(els.routeBatchStatus, `Failed: ${error.message}`, true);
      });
    });
  }
  if (els.transitlandSearchBtn) {
    els.transitlandSearchBtn.addEventListener("click", () => {
      searchTransitland().catch(() => {});
    });
  }
  if (els.transitlandSearchInput) {
    els.transitlandSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchTransitland().catch(() => {});
      }
    });
  }

  if (els.cityPanelSelect) {
    els.cityPanelSelect.addEventListener("change", () => {
      selectCityForPanel(els.cityPanelSelect.value).catch(() => {});
    });
  }
  if (els.cityMetaSaveBtn) {
    els.cityMetaSaveBtn.addEventListener("click", () => {
      saveCityMetadata().catch(() => {});
    });
  }
  if (els.cityMetaPublished) {
    els.cityMetaPublished.addEventListener("change", updateCityPublishButton);
  }
  if (els.cityMetaPublishBtn) {
    els.cityMetaPublishBtn.addEventListener("click", () => {
      saveCityPublish().catch(() => {});
    });
  }
  if (els.cityPreviewCb) {
    els.cityPreviewCb.addEventListener("change", () => {
      setCityPreview(els.cityPreviewCb.checked);
    });
  }
  if (els.newCityCreateBtn) {
    els.newCityCreateBtn.addEventListener("click", () => {
      createCityFromView().catch(() => {});
    });
  }
  if (els.cityOperatorSearchBtn) {
    els.cityOperatorSearchBtn.addEventListener("click", () => {
      searchCityOperators().catch(() => {});
    });
  }
  if (els.cityOperatorSearchInput) {
    els.cityOperatorSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchCityOperators().catch(() => {});
      }
    });
  }
  if (els.cityAddSelectedRouteBtn) {
    els.cityAddSelectedRouteBtn.addEventListener("click", includeSelectedRouteInCity);
  }
  if (els.cityExcludeSelectedRouteBtn) {
    els.cityExcludeSelectedRouteBtn.addEventListener("click", excludeSelectedRouteInCity);
  }
  if (els.cityAddVisibleOperatorsBtn) {
    els.cityAddVisibleOperatorsBtn.addEventListener("click", () => {
      addVisibleOperatorsToCity().catch(() => {});
    });
  }
  if (els.refreshRouteBtn) {
    els.refreshRouteBtn.addEventListener("click", () => {
      refreshSingleRoute().catch(() => {});
    });
  }
  if (els.removeRouteBtn) {
    els.removeRouteBtn.addEventListener("click", () => {
      removeSingleRoute().catch(() => {});
    });
  }

  els.saveRouteBtn.addEventListener("click", saveRouteEdits);
  if (els.routeProblematic) {
    els.routeProblematic.addEventListener("change", () => {
      state.problematicTouched = true;
    });
  }
  if (els.routeOrdering) {
    els.routeOrdering.addEventListener("change", updateStopOrderLockState);
  }
  if (els.routeFrequency) {
    els.routeFrequency.addEventListener("change", () => {
      const bucket = String(els.routeFrequency.value || "");
      if (["frequent", "regular", "local"].includes(bucket) && els.routeFrequencyMinutes) {
        els.routeFrequencyMinutes.value = bucket === "frequent" ? "10" : bucket === "regular" ? "20" : "45";
      } else if (bucket === "unknown" || bucket === "__default__" || bucket === "") {
        if (els.routeFrequencyMinutes) els.routeFrequencyMinutes.value = "";
      }
    });
  }
  if (els.routeFrequencyMinutes) {
    els.routeFrequencyMinutes.addEventListener("input", () => {
      const minutes = Number(els.routeFrequencyMinutes.value);
      if (!els.routeFrequency || !Number.isFinite(minutes) || minutes <= 0) {
        return;
      }
      const bucket = minutes <= 10 ? "frequent" : minutes < 30 ? "regular" : "local";
      els.routeFrequency.value = bucket;
    });
  }
  els.discardRouteBtn.addEventListener("click", () => {
    closeRouteOverlapPopup();
    clearSelection();
  });
  if (els.routeEditZoomBtn) {
    els.routeEditZoomBtn.addEventListener("click", () => {
      if (state.selectedRouteFeature) {
        focusRouteFeature(state.selectedRouteFeature);
      }
    });
  }
  els.saveStationBtn.addEventListener("click", saveStationEdits);
  els.discardStationBtn.addEventListener("click", () => {
    els.stationEditPanel.hidden = true;
    state.selectedStationKey = "";
  });

  els.saveStopOrderBtn.addEventListener("click", saveStopOrder);
  els.clearStopOrderBtn.addEventListener("click", clearStopOrder);
  if (els.clearStopChangesBtn) {
    els.clearStopChangesBtn.addEventListener("click", () => {
      clearStopChanges().catch(() => {});
    });
  }
  if (els.addStopBtn) {
    els.addStopBtn.addEventListener("click", addCustomStop);
  }
  if (els.addBranchGroupBtn) {
    els.addBranchGroupBtn.addEventListener("click", addBranchGroup);
  }
  if (els.addMergeRouteBtn) {
    els.addMergeRouteBtn.addEventListener("click", addMergeRoute);
  }
  if (els.findMergeCandidatesBtn) {
    els.findMergeCandidatesBtn.addEventListener("click", () => {
      findMergeCandidates().catch(() => {});
    });
  }
  if (els.reloadReviewQueueBtn) {
    els.reloadReviewQueueBtn.addEventListener("click", () => {
      loadReviewQueue().catch(() => {});
    });
  }
  if (els.problematicPreviewCb) {
    els.problematicPreviewCb.addEventListener("change", () => {
      state.problematicPreview = els.problematicPreviewCb.checked;
      applyMapRouteVisibility({
        hiddenOperators: state.hiddenOperators,
        disabledLineKeys: state.disabledRouteKeys
      });
    });
  }
  if (els.mergeRouteKeyInput) {
    els.mergeRouteKeyInput.addEventListener("input", renderMergeRouteKeyResults);
    els.mergeRouteKeyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addMergeRoute();
      }
    });
  }
  if (els.resetRouteBtn) {
    els.resetRouteBtn.addEventListener("click", () => {
      if (state.selectedRouteFeature) {
        selectRouteFromFeature(state.selectedRouteFeature).catch(() => {});
      }
    });
  }
  if (els.deleteRouteOverrideBtn) {
    els.deleteRouteOverrideBtn.addEventListener("click", () => {
      deleteRouteOverride().catch(() => {});
    });
  }

  if (els.operatorPreviewAllCb) {
    els.operatorPreviewAllCb.checked = !state.visibilityPreviewAll;
    els.operatorPreviewAllCb.addEventListener("change", () => {
      setVisibilityPreviewAll(!els.operatorPreviewAllCb.checked);
    });
  }
}

// ---------------------------------------------------------------------------
