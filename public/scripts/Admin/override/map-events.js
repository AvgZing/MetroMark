// Admin Map Editor — map interaction bindings, overlap popup, feature property helpers.
function bindMapEvents() {
  state.map.on("click", "routes-hit", (event) => {
    const features = state.map.queryRenderedFeatures(event.point, { layers: ["routes-hit"] });
    if (!features || !features.length) {
      return;
    }

    const seenLineKeys = new Set();
    const uniqueFeatures = [];
    for (const feature of features) {
      const props = featureLineProps(feature);
      const lineKey = String(props.lineKey || "").trim();
      if (!lineKey || seenLineKeys.has(lineKey)) {
        continue;
      }
      // Merged members collapse into their canonical: don't offer them here.
      if (state.mergeCanonicalByMember instanceof Map && state.mergeCanonicalByMember.has(lineKey)) {
        continue;
      }
      seenLineKeys.add(lineKey);
      uniqueFeatures.push(feature);
    }

    if (!uniqueFeatures.length) {
      return;
    }

    if (uniqueFeatures.length === 1) {
      selectRouteFromFeature(uniqueFeatures[0]);
      return;
    }

    openRouteOverlapPopup(uniqueFeatures, event.lngLat);
  });

  state.map.on("click", "stops-layer", (event) => {
    const features = state.map.queryRenderedFeatures(event.point, { layers: ["stops-layer"] });
    const feature = features && features[0];
    if (!feature) {
      return;
    }
    selectStationFromFeature(feature);
  });

  state.map.on("click", (event) => {
    const clicked = state.map.queryRenderedFeatures(event.point, {
      layers: ["routes-hit", "stops-layer"]
    });
    if (!clicked || !clicked.length) {
      closeRouteOverlapPopup();
      clearSelection();
    }
  });

  state.map.on("mousemove", (event) => {
    const hit = state.map.queryRenderedFeatures(event.point, { layers: ["routes-hit", "stops-layer"] });
    state.map.getCanvas().style.cursor = hit && hit.length ? "pointer" : "";
  });
}

function escapeAdminHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function adminLineDisplayName(props) {
  return [props.lineShortName, props.lineLongName || props.lineName]
    .filter(Boolean)
    .join(" | ") || props.lineKey;
}

function openRouteOverlapPopup(features, lngLat) {
  closeRouteOverlapPopup();
  if (!state.map) {
    return;
  }

  const rows = features
    .map((feature) => {
      const props = featureLineProps(feature);
      const meta = [props.operatorName, props.lineKey].filter(Boolean).join(" | ");
      return `
        <button class="route-select-btn" type="button" data-admin-route-select="${escapeAdminHtml(props.lineKey)}">
          <span class="route-select-name">${escapeAdminHtml(adminLineDisplayName(props))}</span>
          <span class="route-select-meta">${escapeAdminHtml(meta)}</span>
        </button>`;
    })
    .join("");

  // Same markup/classes as the frontend route selector.
  state.routeOverlapPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    offset: 16
  })
    .setLngLat(lngLat)
    .setHTML(
      `<div class="station-hover route-select-popup">
        <div class="route-select-header"><h4>Select Route</h4></div>
        <p class="hover-subtitle">${features.length} routes overlap here.</p>
        <div class="route-select-list">${rows}</div>
      </div>`
    )
    .addTo(state.map);

  const popupEl = state.routeOverlapPopup.getElement();
  if (popupEl) {
    popupEl.querySelectorAll("[data-admin-route-select]").forEach((button) => {
      button.addEventListener("click", () => {
        const lineKey = String(button.getAttribute("data-admin-route-select") || "").trim();
        const feature = features.find((f) => {
          return String(featureLineProps(f).lineKey || "").trim() === lineKey;
        });
        closeRouteOverlapPopup();
        if (feature) {
          selectRouteFromFeature(feature);
        }
      });
    });
  }
}

function closeRouteOverlapPopup() {
  if (state.routeOverlapPopup) {
    state.routeOverlapPopup.remove();
    state.routeOverlapPopup = null;
  }
}

function featureLineProps(feature) {
  const p = feature?.properties || {};
  return {
    lineKey: String(p.line_key || p.id || "").trim(),
    lineName: String(p.line_name || ""),
    lineShortName: String(p.line_short_name || ""),
    lineLongName: String(p.line_long_name || ""),
    operatorName: String(p.operator_name || ""),
    routeType: Number.isFinite(Number(p.route_type)) ? Number(p.route_type) : null,
    color: String(p.color || ""),
    routeOnestopId: String(p.route_onestop_id || p.onestop_id || "")
  };
}
