function lineFromPropertiesForHover(properties) {
  const lineKey = String(properties?.line_key || properties?.lineKey || "").trim();
  if (lineKey) {
    const fromSummary = appState.lineSummaries.find((entry) => entry.lineKey === lineKey);
    if (fromSummary) {
      return fromSummary;
    }
  }

  return lineLikeFromFeatureProperties(properties);
}

function stopHoverHtml(properties) {
  const lineLabel = [properties.line_short_name, properties.line_long_name || properties.line_name]
    .filter(Boolean)
    .join(" | ");

  const line = lineFromPropertiesForHover(properties);
  const operatorLabel = lineOperatorLabel(line);
  const modeLabel = lineMode(line);
  const hubCount = Math.max(1, Number(properties.hub_member_count || 1));
  const visited = Number(properties.visited) === 1;
  const progressLabel = appState.user
    ? visited
      ? "Visited"
      : "Not visited"
    : "Sign in to track progress";

  return `
    <div class="station-hover">
      <h4>${escapeHtml(properties.station_name || "Unnamed Station")}</h4>
      <p class="hover-subtitle">${escapeHtml(
        lineLabel || properties.line_name || properties.line_key || "Route details"
      )}</p>
      <dl class="hover-grid">
        <dt>Mode</dt>
        <dd>${escapeHtml(modeLabel)}</dd>
        <dt>Operator</dt>
        <dd>${escapeHtml(operatorLabel)}</dd>
        <dt>Frequency</dt>
        <dd>${escapeHtml(lineHeadwayLabel(line))}</dd>
        <dt>Stop Type</dt>
        <dd>${escapeHtml(stopLocationTypeLabel(properties.stop_location_type))}</dd>
        <dt>Hub</dt>
        <dd>${hubCount} linked stops</dd>
        <dt>Status</dt>
        <dd>${escapeHtml(progressLabel)}</dd>
      </dl>
    </div>
  `;
}

function lineHoverHtml(lines, totalLineCount = lines.length) {
  const rows = lines
    .map(
      (line) =>
        `<li class="hover-route-row">
          <p class="hover-route-name">${escapeHtml(lineDisplayName(line))}</p>
          <p class="hover-route-meta">${escapeHtml(lineMode(line))} | ${escapeHtml(
          lineOperatorLabel(line)
        )} | ${escapeHtml(lineHeadwayLabel(line))}${
          Number(line.stopCount || 0) > 0 ? ` | ${Number(line.stopCount)} stops` : ""
        }</p>
        </li>`
    )
    .join("");

  const hiddenCount = Math.max(0, Number(totalLineCount || 0) - lines.length);

  return `
    <div class="station-hover">
      <h4>Routes Under Cursor</h4>
      <p class="hover-subtitle">${
        totalLineCount > 1
          ? "Interlined segment. Tap/click to pick a route."
          : "Tap/click to focus this route."
      }</p>
      <ul class="hover-route-list">${rows || "<li class=\"hover-route-row\">No route details available.</li>"}</ul>
      ${
        hiddenCount > 0
          ? `<p class="hover-subtitle">+${hiddenCount} more route${hiddenCount === 1 ? "" : "s"} at this location</p>`
          : ""
      }
    </div>
  `;
}

function routeSelectionPopupHtml(lines, options = {}) {
  const includeClose = Boolean(options.includeClose);
  const rows = lines
    .map(
      (line) =>
        `<button class="route-select-btn" type="button" data-route-select="${escapeHtml(
          line.lineKey
        )}">
          <span class="route-select-name">${escapeHtml(lineDisplayName(line))}</span>
          <span class="route-select-meta">${escapeHtml(lineMode(line))} | ${escapeHtml(
          lineOperatorLabel(line)
        )} | ${escapeHtml(lineHeadwayLabel(line))}</span>
        </button>`
    )
    .join("");

  return `
    <div class="station-hover route-select-popup">
      <div class="route-select-header">
        <h4>Select Route</h4>
        ${
          includeClose
            ? "<button class=\"route-select-close\" type=\"button\" data-route-select-close>Close</button>"
            : ""
        }
      </div>
      <p class="hover-subtitle">${lines.length} routes overlap here.</p>
      <div class="route-select-list">${rows}</div>
    </div>
  `;
}

function closeRouteSelectionPopup() {
  if (appState.routeSelectPopup) {
    appState.routeSelectPopup.remove();
  }

  if (dom.routeSelectPanel) {
    dom.routeSelectPanel.hidden = true;
    dom.routeSelectPanel.innerHTML = "";
  }
}

function bindRouteSelectionButtons(container) {
  if (!container) {
    return;
  }

  const buttons = container.querySelectorAll("[data-route-select]");
  buttons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const lineKey = String(button.getAttribute("data-route-select") || "").trim();
      if (!lineKey) {
        return;
      }

      closeRouteSelectionPopup();
      setFocusedLine(lineKey).catch((error) => {
        setStatus(error.message, "error");
      });
    });
  });

  const closeButton = container.querySelector("[data-route-select-close]");
  if (closeButton) {
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      closeRouteSelectionPopup();
    });
  }
}

function openRouteSelectionPopup(lines, lngLat) {
  if (isPortraitMobileLayout() && dom.routeSelectPanel) {
    closeRouteSelectionPopup();
    dom.routeSelectPanel.hidden = false;
    dom.routeSelectPanel.innerHTML = routeSelectionPopupHtml(lines, { includeClose: true });
    bindRouteSelectionButtons(dom.routeSelectPanel);
    return;
  }

  if (!appState.routeSelectPopup || !appState.map) {
    return;
  }

  closeRouteSelectionPopup();
  appState.routeSelectPopup.setLngLat(lngLat).setHTML(routeSelectionPopupHtml(lines)).addTo(appState.map);

  const popupElement = appState.routeSelectPopup.getElement();
  if (!popupElement) {
    return;
  }

  bindRouteSelectionButtons(popupElement);
}
