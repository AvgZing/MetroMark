// Admin Map Editor — route search corpus/results, batch refresh, Transitland add, coverage underlay, cities load.
function collectRouteSearchCorpus() {
  const byKey = new Map();
  const add = (feature, visible = false) => {
    const props = featureLineProps(feature);
    if (!props.lineKey) {
      return;
    }
    const marked = { ...feature, _adminVisible: Boolean(visible) };
    const existing = byKey.get(props.lineKey);
    if (!existing) {
      byKey.set(props.lineKey, marked);
      return;
    }
    if (visible) {
      existing._adminVisible = true;
    }
    const hasGeom = Boolean(feature.geometry && Array.isArray(feature.geometry.coordinates));
    const existingGeom = Boolean(existing.geometry && Array.isArray(existing.geometry.coordinates));
    if (hasGeom && !existingGeom) {
      marked._adminVisible = marked._adminVisible || Boolean(existing._adminVisible);
      byKey.set(props.lineKey, marked);
    }
  };
  if (state.map && state.mapReady && state.map.getLayer("routes-main")) {
    for (const feature of state.map.queryRenderedFeatures({ layers: ["routes-main"] })) {
      add(feature, true);
    }
  }
  // Include source (hidden) features so search finds non-rendered routes too.
  if (state.map && state.mapReady) {
    try {
      for (const feature of state.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" })) {
        add(feature, false);
      }
    } catch {
      // source not ready yet
    }
  }
  for (const feature of state.underlayFeatures || []) {
    add(feature, false);
  }
  return Array.from(byKey.values());
}

function routeSearchFeatureText(feature) {
  const props = featureLineProps(feature);
  return [
    props.lineKey,
    props.lineName,
    props.lineShortName,
    props.lineLongName,
    props.operatorName,
    props.routeOnestopId,
    MODE_LABELS[props.routeType],
    props.routeType,
    state.frequencyByLineKey.get(props.lineKey)
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function routeSearchScore(feature, query) {
  if (!query) {
    return 0;
  }
  const props = featureLineProps(feature);
  const text = routeSearchFeatureText(feature);
  if (!text.includes(query)) {
    return -999;
  }
  const shortName = String(props.lineShortName || "").toLowerCase();
  const lineName = String(props.lineName || "").toLowerCase();
  const longName = String(props.lineLongName || "").toLowerCase();
  if (shortName === query) return 1000;
  if (lineName === query) return 950;
  if (longName === query) return 900;
  if (shortName.startsWith(query)) return 800;
  if (lineName.startsWith(query)) return 750;
  if (longName.startsWith(query)) return 700;
  const shortNameIndex = shortName.indexOf(query);
  if (shortNameIndex !== -1) {
    return 500 - shortNameIndex;
  }
  return 100;
}

function routeSearchTierWeight(feature) {
  const routeType = Number(featureLineProps(feature).routeType);
  if ([0, 1, 2, 12].includes(routeType)) {
    return 0;
  }
  if ([3, 11].includes(routeType)) {
    return 3;
  }
  return 2;
}

function sortRouteSearchFeatures(features, query) {
  return features.slice().sort((a, b) => {
    const visibleDiff = Number(Boolean(b._adminVisible)) - Number(Boolean(a._adminVisible));
    if (visibleDiff) {
      return visibleDiff;
    }
    const scoreDiff = routeSearchScore(b, query) - routeSearchScore(a, query);
    if (scoreDiff) {
      return scoreDiff;
    }
    const tierDiff = routeSearchTierWeight(a) - routeSearchTierWeight(b);
    if (tierDiff) {
      return tierDiff;
    }
    return adminLineDisplayName(featureLineProps(a)).localeCompare(adminLineDisplayName(featureLineProps(b)));
  });
}

function routeMetadataToSearchFeature(route) {
  return {
    type: "Feature",
    properties: {
      line_key: route.lineKey,
      line_name: route.lineName,
      line_short_name: route.lineShortName,
      line_long_name: route.lineLongName,
      operator_name: route.operatorName,
      route_type: route.routeType,
      color: route.color,
      route_onestop_id: route.routeOnestopId
    },
    bbox: route.bbox,
    _adminGlobal: true
  };
}

function createRouteSearchRow(feature, { global = false } = {}) {
  const props = featureLineProps(feature);
  const row = document.createElement("div");
  row.className = "admin-route-result-row";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.title = "Select for batch refresh";
  cb.checked = state.routeBatchSelection.has(props.lineKey);
  cb.addEventListener("change", () => {
    if (cb.checked) {
      state.routeBatchSelection.add(props.lineKey);
    } else {
      state.routeBatchSelection.delete(props.lineKey);
    }
    updateRouteBatchControl();
  });

  const focusBtn = document.createElement("button");
  focusBtn.type = "button";
  focusBtn.className = "admin-route-result-focus";
  const dot = document.createElement("span");
  dot.className = "admin-route-select-dot";
  dot.style.background = props.color || "#177ca2";
  const name = document.createElement("span");
  name.className = "admin-route-select-name";
  name.textContent = adminLineDisplayName(props) || props.lineKey;
  const meta = document.createElement("span");
  meta.className = "admin-route-select-meta";
  const metaParts = [MODE_LABELS[props.routeType] || "Route", props.operatorName].filter(Boolean);
  if (global) {
    metaParts.push("Not in view");
  }
  meta.textContent = metaParts.join(" · ");
  focusBtn.append(dot, name, meta);
  focusBtn.addEventListener("click", () => {
    if (global) {
      focusRouteByLineKey(props.lineKey).catch(() => {});
    } else {
      focusRouteFeature(feature);
    }
  });

  row.append(cb, focusBtn);
  return row;
}

function renderRouteSearchResults(features, context = {}) {
  const container = els.routeSearchResults;
  if (!container) {
    return;
  }
  const query = String(context.query || "").trim().toLowerCase();
  const modeFilterSet = context.modeFilterSet instanceof Set ? context.modeFilterSet : new Set();
  const frequencyFilterSet =
    context.frequencyFilterSet instanceof Set ? context.frequencyFilterSet : new Set();
  const hasFilter = Boolean(query || modeFilterSet.size || frequencyFilterSet.size);
  container.innerHTML = "";
  // Only render results when a search/filter is active.
  if (!hasFilter) {
    updateRouteBatchControl();
    return;
  }
  const list = (Array.isArray(features) ? features : []).filter((feature) => {
    const props = featureLineProps(feature);
    if (query && !routeSearchFeatureText(feature).includes(query)) {
      return false;
    }
    if (modeFilterSet.size) {
      if (props.routeType === null || !modeFilterSet.has(Number(props.routeType))) {
        return false;
      }
    }
    if (frequencyFilterSet.size) {
      const bucket = String(state.frequencyByLineKey.get(props.lineKey) || "unknown").toLowerCase();
      if (!frequencyFilterSet.has(bucket)) {
        return false;
      }
    }
    return true;
  });
  const globalList = query && Array.isArray(context.globalResults)
    ? context.globalResults.slice()
    : [];

  const seen = new Set();
  let rendered = 0;
  for (const feature of sortRouteSearchFeatures(list, query)) {
    const props = featureLineProps(feature);
    if (!props.lineKey || seen.has(props.lineKey)) {
      continue;
    }
    seen.add(props.lineKey);
    if (rendered >= 60) {
      break;
    }
    rendered += 1;
    container.append(createRouteSearchRow(feature));
  }

  let globalRendered = 0;
  for (const feature of sortRouteSearchFeatures(globalList, query)) {
    const props = featureLineProps(feature);
    if (!props.lineKey || seen.has(props.lineKey)) {
      continue;
    }
    seen.add(props.lineKey);
    if (globalRendered >= 30) {
      break;
    }
    globalRendered += 1;
    container.append(createRouteSearchRow(feature, { global: true }));
  }

  if (!rendered && !globalRendered) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No matching routes in the current view. Pan/zoom the map to load more.";
    container.append(p);
  }
  updateRouteBatchControl();
}

function updateRouteBatchControl() {
  const count = state.routeBatchSelection.size;
  if (els.refreshSelectedRoutesBtn) {
    els.refreshSelectedRoutesBtn.textContent = `Refresh selected (${count})`;
    els.refreshSelectedRoutesBtn.disabled = count === 0;
  }
}

function summarizeRouteReport(payload, keys) {
  const parts = [`Done in ${Math.round(Number(payload.elapsedMs || 0) / 1000)}s`];
  if (payload.refreshed?.length) parts.push(`${payload.refreshed.length} refreshed`);
  if (payload.merged?.added) parts.push(`${payload.merged.added} added`);
  if (payload.merged?.updated) parts.push(`${payload.merged.updated} updated`);
  if (payload.removed?.length) parts.push(`${payload.removed.length} removed`);
  if (payload.missing?.length) parts.push(`${payload.missing.length} missing (kept — review to remove)`);
  if (payload.flagsOpened?.length) parts.push(`${payload.flagsOpened.length} flag(s) opened`);
  if (payload.failures?.length) parts.push(`${payload.failures.length} failure(s)`);
  if (payload.tileCount !== null && payload.tileCount !== undefined) {
    parts.push(`tiles rebuilt (${payload.tileCount})`);
  }
  const removedKeys = new Set((payload.removed || []).map((entry) => entry.lineKey));
  return { text: parts.join(" · "), isError: Boolean(payload.failures?.length), removedKeys };
}

async function refreshRoutesByKeys(keys, statusEl) {
  if (!keys.length) {
    return null;
  }
  if (!state.token) {
    setEditStatus(statusEl, "Log in first.", true);
    return null;
  }
  setEditStatus(statusEl, `Refreshing ${keys.length} route(s)…`);
  try {
    const payload = await apiRequest("/api/admin/routes/refresh", {
      method: "POST",
      body: {
        lineKeys: keys,
        zoom: state.map ? state.map.getZoom() : undefined
      }
    });
    const summary = summarizeRouteReport(payload, keys);
    setEditStatus(statusEl, summary.text, summary.isError);
    recordManualEdit("route-data", `${keys.length} route(s) refreshed`, summary.text);
    return summary;
  } catch (error) {
    setEditStatus(statusEl, `Failed: ${error.message}`, true);
    return null;
  }
}

async function refreshSelectedRoutes() {
  const keys = Array.from(state.routeBatchSelection);
  if (els.refreshSelectedRoutesBtn) {
    els.refreshSelectedRoutesBtn.disabled = true;
  }
  try {
    const summary = await refreshRoutesByKeys(keys, els.routeBatchStatus);
    if (!summary) {
      return;
    }
    showAdminAction(`${keys.length} route(s): ${summary.text}`, summary.isError);
    state.routeBatchSelection.clear();
    startRebuildWatch();
    if (summary.removedKeys.has(state.selectedLineKey)) {
      clearSelection();
    }
  } finally {
    updateRouteBatchControl();
  }
}

async function refreshSingleRoute() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  if (els.refreshRouteBtn) {
    els.refreshRouteBtn.disabled = true;
  }
  try {
    const summary = await refreshRoutesByKeys([lineKey], els.routeDataStatus);
    if (!summary) {
      return;
    }
    showAdminAction(`${lineKey}: ${summary.text}`, summary.isError);
    startRebuildWatch();
    if (summary.removedKeys.has(lineKey)) {
      clearSelection();
    }
  } finally {
    if (els.refreshRouteBtn) {
      els.refreshRouteBtn.disabled = false;
    }
  }
}

async function removeSingleRoute() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;
  const confirmed = window.confirm(
    `Remove ${lineKey} from the archive? Admin overrides, reviews, and votes are preserved and flagged for review.`
  );
  if (!confirmed) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.routeDataStatus, "Log in first.", true);
    return;
  }
  if (els.removeRouteBtn) {
    els.removeRouteBtn.disabled = true;
  }
  try {
    setEditStatus(els.routeDataStatus, "Removing route…");
    const payload = await apiRequest("/api/admin/routes/remove", {
      method: "POST",
      body: { lineKeys: [lineKey] }
    });
    const summary = summarizeRouteReport(payload, [lineKey]);
    setEditStatus(els.routeDataStatus, summary.text, summary.isError);
    recordManualEdit("route-data", `${lineKey} removed`, "removed from archive");
    showAdminAction(`${lineKey}: ${summary.text}`, summary.isError);
    if (payload?.rebuilding) {
      startRebuildWatch();
    } else {
      reloadVectorSource();
      updateUnderlay();
    }
    clearSelection();
  } catch (error) {
    setEditStatus(els.routeDataStatus, `Failed: ${error.message}`, true);
  } finally {
    if (els.removeRouteBtn) {
      els.removeRouteBtn.disabled = false;
    }
  }
}

async function searchTransitland() {
  const query = String(els.transitlandSearchInput?.value || "").trim();
  if (!query) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.transitlandSearchStatus, "Log in first.", true);
    return;
  }
  setEditStatus(els.transitlandSearchStatus, "Searching Transitland…");
  if (els.transitlandSearchResults) {
    els.transitlandSearchResults.innerHTML = "";
  }
  try {
    const bounds = state.map && state.map.getBounds ? state.map.getBounds() : null;
    const bboxParam = bounds
      ? `&bbox=${[bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",")}`
      : "";
    const payload = await apiRequest(
      `/api/admin/routes/search?q=${encodeURIComponent(query)}${bboxParam}`,
      { method: "GET" }
    );
    renderTransitlandResults(Array.isArray(payload?.routes) ? payload.routes : []);
  } catch (error) {
    setEditStatus(els.transitlandSearchStatus, `Search failed: ${error.message}`, true);
  }
}

function renderTransitlandResults(routes) {
  const container = els.transitlandSearchResults;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  if (!routes.length) {
    setEditStatus(els.transitlandSearchStatus, "No Transitland routes matched.");
    return;
  }
  setEditStatus(els.transitlandSearchStatus, `${routes.length} match(es).`);
  for (const candidate of routes) {
    const row = document.createElement("div");
    row.className = "admin-route-result-row";

    const dot = document.createElement("span");
    dot.className = "admin-route-select-dot";
    dot.style.background = candidate.color || "#177ca2";

    const name = document.createElement("span");
    name.className = "admin-route-select-name";
    name.textContent =
      adminLineDisplayName({
        lineShortName: candidate.lineShortName,
        lineLongName: candidate.lineLongName,
        lineName: candidate.lineName,
        lineKey: candidate.lineKey
      }) || candidate.lineKey;

    const meta = document.createElement("span");
    meta.className = "admin-route-select-meta";
    meta.textContent = candidate.lineKey;

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => addTransitlandRoute(candidate, addBtn));

    row.append(dot, name, meta, addBtn);
    container.append(row);
  }
}

async function addTransitlandRoute(candidate, button) {
  if (!candidate?.lineKey) {
    return;
  }
  if (!state.token) {
    setEditStatus(els.transitlandSearchStatus, "Log in first.", true);
    return;
  }
  button.disabled = true;
  setEditStatus(els.transitlandSearchStatus, `Adding ${candidate.lineKey}…`);
  try {
    const payload = await apiRequest("/api/admin/routes/add", {
      method: "POST",
      body: {
        lineKeys: [candidate.lineKey],
        zoom: state.map ? state.map.getZoom() : undefined
      }
    });
    const summary = summarizeRouteReport(payload, [candidate.lineKey]);
    setEditStatus(
      els.transitlandSearchStatus,
      `Added ${candidate.lineKey}. ${summary.text}`,
      summary.isError
    );
    showAdminAction(`Added ${candidate.lineKey}: ${summary.text}`, summary.isError);
    recordManualEdit("route-data", `${candidate.lineKey} added`, "added from Transitland search");
    startRebuildWatch();
    updateUnderlay();
    const match = (state.underlayFeatures || []).find(
      (feature) => String(featureLineProps(feature).lineKey) === candidate.lineKey
    );
    if (match) {
      focusRouteFeature(match);
    }
  } catch (error) {
    setEditStatus(els.transitlandSearchStatus, `Add failed: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function updateCurrentCity() {
  if (!state.map || !state.mapReady) {
    return;
  }
  const center = state.map.getCenter();
  const city = state.cities.find((c) => {
    const [w, s, e, n] = c.bbox || [];
    return w <= center.lng && center.lng <= e && s <= center.lat && center.lat <= n;
  }) || state.cities[0] || null;
  state.currentCitySlug = city ? city.slug : "";
}

async function updateUnderlay() {
  if (!state.mapReady || !state.map) {
    return;
  }
  const bbox = state.map.getBounds().toArray();
  const bounds = [bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]];
  const zoom = state.map.getZoom();
  try {
    const params = new URLSearchParams({
      bbox: bounds.join(","),
      zoom: String(Math.round(zoom)),
      includeGeometry: "1"
    });
    const payload = await fetch(`/api/transit/coverage?${params.toString()}`).then((r) => r.json());
    state.underlayFeatures = Array.isArray(payload?.routesGeoJson?.features)
      ? payload.routesGeoJson.features
      : [];
    applyUnderlaySearchFilter();
  } catch {
    // non-critical
  }
}

let globalRouteSearchTimer = null;
function scheduleGlobalRouteSearch() {
  if (globalRouteSearchTimer) {
    window.clearTimeout(globalRouteSearchTimer);
    globalRouteSearchTimer = null;
  }
  const query = String(state.routeSearchQuery || "").trim();
  if (!query) {
    state.globalRouteSearchResults = [];
    return;
  }
  globalRouteSearchTimer = window.setTimeout(async () => {
    globalRouteSearchTimer = null;
    try {
      const payload = await apiRequest(`/api/transit/routes/search?q=${encodeURIComponent(query)}`, {
        method: "GET"
      });
      if (String(state.routeSearchQuery || "").trim() !== query) {
        return;
      }
      state.globalRouteSearchResults = (payload.routes || []).map(routeMetadataToSearchFeature);
    } catch {
      if (String(state.routeSearchQuery || "").trim() === query) {
        state.globalRouteSearchResults = [];
      }
    }
    applyUnderlaySearchFilter();
  }, 300);
}

function applyUnderlaySearchFilter() {
  const query = String(state.routeSearchQuery || "").trim().toLowerCase();
  const modeFilterSet = state.adminModeFilter instanceof Set ? state.adminModeFilter : new Set();
  const frequencyFilterSet =
    state.adminFrequencyFilter instanceof Set ? state.adminFrequencyFilter : new Set();
  const corpus = collectRouteSearchCorpus();
  if (els.routeSearchInfo) {
    if (query || modeFilterSet.size || frequencyFilterSet.size) {
      const globalCount = query ? state.globalRouteSearchResults.length : 0;
      els.routeSearchInfo.textContent = `${corpus.length} route(s) in view${
        globalCount ? ` · ${globalCount} elsewhere` : ""
      }`;
    } else {
      els.routeSearchInfo.textContent = "";
    }
  }
  // Frequency comes from route_metadata, not tiles; fetch it for the corpus once.
  if (frequencyFilterSet.size) {
    const keys = corpus.map((feature) => featureLineProps(feature).lineKey).filter(Boolean);
    if (keys.some((key) => !state.frequencyByLineKey.has(key))) {
      ensureFrequencyMetadata(keys)
        .then(() => applyUnderlaySearchFilter())
        .catch(() => {});
    }
  }
  renderRouteSearchResults(corpus, {
    query,
    modeFilterSet,
    frequencyFilterSet,
    globalResults: state.globalRouteSearchResults
  });
}

async function ensureFrequencyMetadata(lineKeys) {
  const missing = Array.from(new Set(lineKeys)).filter(
    (key) => key && !state.frequencyByLineKey.has(key) && !state.frequencyFetchInFlight.has(key)
  );
  if (!missing.length) {
    return;
  }
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200);
    for (const key of chunk) {
      state.frequencyFetchInFlight.add(key);
    }
    try {
      const params = new URLSearchParams({ lineKeys: chunk.join(",") });
      const payload = await apiRequest(`/api/transit/route-headway/bulk?${params.toString()}`, { method: "GET" });
      const byKey = payload?.headwayByLineKey || {};
      for (const key of chunk) {
        state.frequencyByLineKey.set(key, String(byKey[key]?.frequencyBucket || "unknown").toLowerCase());
      }
    } catch {
      for (const key of chunk) {
        state.frequencyByLineKey.set(key, "unknown");
      }
    } finally {
      for (const key of chunk) {
        state.frequencyFetchInFlight.delete(key);
      }
    }
  }
}

// Refresh the coverage underlay for the current viewport while searching.
let underlayRefreshTimer = null;
function scheduleUnderlayRefresh() {
  if (underlayRefreshTimer) {
    clearTimeout(underlayRefreshTimer);
  }
  underlayRefreshTimer = setTimeout(() => {
    underlayRefreshTimer = null;
    updateUnderlay();
  }, 350);
}

async function loadCities() {
  try {
    const data = await fetch("/api/catalog/cities").then((r) => r.json());
    state.cities = Array.isArray(data.cities) ? data.cities : [];
  } catch {
    state.cities = [];
  }
}
