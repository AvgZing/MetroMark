// Admin Map Editor — save/delete route overrides, map highlights.
// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

async function saveRouteEdits() {
  if (!state.selectedLineKey) {
    return;
  }
  const lineKey = state.selectedLineKey;

  // Merge so fields this form doesn't own (custom stops) survive.
  let payload = {};
  try {
    const existing = await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "GET" });
    payload = existing?.override?.payload || {};
  } catch {
    payload = {};
  }

  const name = String(els.routeName.value || "").trim();
  const short = String(els.routeShortName.value || "").trim();
  const long = String(els.routeLongName.value || "").trim();
  const operator = String(els.routeOperator.value || "").trim();
  const modeRaw = String(els.routeMode.value || "").trim();
  const color = String(els.routeColor.value || "").trim();
  const ordering = String(els.routeOrdering.value || "").trim();
  const frequency = String(els.routeFrequency?.value || "").trim();
  const frequencyMinutes = Number(els.routeFrequencyMinutes?.value);

  if (name) payload.lineName = name;
  else delete payload.lineName;
  if (short) payload.lineShortName = short;
  else delete payload.lineShortName;
  if (long) payload.lineLongName = long;
  else delete payload.lineLongName;
  if (operator) payload.operatorName = operator;
  else delete payload.operatorName;
  if (modeRaw) payload.mode = Number(modeRaw);
  else delete payload.mode;
  if (color) payload.color = color;
  else delete payload.color;
  if (ordering) payload.orderingMode = ordering;
  else delete payload.orderingMode;
  if (frequency === "__default__") {
    delete payload.frequencyBucket;
    delete payload.headwayBestMinutes;
  } else if (frequency) {
    payload.frequencyBucket = frequency;
  }
  if (frequency !== "__default__" && Number.isFinite(frequencyMinutes) && frequencyMinutes > 0) {
    payload.headwayBestMinutes = Math.round(frequencyMinutes);
  } else if (frequency === "__default__") {
    delete payload.headwayBestMinutes;
  }

  const mergedKeys = (state.selectedMergedKeys || []).filter((key) => key && key !== lineKey);
  if (mergedKeys.length) {
    payload.mergedLineKeys = mergedKeys;
  } else {
    delete payload.mergedLineKeys;
  }

  try {
    // Emptied payload deletes the override instead of leaving an empty row.
    const result =
      Object.keys(payload).length === 0
        ? await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "DELETE" }).then(() => ({ override: null }))
        : await apiRequest("/api/admin/overrides/route", {
            method: "POST",
            body: { lineKey, citySlug: state.currentCitySlug, payload }
          });

    setEditStatus(els.routeEditStatus, "Route changes saved.");
    setEditStatus(els.mergeRouteStatus, "");
    clearRouteDirty("route");

    // Problematic geometry is managed from the Problematic geometries panel.
    const problematicActive = Boolean(els.routeProblematic?.checked);
    recordManualEdit(
      "route",
      `${lineKey}${name ? " · " + name : ""}`,
      [
        color ? `color ${color}` : "",
        ordering ? `ordering ${ordering}` : "",
        frequency === "__default__" ? "frequency cleared" : frequency ? `frequency ${frequency}` : "",
        modeRaw ? `mode ${MODE_LABELS[Number(modeRaw)] || modeRaw}` : "",
        mergedKeys.length ? `merged with ${mergedKeys.join(", ")}` : "",
        problematicActive ? "disabled-by-default" : ""
      ]
        .filter(Boolean)
        .join(", ")
    );
    if (result.override) {
      addRouteHighlight(lineKey, result.override.payload || payload);
    } else {
      loadExistingEdits();
    }
    await loadOperatorsForViewport();
  } catch (error) {
    setEditStatus(els.routeEditStatus, error.message, true);
  }
}

async function deleteRouteOverride() {
  const lineKey = state.selectedLineKey;
  if (!lineKey) {
    return;
  }
  if (!window.confirm(`Delete the override for ${lineKey}? The route returns to harvested values.`)) {
    return;
  }
  if (els.deleteRouteOverrideBtn) {
    els.deleteRouteOverrideBtn.disabled = true;
  }
  try {
    await apiRequest(`/api/admin/overrides/route/${encodeURIComponent(lineKey)}`, { method: "DELETE" });
    recordManualEdit("route", `${lineKey} override`, "deleted");
    loadExistingEdits();
    if (state.selectedRouteFeature) {
      await selectRouteFromFeature(state.selectedRouteFeature, { force: true });
    }
    setEditStatus(els.routeEditStatus, "Override deleted; showing harvested values.");
  } catch (error) {
    setEditStatus(els.routeEditStatus, `Failed to delete override: ${error.message}`, true);
  } finally {
    if (els.deleteRouteOverrideBtn) {
      els.deleteRouteOverrideBtn.disabled = false;
    }
  }
}

// Recolor the saved route in place via feature-state (no clipped overlay).
function addRouteHighlight(lineKey, payload) {
  if (!state.map || !lineKey) {
    return;
  }
  const color = String(payload?.color || "").trim();
  if (!color) {
    return;
  }
  try {
    state.map.setFeatureState(
      { source: "routes-vector", sourceLayer: "routes", id: lineKey },
      { color }
    );
  } catch {
    // route not in the loaded tileset
  }
}
