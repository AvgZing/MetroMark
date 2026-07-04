function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function focusMaskFeatureCollection(active) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-180, -85],
              [180, -85],
              [180, 85],
              [-180, 85],
              [-180, -85]
            ]
          ]
        },
        properties: {
          active: active ? 1 : 0
        }
      }
    ]
  };
}

function collectCoordsFromGeometry(geometry, bbox) {
  if (!geometry) {
    return bbox;
  }

  const type = geometry.type;
  const coords = geometry.coordinates;
  if (!coords) {
    return bbox;
  }

  const update = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }
    bbox.minLng = Math.min(bbox.minLng, lng);
    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.maxLng = Math.max(bbox.maxLng, lng);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
  };

  if (type === "LineString") {
    coords.forEach(([lng, lat]) => update(lng, lat));
    return bbox;
  }

  if (type === "MultiLineString") {
    coords.forEach((line) => line.forEach(([lng, lat]) => update(lng, lat)));
    return bbox;
  }

  return bbox;
}

function buildLineBboxFromStops(lineKey) {
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(lineKey));
  const stopFeatures = Array.isArray(cacheEntry?.payload?.stopsGeoJson?.features)
    ? cacheEntry.payload.stopsGeoJson.features
    : [];

  if (!stopFeatures.length) {
    return null;
  }

  const bbox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  stopFeatures.forEach((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      return;
    }
    const [lng, lat] = coords;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      bbox.minLng = Math.min(bbox.minLng, lng);
      bbox.minLat = Math.min(bbox.minLat, lat);
      bbox.maxLng = Math.max(bbox.maxLng, lng);
      bbox.maxLat = Math.max(bbox.maxLat, lat);
    }
  });

  if (!Number.isFinite(bbox.minLng)) {
    return null;
  }

  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
}

function buildLineBboxFromRoutes(lineKey) {
  const features = Array.isArray(state.transit?.routesGeoJson?.features)
    ? state.transit.routesGeoJson.features
    : [];

  if (!features.length) {
    return null;
  }

  const bbox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  for (const feature of features) {
    const featureLineKey = String(feature?.properties?.line_key || "").trim();
    if (featureLineKey !== lineKey) {
      continue;
    }

    collectCoordsFromGeometry(feature.geometry, bbox);
  }

  if (!Number.isFinite(bbox.minLng)) {
    return null;
  }

  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
}

function mapSafeAreaPadding(extraPadding = 24) {
  const basePadding = {
    top: extraPadding,
    right: extraPadding,
    bottom: extraPadding,
    left: extraPadding
  };

  if (!state.map || typeof state.map.getContainer !== "function") {
    return basePadding;
  }

  const mapContainer = state.map.getContainer();
  if (!mapContainer) {
    return basePadding;
  }

  const mapRect = mapContainer.getBoundingClientRect();
  if (!mapRect || mapRect.width <= 0 || mapRect.height <= 0) {
    return basePadding;
  }

  const isDesktopLineView = Boolean(els.lineViewPanel) && !isPortraitMobileLayout();
  if (isDesktopLineView && !els.lineViewPanel.hidden) {
    const style = window.getComputedStyle(els.lineViewPanel);
    if (style.display !== "none" && style.visibility !== "hidden") {
      const rect = els.lineViewPanel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.right > mapRect.left && rect.left < mapRect.right) {
        basePadding.right = Math.max(basePadding.right, Math.ceil(rect.width) + extraPadding);
      }
    }
  }

  if (Boolean(els.routeSelectPanel) && !els.routeSelectPanel.hidden) {
    const style = window.getComputedStyle(els.routeSelectPanel);
    if (style.display !== "none" && style.visibility !== "hidden") {
      const rect = els.routeSelectPanel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.bottom > mapRect.top && rect.top < mapRect.bottom) {
        basePadding.bottom = Math.max(basePadding.bottom, Math.ceil(rect.height) + extraPadding);
      }
    }
  }

  return basePadding;
}

function fitMapToBbox(bbox, options = {}) {
  if (!state.map || !bbox || bbox.length !== 4) {
    return;
  }

  const duration = Number.isFinite(Number(options.duration)) ? Number(options.duration) : 650;
  const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : 12.5;
  const extraPadding = Number.isFinite(Number(options.extraPadding)) ? Number(options.extraPadding) : 24;
  const padding = options.useSafeAreaPadding === false
    ? {
        top: extraPadding,
        right: extraPadding,
        bottom: extraPadding,
        left: extraPadding
      }
    : mapSafeAreaPadding(extraPadding);

  state.map.fitBounds(
    [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]]
    ],
    {
      padding,
      duration,
      maxZoom
    }
  );
}

function fitMapToLine(lineKey) {
  if (!state.map || !lineKey) {
    return;
  }

  const bbox = buildLineBboxFromStops(lineKey) || buildLineBboxFromRoutes(lineKey);
  if (!bbox) {
    return;
  }

  fitMapToBbox(bbox, {
    extraPadding: isPortraitMobileLayout() ? 24 : 24,
    duration: 650,
    maxZoom: 12.5
  });
}

function stopKeyForFeature(feature) {
  const props = feature?.properties || {};
  return String(props.station_key || props.stop_id || "").trim();
}

function uniqueStopFeaturesForLine(lineKey) {
  const cacheEntry = state.lineStopsCache.get(routeStopCacheKey(lineKey));
  const stopFeatures = Array.isArray(cacheEntry?.payload?.stopsGeoJson?.features)
    ? cacheEntry.payload.stopsGeoJson.features
    : [];

  const seen = new Set();
  const unique = stopFeatures.filter((feature) => {
    const key = stopKeyForFeature(feature);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique;
}

async function toggleVisitedForStation(properties, coords) {
  const lineKey = String(properties?.line_key || "").trim();
  const stationKey = String(properties?.station_key || properties?.stop_id || "").trim();
  const stationName = String(properties?.station_name || properties?.stop_name || "Unnamed Station");
  const [lon, lat] = Array.isArray(coords) ? coords : [];

  if (!lineKey || !stationKey || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return;
  }

  if (!state.user) {
    setUserStatusFromStation(properties || {}, "Sign in to mark this station as visited.");
    setStatus("Sign in first to mark stations.", "error");
    return;
  }

  const visitedSet = getVisitedSetForLine(lineKey);
  const nextVisited = !visitedSet.has(stationKey);

  try {
    await apiRequest("/api/progress/toggle", {
      method: "POST",
      body: JSON.stringify({
        lineKey,
        stationKey,
        stationName,
        lon,
        lat,
        visited: nextVisited
      })
    });

    if (nextVisited) {
      visitedSet.add(stationKey);
    } else {
      visitedSet.delete(stationKey);
    }

    renderMapData();
    renderProgress();
    renderLineView({ forceStopRefresh: true });

    setUserStatusFromStation(
      properties || {},
      nextVisited ? "Marked as visited in your progress." : "Marked as unvisited in your progress."
    );

    setStatus(`${nextVisited ? "Visited" : "Unvisited"}: ${stationName}`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function createLineConnector(lineColor) {
  if (!els.lineViewStops) {
    return;
  }

  const existingSvg = els.lineViewStops.querySelector("#lineViewConnectorSvg");
  if (existingSvg) {
    existingSvg.remove();
  }

  const stopRows = Array.from(els.lineViewStops.querySelectorAll(".line-view-stop-row"));
  if (stopRows.length < 2) {
    return;
  }

  const containerRect = els.lineViewStops.getBoundingClientRect();
  const scrollTop = els.lineViewStops.scrollTop;
  const scrollLeft = els.lineViewStops.scrollLeft;
  const dotPositions = stopRows.map((row) => {
    const dot = row.querySelector(".line-view-stop-dot");
    if (!dot) {
      return null;
    }

    const dotRect = dot.getBoundingClientRect();

    const relativeY = dotRect.top - containerRect.top + scrollTop + dotRect.height / 2;
    const relativeX = dotRect.left - containerRect.left + scrollLeft + dotRect.width / 2;

    return {
      y: relativeY,
      x: relativeX
    };
  });

  const validPositions = dotPositions.filter((p) => p !== null);
  if (validPositions.length < 2) {
    return;
  }

  const maxY = Math.max(...validPositions.map((p) => p.y));
  const containerWidth = els.lineViewStops.offsetWidth;
  const containerHeight = Math.max(els.lineViewStops.scrollHeight, maxY + 20);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "lineViewConnectorSvg";
  svg.setAttribute("viewBox", `0 0 ${containerWidth} ${containerHeight}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = `${containerHeight}px`;
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "0";

  const pathData = validPositions
    .map((pos, idx) => {
      if (idx === 0) {
        return `M ${pos.x} ${pos.y}`;
      }
      return `L ${pos.x} ${pos.y}`;
    })
    .join(" ");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  path.setAttribute("stroke", lineColor);
  path.setAttribute("stroke-width", "4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linecap", "butt");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("opacity", "0.85");

  svg.append(path);
  els.lineViewStops.insertBefore(svg, els.lineViewStops.firstChild);
}

function hoverInteractionsEnabled() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function isPortraitMobileLayout() {
  return window.matchMedia("(max-width: 900px) and (orientation: portrait)").matches;
}

function setMobilePanelsOpen(open) {
  const nextOpen = Boolean(open) && isPortraitMobileLayout();
  state.mobilePanelsOpen = nextOpen;

  document.body.classList.toggle("mobile-panels-open", nextOpen);

  if (els.mobileDrawerTab) {
    els.mobileDrawerTab.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    els.mobileDrawerTab.setAttribute("aria-label", nextOpen ? "Close panels" : "Open panels");
    els.mobileDrawerTab.classList.toggle("is-open", nextOpen);
    els.mobileDrawerTab.textContent = nextOpen ? "<" : ">";
  }
}

function syncMobilePanelLayout() {
  if (!isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
    return;
  }

  setMobilePanelsOpen(state.mobilePanelsOpen);
}

function setActivePopup(name) {
  const next = state.activePopup === name ? "" : name;
  state.activePopup = next;

  if (next === "account" && isPortraitMobileLayout()) {
    setMobilePanelsOpen(false);
  }

  els.authPopup.hidden = next !== "account";
  els.accountPopupBtn.classList.toggle("btn-primary", next === "account");
  els.accountPopupBtn.setAttribute("aria-expanded", next === "account" ? "true" : "false");
}

function closePopups() {
  setActivePopup("");
}
