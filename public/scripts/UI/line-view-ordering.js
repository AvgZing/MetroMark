function lineViewOrderingModeLabel(mode) {
  const normalizedMode = normalizeLineViewOrderingMode(mode);

  if (normalizedMode === "auto") {
    return "Auto";
  }

  if (normalizedMode === "geometry-revised") {
    return "Main";
  }

  if (normalizedMode === "legacy-geometry") {
    return "U-Shape";
  }

  if (normalizedMode === "fractions") {
    return "Loop";
  }

  return "Main";
}

function lineViewOrderingTechnicalLabel(mode) {
  const normalizedMode = normalizeLineViewOrderingMode(mode);

  if (normalizedMode === "auto") {
    return "Automatic route-shape detection";
  }

  if (normalizedMode === "geometry-revised") {
    return "Geometry Revised Endpoint Anchored";
  }

  if (normalizedMode === "legacy-geometry") {
    return "Trip Pattern Geometry";
  }

  if (normalizedMode === "fractions") {
    return "Fractions Only";
  }

  return "Geometry Revised Endpoint Anchored";
}

function lineViewOrderingStatusLabel() {
  var mode = normalizeLineViewOrderingMode(appState.lineViewOrderingMode);
  var resolvedMode = normalizeLineViewOrderingMode(appState.lineViewOrderingResolved || mode);
  var activeMode = mode === "auto" ? resolvedMode : mode;

  var focusedLineKey = String(appState.lineViewLineKey || appState.focusedLineKey || "").trim();
  var focusedLine = null;
  if (focusedLineKey && Array.isArray(appState.lineSummaries)) {
    focusedLine = appState.lineSummaries.find(function(l) { return String(l.lineKey || "").trim() === focusedLineKey; }) || null;
  }

  var adminMode = focusedLine ? String(focusedLine.lineViewOrderingAdminMode || "").trim() : "";
  var voteCounts = (focusedLine && focusedLine.lineViewOrderingVoteCounts) ? focusedLine.lineViewOrderingVoteCounts : {};

  var label = mode === "auto"
    ? "Auto - " + lineViewOrderingModeLabel(activeMode) + " (" + lineViewOrderingTechnicalLabel(activeMode) + ")"
    : lineViewOrderingModeLabel(activeMode) + " (" + lineViewOrderingTechnicalLabel(activeMode) + ")";

  var voteSuffix = "";
  if (adminMode === activeMode) {
    voteSuffix = " (A)";
  } else {
    var count = Number(voteCounts[activeMode] || 0);
    voteSuffix = " (" + count + ")";
  }

  if (appState.lineViewOrderingReversed) {
    label = label + " \u00B7 Reversed Route";
  }
  return label + voteSuffix;
}

function getLineViewOrderingPreference(lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const stored = appState.lineViewOrderingPreferencesByLineKey.get(normalizedLineKey);
  if (!stored) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  return {
    mode: normalizeLineViewOrderingMode(stored.mode),
    reversed: Boolean(stored.reversed)
  };
}

function setLineViewOrderingPreference(lineKey, preference = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return {
      mode: "auto",
      reversed: false
    };
  }

  const current = getLineViewOrderingPreference(normalizedLineKey);
  const nextPreference = {
    mode: normalizeLineViewOrderingMode(
      Object.prototype.hasOwnProperty.call(preference, "mode") ? preference.mode : current.mode
    ),
    reversed: Object.prototype.hasOwnProperty.call(preference, "reversed")
      ? Boolean(preference.reversed)
      : Boolean(current.reversed)
  };

  appState.lineViewOrderingPreferencesByLineKey.set(normalizedLineKey, nextPreference);
  persistLineViewOrderingPreferencesToStorage(
    LINE_VIEW_ORDERING_PREFERENCES_STORAGE_KEY,
    appState.lineViewOrderingPreferencesByLineKey
  );

  return nextPreference;
}

function applyLineViewOrderingPreference(lineKey) {
  const preference = getLineViewOrderingPreference(lineKey);
  appState.lineViewOrderingMode = preference.mode;
  appState.lineViewOrderingReversed = Boolean(preference.reversed);
  return preference;
}

function lineViewOrderingVoteModeForCurrentState() {
  const selectedMode = normalizeLineViewOrderingMode(appState.lineViewOrderingMode);
  if (selectedMode !== "auto") {
    return selectedMode;
  }

  return normalizeLineViewOrderingMode(appState.lineViewOrderingResolved || "geometry-revised");
}

function updateRouteOrderingMetadataForLine(lineKey, metadata = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey || !metadata || typeof metadata !== "object") {
    return;
  }

  const nextLineSummaries = appState.lineSummaries.map((line) => {
    if (String(line?.lineKey || "").trim() !== normalizedLineKey) {
      return line;
    }

    return {
      ...line,
      lineViewOrderingDefaultMode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
      lineViewOrderingDefaultSource: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
      lineViewOrderingAdminMode: String(metadata.orderingModeAdminMode || "").trim(),
      lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
      lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
    };
  });

  appState.lineSummaries = nextLineSummaries;

  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    appState.loadedLineSummaries = appState.loadedLineSummaries.map((line) => {
      if (String(line?.lineKey || "").trim() !== normalizedLineKey) {
        return line;
      }

      return {
        ...line,
        lineViewOrderingDefaultMode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
        lineViewOrderingDefaultSource: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
        lineViewOrderingAdminMode: String(metadata.orderingModeAdminMode || "").trim(),
        lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
        lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
      };
    });
  }

  if (appState.transit?.routesGeoJson?.features) {
    appState.transit.routesGeoJson.features = appState.transit.routesGeoJson.features.map((feature) => {
      if (String(feature?.properties?.line_key || "").trim() !== normalizedLineKey) {
        return feature;
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          line_view_ordering_default_mode: String(metadata.orderingModeDefaultMode || "auto").trim() || "auto",
          line_view_ordering_default_source: String(metadata.orderingModeDefaultSource || "auto").trim() || "auto",
          line_view_ordering_admin_mode: String(metadata.orderingModeAdminMode || "").trim(),
          line_view_ordering_vote_total: Number(metadata.orderingModeVoteTotal || 0)
        }
      };
    });
  }
}

/** Submit an authenticated route ordering preference vote for a line. */
async function submitLineViewOrderingVote(lineKey, orderingMode) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedMode = normalizeLineViewOrderingMode(orderingMode);
  if (!normalizedLineKey || normalizedMode === "auto" || !appState.user) {
    return null;
  }

  const payload = await apiRequest("/api/transit/route-ordering/vote", {
    method: "POST",
    body: {
      lineKey: normalizedLineKey,
      citySlug: String(appState.initialCitySlug || "").trim(),
      orderingMode: normalizedMode
    }
  });

  if (payload?.metadata) {
    updateRouteOrderingMetadataForLine(normalizedLineKey, payload.metadata);
  }

  if (appState.lineViewOpen && String(appState.lineViewLineKey || "").trim() === normalizedLineKey) {
    renderLineView();
  }

  return payload;
}

function noteLineViewOrderingVoteClick(lineKey, stopKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedStopKey = String(stopKey || "").trim();
  if (!normalizedLineKey || !normalizedStopKey || !appState.user) {
    return;
  }

  let clickSet = appState.lineViewOrderingVoteClickSetsByLineKey.get(normalizedLineKey);
  if (!clickSet) {
    clickSet = new Set();
    appState.lineViewOrderingVoteClickSetsByLineKey.set(normalizedLineKey, clickSet);
  }

  if (clickSet.has(normalizedStopKey)) {
    return;
  }

  clickSet.add(normalizedStopKey);
  if (clickSet.size < 2) {
    return;
  }

  clickSet.clear();
  const voteMode = lineViewOrderingVoteModeForCurrentState();
  if (!voteMode || voteMode === "auto") {
    return;
  }

  submitLineViewOrderingVote(normalizedLineKey, voteMode).catch((error) => {
    console.warn("Unable to record route ordering vote:", error);
  });
}

/** Sync the route ordering mode buttons and reversed toggle with current appState. */
function syncLineViewOrderingControls() {
  const mode = normalizeLineViewOrderingMode(appState.lineViewOrderingMode);
  appState.lineViewOrderingMode = mode;

  const buttonByMode = {
    auto: dom.lineViewOrderingAutoBtn,
    "geometry-revised": dom.lineViewOrderingGeometryRevisedBtn,
    "legacy-geometry": dom.lineViewOrderingGeometryBtn,
    fractions: dom.lineViewOrderingFractionsBtn
  };

  const buttonLabelByMode = {
    auto: "Auto",
    "geometry-revised": "Main",
    "legacy-geometry": "U-Shape",
    fractions: "Loop"
  };

  const buttonTitleByMode = {
    auto: "Automatic route-shape detection",
    "geometry-revised": "Geometry Revised Endpoint Anchored",
    "legacy-geometry": "Trip Pattern Geometry",
    fractions: "Fractions Only"
  };

  for (const [buttonMode, button] of Object.entries(buttonByMode)) {
    if (!button) {
      continue;
    }

    const isActive = buttonMode === mode;
    button.textContent = buttonLabelByMode[buttonMode] || button.textContent;
    button.title = buttonTitleByMode[buttonMode] || button.title || "";
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (dom.lineViewOrderingReverseBtn) {
    const isActive = Boolean(appState.lineViewOrderingReversed);
    dom.lineViewOrderingReverseBtn.textContent = "Reverse Route";
    dom.lineViewOrderingReverseBtn.title = "Reverse the current stop order";
    dom.lineViewOrderingReverseBtn.classList.toggle("is-active", isActive);
    dom.lineViewOrderingReverseBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (dom.lineViewOrderingResolved) {
    dom.lineViewOrderingResolved.textContent = lineViewOrderingStatusLabel();
  }
}
