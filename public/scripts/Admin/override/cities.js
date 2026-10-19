// Admin Map Editor — city presets panel: creation, metadata, operators, routes, preview.
// City presets panel: operator rules + explicit route rules + per-route vetting
// ---------------------------------------------------------------------------

function describeCurrentView() {
  if (!state.map || !state.mapReady) {
    return null;
  }
  const center = state.map.getCenter();
  const zoom = state.map.getZoom();
  const bounds = state.map.getBounds();
  return {
    center: [Number(center.lng.toFixed(6)), Number(center.lat.toFixed(6))],
    zoom: Number(zoom.toFixed(2)),
    bbox: [
      Number(bounds.getWest().toFixed(6)),
      Number(bounds.getSouth().toFixed(6)),
      Number(bounds.getEast().toFixed(6)),
      Number(bounds.getNorth().toFixed(6))
    ]
  };
}

function updateNewCityView() {
  if (!els.newCityView) {
    return;
  }
  const view = describeCurrentView();
  els.newCityView.textContent = view
    ? `Center ${view.center[0]}, ${view.center[1]} · zoom ${view.zoom} · bbox ${view.bbox.join(", ")}`
    : "Move the map to the city, then create it here.";
}

// City creation captures the current map view.
async function createCityFromView() {
  const slug = String(els.newCitySlug?.value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = String(els.newCityName?.value || "").trim() || slug;
  if (!slug) {
    setEditStatus(els.newCityStatus, "A slug is required.", true);
    return;
  }
  const view = describeCurrentView();
  if (!view) {
    setEditStatus(els.newCityStatus, "Map not ready yet.", true);
    return;
  }
  setEditStatus(els.newCityStatus, "Creating…");
  try {
    await apiRequest("/api/admin/cities", {
      method: "POST",
      body: {
        slug,
        name,
        center: view.center,
        bbox: view.bbox,
        defaultZoom: view.zoom,
        published: false
      }
    });
    setEditStatus(els.newCityStatus, `Created ${slug}.`);
    if (els.newCitySlug) els.newCitySlug.value = "";
    if (els.newCityName) els.newCityName.value = "";
    await loadCityPanelList();
    if (els.cityPanelSelect) {
      els.cityPanelSelect.value = slug;
    }
    await selectCityForPanel(slug);
    recordManualEdit("city", slug, "created from current map view");
  } catch (error) {
    setEditStatus(els.newCityStatus, `Failed: ${error.message}`, true);
  }
}

async function loadCityPanelList() {
  if (!els.cityPanelSelect) {
    return;
  }
  try {
    const payload = await apiRequest("/api/admin/cities", { method: "GET" });
    state.cityPanelList = Array.isArray(payload?.cities) ? payload.cities : [];
    const current = els.cityPanelSelect.value;
    els.cityPanelSelect.innerHTML = '<option value="">Select a city…</option>';
    for (const city of state.cityPanelList) {
      const option = document.createElement("option");
      option.value = city.slug;
      option.textContent = `${city.name || city.slug}${city.published ? "" : " (draft)"}`;
      els.cityPanelSelect.append(option);
    }
    if (current && state.cityPanelList.some((city) => city.slug === current)) {
      els.cityPanelSelect.value = current;
      await selectCityForPanel(current);
    }
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed to load cities: ${error.message}`, true);
  }
}

async function selectCityForPanel(slug) {
  const key = String(slug || "").trim();
  if (!key) {
    state.cityPanelCity = null;
    if (els.cityPanelBody) {
      els.cityPanelBody.hidden = true;
    }
    setCityPreview(false);
    return;
  }
  setEditStatus(els.cityPanelStatus, "Loading city…");
  try {
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(key)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || null;
    if (els.cityPanelBody) {
      els.cityPanelBody.hidden = !state.cityPanelCity;
    }
    // Keep any active preset preview in sync with the loaded city.
    setCityPreview(state.cityPreviewKeys instanceof Set && state.cityPanelCity);
    renderCityPanel();
    setEditStatus(els.cityPanelStatus, "");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed to load city: ${error.message}`, true);
  }
}

function cityRouteDisplayName(lineKey) {
  const feature = (state.underlayFeatures || []).find(
    (entry) => String(featureLineProps(entry).lineKey) === lineKey
  );
  if (feature) {
    return adminLineDisplayName(featureLineProps(feature)) || lineKey;
  }
  return lineKey;
}

// Preview the preset on the map: only the city's resolved routes render.
function setCityPreview(enabled) {
  const city = state.cityPanelCity;
  const on = Boolean(enabled) && city && Array.isArray(city.routeKeys);
  state.cityPreviewKeys = on ? new Set(city.routeKeys) : null;
  if (els.cityPreviewCb) {
    els.cityPreviewCb.checked = on;
  }
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
}

function renderCityPanel() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  if (els.cityPanelSummary) {
    const explicit = city.routes || [];
    const includedExplicit = explicit.filter((route) => route.included).length;
    const excludedExplicit = explicit.filter((route) => !route.included).length;
    els.cityPanelSummary.textContent =
      `${city.name || city.slug} · ${city.published ? "Published" : "Draft"} · ` +
      `${city.routeCount || 0} route(s) · ${(city.operators || []).length} operator rule(s) · ` +
      `${includedExplicit} included · ${excludedExplicit} excluded`;
  }
  renderCityOperators();
  renderCityRoutes();
  renderCitySelectedRoute();
  if (els.cityMetaName) {
    els.cityMetaName.value = city.name || "";
  }
  if (els.cityMetaPublished) {
    els.cityMetaPublished.checked = Boolean(city.published);
  }
  if (els.cityMetaPublishBtn) {
    els.cityMetaPublishBtn.hidden = true;
  }
}

function updateCityPublishButton() {
  const button = els.cityMetaPublishBtn;
  const checkbox = els.cityMetaPublished;
  if (!button || !checkbox || !state.cityPanelCity) {
    return;
  }
  const saved = Boolean(state.cityPanelCity.published);
  const current = Boolean(checkbox.checked);
  if (current === saved) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.textContent = current
    ? "Yes, publish this city (visible to users)"
    : "Yes, unpublish this city (keep as draft)";
}

async function saveCityMetadata() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  setEditStatus(els.cityMetaStatus, "Saving…");
  try {
    await apiRequest("/api/admin/cities", {
      method: "POST",
      body: {
        slug: city.slug,
        name: String(els.cityMetaName?.value || "").trim()
      }
    });
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || city;
    renderCityPanel();
    await loadCityPanelList();
    els.cityPanelSelect.value = city.slug;
    setEditStatus(els.cityMetaStatus, "Name updated.");
  } catch (error) {
    setEditStatus(els.cityMetaStatus, `Failed to save: ${error.message}`, true);
  }
}

async function saveCityPublish() {
  const city = state.cityPanelCity;
  if (!city) {
    return;
  }
  setEditStatus(els.cityMetaStatus, "Saving…");
  try {
    await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}/publish`, {
      method: "POST",
      body: { published: Boolean(els.cityMetaPublished?.checked) }
    });
    const payload = await apiRequest(`/api/admin/cities/${encodeURIComponent(city.slug)}`, { method: "GET" });
    state.cityPanelCity = payload?.city || city;
    renderCityPanel();
    await loadCityPanelList();
    els.cityPanelSelect.value = city.slug;
    setEditStatus(els.cityMetaStatus, "Publish state updated.");
  } catch (error) {
    setEditStatus(els.cityMetaStatus, `Failed to update publish state: ${error.message}`, true);
  }
}

function renderCitySelectedRoute() {
  const container = els.citySelectedRoute;
  if (!container) {
    return;
  }
  const city = state.cityPanelCity;
  const lineKey = String(state.selectedLineKey || "").trim();
  if (!city || !lineKey) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const explicit = (city.routes || []).find((route) => route.lineKey === lineKey) || null;
  const resolved = (city.routeKeys || []).includes(lineKey);

  container.hidden = false;
  container.innerHTML = "";

  const main = document.createElement("div");
  main.className = "city-member-main";
  const name = document.createElement("span");
  name.className = "city-member-name";
  name.textContent = cityRouteDisplayName(lineKey);
  const meta = document.createElement("span");
  meta.className = "city-member-meta";
  const sourceLabel = explicit
    ? explicit.included
      ? "Explicitly included"
      : "Excluded from this city"
    : resolved
      ? "Included via operator rule"
      : "Not part of this city";
  meta.textContent = `${lineKey} · ${sourceLabel}`;
  main.append(name, meta);

  const actions = document.createElement("div");
  actions.className = "city-actions-row";

  const selectedProps = state.selectedRouteFeature ? featureLineProps(state.selectedRouteFeature) : null;
  const operatorName = String(selectedProps?.operatorName || "").trim();
  const operatorRule = (city.operators || []).find((op) => op.operatorName === operatorName) || null;
  const operatorIncluded = Boolean(operatorRule) && operatorRule.included !== false;

  const explicitIncluded = explicit?.included === true;
  const explicitExcluded = Boolean(explicit) && !explicit.included;

  // Show only the applicable direction per entity, not both.
  const routeButton = document.createElement("button");
  routeButton.type = "button";
  routeButton.className = "btn btn-subtle";
  if (explicitIncluded) {
    routeButton.textContent = "Exclude route";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: false }]));
  } else if (explicitExcluded) {
    routeButton.textContent = "Include route";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: true }]));
  } else if (operatorIncluded) {
    routeButton.textContent = "Exclude route";
    routeButton.title = "Exclude just this route; the operator rule stays";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: false }]));
  } else {
    routeButton.textContent = "Include route";
    routeButton.addEventListener("click", () => patchCityRoutes([{ lineKey, included: true }]));
  }
  actions.append(routeButton);

  if (operatorName) {
    const opButton = document.createElement("button");
    opButton.type = "button";
    opButton.className = "btn btn-subtle";
    if (operatorIncluded) {
      opButton.textContent = `Exclude operator: ${operatorName}`;
      opButton.title = `Remove every route by ${operatorName} from this city`;
      opButton.addEventListener("click", () => patchCityOperators([{ operatorName, included: false }]));
    } else {
      opButton.textContent = `Include operator: ${operatorName}`;
      opButton.title = `Include every current route by ${operatorName}`;
      opButton.addEventListener("click", () => patchCityOperators([{ operatorName, included: true }]));
    }
    actions.append(opButton);
  }

  container.append(main, actions);
}

function renderCityOperators() {
  const container = els.cityOperatorsList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const operators = state.cityPanelCity?.operators || [];
  if (!operators.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No operator rules yet. Search below to add one.";
    container.append(p);
    return;
  }
  operators.forEach((operator) => {
    const row = document.createElement("div");
    row.className = "city-member-row" + (operator.included ? "" : " is-excluded");

    const main = document.createElement("div");
    main.className = "city-member-main";
    const name = document.createElement("span");
    name.className = "city-member-name";
    name.textContent = operator.operatorName;
    const meta = document.createElement("span");
    meta.className = "city-member-meta";
    meta.textContent = operator.included ? "All current routes included" : "Excluded";
    main.append(name, meta);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-subtle";
    toggle.textContent = operator.included ? "Exclude" : "Include";
    toggle.addEventListener("click", () =>
      patchCityOperators([{ operatorName: operator.operatorName, included: !operator.included }])
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "city-remove-rule";
    remove.textContent = "Remove rule";
    remove.title = "Delete this operator rule (routes may still be added by other rules)";
    remove.addEventListener("click", () => {
      const remaining = operators
        .filter((entry) => entry.operatorName !== operator.operatorName)
        .map((entry) => ({ operatorName: entry.operatorName, included: entry.included }));
      setCityOperators(remaining);
    });

    row.append(main, toggle, remove);
    container.append(row);
  });
}

function renderCityRoutes() {
  const container = els.cityRoutesList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const routes = state.cityPanelCity?.routes || [];
  if (!routes.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No explicit route rules. Use “Include selected” to add a single route.";
    container.append(p);
    return;
  }
  const sorted = [...routes].sort((a, b) => {
    if (a.included !== b.included) return a.included ? -1 : 1;
    return a.lineKey.localeCompare(b.lineKey);
  });

  sorted.forEach((route) => {
    const row = document.createElement("div");
    row.className = "city-member-row" + (route.included ? "" : " is-excluded");

    const main = document.createElement("div");
    main.className = "city-member-main";
    const name = document.createElement("span");
    name.className = "city-member-name";
    name.textContent = cityRouteDisplayName(route.lineKey);
    const meta = document.createElement("span");
    meta.className = "city-member-meta";
    meta.textContent = `${route.lineKey} · ${route.included ? "Included" : "Excluded"}`;
    main.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "city-actions-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-subtle";
    toggle.textContent = route.included ? "Exclude" : "Include";
    toggle.addEventListener("click", () =>
      patchCityRoutes([{ lineKey: route.lineKey, included: !route.included }])
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "city-remove-rule";
    remove.textContent = "Remove rule";
    remove.title = "Delete this route rule; an operator rule can add the route again";
    remove.addEventListener("click", () => removeCityRoute(route.lineKey));

    actions.append(toggle, remove);
    row.append(main, actions);
    container.append(row);
  });
}

function applyCityResponse(payload) {
  if (payload?.city) {
    state.cityPanelCity = payload.city;
    renderCityPanel();
    if (state.cityPreviewKeys instanceof Set) {
      setCityPreview(true);
    }
  }
}

async function patchCityRoutes(routes) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/routes`,
      { method: "PATCH", body: { routes } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, "Route rules updated.");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function removeCityRoute(lineKey) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/routes/remove`,
      { method: "POST", body: { lineKeys: [lineKey] } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, `Removed ${lineKey}.`);
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function patchCityOperators(operators) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/operators`,
      { method: "PATCH", body: { operators } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, "Operator rules updated.");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function setCityOperators(operators) {
  if (!state.cityPanelCity) return;
  try {
    const payload = await apiRequest(
      `/api/admin/cities/${encodeURIComponent(state.cityPanelCity.slug)}/operators`,
      { method: "POST", body: { operators, replace: true } }
    );
    applyCityResponse(payload);
    setEditStatus(els.cityPanelStatus, "Operator rules updated.");
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Failed: ${error.message}`, true);
  }
}

async function searchCityOperators() {
  const query = String(els.cityOperatorSearchInput?.value || "").trim();
  if (!query || !els.cityOperatorResults) {
    return;
  }
  setEditStatus(els.cityPanelStatus, "Searching operators…");
  try {
    const payload = await apiRequest(`/api/admin/operators?q=${encodeURIComponent(query)}`, { method: "GET" });
    const operators = Array.isArray(payload?.operators) ? payload.operators : [];
    els.cityOperatorResults.innerHTML = "";
    if (!operators.length) {
      const p = document.createElement("p");
      p.className = "microcopy";
      p.textContent = "No operators matched.";
      els.cityOperatorResults.append(p);
      return;
    }
    const existing = new Set((state.cityPanelCity?.operators || []).map((entry) => entry.operatorName));
    for (const operator of operators.slice(0, 40)) {
      const row = document.createElement("div");
      row.className = "admin-route-result-row";
      const name = document.createElement("span");
      name.className = "admin-route-select-name";
      name.textContent = operator.operatorName;
      const meta = document.createElement("span");
      meta.className = "admin-route-select-meta";
      meta.textContent = `${operator.routeCount} routes`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn";
      add.textContent = existing.has(operator.operatorName) ? "Added" : "Add";
      add.disabled = existing.has(operator.operatorName);
      add.addEventListener("click", () => {
        add.disabled = true;
        patchCityOperators([{ operatorName: operator.operatorName, included: true }]);
      });
      row.append(name, meta, add);
      els.cityOperatorResults.append(row);
    }
    setEditStatus(els.cityPanelStatus, `${operators.length} operator(s) matched.`);
  } catch (error) {
    setEditStatus(els.cityPanelStatus, `Search failed: ${error.message}`, true);
  }
}

function includeSelectedRouteInCity() {
  if (!state.selectedLineKey) {
    setEditStatus(els.cityPanelStatus, "Select a route on the map first.", true);
    return;
  }
  patchCityRoutes([{ lineKey: state.selectedLineKey, included: true }]);
}

function excludeSelectedRouteInCity() {
  if (!state.selectedLineKey) {
    setEditStatus(els.cityPanelStatus, "Select a route on the map first.", true);
    return;
  }
  patchCityRoutes([{ lineKey: state.selectedLineKey, included: false }]);
}

// Add an operator rule for every operator currently rendered in the viewport.
async function addVisibleOperatorsToCity() {
  if (!state.cityPanelCity) {
    setEditStatus(els.cityPanelStatus, "Select a city first.", true);
    return;
  }
  const features = state.map && state.mapReady
    ? state.map.queryRenderedFeatures({ layers: ["routes-main"] })
    : [];
  const names = new Set();
  for (const feature of features) {
    const name = String(feature.properties?.operator_name || "").trim();
    if (name) {
      names.add(name);
    }
  }
  const existing = new Set((state.cityPanelCity.operators || []).map((entry) => entry.operatorName));
  const toAdd = Array.from(names).filter((name) => !existing.has(name));
  if (!toAdd.length) {
    setEditStatus(els.cityPanelStatus, "No new operators in the current view.", true);
    return;
  }
  await patchCityOperators(toAdd.map((operatorName) => ({ operatorName, included: true })));
  setEditStatus(els.cityPanelStatus, `Added ${toAdd.length} operator rule(s) from the view.`);
}
