// Admin Map Editor — operator visibility, hidden/disabled route filters, viewport operator list.
// ---------------------------------------------------------------------------
// Operators (batch hide by default)
// ---------------------------------------------------------------------------

// Show hidden operators and disabled routes on the map.
function applyMapRouteVisibility({ hiddenOperators, disabledLineKeys } = {}) {
  if (!state.map || !state.mapReady) {
    return;
  }
  const operators = Array.from(hiddenOperators || []).filter(Boolean);
  const lineKeys = Array.from(disabledLineKeys || []).filter(Boolean);
  state.hiddenOperators = new Set(operators);
  state.disabledRouteKeys = new Set(lineKeys);

  const conditions = [];
  if (operators.length) {
    conditions.push(["!", ["in", ["get", "operator_name"], ["literal", operators]]]);
  }
  if (lineKeys.length) {
    conditions.push(["!", ["in", ["get", "line_key"], ["literal", lineKeys]]]);
  }
  // City preset preview: show only the resolved preset routes.
  if (state.cityPreviewKeys instanceof Set && state.cityPreviewKeys.size) {
    conditions.push(["in", ["get", "line_key"], ["literal", Array.from(state.cityPreviewKeys)]]);
  }
  // Problematic geometries are hidden for users by default; preview can reveal.
  if (state.problematicPreview !== false && state.problematicKeys instanceof Set && state.problematicKeys.size) {
    conditions.push(["!", ["in", ["get", "line_key"], ["literal", Array.from(state.problematicKeys)]]]);
  }
  const baseFilter = conditions.length === 0 ? null : conditions.length === 1 ? conditions[0] : ["all", ...conditions];

  // Merged members stay hidden even in "preview all" (preview only ignores
  // operator/disabled hides).
  const mergedMembers = state.mergeCanonicalByMember instanceof Map
    ? Array.from(state.mergeCanonicalByMember.keys())
    : [];
  const memberFilter = mergedMembers.length
    ? ["!", ["in", ["get", "line_key"], ["literal", mergedMembers]]]
    : null;
  let filter = state.visibilityPreviewAll ? null : baseFilter;
  if (memberFilter) {
    filter = filter ? ["all", filter, memberFilter] : memberFilter;
  }

  for (const id of ["routes-base-main", "routes-casing", "routes-main", "routes-hit"]) {
    if (state.map.getLayer(id)) {
      state.map.setFilter(id, filter);
    }
  }
}

async function loadAdminMerges() {
  try {
    const payload = await apiRequest("/api/admin/overrides/route", { method: "GET" });
    const byCanonical = new Map();
    const byMember = new Map();
    for (const row of payload?.overrides || []) {
      const members = Array.isArray(row?.payload?.mergedLineKeys) ? row.payload.mergedLineKeys.map(String) : [];
      if (members.length) {
        byCanonical.set(String(row.line_key), members);
        for (const member of members) {
          byMember.set(member, String(row.line_key));
        }
      }
    }
    state.mergeMembersByCanonical = byCanonical;
    state.mergeCanonicalByMember = byMember;
  } catch {
    // ignore
  }
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
}

function setVisibilityPreviewAll(enabled) {
  state.visibilityPreviewAll = Boolean(enabled);
  if (els.operatorPreviewAllCb) {
    els.operatorPreviewAllCb.checked = !state.visibilityPreviewAll;
  }
  applyMapRouteVisibility({
    hiddenOperators: state.hiddenOperators,
    disabledLineKeys: state.disabledRouteKeys
  });
}

async function loadOperatorsForViewport() {
  // Source query (not rendered): hidden operators must stay listed/toggleable.
  const features = state.map && state.mapReady
    ? state.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" })
    : [];
  const operatorNames = new Set();
  for (const feature of features) {
    const name = String(feature.properties?.operator_name || "").trim();
    if (name) {
      operatorNames.add(name);
    }
  }

  let reviews = [];
  let disabledRouteKeys = new Set();
  try {
    if (state.currentCitySlug) {
      const [agencyPayload, routePayload] = await Promise.all([
        apiRequest(`/api/admin/reviews/agencies?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" }),
        apiRequest(`/api/admin/reviews/route?citySlug=${encodeURIComponent(state.currentCitySlug)}`, { method: "GET" })
      ]);
      reviews = Array.isArray(agencyPayload.reviews) ? agencyPayload.reviews : [];
      disabledRouteKeys = new Set(
        (Array.isArray(routePayload.reviews) ? routePayload.reviews : [])
          .filter((review) => review.problematic_override === true)
          .map((review) => String(review.line_key || "").trim())
          .filter(Boolean)
      );
    }
  } catch {
    reviews = [];
  }
  const reviewByOperator = new Map(reviews.map((r) => [r.operator_name, r]));

  const hiddenOperators = new Set(
    reviews
      .filter((r) => r.allowed_override === false)
      .map((r) => String(r.operator_name || "").trim())
      .filter(Boolean)
  );
  applyMapRouteVisibility({ hiddenOperators, disabledLineKeys: disabledRouteKeys });

  els.operatorList.innerHTML = "";
  const names = Array.from(operatorNames).sort();
  if (!names.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No operators in the current viewport (zoom in).";
    els.operatorList.append(p);
    return;
  }

  for (const name of names) {
    const review = reviewByOperator.get(name);
    const hidden = review?.allowed_override === false;

    const row = document.createElement("div");
    row.className = "operator-row";

    const label = document.createElement("span");
    label.textContent = name;
    label.title = hidden ? "Currently hidden by default" : "Currently shown by default";

    const toggle = document.createElement("label");
    toggle.className = "switch";
    toggle.title = hidden ? "Hidden by default" : "Shown by default";
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = !hidden;
    toggleInput.addEventListener("change", async () => {
      const nextHidden = !toggleInput.checked;
      toggleInput.disabled = true;
      try {
        await apiRequest("/api/admin/reviews/agencies", {
          method: "POST",
          body: {
            citySlug: state.currentCitySlug,
            operatorName: name,
            allowedOverride: nextHidden ? false : null
          }
        });
        recordManualEdit(
          "agency",
          name,
          nextHidden ? "Hidden by default (users can re-enable)" : "Un-hidden (default shown)"
        );
        await loadOperatorsForViewport();
      } catch (error) {
        toggleInput.checked = !toggleInput.checked;
        setEditStatus(els.routeEditStatus || els.stationEditStatus, error.message, true);
      } finally {
        toggleInput.disabled = false;
      }
    });
    const toggleSlider = document.createElement("span");
    toggleSlider.className = "switch-slider";
    toggle.append(toggleInput, toggleSlider);

    row.append(label, toggle);
    els.operatorList.append(row);
  }
}
