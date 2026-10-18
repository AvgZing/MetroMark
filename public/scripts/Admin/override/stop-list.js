// Admin Map Editor — stop list rendering, ordering controls, add/save/clear stops, route/station selection.
let dragStopIndex = null;

function stopCoordinateValue(input) {
  const raw = String(input?.value || "").trim();
  return raw ? Number(raw) : NaN;
}

function stopOrderingModeLabel(mode) {
  return (
    {
      "geometry-revised": "Main",
      "legacy-geometry": "U-Shape",
      fractions: "Loop",
      manual: "Manual"
    }[String(mode || "")] || "Auto"
  );
}

function updateStopOrderLockState() {
  const manual = String(els.routeOrdering?.value || "") === "manual";
  if (els.stopOrderLockNote) {
    const label = stopOrderingModeLabel(els.routeOrdering?.value);
    els.stopOrderLockNote.textContent = `Stops are shown in ${label} order. Set Stop Ordering Default to Manual to add, remove, reorder, or tag stops.`;
    els.stopOrderLockNote.hidden = manual;
  }
  if (els.stopAddRow) {
    els.stopAddRow.hidden = !manual;
  }
  const branchEditor = document.querySelector(".branch-groups-editor");
  if (branchEditor) {
    branchEditor.hidden = !manual;
  }
  renderStopsOrderList();
  if (!manual) {
    refreshStopOrderPreview();
  }
}

// Preview the chosen ordering by reusing the line-view ordering algorithms.
async function refreshStopOrderPreview() {
  const lineKey = String(state.selectedLineKey || "").trim();
  if (!lineKey || typeof orderStopsForLineView !== "function" || !Array.isArray(state.currentRouteStops)) {
    return;
  }
  const mode = String(els.routeOrdering?.value || "").trim() || "auto";
  if (mode === "manual") {
    return;
  }
  try {
    const ordered = await orderStopsForLineView(
      state.currentRouteStops.slice(),
      lineKey,
      state.currentRouteDirectionSequences || null,
      mode,
      state.selectedRouteOnestopId || null,
      null,
      state.currentRouteDirectionPatterns || null
    );
    if (state.selectedLineKey !== lineKey || String(els.routeOrdering?.value || "") !== mode) {
      return;
    }
    if (Array.isArray(ordered) && ordered.length) {
      state.currentRouteStops = ordered;
      renderStopsOrderList();
    }
  } catch {
    // keep the current order
  }
}

function renderStopsOrderList() {
  els.routeStopsList.innerHTML = "";
  const stops = state.currentRouteStops || [];
  if (!stops.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No stops loaded for this route yet.";
    els.routeStopsList.append(p);
    return;
  }
  const manual = String(els.routeOrdering?.value || "") === "manual";
  stops.forEach((feature, index) => {
    const p = feature.properties || {};
    const row = document.createElement("div");
    row.className =
      "stop-order-row" + (p.custom_stop ? " is-custom" : "") + (manual ? "" : " is-locked");

    const drag = document.createElement("button");
      drag.type = "button";
      drag.className = "stop-order-drag";
      drag.textContent = "⠿";
      drag.title = manual ? "Drag to reorder" : "Set Stop Ordering Default to Manual to reorder stops";
      drag.draggable = manual;
      drag.disabled = !manual;
      drag.addEventListener("dragstart", (event) => {
        dragStopIndex = index;
        row.classList.add("is-dragging");
        try {
          event.dataTransfer.setData("text/plain", String(index));
        } catch {
          // some browsers block setData on synthetic drags
        }
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      drag.addEventListener("dragend", () => {
        dragStopIndex = null;
        row.classList.remove("is-dragging");
        els.routeStopsList.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => {
          el.classList.remove("is-drop-before", "is-drop-after");
        });
      });
      row.addEventListener("dragover", (event) => {
        if (dragStopIndex === null) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        const rect = row.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        els.routeStopsList.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => {
          el.classList.remove("is-drop-before", "is-drop-after");
        });
        row.classList.add(after ? "is-drop-after" : "is-drop-before");
      });
      row.addEventListener("dragleave", (event) => {
        if (event.target === row) {
          row.classList.remove("is-drop-before", "is-drop-after");
        }
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const after = row.classList.contains("is-drop-after");
        els.routeStopsList.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => {
          el.classList.remove("is-drop-before", "is-drop-after");
        });
        if (dragStopIndex === null) {
          return;
        }
        const arr = state.currentRouteStops;
        let targetIndex = index + (after ? 1 : 0);
        const [moved] = arr.splice(dragStopIndex, 1);
        if (dragStopIndex < targetIndex) {
          targetIndex -= 1;
        }
        arr.splice(Math.max(0, Math.min(targetIndex, arr.length)), 0, moved);
        dragStopIndex = null;
        markRouteDirty("stops");
        renderStopsOrderList();
      });
      row.append(drag);

    const coords = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];

    const fields = document.createElement("div");
    fields.className = "stop-order-fields";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = String(p.station_name || p.stop_name || p.station_key || "");
    nameInput.placeholder = "Stop name";
    nameInput.addEventListener("input", () => {
      p.station_name = nameInput.value;
    });

    const latInput = document.createElement("input");
    latInput.type = "number";
    latInput.step = "any";
    latInput.min = "-90";
    latInput.max = "90";
    latInput.placeholder = "Lat";
    latInput.value = Number.isFinite(Number(coords[1])) ? String(Number(coords[1]).toFixed(6)) : "";
    latInput.addEventListener("input", () => {
      const lat = stopCoordinateValue(latInput);
      const lon = stopCoordinateValue(lonInput);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
      ) {
        feature.geometry = { type: "Point", coordinates: [lon, lat] };
      }
    });

    const lonInput = document.createElement("input");
    lonInput.type = "number";
    lonInput.step = "any";
    lonInput.min = "-180";
    lonInput.max = "180";
    lonInput.placeholder = "Lon";
    lonInput.value = Number.isFinite(Number(coords[0])) ? String(Number(coords[0]).toFixed(6)) : "";
    lonInput.addEventListener("input", () => {
      const lat = stopCoordinateValue(latInput);
      const lon = stopCoordinateValue(lonInput);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
      ) {
        feature.geometry = { type: "Point", coordinates: [lon, lat] };
      }
    });

    nameInput.className = "stop-order-name";
    const coordsRow = document.createElement("div");
    coordsRow.className = "stop-order-coords";
    coordsRow.append(latInput, lonInput);
    fields.append(nameInput, coordsRow);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stop-order-remove";
    remove.textContent = "×";
    remove.title = "Delete this stop";
    remove.setAttribute("aria-label", "Delete this stop");
    remove.disabled = !manual;
    remove.addEventListener("click", () => {
      const key = String(p?.station_key || "").trim();
      if (key) {
        state.removedStopKeys = state.removedStopKeys instanceof Set ? state.removedStopKeys : new Set();
        state.removedStopKeys.add(key);
      }
      state.currentRouteStops.splice(index, 1);
      markRouteDirty("stops");
      const source = state.map && state.map.getSource("stops");
      if (source && typeof source.setData === "function") {
        source.setData({ type: "FeatureCollection", features: state.currentRouteStops.slice() });
      }
      renderStopsOrderList();
    });

    row.append(fields, remove);

    if (manual && (state.selectedBranchGroups || []).length) {
      const branchRow = document.createElement("div");
      branchRow.className = "stop-branch-row";
      const choices = branchOptionChoices();
      const picker = document.createElement("details");
      picker.className = "stop-branch-picker";
      const summary = document.createElement("summary");
      const labelFor = (id) => {
        const choice = choices.find((entry) => String(entry.option.id) === String(id));
        return choice ? `${choice.group.label || "Branch"}: ${choice.option.label || id}` : "";
      };
      const updateSummary = () => {
        const labels = stopBranchIds(p).map(labelFor).filter(Boolean);
        summary.textContent = labels.length ? labels.join(", ") : "Trunk (always shown)";
      };
      updateSummary();
      const optionsWrap = document.createElement("div");
      optionsWrap.className = "stop-branch-options";
      for (const choice of choices) {
        const optionId = String(choice.option.id);
        const optionLabel = document.createElement("label");
        optionLabel.className = "stop-branch-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = optionId;
        checkbox.checked = stopBranchIds(p).includes(optionId);
        checkbox.addEventListener("change", () => {
          const ids = new Set(stopBranchIds(p));
          if (checkbox.checked) {
            ids.add(optionId);
          } else {
            ids.delete(optionId);
          }
          if (ids.size) {
            p.branches = Array.from(ids);
          } else {
            delete p.branches;
          }
          delete p.branch;
          updateSummary();
        });
        const text = document.createElement("span");
        text.textContent = `${choice.group.label || "Branch"}: ${choice.option.label || optionId}`;
        optionLabel.append(checkbox, text);
        optionsWrap.append(optionLabel);
      }
      picker.append(summary, optionsWrap);
      branchRow.append(picker);
      row.append(branchRow);
    }

    els.routeStopsList.append(row);
  });
}

function addCustomStop() {
  if (!state.selectedLineKey) {
    return;
  }
  const name = String(els.newStopName?.value || "").trim();
  const latRaw = String(els.newStopLat?.value || "").trim();
  const lonRaw = String(els.newStopLon?.value || "").trim();
  const lat = latRaw ? Number(latRaw) : NaN;
  const lon = lonRaw ? Number(lonRaw) : NaN;
  if (
    !name ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    setEditStatus(els.stopOrderStatus, "A stop name and valid lat/lon are required.", true);
    return;
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "stop";
  const key = `custom:${slug}:${Date.now().toString(36)}`;
  const feature = adminCustomStopFeature({ key, name, lat, lon }, state.selectedLineKey);
  if (!feature) {
    return;
  }
  state.currentRouteStops.push(feature);
  markRouteDirty("stops");
  renderStopsOrderList();
  appendStopsToMapSource([feature]);
  if (els.newStopName) els.newStopName.value = "";
  if (els.newStopLat) els.newStopLat.value = "";
  if (els.newStopLon) els.newStopLon.value = "";
  setEditStatus(els.stopOrderStatus, `Added "${name}" to the working order. Save Stop Order to persist.`);
}

async function saveStopOrder() {
  if (!state.selectedLineKey || state.stopOrderSaving) {
    return;
  }
  state.stopOrderSaving = true;
  if (els.saveStopOrderBtn) {
    els.saveStopOrderBtn.disabled = true;
  }
  setEditStatus(els.stopOrderStatus, "Saving…");
  const warnBeforeUnload = (event) => {
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", warnBeforeUnload);
  try {
    await saveStopOrderNow();
  } finally {
    state.stopOrderSaving = false;
    if (els.saveStopOrderBtn) {
      els.saveStopOrderBtn.disabled = false;
    }
    window.removeEventListener("beforeunload", warnBeforeUnload);
  }
}

async function saveStopOrderNow() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  const stops = (state.currentRouteStops || [])
    .map((feature) => {
      const p = feature.properties || {};
      const coords = feature.geometry?.coordinates || [];
      const entry = {
        key: String(p.station_key || ""),
        name: String(p.station_name || p.stop_name || p.station_key || ""),
        lat: Number.isFinite(Number(coords[1])) ? Number(coords[1]) : null,
        lon: Number.isFinite(Number(coords[0])) ? Number(coords[0]) : null
      };
      const validOptionIds = new Set(branchOptionChoices().map((choice) => String(choice.option.id)));
      const branches = stopBranchIds(p).filter((id) => validOptionIds.has(id));
      if (branches.length) {
        entry.branches = branches;
        // Keep `branch` for older clients that only read the single tag.
        entry.branch = branches[0];
      }
      return entry;
    })
    .filter((entry) => entry.key);

  let payload = {};
  try {
    const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET" });
    payload = (existing?.override?.payload || {});
  } catch {
    // new override
  }
  payload = { ...payload, stops };
  const removedStops = Array.from(state.removedStopKeys || []).filter(Boolean);
  if (removedStops.length) {
    payload.removedStops = removedStops;
  } else {
    delete payload.removedStops;
  }
  // Persist the ordering selection so a manual reorder applies on the frontend.
  const orderingValue = String(els.routeOrdering?.value || "").trim();
  if (orderingValue) {
    payload.orderingMode = orderingValue;
  }
  const mergedKeys = (state.selectedMergedKeys || []).filter((key) => key && key !== lineKey);
  if (mergedKeys.length) {
    payload.mergedLineKeys = mergedKeys;
  } else {
    delete payload.mergedLineKeys;
  }
  const branchGroups = (state.selectedBranchGroups || []).filter(
    (group) => (group.options || []).length > 0
  );
  if (branchGroups.length) {
    payload.branchGroups = branchGroups;
  } else {
    delete payload.branchGroups;
  }

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    setEditStatus(els.stopOrderStatus, `Stop order saved (${stops.length} stops).`);
    setEditStatus(els.mergeRouteStatus, "");
    clearRouteDirty("stops");
    recordManualEdit(
      "route",
      `${lineKey} · stop order`,
      `${stops.length} stops${branchGroups.length ? `, ${branchGroups.length} branch group(s)` : ""}`
    );
  } catch (error) {
    setEditStatus(els.stopOrderStatus, error.message, true);
  }
}

async function clearStopChanges() {
  if (!state.selectedLineKey) {
    return;
  }
  const payload = state.selectedRouteOverride?.payload || {};
  state.selectedBranchGroups = Array.isArray(payload.branchGroups)
    ? JSON.parse(JSON.stringify(payload.branchGroups))
    : [];
  state.removedStopKeys = new Set(
    Array.isArray(payload.removedStops) ? payload.removedStops.map(String) : []
  );
  if (els.routeOrdering) {
    const savedOrdering = String(payload.orderingMode || "");
    els.routeOrdering.value =
      !savedOrdering && Array.isArray(payload.stops) && payload.stops.length ? "manual" : savedOrdering;
  }
  renderBranchGroupsEditor();
  await loadStopsForRoute(state.selectedLineKey);
  updateStopOrderLockState();
  clearRouteDirty("stops");
  setEditStatus(els.stopOrderStatus, "Reverted unsaved stop changes.");
}

async function clearStopOrder() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  let payload = {};
  try {
    const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET" });
    payload = (existing?.override?.payload || {});
  } catch {
    // new override
  }
  delete payload.stops;
  delete payload.orderingMode;
  delete payload.branchGroups;
  delete payload.removedStops;

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    if (els.routeOrdering) {
      els.routeOrdering.value = "";
    }
    state.selectedBranchGroups = [];
    state.removedStopKeys = new Set();
    renderBranchGroupsEditor();
    clearRouteDirty("stops");
    setEditStatus(els.stopOrderStatus, "Stop order reset to automatic.");
    recordManualEdit("route", `${lineKey} · stop order`, "reset all stop-order changes");
    await loadStopsForRoute(lineKey);
    // Re-render in case the stop refetch did not land.
    for (const feature of state.currentRouteStops || []) {
      if (feature.properties) {
        delete feature.properties.branch;
        delete feature.properties.branches;
      }
    }
    updateStopOrderLockState();
  } catch (error) {
    setEditStatus(els.stopOrderStatus, error.message, true);
  }
}

async function selectRouteFromFeature(feature, options = {}) {
  const props = featureLineProps(feature);
  const nextLineKey = String(props.lineKey || "").trim();
  if (!options.force && nextLineKey === state.selectedLineKey) {
    highlightRouteOnMap(feature);
    return;
  }
  if (
    state.selectedLineKey &&
    nextLineKey !== state.selectedLineKey &&
    !confirmDiscardRouteChanges()
  ) {
    return;
  }
  closeRouteOverlapPopup();
  state.selectedRouteFeature = feature;
  state.selectedRouteOnestopId = String(feature?.properties?.onestop_id || "").trim();
  state.selectedLineKey = nextLineKey;
  state.selectedRouteOverride = null;
  state.selectedRouteReview = null;
  clearRouteDirty();

  highlightRouteOnMap(feature);
  els.routeEditPanel.hidden = false;
  els.routeIdentity.textContent = `${props.lineKey}${props.lineName ? " · " + props.lineName : ""}`;
  if (els.routeEditColorDot) {
    els.routeEditColorDot.style.background = props.color || "#177ca2";
  }
  if (els.routeEditMeta) {
    els.routeEditMeta.textContent = `${props.lineName || "Unnamed route"}${props.operatorName ? " · " + props.operatorName : ""}`;
  }

  els.routeName.value = props.lineName;
  els.routeShortName.value = props.lineShortName;
  els.routeLongName.value = props.lineLongName;
  els.routeOperator.value = props.operatorName;
  els.routeMode.value = props.routeType !== null ? String(props.routeType) : "";
  els.routeColor.value = props.color;
  els.routeOrdering.value = "";
  if (els.routeFrequency) els.routeFrequency.value = "";
  if (els.routeFrequencyMinutes) els.routeFrequencyMinutes.value = "";
  state.selectedBranchGroups = [];
  state.removedStopKeys = new Set();
  renderBranchGroupsEditor();
  state.selectedMergedKeys = [];
  renderMergeRoutesList();
  updateStopOrderLockState();
  if (els.routeProblematic) {
    els.routeProblematic.checked = false;
  }
  state.problematicTouched = false;
  if (els.newStopName) els.newStopName.value = "";
  if (els.newStopLat) els.newStopLat.value = "";
  if (els.newStopLon) els.newStopLon.value = "";
  setEditStatus(els.routeEditStatus, "Loaded from tile properties.");
  if (els.routeDataStatus) {
    setEditStatus(els.routeDataStatus, "");
  }
  if (els.refreshRouteBtn) {
    els.refreshRouteBtn.disabled = false;
  }
  if (els.removeRouteBtn) {
    els.removeRouteBtn.disabled = false;
  }

  const requestLineKey = state.selectedLineKey;
  try {
    const [overridePayload, reviewsPayload, headwayPayload] = await Promise.all([
      apiRequest(`/api/admin/overrides/route/${encodeURIComponent(requestLineKey)}`, { method: "GET" }),
      state.currentCitySlug
        ? apiRequest(`/api/admin/reviews/route?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" })
        : Promise.resolve({ reviews: [] }),
      apiRequest(`/api/transit/route-headway/bulk?${new URLSearchParams({ lineKeys: requestLineKey })}`, { method: "GET" })
        .catch(() => ({ headwayByLineKey: {} }))
    ]);

    if (state.selectedLineKey !== requestLineKey) {
      return;
    }

    if (overridePayload?.override) {
      state.selectedRouteOverride = overridePayload.override;
      const payload = overridePayload.override.payload || {};
      if (payload.lineName) els.routeName.value = payload.lineName;
      if (payload.lineShortName !== undefined) els.routeShortName.value = payload.lineShortName;
      if (payload.lineLongName !== undefined) els.routeLongName.value = payload.lineLongName;
      if (payload.operatorName) els.routeOperator.value = payload.operatorName;
      if (payload.mode !== undefined && payload.mode !== null && payload.mode !== "") els.routeMode.value = String(payload.mode);
      if (payload.color) els.routeColor.value = payload.color;
      if (payload.orderingMode) els.routeOrdering.value = payload.orderingMode;
      if (Array.isArray(payload.stops) && payload.stops.length && !payload.orderingMode) {
        // A custom order implies manual mode unless told otherwise.
        els.routeOrdering.value = "manual";
      }
      if (payload.frequencyBucket && els.routeFrequency) {
        els.routeFrequency.value = String(payload.frequencyBucket);
      }
      if (els.routeFrequencyMinutes && payload.headwayBestMinutes !== undefined) {
        const minutes = Number(payload.headwayBestMinutes);
        els.routeFrequencyMinutes.value = Number.isFinite(minutes) ? String(minutes) : "";
      }
      state.selectedBranchGroups = Array.isArray(payload.branchGroups)
        ? JSON.parse(JSON.stringify(payload.branchGroups))
        : [];
      state.removedStopKeys = new Set(
        Array.isArray(payload.removedStops) ? payload.removedStops.map(String) : []
      );
      state.selectedMergedKeys = Array.isArray(payload.mergedLineKeys)
        ? payload.mergedLineKeys.map((key) => String(key || "").trim()).filter(Boolean)
        : [];
      renderBranchGroupsEditor();
      renderMergeRoutesList();
      updateStopOrderLockState();
      setEditStatus(els.routeEditStatus, "Loaded existing override + tile properties.");
    }

    if (els.routeFrequencyMinutes && !els.routeFrequencyMinutes.value) {
      const minutes = Number(headwayPayload?.headwayByLineKey?.[state.selectedLineKey]?.headwayBestMinutes);
      if (Number.isFinite(minutes) && minutes > 0) {
        els.routeFrequencyMinutes.value = String(Math.round(minutes));
      }
    }

    // Problematic = manual override, else auto-detect.
    const review = (reviewsPayload.reviews || []).find((r) => r.line_key === state.selectedLineKey);
    const manualOverride = review ? review.problematic_override : undefined;
    const autoProblematic = Boolean(headwayPayload?.headwayByLineKey?.[state.selectedLineKey]?.problematicGeometry);
    const effectiveProblematic = manualOverride === true || (manualOverride !== false && autoProblematic);
    if (review) {
      state.selectedRouteReview = review;
    }
    if (els.routeProblematic) {
      els.routeProblematic.checked = Boolean(effectiveProblematic);
    }

    loadStopsForRoute(state.selectedLineKey);
    renderCitySelectedRoute();
    applyActiveSuggestion(state.selectedLineKey);
    renderProblematicSelectedRow();
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

function clearSelection() {
  closeRouteOverlapPopup();
  state.selectedLineKey = "";
  clearRouteDirty();
  state.currentRouteStops = [];
  state.selectedBranchGroups = [];
  state.selectedMergedKeys = [];
  clearRouteHighlight();
  clearStopsMapSources();
  renderStopsOrderList();
  renderBranchGroupsEditor();
  renderMergeRoutesList();
  renderProblematicSelectedRow();
  if (els.routeEditPanel) {
    els.routeEditPanel.hidden = true;
  }
  renderCitySelectedRoute();
}
