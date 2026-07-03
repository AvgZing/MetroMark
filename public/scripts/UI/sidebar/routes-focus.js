function clearFocusedLine(statusMessage = "Route focus cleared.", statusMeta = "Click a route to focus it.") {
  if (!state.focusedLineKey) {
    closeRouteSelectionPopup();
    return;
  }

  if (state.lineViewOpen && typeof closeLineView === "function") {
    closeLineView({ restore: false });
  }

  closeRouteSelectionPopup();
  clearStatusPin();
  resetClearRouteProgressConfirmation();

  state.focusedLineKey = "";
  renderMapData();
  renderLineList();
  renderProgress();
  if (typeof renderLineView === "function") {
    renderLineView();
  }
  restoreUserStatusFromFocus();
  setStatus(statusMessage, "ok", statusMeta);
}

async function setFocusedLine(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return;
  }

  closeRouteSelectionPopup();

  const line = state.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return;
  }

  clearStatusPin();
  resetClearRouteProgressConfirmation();

  if (state.focusedLineKey === normalizedLineKey && !options.forceRefresh) {
    setUserStatusFromLine(line);
    const headwayLookupPromise = ensureLineHeadwayLoaded(normalizedLineKey, {
      forceRefresh: false,
      silent: true
    });
    await ensureLineStopsLoaded(normalizedLineKey, {
      forceRefresh: false,
      silent: false
    });
    await headwayLookupPromise;
    renderMapData();
    renderProgress();
    if (typeof renderLineView === "function") {
      renderLineView();
    }
    restoreUserStatusFromFocus();
    return;
  }

  state.focusedLineKey = normalizedLineKey;
  
  // If line view is open, update the line shown in line view to match focused line
  if (state.lineViewOpen) {
    state.lineViewLineKey = normalizedLineKey;
  } else if (state.lineViewAutoOpenEnabled && !isPortraitMobileLayout()) {
    // Auto-open line view on desktop if enabled
    await openLineView(normalizedLineKey);
  }
  
  setUserStatusFromLine(line);
  renderMapData();
  renderLineList();
  renderProgress();

  setStatus(
    `Focused on ${lineDisplayName(line)}.`,
    "ok",
    "Loading route-linked stops and details. Other routes stay visible in a dimmed state."
  );

  const headwayLookupPromise = ensureLineHeadwayLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: true
  });

  await ensureLineStopsLoaded(normalizedLineKey, {
    forceRefresh: Boolean(options.forceRefresh),
    silent: false
  });

  await headwayLookupPromise;

  renderMapData();
  renderProgress();
  if (typeof renderLineView === "function") {
    renderLineView();
  }
}
