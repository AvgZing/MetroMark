function setStatus(message, kind = "neutral", meta = "") {
  els.statusText.textContent = message;
  els.statusMeta.textContent = meta;

  els.statusText.classList.remove("error", "ok");
  if (kind === "error") {
    els.statusText.classList.add("error");
  }
  if (kind === "ok") {
    els.statusText.classList.add("ok");
  }
}

function setBackendStatus(message) {
  const raw = String(message || "");
  const escaped = escapeHtml(raw);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  const zoom = state.map && state.mapReady ? Number(state.map.getZoom()).toFixed(2) : "n/a";
  els.backendStatusText.innerHTML = `<span class="backend-status-zoom">Current zoom level: ${zoom}</span><br>${linked}`;
}

function clearMapNotice() {
  if (!els.mapNotice) {
    return;
  }

  els.mapNotice.hidden = true;
  els.mapNotice.innerHTML = "";
}

function setMapNotice(title, meta = "", kind = "neutral", placement = "center", detailIsHtml = false) {
  if (!els.mapNotice) {
    return;
  }

  const message = String(title || "").trim();
  const detail = String(meta || "").trim();

  // Corner placement is handled by the small badge element.
  if (placement === "corner") {
    if (!message) {
      hideMapLoadingBadge();
      return;
    }
    // show a compact badge for loading/brief status
    showMapLoadingBadge();
    return;
  }

  // Center placement: show a full map notice card. Errors use error styling;
  // neutral messages are allowed here when the map has no visible routes.
  if (!message) {
    clearMapNotice();
    return;
  }

  const className = kind === "error" ? "error" : kind === "ok" ? "ok" : "";
  els.mapNotice.className = `map-notice${className ? ` ${className}` : ""}`;
  els.mapNotice.innerHTML = `
    <div class="map-notice-card">
      <p class="map-notice-title">${escapeHtml(message)}</p>
      ${detail ? `<p class="map-notice-meta">${detailIsHtml ? detail : escapeHtml(detail)}</p>` : ""}
    </div>
  `;
  els.mapNotice.hidden = false;
}

function showMapLoadingBadge() {
  if (!els.mapLoadingBadge) return;
  els.mapLoadingBadge.hidden = false;
  els.mapLoadingBadge.textContent = "Loading...";
}

function hideMapLoadingBadge() {
  if (!els.mapLoadingBadge) return;
  els.mapLoadingBadge.hidden = true;
  els.mapLoadingBadge.textContent = "";
}

function renderApiCounter() {
  els.apiRequestCounter.textContent =
    `Queries - REST: ${state.transitlandRestApiRequestCount}, ` +
    `Vector: ${state.transitlandVectorTileRequestCount}, ` +
    `Routing: ${state.transitlandRoutingApiRequestCount}, ` +
    `Postgres: ${state.postgresQueryCount}`;

  if (els.apiRequestCounterDetail) {
    els.apiRequestCounterDetail.textContent =
      `Failures - REST: ${state.transitlandRestApiFailureCount}, ` +
      `Vector: ${state.transitlandVectorTileFailureCount}, ` +
      `Routing: ${state.transitlandRoutingApiFailureCount}, ` +
      `Postgres: ${state.postgresQueryFailureCount}`;
  }
}

function resetClearRouteProgressConfirmation(options = {}) {
  if (state.clearRouteProgressConfirmTimeoutId) {
    window.clearTimeout(state.clearRouteProgressConfirmTimeoutId);
    state.clearRouteProgressConfirmTimeoutId = null;
  }

  state.clearRouteProgressConfirmLineKey = "";

  if (options.renderNow) {
    renderUserStatus();
  }
}

function setStatusPin(kind) {
  state.userStatusPinnedKind = String(kind || "").trim();
}

function clearStatusPin() {
  state.userStatusPinnedKind = "";
}

function setUserFeedback(message, kind = "neutral") {
  state.userFeedback = {
    message: String(message || "").trim(),
    kind
  };

  renderUserFeedback();
}

function renderUserFeedback() {
  if (!els.userStatusFeedback) {
    return;
  }

  const message = String(state.userFeedback?.message || "").trim();

  els.userStatusFeedback.classList.remove("ok", "error");
  if (state.userFeedback?.kind === "ok") {
    els.userStatusFeedback.classList.add("ok");
  }
  if (state.userFeedback?.kind === "error") {
    els.userStatusFeedback.classList.add("error");
  }

  if (!message) {
    els.userStatusFeedback.hidden = true;
    els.userStatusFeedback.textContent = "";
    return;
  }

  els.userStatusFeedback.hidden = false;
  els.userStatusFeedback.textContent =
    message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function renderUserStatus() {
  const statusLineKey = String(
    state.userStatus?.routeLineKey || state.lineViewLineKey || state.focusedLineKey || ""
  ).trim();
  const statusLine = state.lineSummaries.find((entry) => entry.lineKey === statusLineKey);
  const statusLineColor = statusLine?.color || "#177ca2";

  if (els.userStatusTitle) {
    els.userStatusTitle.style.setProperty("--status-line-color", statusLineColor);
  }

  els.userStatusTitle.textContent = state.userStatus.title;
  els.userStatusSubtitle.textContent = state.userStatus.subtitle;

  if (els.userStatusDetails) {
    els.userStatusDetails.innerHTML = "";
    for (const item of state.userStatus.details || []) {
      if (!item || !item.label || !item.value) {
        continue;
      }

      const dt = document.createElement("dt");
      dt.textContent = String(item.label);
      const dd = document.createElement("dd");
      dd.textContent = String(item.value);
      els.userStatusDetails.append(dt, dd);
    }
  }

  if (els.userStatusRouteProgress && els.userStatusRouteProgressText && els.userStatusRouteProgressFill) {
    const progress = state.userStatus.progress;
    const hasProgress = Boolean(state.user) && Boolean(progress) && Number(progress.total || 0) > 0;

    if (hasProgress) {
      const visited = Number(progress.visited || 0);
      const total = Number(progress.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      els.userStatusRouteProgress.hidden = false;
      els.userStatusRouteProgressText.textContent = `${visited}/${total} stations visited (${percent}%)`;
      els.userStatusRouteProgressFill.style.width = `${percent}%`;
    } else {
      els.userStatusRouteProgress.hidden = true;
      els.userStatusRouteProgressText.textContent = "";
      els.userStatusRouteProgressFill.style.width = "0%";
    }
  }

  if (els.clearRouteProgressBtn) {
    const routeLineKey = String(state.userStatus.routeLineKey || state.focusedLineKey || "").trim();
    const showClear = Boolean(state.user) && Boolean(routeLineKey);
    els.clearRouteProgressBtn.hidden = !showClear;
    els.clearRouteProgressBtn.disabled = !showClear;
  }

  if (els.clearRouteProgressConfirmText) {
    const routeLineKey = String(state.userStatus.routeLineKey || state.focusedLineKey || "").trim();
    const pending =
      Boolean(routeLineKey) && state.clearRouteProgressConfirmLineKey === routeLineKey;

    els.clearRouteProgressConfirmText.hidden = !pending;
    els.clearRouteProgressConfirmText.textContent = pending
      ? "Click Clear Route Progress again to confirm reset."
      : "";
  }

  if (els.lineViewBtn) {
    const hasLine = Boolean(state.focusedLineKey);
    els.lineViewBtn.hidden = !hasLine;
    els.lineViewBtn.disabled = !hasLine;
    els.lineViewBtn.classList.toggle("is-active", state.lineViewOpen);
    els.lineViewBtn.setAttribute("aria-pressed", state.lineViewOpen ? "true" : "false");
  }

  if (els.deselectRouteBtn) {
    els.deselectRouteBtn.hidden = !state.focusedLineKey;
  }

  renderUserFeedback();
}

function captureMapView() {
  if (!state.map) {
    return null;
  }

  const center = state.map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: state.map.getZoom(),
    bearing: state.map.getBearing(),
    pitch: state.map.getPitch()
  };
}

function restoreMapView(view) {
  if (!state.map || !view) {
    return;
  }

  state.map.jumpTo({
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch
  });
}

function setUserStatus(title, subtitle, options = {}) {
  state.userStatus = {
    title: String(title || "").trim() || "No route selected.",
    subtitle: String(subtitle || "").trim() || "Select a route or station.",
    details: Array.isArray(options.details) ? options.details : [],
    routeLineKey: String(options.routeLineKey || "").trim(),
    progress: options.progress || null
  };

  if (Object.prototype.hasOwnProperty.call(options, "feedback")) {
    setUserFeedback(options.feedback, options.feedbackKind || "neutral");
  }

  renderUserStatus();
}

async function loadReviewsForCity(citySlug) {
  try {
    const response = await fetch(`/api/transit/reviews?citySlug=${encodeURIComponent(citySlug)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    state.routeReviewsByCity.clear();
    state.agencyReviewsByCity.clear();

    if (Array.isArray(data.routeReviews)) {
      data.routeReviews.forEach((review) => {
        state.routeReviewsByCity.set(review.line_key, review);
      });
    }

    if (Array.isArray(data.agencyReviews)) {
      data.agencyReviews.forEach((review) => {
        state.agencyReviewsByCity.set(review.operator_name, review);
      });
    }
  } catch (err) {
    console.warn(`Failed to load reviews for city ${citySlug}:`, err);
  }
}

function lineProgressMetrics(lineKey, fallbackTotal = 0) {
  const normalizedLineKey = String(lineKey || "").trim();
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(normalizedLineKey));
  const stopFeatures = Array.isArray(cacheEntry?.payload?.stopsGeoJson?.features)
    ? cacheEntry.payload.stopsGeoJson.features
    : [];

  const stationKeys = new Set();
  for (const feature of stopFeatures) {
    const stationKey = String(feature?.properties?.station_key || "").trim();
    if (stationKey) {
      stationKeys.add(stationKey);
    }
  }

  const fallback = Number(fallbackTotal);
  const total = stationKeys.size > 0 ? stationKeys.size : Number.isFinite(fallback) ? fallback : 0;
  const visitedSet = getVisitedSetForLine(normalizedLineKey);

  let visited = 0;
  if (stationKeys.size > 0) {
    for (const stationKey of visitedSet) {
      if (stationKeys.has(stationKey)) {
        visited += 1;
      }
    }
  } else {
    visited = visitedSet.size;
  }

  if (total > 0) {
    visited = Math.min(visited, total);
  }

  const percent = total > 0 ? (visited / total) * 100 : 0;
  return {
    visited,
    total,
    percent
  };
}

function setUserStatusFromLine(line) {
  if (!line) {
    setUserStatus("No route selected.", "Select a route or station.", {
      details: [],
      feedback: ""
    });
    return;
  }

  clearStatusPin();

  const progress = lineProgressMetrics(line.lineKey, Number(line.stopCount || 0));
  const focusedLineActions = state.focusedLineKey === line.lineKey ? line.lineKey : "";

  const details = [
    {
      label: "Operator",
      value: lineOperatorLabel(line)
    },
    {
      label: "Frequency",
      value: lineHeadwayLabel(line)
    }
  ];

  if (!isPortraitMobileLayout()) {
    details.push({
      label: "Stops",
      value: progress.total > 0 ? `${progress.total} stations loaded` : "Stops not loaded yet"
    });
  }

  setUserStatus(lineDisplayName(line), `${lineMode(line)} Line`, {
    details,
    routeLineKey: focusedLineActions,
    progress,
    feedback: ""
  });
}

function setUserStatusFromStation(properties, extraMessage = "") {
  const stationName = String(properties?.station_name || "Unnamed Station");
  const lineDescriptor = lineDisplayName({
    lineShortName: properties?.line_short_name,
    lineLongName: properties?.line_long_name || properties?.line_name,
    lineName: properties?.line_name
  }) || properties?.line_key || "Unknown line";

  const relatedLineKey = String(properties?.line_key || "").trim();
  const relatedLine = state.lineSummaries.find((entry) => entry.lineKey === relatedLineKey);
  const progress = relatedLine
    ? lineProgressMetrics(relatedLineKey, Number(relatedLine.stopCount || 0))
    : null;

  setUserStatus(stationName, `Station on ${lineDescriptor}`, {
    details: [],
    routeLineKey: state.focusedLineKey === relatedLineKey ? relatedLineKey : "",
    progress,
    feedback: extraMessage || ""
  });

  setStatusPin("station");
}

function restoreUserStatusFromFocus() {
  if (state.userStatusPinnedKind === "station") {
    return;
  }

  if (!state.focusedLineKey) {
    const shownLines = getShownLines();
    if (shownLines.length === 0) {
      setUserStatus("Zoom in to see stops.", "Pan or zoom the map to load transit.", {
        details: [
          {
            label: "Visible Routes",
            value: "0 Matching Current Filters"
          }
        ],
        feedback: ""
      });
      return;
    }

    setUserStatus("No route selected.", "Select a route or station.", {
      details: [
        {
          label: "Visible Routes",
          value: `${shownLines.length} Matching Current Filters`
        }
      ],
      feedback: ""
    });
    return;
  }

  const line = state.lineSummaries.find((entry) => entry.lineKey === state.focusedLineKey);
  setUserStatusFromLine(line);
}
