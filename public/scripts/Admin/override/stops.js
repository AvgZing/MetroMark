// Admin Map Editor — stop features/order/loading and route merging.
function dedupeAdminStopFeatures(features) {
  const seen = new Set();
  return (Array.isArray(features) ? features : []).filter((feature) => {
    const key = String(feature?.properties?.station_key || "").trim();
    if (!key) {
      return true;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function adminCustomStopFeature(stop, lineKey) {
  const key = String(stop?.key || "").trim();
  const lat = Number(stop?.lat);
  const lon = Number(stop?.lon);
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const properties = {
    station_key: key,
    station_name: String(stop?.name || key),
    line_key: lineKey,
    custom_stop: 1
  };
  const branch = String(stop?.branch || "").trim();
  if (branch) {
    properties.branch = branch;
  }
  return {
    type: "Feature",
    id: `${lineKey}|${key}`,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties
  };
}

function orderAdminStopsByCustomOrder(features, customStops, lineKey = "") {
  const byKey = new Map();
  for (const feature of features || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (key) {
      byKey.set(key, feature);
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const stop of customStops || []) {
    const key = String(stop?.key || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const feature = byKey.get(key);
    if (feature) {
      // Restore the saved branch tag so the editor reflects what was authored.
      const branch = String(stop?.branch || "").trim();
      if (feature.properties) {
        if (branch) {
          feature.properties.branch = branch;
        } else {
          delete feature.properties.branch;
        }
      }
      ordered.push(feature);
      continue;
    }
    // A stop added manually by an admin — synthesize it from override coords.
    const synthetic = adminCustomStopFeature(stop, lineKey);
    if (synthetic) {
      ordered.push(synthetic);
    }
  }

  for (const feature of features || []) {
    const key = String(feature?.properties?.station_key || "").trim();
    if (!seen.has(key)) {
      ordered.push(feature);
    }
  }

  return ordered;
}

async function loadStopsForRoute(lineKey) {
  const source = state.map && state.map.getSource("stops");
  if (!source) {
    return;
  }
  try {
    const params = new URLSearchParams({ lineKey, stopTypes: ROUTE_STOP_TYPES_QUERY });
    const payload = await fetch(`/api/transit/route-stops?${params.toString()}`).then((r) => r.json());
    if (Array.isArray(payload?.stopsGeoJson?.features)) {
      // Dedupe by station key, then apply the saved custom order.
      let stops = dedupeAdminStopFeatures(payload.stopsGeoJson.features);
      if (state.selectedRouteOverride && Array.isArray(state.selectedRouteOverride.payload?.stops)) {
        stops = orderAdminStopsByCustomOrder(
          stops,
          state.selectedRouteOverride.payload.stops,
          lineKey
        );
      }
      source.setData({ type: "FeatureCollection", features: stops });
      state.currentRouteStops = stops.slice();
      state.currentRouteDirectionSequences = payload.directionStopSequences || null;
      state.currentRouteDirectionPatterns = payload.directionStopPatterns || null;
      renderStopsOrderList();
      if (String(els.routeOrdering?.value || "").trim() !== "manual") {
        refreshStopOrderPreview();
      }
    }
  } catch {
    // non-critical — stations still editable via other flows
  }
}

function appendStopsToMapSource(newFeatures) {
  const source = state.map && state.map.getSource("stops");
  if (!source || !newFeatures?.length) {
    return;
  }
  const current = Array.isArray(source._data?.features) ? source._data.features : [];
  source.setData({ type: "FeatureCollection", features: [...current, ...newFeatures] });
}

function clearStopsMapSources() {
  for (const id of ["stops", "stops-edited"]) {
    const source = state.map && state.map.getSource(id);
    if (source && typeof source.setData === "function") {
      source.setData(EMPTY_FC);
    }
  }
}

function branchOptionChoices() {
  const choices = [];
  for (const group of state.selectedBranchGroups || []) {
    for (const option of group.options || []) {
      choices.push({ group, option });
    }
  }
  return choices;
}

function renderMergeRoutesList() {
  const container = els.mergeRoutesList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const keys = state.selectedMergedKeys || [];
  if (!keys.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "Not merged with any route.";
    container.append(p);
    return;
  }
  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "city-member-row";
    const main = document.createElement("div");
    main.className = "city-member-main";
    const name = document.createElement("span");
    name.className = "city-member-name";
    name.textContent = cityRouteDisplayName(key);
    const meta = document.createElement("span");
    meta.className = "city-member-meta";
    meta.textContent = key;
    main.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "city-remove-rule";
    remove.textContent = "Unmerge";
    remove.addEventListener("click", () => {
      state.selectedMergedKeys = (state.selectedMergedKeys || []).filter((entry) => entry !== key);
      renderMergeRoutesList();
      setEditStatus(els.mergeRouteStatus, `${key} removed. Save Changes to apply.`);
    });

    row.append(main, remove);
    container.append(row);
  }
}

function renderMergeRouteKeyResults() {
  const input = els.mergeRouteKeyInput;
  const container = els.mergeRouteKeyResults;
  if (!input || !container) {
    return;
  }
  const query = String(input.value || "").trim().toLowerCase();
  container.innerHTML = "";
  if (query.length < 2 || typeof collectRouteSearchCorpus !== "function") {
    return;
  }
  const self = String(state.selectedLineKey || "").trim();
  const seen = new Set();
  for (const feature of collectRouteSearchCorpus()) {
    const props = featureLineProps(feature);
    const key = String(props.lineKey || "").trim();
    if (!key || key === self || seen.has(key)) {
      continue;
    }
    const label = typeof cityRouteDisplayName === "function" ? cityRouteDisplayName(key) : key;
    if (!`${key} ${label}`.toLowerCase().includes(query)) {
      continue;
    }
    seen.add(key);
    const row = document.createElement("div");
    row.className = "admin-route-result-row";
    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "admin-route-result-focus";
    const dot = document.createElement("span");
    dot.className = "admin-route-select-dot";
    dot.style.background = props.color || "#177ca2";
    const nameEl = document.createElement("span");
    nameEl.className = "admin-route-select-name";
    nameEl.textContent = label;
    const metaEl = document.createElement("span");
    metaEl.className = "admin-route-select-meta";
    metaEl.textContent = key;
    pickBtn.append(dot, nameEl, metaEl);
    pickBtn.addEventListener("click", () => {
      input.value = key;
      container.innerHTML = "";
    });
    row.append(pickBtn);
    container.append(row);
    if (seen.size >= 8) {
      break;
    }
  }
}

function addMergeRoute() {
  const key = String(els.mergeRouteKeyInput?.value || "").trim();
  if (!key) {
    return;
  }
  if (key === state.selectedLineKey) {
    setEditStatus(els.mergeRouteStatus, "A route cannot merge with itself.", true);
    return;
  }
  if ((state.selectedMergedKeys || []).includes(key)) {
    setEditStatus(els.mergeRouteStatus, `${key} is already merged.`, true);
    return;
  }
  state.selectedMergedKeys = [...(state.selectedMergedKeys || []), key];
  if (els.mergeRouteKeyInput) {
    els.mergeRouteKeyInput.value = "";
  }
  renderMergeRoutesList();
  setEditStatus(els.mergeRouteStatus, `${key} added. Save Changes to apply.`);
}

function mergeCandidateKey(candidate) {
  return [...(candidate?.lineKeys || [])].sort().join("|");
}

function scheduleMergeDetection() {
  if (!els.mergeCandidatesList) {
    return;
  }
  if (state.mergeDetectTimer) {
    clearTimeout(state.mergeDetectTimer);
  }
  state.mergeDetectTimer = setTimeout(() => {
    state.mergeDetectTimer = null;
    findMergeCandidates().catch(() => {});
  }, 1200);
}

async function findMergeCandidates() {
  if (!els.mergeCandidatesList) {
    return;
  }
  const bbox = currentMapBbox();
  if (!bbox) {
    return;
  }
  setEditStatus(els.mergeCandidatesStatus, "Scanning geometry…");
  try {
    const params = new URLSearchParams({ bbox: bbox.join(",") });
    if (state.currentCitySlug) {
      params.set("citySlug", state.currentCitySlug);
    }
    const payload = await apiRequest(`/api/admin/routes/merge-candidates?${params.toString()}`, {
      method: "GET"
    });
    state.mergeCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    renderMergeCandidates();
    const visible = state.mergeCandidates.filter(
      (candidate) => !state.dismissedMergeCandidates.has(mergeCandidateKey(candidate))
    );
    setEditStatus(
      els.mergeCandidatesStatus,
      visible.length ? `${visible.length} possible duplicate group(s) in view.` : "No duplicate-looking routes in view."
    );
  } catch (error) {
    setEditStatus(els.mergeCandidatesStatus, `Detection failed: ${error.message}`, true);
  }
}

function renderMergeCandidates() {
  const container = els.mergeCandidatesList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const candidates = (state.mergeCandidates || []).filter(
    (candidate) => !state.dismissedMergeCandidates.has(mergeCandidateKey(candidate))
  );
  if (!candidates.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No duplicate-looking routes in view.";
    container.append(p);
    return;
  }
  for (const candidate of candidates) {
    container.append(buildMergeCandidateRow(candidate));
  }
}

function buildMergeCandidateRow(candidate) {
  const row = document.createElement("div");
  row.className = "merge-candidate";

  const title = document.createElement("p");
  title.className = "merge-candidate-title";
  const reason = candidate.reason === "identical-geometry" ? "Identical geometry" : "Near-identical geometry";
  title.textContent = `${reason} · match ${Number(candidate.score).toFixed(2)}`;
  row.append(title);

  const names = document.createElement("p");
  names.className = "merge-candidate-names";
  candidate.lineKeys.forEach((key, index) => {
    if (index > 0) {
      names.append(document.createTextNode("  ·  "));
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = "merge-candidate-name-link";
    link.textContent = candidate.names?.[index] || key;
    link.title = `Show ${key} on the map`;
    link.addEventListener("click", () => {
      focusRouteByLineKey(key).catch(() => {});
    });
    names.append(link);
  });
  row.append(names);

  const actions = document.createElement("div");
  actions.className = "override-actions";
  const canonical = candidate.suggestedCanonicalKey || candidate.lineKeys[0];
  const members = candidate.lineKeys.filter((key) => key !== canonical);
  const canonicalIndex = candidate.lineKeys.indexOf(canonical);

  const mergeBtn = document.createElement("button");
  mergeBtn.type = "button";
  mergeBtn.className = "btn";
  mergeBtn.textContent = `Merge into ${candidate.names?.[canonicalIndex] || canonical}`;
  mergeBtn.addEventListener("click", () => mergeCandidateGroup(canonical, members, mergeBtn));

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn btn-subtle";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => {
    state.dismissedMergeCandidates.add(mergeCandidateKey(candidate));
    renderMergeCandidates();
  });

  actions.append(mergeBtn, dismissBtn);
  row.append(actions);
  return row;
}

async function mergeCandidateGroup(canonical, members, button) {
  if (!canonical || !members?.length) {
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Merging…";
  try {
    let payload = {};
    try {
      const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(canonical)}`, {
        method: "GET"
      });
      payload = existing?.override?.payload || {};
    } catch {
      payload = {};
    }
    const existingMembers = Array.isArray(payload.mergedLineKeys) ? payload.mergedLineKeys.map(String) : [];
    const merged = Array.from(
      new Set([...existingMembers, ...members].filter((key) => key && key !== canonical))
    );
    await apiRequest("/api/admin/overrides/route", {
      method: "POST",
      body: { lineKey: canonical, citySlug: state.currentCitySlug, payload: { ...payload, mergedLineKeys: merged } }
    });
    recordManualEdit("route", `${canonical} · merge`, `merged ${members.join(", ")}`);
    showAdminAction(`Merged ${members.join(", ")} into ${canonical}.`);
    state.dismissedMergeCandidates.add(mergeCandidateKey({ lineKeys: [canonical, ...members] }));
    reloadVectorSource();
    updateUnderlay();
    await loadAdminMerges();
    renderMergeCandidates();
  } catch (error) {
    showAdminAction(`Merge failed: ${error.message}`, true);
    button.textContent = originalText;
    button.disabled = false;
  }
}
