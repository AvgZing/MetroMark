function setStatus(message, kind = "neutral", meta = "") {
  dom.statusText.textContent = message;
  dom.statusMeta.textContent = meta;

  dom.statusText.classList.remove("error", "ok");
  if (kind === "error") {
    dom.statusText.classList.add("error");
  }
  if (kind === "ok") {
    dom.statusText.classList.add("ok");
  }
}

function setBackendStatus(message) {
  const raw = String(message || "");
  const escaped = escapeHtml(raw);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  const zoom = appState.map && appState.mapReady ? Number(appState.map.getZoom()).toFixed(2) : "n/a";
  dom.backendStatusText.innerHTML = `<span class="backend-status-zoom">Current zoom level: ${zoom}</span><br>${linked}`;
}

function clearMapNotice() {
  if (!dom.mapNotice) {
    return;
  }

  dom.mapNotice.hidden = true;
  dom.mapNotice.innerHTML = "";
}

function setMapNotice(title, meta = "", kind = "neutral", placement = "center", detailIsHtml = false) {
  if (!dom.mapNotice) {
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
  dom.mapNotice.className = `map-notice${className ? ` ${className}` : ""}`;
  dom.mapNotice.innerHTML = `
    <div class="map-notice-card">
      <p class="map-notice-title">${escapeHtml(message)}</p>
      ${detail ? `<p class="map-notice-meta">${detailIsHtml ? detail : escapeHtml(detail)}</p>` : ""}
    </div>
  `;
  dom.mapNotice.hidden = false;
}

function showMapLoadingBadge() {
  if (!dom.mapLoadingBadge) return;
  dom.mapLoadingBadge.hidden = false;
  dom.mapLoadingBadge.textContent = "Loading...";
}

function hideMapLoadingBadge() {
  if (!dom.mapLoadingBadge) return;
  dom.mapLoadingBadge.hidden = true;
  dom.mapLoadingBadge.textContent = "";
}

function renderApiCounter() {
  dom.apiRequestCounter.textContent =
    `Queries - REST: ${appState.transitlandRestApiRequestCount}, ` +
    `Vector: ${appState.transitlandVectorTileRequestCount}, ` +
    `Routing: ${appState.transitlandRoutingApiRequestCount}, ` +
    `Postgres: ${appState.postgresQueryCount}`;

  if (dom.apiRequestCounterDetail) {
    dom.apiRequestCounterDetail.textContent =
      `Failures - REST: ${appState.transitlandRestApiFailureCount}, ` +
      `Vector: ${appState.transitlandVectorTileFailureCount}, ` +
      `Routing: ${appState.transitlandRoutingApiFailureCount}, ` +
      `Postgres: ${appState.postgresQueryFailureCount}`;
  }
}

function resetClearRouteProgressConfirmation(options = {}) {
  if (appState.clearRouteProgressConfirmTimeoutId) {
    window.clearTimeout(appState.clearRouteProgressConfirmTimeoutId);
    appState.clearRouteProgressConfirmTimeoutId = null;
  }

  appState.clearRouteProgressConfirmLineKey = "";

  if (options.renderNow) {
    renderUserStatus();
  }
}

function setStatusPin(kind) {
  appState.userStatusPinnedKind = String(kind || "").trim();
}

function clearStatusPin() {
  appState.userStatusPinnedKind = "";
}

function setUserFeedback(message, kind = "neutral") {
  appState.userFeedback = {
    message: String(message || "").trim(),
    kind
  };

  renderUserFeedback();
}

function renderUserFeedback() {
  if (!dom.userStatusFeedback) {
    return;
  }

  const message = String(appState.userFeedback?.message || "").trim();

  dom.userStatusFeedback.classList.remove("ok", "error");
  if (appState.userFeedback?.kind === "ok") {
    dom.userStatusFeedback.classList.add("ok");
  }
  if (appState.userFeedback?.kind === "error") {
    dom.userStatusFeedback.classList.add("error");
  }

  if (!message) {
    dom.userStatusFeedback.hidden = true;
    dom.userStatusFeedback.textContent = "";
    return;
  }

  dom.userStatusFeedback.hidden = false;
  dom.userStatusFeedback.textContent =
    message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function renderUserStatus() {
  const statusLineKey = String(
    appState.userStatus?.routeLineKey || appState.lineViewLineKey || appState.focusedLineKey || ""
  ).trim();
  const statusLine = appState.lineSummaries.find((entry) => entry.lineKey === statusLineKey);
  const statusLineColor = statusLine?.color || "#177ca2";

  if (dom.userStatusTitle) {
    dom.userStatusTitle.style.setProperty("--status-line-color", statusLineColor);
  }

  dom.userStatusTitle.textContent = appState.userStatus.title;
  dom.userStatusSubtitle.textContent = appState.userStatus.subtitle;

  if (dom.userStatusDetails) {
    dom.userStatusDetails.innerHTML = "";
    for (const item of appState.userStatus.details || []) {
      if (!item || !item.label || !item.value) {
        continue;
      }

      const dt = document.createElement("dt");
      dt.textContent = String(item.label);
      const dd = document.createElement("dd");
      dd.textContent = String(item.value);
      dom.userStatusDetails.append(dt, dd);
    }
  }

  if (dom.userStatusRouteProgress && dom.userStatusRouteProgressText && dom.userStatusRouteProgressFill) {
    const progress = appState.userStatus.progress;
    const hasProgress = Boolean(appState.user) && Boolean(progress) && Number(progress.total || 0) > 0;

    if (hasProgress) {
      const visited = Number(progress.visited || 0);
      const total = Number(progress.total || 0);
      const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
      dom.userStatusRouteProgress.hidden = false;
      dom.userStatusRouteProgressText.textContent = `${visited}/${total} stations visited (${percent}%)`;
      dom.userStatusRouteProgressFill.style.width = `${percent}%`;
    } else {
      dom.userStatusRouteProgress.hidden = true;
      dom.userStatusRouteProgressText.textContent = "";
      dom.userStatusRouteProgressFill.style.width = "0%";
    }
  }

  if (dom.clearRouteProgressBtn) {
    const routeLineKey = String(appState.userStatus.routeLineKey || appState.focusedLineKey || "").trim();
    const showClear = Boolean(appState.user) && Boolean(routeLineKey);
    dom.clearRouteProgressBtn.hidden = !showClear;
    dom.clearRouteProgressBtn.disabled = !showClear;
  }

  if (dom.clearRouteProgressConfirmText) {
    const routeLineKey = String(appState.userStatus.routeLineKey || appState.focusedLineKey || "").trim();
    const pending =
      Boolean(routeLineKey) && appState.clearRouteProgressConfirmLineKey === routeLineKey;

    dom.clearRouteProgressConfirmText.hidden = !pending;
    dom.clearRouteProgressConfirmText.textContent = pending
      ? "Click Clear Route Progress again to confirm reset."
      : "";
  }

  if (dom.lineViewBtn) {
    const hasLine = Boolean(appState.focusedLineKey);
    dom.lineViewBtn.hidden = !hasLine;
    dom.lineViewBtn.disabled = !hasLine;
    dom.lineViewBtn.classList.toggle("is-active", appState.lineViewOpen);
    dom.lineViewBtn.setAttribute("aria-pressed", appState.lineViewOpen ? "true" : "false");
  }

  if (dom.deselectRouteBtn) {
    dom.deselectRouteBtn.hidden = !appState.focusedLineKey;
  }

  renderUserFeedback();
}

function captureMapView() {
  if (!appState.map) {
    return null;
  }

  const center = appState.map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: appState.map.getZoom(),
    bearing: appState.map.getBearing(),
    pitch: appState.map.getPitch()
  };
}

function restoreMapView(view) {
  if (!appState.map || !view) {
    return;
  }

  appState.map.jumpTo({
    center: view.center,
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch
  });
}

function setUserStatus(title, subtitle, options = {}) {
  appState.userStatus = {
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

    appState.routeReviewsByCity.clear();
    appState.agencyReviewsByCity.clear();

    if (Array.isArray(data.routeReviews)) {
      data.routeReviews.forEach((review) => {
        appState.routeReviewsByCity.set(review.line_key, review);
      });
    }

    if (Array.isArray(data.agencyReviews)) {
      data.agencyReviews.forEach((review) => {
        appState.agencyReviewsByCity.set(review.operator_name, review);
      });
    }
  } catch (err) {
    console.warn(`Failed to load reviews for city ${citySlug}:`, err);
  }
}

function lineProgressMetrics(lineKey, fallbackTotal = 0) {
  const normalizedLineKey = String(lineKey || "").trim();
  const cacheEntry = appState.lineStopsCache.get(routeStopCacheKey(normalizedLineKey));
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
  const focusedLineActions = appState.focusedLineKey === line.lineKey ? line.lineKey : "";

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
  const relatedLine = appState.lineSummaries.find((entry) => entry.lineKey === relatedLineKey);
  const progress = relatedLine
    ? lineProgressMetrics(relatedLineKey, Number(relatedLine.stopCount || 0))
    : null;

  setUserStatus(stationName, `Station on ${lineDescriptor}`, {
    details: [],
    routeLineKey: appState.focusedLineKey === relatedLineKey ? relatedLineKey : "",
    progress,
    feedback: extraMessage || ""
  });

  setStatusPin("station");
}

function restoreUserStatusFromFocus() {
  if (appState.userStatusPinnedKind === "station") {
    return;
  }

  if (!appState.focusedLineKey) {
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

  const line = appState.lineSummaries.find((entry) => entry.lineKey === appState.focusedLineKey);
  setUserStatusFromLine(line);
}
