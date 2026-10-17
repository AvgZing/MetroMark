// Admin Map Editor — stop list rendering, ordering controls, add/save/clear stops, route/station selection.
let dragStopIndex = null;

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
    els.stopOrderLockNote.textContent = `Stops are shown in ${label} order. Set Stop Ordering Default to Manual to drag and reorder.`;
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
      });
      row.addEventListener("dragover", (event) => {
        if (dragStopIndex === null) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragStopIndex === null || dragStopIndex === index) {
          return;
        }
        const arr = state.currentRouteStops;
        const [moved] = arr.splice(dragStopIndex, 1);
        arr.splice(index, 0, moved);
        dragStopIndex = null;
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
    latInput.placeholder = "Lat";
    latInput.value = Number.isFinite(Number(coords[1])) ? String(Number(coords[1]).toFixed(6)) : "";
    latInput.addEventListener("input", () => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        feature.geometry = { type: "Point", coordinates: [lon, lat] };
      }
    });

    const lonInput = document.createElement("input");
    lonInput.type = "number";
    lonInput.step = "any";
    lonInput.placeholder = "Lon";
    lonInput.value = Number.isFinite(Number(coords[0])) ? String(Number(coords[0]).toFixed(6)) : "";
    lonInput.addEventListener("input", () => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
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
    remove.textContent = "Delete";
    remove.title = "Delete this stop";
    remove.disabled = !manual;
    remove.addEventListener("click", () => {
      state.currentRouteStops.splice(index, 1);
      renderStopsOrderList();
    });

    row.append(fields, remove);

    if (manual && (state.selectedBranchGroups || []).length) {
      const branchRow = document.createElement("div");
      branchRow.className = "stop-branch-row";
      const branchSelect = document.createElement("select");
      branchSelect.className = "stop-branch-select";
      branchSelect.title = "Which branch option this stop belongs to";
      const trunkOption = document.createElement("option");
      trunkOption.value = "";
      trunkOption.textContent = "Trunk (always shown)";
      branchSelect.append(trunkOption);
      for (const choice of branchOptionChoices()) {
        const optionEl = document.createElement("option");
        optionEl.value = String(choice.option.id);
        optionEl.textContent = `${choice.group.label || "Branch"}: ${choice.option.label || choice.option.id}`;
        branchSelect.append(optionEl);
      }
      branchSelect.value = String(p.branch || "");
      branchSelect.addEventListener("change", () => {
        p.branch = branchSelect.value;
      });
      branchRow.append(branchSelect);
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
  const lat = Number(els.newStopLat?.value);
  const lon = Number(els.newStopLon?.value);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    setEditStatus(els.routeEditStatus, "A stop name and numeric lat/lon are required.", true);
    return;
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "stop";
  const key = `custom:${slug}:${Date.now().toString(36)}`;
  const feature = adminCustomStopFeature({ key, name, lat, lon }, state.selectedLineKey);
  if (!feature) {
    return;
  }
  state.currentRouteStops.push(feature);
  renderStopsOrderList();
  appendStopsToMapSource([feature]);
  if (els.newStopName) els.newStopName.value = "";
  if (els.newStopLat) els.newStopLat.value = "";
  if (els.newStopLon) els.newStopLon.value = "";
  setEditStatus(els.routeEditStatus, `Added "${name}" to the working order. Save Stop Order to persist.`);
}

async function saveStopOrder() {
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
      const branch = String(p.branch || "").trim();
      if (branch) {
        entry.branch = branch;
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
    setEditStatus(els.routeEditStatus, `Stop order saved (${stops.length} stops).`);
    setEditStatus(els.mergeRouteStatus, "");
    recordManualEdit(
      "route",
      `${lineKey} · stop order`,
      `${stops.length} stops${branchGroups.length ? `, ${branchGroups.length} branch group(s)` : ""}`
    );
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
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
  if (els.routeOrdering) {
    const savedOrdering = String(payload.orderingMode || "");
    els.routeOrdering.value =
      !savedOrdering && Array.isArray(payload.stops) && payload.stops.length ? "manual" : savedOrdering;
  }
  renderBranchGroupsEditor();
  await loadStopsForRoute(state.selectedLineKey);
  updateStopOrderLockState();
  setEditStatus(els.routeEditStatus, "Reverted unsaved stop changes.");
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

  try {
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey, citySlug: state.currentCitySlug, payload }
    });
    if (els.routeOrdering) {
      els.routeOrdering.value = "";
    }
    state.selectedBranchGroups = [];
    renderBranchGroupsEditor();
    setEditStatus(els.routeEditStatus, "Stop order reset to automatic.");
    recordManualEdit("route", `${lineKey} · stop order`, "reset all stop-order changes");
    await loadStopsForRoute(lineKey);
    // Render from state even if the stop refetch did not land, so the reset sticks.
    for (const feature of state.currentRouteStops || []) {
      if (feature.properties) {
        delete feature.properties.branch;
      }
    }
    updateStopOrderLockState();
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function selectRouteFromFeature(feature) {
  const props = featureLineProps(feature);
  closeRouteOverlapPopup();
  state.selectedRouteFeature = feature;
  state.selectedRouteOnestopId = String(feature?.properties?.onestop_id || "").trim();
  state.selectedLineKey = props.lineKey;
  state.selectedStationKey = "";
  state.selectedRouteOverride = null;
  state.selectedRouteReview = null;

  highlightRouteOnMap(feature);
  els.stationEditPanel.hidden = true;
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

  try {
    const [overridePayload, reviewsPayload, headwayPayload] = await Promise.all([
      apiRequest(`/api/admin/overrides/route/${encodeURIComponent(state.selectedLineKey)}`, { method: "GET" }),
      state.currentCitySlug
        ? apiRequest(`/api/admin/reviews/route?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" })
        : Promise.resolve({ reviews: [] }),
      apiRequest(`/api/transit/route-headway/bulk?${new URLSearchParams({ lineKeys: state.selectedLineKey })}`, { method: "GET" })
        .catch(() => ({ headwayByLineKey: {} }))
    ]);

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

async function selectStationFromFeature(feature) {
  const p = feature?.properties || {};
  closeRouteOverlapPopup();
  const stationKey = String(p.station_key || "").trim();
  const lineKey = String(p.line_key || "").trim();
  if (!stationKey) {
    return;
  }

  state.selectedStationKey = stationKey;
  state.selectedLineKey = "";
  els.routeEditPanel.hidden = true;
  els.stationEditPanel.hidden = false;
  els.stationIdentity.textContent = `${stationKey}${lineKey ? " · on " + lineKey : ""}`;

  const coords = feature.geometry?.coordinates || [];
  els.stationName.value = String(p.station_name || "");
  els.stationLat.value = coords[1] !== undefined ? String(Number(coords[1]).toFixed(6)) : "";
  els.stationLon.value = coords[0] !== undefined ? String(Number(coords[0]).toFixed(6)) : "";
  els.stationNote.value = "";
  setEditStatus(els.stationEditStatus, "Loaded from stop properties.");
}

function clearSelection() {
  closeRouteOverlapPopup();
  state.selectedLineKey = "";
  state.selectedStationKey = "";
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
  if (els.stationEditPanel) {
    els.stationEditPanel.hidden = true;
  }
  renderCitySelectedRoute();
}
