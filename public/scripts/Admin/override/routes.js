// Admin Map Editor — route focus/highlight, review queue, suggestions, problematic geometries, deep-link route.
// ---------------------------------------------------------------------------
// Route browser: search/focus, per-route refresh/remove, add from Transitland
// ---------------------------------------------------------------------------

function routeFeatureBounds(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const parts =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const part of parts) {
    if (!Array.isArray(part)) {
      continue;
    }
    for (const coord of part) {
      if (!Array.isArray(coord) || coord.length < 2) {
        continue;
      }
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon)) {
    return null;
  }
  return [[minLon, minLat], [maxLon, maxLat]];
}

function focusRouteFeature(feature) {
  const bounds = routeFeatureBounds(feature);
  if (bounds && state.map) {
    state.map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 300 });
  }
  selectRouteFromFeature(feature);
}

// Dim every route except the focused one (and its merge members) and darken the
// surrounding map, so the selected route stays surfaced like in the app.
function setAdminFocusState(focusedKey) {
  if (!state.map || typeof state.map.querySourceFeatures !== "function") {
    return;
  }
  let features = [];
  try {
    features = state.map.querySourceFeatures("routes-vector", { sourceLayer: "routes" });
  } catch {
    features = [];
  }
  const key = String(focusedKey || "").trim();
  const members = key && state.mergeMembersByCanonical instanceof Map
    ? state.mergeMembersByCanonical.get(key) || []
    : [];
  const group = new Set([key, ...members].filter(Boolean));
  const present = new Set();
  for (const feature of features) {
    const lineKey = String(feature?.properties?.line_key || "").trim();
    if (lineKey) {
      present.add(lineKey);
    }
  }
  // Focus only applies while the route is in the loaded tiles, so panning away
  // shows the normal map instead of an all-dimmed one.
  const hasFocus = Boolean(key) && Array.from(group).some((candidate) => present.has(candidate));
  for (const lineKey of present) {
    try {
      state.map.setFeatureState(
        { source: "routes-vector", sourceLayer: "routes", id: lineKey },
        { focused: !hasFocus || group.has(lineKey) ? 1 : 0 }
      );
    } catch {
      // feature not in the loaded tileset
    }
  }
  state.adminFocusActive = hasFocus;
  setAdminFocusMask(hasFocus);
}

function highlightRouteOnMap(feature) {
  if (!state.map) {
    return;
  }
  const props = feature ? featureLineProps(feature) : null;
  setAdminFocusState(props ? props.lineKey : "");
}

function clearRouteHighlight() {
  if (!state.map) {
    return;
  }
  setAdminFocusState("");
}

// ?lineKey=... focuses and highlights that route.
async function focusRouteByLineKey(lineKey) {
  const key = String(lineKey || "").trim();
  if (!key) {
    return;
  }
  try {
    const payload = await apiRequest(`/api/admin/routes/geometry?lineKey=${encodeURIComponent(key)}`, { method: "GET" });
    const feature = payload?.feature;
    if (!feature || !feature.geometry) {
      throw new Error("not in the archive");
    }
    focusRouteFeature(feature);
    showAdminAction(`Showing ${key} on the map.`);
  } catch (error) {
    showAdminAction(`Could not show ${key}: ${error.message}`, true);
  }
}

function reviewRow(mainText) {
  const row = document.createElement("div");
  row.className = "review-row";
  const main = document.createElement("span");
  main.className = "review-main";
  main.textContent = mainText;
  row.append(main);
  return row;
}

function reviewButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-subtle";
  button.textContent = label;
  if (title) {
    button.title = title;
  }
  button.addEventListener("click", onClick);
  return button;
}

// Review surfaces (flags / issues / suggestions) live in the Map Editor where the
// map is visible; the Console is for site/API health only.
async function loadReviewQueue() {
  const flagsEl = els.flagsReviewList;
  const issuesEl = els.issuesReviewList;
  const suggestionsEl = els.suggestionsReviewList;
  const statusEl = els.reviewQueueStatus;
  if (!flagsEl) {
    return;
  }
  setEditStatus(statusEl, "Loading review queue…");
  try {
    const [flagsPayload, issuesPayload, suggestionsPayload] = await Promise.all([
      apiRequest("/api/admin/reharvest/flags?status=open", { method: "GET" }),
      apiRequest("/api/admin/issues?status=open", { method: "GET" }),
      apiRequest("/api/admin/suggestions?status=open", { method: "GET" })
    ]);
    const flags = Array.isArray(flagsPayload?.flags) ? flagsPayload.flags : [];
    const issues = Array.isArray(issuesPayload?.issues) ? issuesPayload.issues : [];
    const suggestions = Array.isArray(suggestionsPayload?.suggestions) ? suggestionsPayload.suggestions : [];

    flagsEl.innerHTML = "";
    issuesEl.innerHTML = "";
    suggestionsEl.innerHTML = "";

    if (!flags.length) {
      flagsEl.innerHTML = "<p class='microcopy'>None.</p>";
    }
    for (const flag of flags) {
      const row = reviewRow(`${flag.kind || "flag"} · ${flag.lineKey || flag.stationKey || ""} · ${flag.message || ""}`);
      if (flag.lineKey) {
        row.append(reviewButton("View Error", "Show this route on the map", () => focusRouteByLineKey(flag.lineKey)));
      }
      row.append(
        reviewButton("Close Issue", "Close this flag — does not change the route", async () => {
          try {
            await apiRequest(`/api/admin/reharvest/flags/${flag.id}/resolve`, { method: "POST" });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to dismiss flag: ${error.message}`, true);
          }
        })
      );
      flagsEl.append(row);
    }

    if (!issues.length) {
      issuesEl.innerHTML = "<p class='microcopy'>None.</p>";
    }
    for (const issue of issues) {
      const row = reviewRow(`#${issue.id} · ${issue.reporterName || issue.reporterEmail || "guest"} · ${issue.description || ""}`);
      if (Array.isArray(issue.bbox) && issue.bbox.length === 4 && state.map) {
        row.append(
          reviewButton("Show", "Jump to the reported area", () => {
            const bbox = issue.bbox.map(Number);
            state.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: 15 });
          })
        );
      }
      row.append(
        reviewButton("Resolve", "Mark this report resolved", async () => {
          try {
            await apiRequest(`/api/admin/issues/${issue.id}/resolve`, { method: "POST" });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to resolve report: ${error.message}`, true);
          }
        })
      );
      issuesEl.append(row);
    }

    if (!suggestions.length) {
      suggestionsEl.innerHTML = "<p class='microcopy'>None.</p>";
    }
    for (const suggestion of suggestions) {
      const changes = Object.entries(suggestion.payload || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      const row = reviewRow(`#${suggestion.id} · ${suggestion.lineKey} · ${changes}`);
      row.append(reviewButton("Show", "Preview the suggested changes on this route", () => showSuggestion(suggestion)));
      row.append(
        reviewButton("Accept", "Apply these fields to the route override", async () => {
          try {
            await apiRequest(`/api/admin/suggestions/${suggestion.id}/resolve`, {
              method: "POST",
              body: { status: "applied" }
            });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to accept: ${error.message}`, true);
          }
        })
      );
      row.append(
        reviewButton("Deny", "Discard this suggestion", async () => {
          try {
            await apiRequest(`/api/admin/suggestions/${suggestion.id}/resolve`, {
              method: "POST",
              body: { status: "denied" }
            });
            loadReviewQueue();
          } catch (error) {
            setEditStatus(statusEl, `Failed to deny: ${error.message}`, true);
          }
        })
      );
      suggestionsEl.append(row);
    }

    if (els.reviewQueueBadge) {
      const total = flags.length + issues.length + suggestions.length;
      els.reviewQueueBadge.hidden = total === 0;
      els.reviewQueueBadge.textContent = String(total);
    }
  } catch (error) {
    setEditStatus(statusEl, `Failed to load review queue: ${error.message}`, true);
  }
}

const SUGGESTION_FIELD_INPUTS = {
  lineShortName: "routeShortName",
  lineLongName: "routeLongName",
  lineName: "routeName",
  operatorName: "routeOperator",
  color: "routeColor",
  mode: "routeMode",
  frequencyBucket: "routeFrequency",
  headwayBestMinutes: "routeFrequencyMinutes"
};

async function showSuggestion(suggestion) {
  state.pendingSuggestion = {
    lineKey: String(suggestion.lineKey || "").trim(),
    payload: suggestion.payload || {}
  };
  await focusRouteByLineKey(suggestion.lineKey);
}

// Overlay the suggestion's fields into the route editor and highlight them, so
// the admin sees exactly what the suggestion would change.
function applyActiveSuggestion(lineKey) {
  for (const id of Object.values(SUGGESTION_FIELD_INPUTS)) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("is-suggested");
    }
  }
  const pending = state.pendingSuggestion;
  if (!pending || pending.lineKey !== String(lineKey || "").trim()) {
    return;
  }
  for (const [field, value] of Object.entries(pending.payload || {})) {
    const id = SUGGESTION_FIELD_INPUTS[field];
    const el = id ? document.getElementById(id) : null;
    if (!el) {
      continue;
    }
    el.value = String(value);
    el.classList.add("is-suggested");
  }
  state.pendingSuggestion = null;
}

async function loadProblematicRoutes() {
  const container = els.problematicList;
  if (!container) {
    return;
  }
  setEditStatus(els.problematicStatus, "Loading…");
  try {
    const query = state.currentCitySlug ? `?citySlug=${encodeURIComponent(state.currentCitySlug)}` : "";
    const payload = await apiRequest(`/api/admin/reviews/route${query}`, { method: "GET" });
    const flagged = (payload?.reviews || []).filter(
      (row) => row.problematic_override === true || row.problematicOverride === true
    );
    state.problematicKeys = new Set(
      flagged.map((row) => String(row.line_key || row.lineKey || "").trim()).filter(Boolean)
    );
    applyMapRouteVisibility({
      hiddenOperators: state.hiddenOperators,
      disabledLineKeys: state.disabledRouteKeys
    });
    container.innerHTML = "";
    if (!flagged.length) {
      container.innerHTML = "<p class='microcopy'>None.</p>";
      setEditStatus(els.problematicStatus, "");
      return;
    }
    for (const row of flagged) {
      const key = String(row.line_key || row.lineKey || "").trim();
      if (!key) {
        continue;
      }
      const item = reviewRow(`${cityRouteDisplayName(key)} (${key})`);
      item.append(reviewButton("Show", "Show this route on the map", () => focusRouteByLineKey(key)));
      item.append(
        reviewButton("Unflag", "Unhide this route for users", async () => {
          try {
            await apiRequest("/api/admin/reviews/route", {
              method: "POST",
              body: { lineKey: key, citySlug: state.currentCitySlug, problematicOverride: null }
            });
            loadProblematicRoutes();
          } catch (error) {
            setEditStatus(els.problematicStatus, `Failed to unflag: ${error.message}`, true);
          }
        })
      );
      container.append(item);
    }
    setEditStatus(els.problematicStatus, "");
    renderProblematicSelectedRow();
  } catch (error) {
    setEditStatus(els.problematicStatus, `Failed to load: ${error.message}`, true);
  }
}

// Per-selected-route flag/unflag, like the city include/exclude row.
function renderProblematicSelectedRow() {
  const container = els.problematicSelectedRow;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const lineKey = String(state.selectedLineKey || "").trim();
  if (!lineKey) {
    return;
  }
  const flagged = state.problematicKeys instanceof Set && state.problematicKeys.has(lineKey);
  const row = reviewRow(`${cityRouteDisplayName(lineKey)} (${lineKey}) — ${flagged ? "hidden for users" : "shown to users"}`);
  row.append(
    reviewButton(
      flagged ? "Unflag" : "Flag as problematic",
      flagged ? "Unhide this route for users" : "Hide this route for users by default",
      async () => {
        try {
          await apiRequest("/api/admin/reviews/route", {
            method: "POST",
            body: { lineKey, citySlug: state.currentCitySlug, problematicOverride: flagged ? null : true }
          });
          loadProblematicRoutes();
        } catch (error) {
          setEditStatus(els.problematicStatus, `Failed: ${error.message}`, true);
        }
      }
    )
  );
  container.append(row);
}

function applyDeepLinkRoute() {
  const params = new URLSearchParams(window.location.search);
  const lineKey = String(params.get("lineKey") || "").trim();
  if (!lineKey) {
    return;
  }
  apiRequest(`/api/admin/routes/geometry?lineKey=${encodeURIComponent(lineKey)}`, { method: "GET" })
    .then((payload) => {
      const feature = payload?.feature;
      if (!feature || !feature.geometry) {
        throw new Error("Route geometry is not in the archive yet.");
      }
      focusRouteFeature(feature);
      showAdminAction(`Reviewing ${lineKey}.`);
    })
    .catch((error) => {
      showAdminAction(`Could not open ${lineKey} on the map: ${error.message}`, true);
    });
}

// Rendered + underlay routes, deduped by line key (coverage alone misses some).
