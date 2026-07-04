function createMapStyle() {
  return {
    version: 8,
    projection: {
      type: "globe"
    },
    sources: {
      streets: {
        type: "raster",
        tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
      },
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        tileSize: 256,
        attribution: "Esri"
      }
    },
    layers: [
      {
        id: "streets-base",
        type: "raster",
        source: "streets"
      },
      {
        id: "satellite-base",
        type: "raster",
        source: "satellite",
        layout: {
          visibility: "none"
        }
      }
    ]
  };
}

function updateMapModeButtons() {
  const streetsActive = appState.mapMode === "streets";
  dom.streetsModeBtn.classList.toggle("btn-primary", streetsActive);
  dom.satelliteModeBtn.classList.toggle("btn-primary", !streetsActive);
}

function setMapMode(mode) {
  appState.mapMode = mode;
  if (!appState.map || !appState.map.getLayer("satellite-base")) {
    return;
  }

  appState.map.setLayoutProperty("satellite-base", "visibility", mode === "satellite" ? "visible" : "none");
  updateMapModeButtons();
}

function mapBoundsToBbox() {
  if (!appState.map) {
    return null;
  }

  const bounds = appState.map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = clamp(bounds.getSouth(), -85, 85);
  const north = clamp(bounds.getNorth(), -85, 85);

  if (west > east) {
    // Antimeridian wrap (common on very wide/world views). Return a world bbox
    // so Postgres-backed viewport requests still run instead of early-returning.
    return [-180, south, 180, north];
  }

  return [west, south, east, north];
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function normalizeBboxArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length !== 4) {
    return null;
  }

  const parsed = candidate.map((value) => Number(value));
  if (parsed.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [west, south, east, north] = parsed;
  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function cacheEntryBbox(cacheKey, entry) {
  const payload = entry?.payload;
  const fromArea =
    normalizeBboxArray(payload?.area?.bbox) ||
    normalizeBboxArray(payload?.normalizedBbox) ||
    normalizeBboxArray(payload?.bbox);

  if (fromArea) {
    return fromArea;
  }

  const tileMatch = /^tile:(\d+):(\d+):(\d+):modes:/.exec(String(cacheKey || ""));
  if (!tileMatch) {
    return null;
  }

  const zoom = Number.parseInt(tileMatch[1], 10);
  const x = Number.parseInt(tileMatch[2], 10);
  const y = Number.parseInt(tileMatch[3], 10);

  if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return tileToBbox(x, y, zoom);
}

function geometryIntersectsBbox(geometry, bbox) {
  if (!geometry || !bbox) {
    return true;
  }

  const geometryBbox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  collectCoordsFromGeometry(geometry, geometryBbox);

  if (
    !Number.isFinite(geometryBbox.minLng) ||
    !Number.isFinite(geometryBbox.minLat) ||
    !Number.isFinite(geometryBbox.maxLng) ||
    !Number.isFinite(geometryBbox.maxLat)
  ) {
    return true;
  }

  return !(
    geometryBbox.maxLng < bbox[0] ||
    geometryBbox.minLng > bbox[2] ||
    geometryBbox.maxLat < bbox[1] ||
    geometryBbox.minLat > bbox[3]
  );
}

function modeCacheKeyFromRouteTypes(routeTypes) {
  const normalized = Array.from(
    new Set(
      Array.isArray(routeTypes)
        ? routeTypes
            .map((value) => Number.parseInt(String(value), 10))
            .filter((value) => Number.isFinite(value) && value >= 0)
        : []
    )
  );
  return normalized.length ? normalized.slice().sort((a, b) => a - b).join("-") : "all";
}

function visibleCachedAreaKeysForViewport(rawBbox, routeTypes = []) {
  const normalizedViewportBbox = normalizeBboxArray(rawBbox);
  if (!normalizedViewportBbox) {
    return new Set();
  }
  const visible = new Set();

  for (const [cacheKey, entry] of appState.areaCache.entries()) {
    const cachedBbox = cacheEntryBbox(cacheKey, entry);
    if (!cachedBbox) {
      continue;
    }

    if (bboxIntersects(normalizedViewportBbox, cachedBbox)) {
      visible.add(cacheKey);
    }
  }

  return visible;
}

function expandBbox(bbox, paddingDegrees) {
  return [
    clamp(bbox[0] - paddingDegrees, -180, 180),
    clamp(bbox[1] - paddingDegrees, -85, 85),
    clamp(bbox[2] + paddingDegrees, -180, 180),
    clamp(bbox[3] + paddingDegrees, -85, 85)
  ];
}

function tileZoomFromMapZoom(zoom) {
  // Use coarser tile zooms for broad map views so the request set covers
  // continent-scale extents without dropping distant metros.
  if (zoom >= 13) return 12;
  if (zoom >= 11) return 11;
  if (zoom >= 9) return 9;
  if (zoom >= 7) return 8;
  if (zoom >= 5) return 7;
  if (zoom >= 3) return 6;
  return 5;
}

function lngLatToTile(lon, lat, zoom) {
  const latClamped = clamp(lat, -85.05112878, 85.05112878);
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  return {
    x,
    y: clamp(y, 0, n - 1)
  };
}

function tileToBbox(x, y, zoom) {
  const n = 2 ** zoom;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;

  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));

  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;

  return [west, south, east, north];
}

function normalizeTileX(x, zoom) {
  const n = 2 ** zoom;
  return ((x % n) + n) % n;
}

function normalizeTileY(y, zoom) {
  const n = 2 ** zoom;
  return clamp(y, 0, n - 1);
}

function bboxQueryText(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function buildViewportTileRequests(rawBbox, zoom) {
  // Use tiles all the way down to zoom 5 â€” each tile's exact key matches Postgres
  // directly without needing spatial overlap. Only at extreme zoom-out (world view)
  // do we fall back to a single viewport request.
  if (Number(zoom || 0) < 5) {
    const paddedViewport = expandBbox(rawBbox, 0.18);
    return [
      {
        areaKey: `viewport:${bboxQueryText(paddedViewport)}`,
        bbox: paddedViewport,
        zoom,
        distanceScore: 0
      }
    ];
  }

  const tileZoom = tileZoomFromMapZoom(zoom);
  const padded = expandBbox(rawBbox, 0.18);
  const center = bboxCenter(rawBbox);
  const centerTile = lngLatToTile(center[0], center[1], tileZoom);

  const northWest = lngLatToTile(padded[0], padded[3], tileZoom);
  const southEast = lngLatToTile(padded[2], padded[1], tileZoom);

  const minX = Math.min(northWest.x, southEast.x) - 1;
  const maxX = Math.max(northWest.x, southEast.x) + 1;
  const minY = Math.min(northWest.y, southEast.y) - 1;
  const maxY = Math.max(northWest.y, southEast.y) + 1;

  const requestsByKey = new Map();

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const nx = normalizeTileX(x, tileZoom);
      const ny = normalizeTileY(y, tileZoom);
      const areaKey = `tile:${tileZoom}:${nx}:${ny}`;
      if (requestsByKey.has(areaKey)) {
        continue;
      }

      const bbox = tileToBbox(nx, ny, tileZoom);
      const dx = nx - centerTile.x;
      const dy = ny - centerTile.y;
      const distanceScore = dx * dx + dy * dy;

      requestsByKey.set(areaKey, {
        areaKey,
        bbox,
        zoom,
        distanceScore
      });
    }
  }

  const allTiles = Array.from(requestsByKey.values());
  
  // At very low zoom (world/continent), ensure we don't drop distant metros
  // by selecting tiles more carefully: sort by distance but use a larger budget
  // rather than slicing aggressively.
  if (zoom < 5) {
    // Low zoom: increase budget to 128 (vs default 24) to cover distant metros
    // but still sort by distance to prioritize the most relevant tiles
    return allTiles
      .sort((a, b) => a.distanceScore - b.distanceScore)
      .slice(0, 128);
  }
  
  // At higher zoom (5+), sort by distance and limit with standard budget
  return allTiles
    .sort((a, b) => a.distanceScore - b.distanceScore)
    .slice(0, MAX_TARGET_TILES_PER_VIEW);
}

function mergeStopFeature(existing, incoming) {
  return {
    ...incoming,
    properties: {
      ...existing.properties,
      ...incoming.properties,
      source_count: Math.max(
        Number(existing.properties.source_count || 1),
        Number(incoming.properties.source_count || 1)
      ),
      hub_member_count: Math.max(
        Number(existing.properties.hub_member_count || 1),
        Number(incoming.properties.hub_member_count || 1)
      ),
      hub_spread_m: Math.max(
        Number(existing.properties.hub_spread_m || 0),
        Number(incoming.properties.hub_spread_m || 0)
      ),
      distance_m: Math.min(
        Number(existing.properties.distance_m || 0),
        Number(incoming.properties.distance_m || 0)
      )
    }
  };
}

function cacheAreaPayload(cacheKey, payload, cacheStatus) {
  appState.areaCache.set(cacheKey, {
    cacheKey,
    payload,
    cacheStatus,
    lastUsedAt: Date.now()
  });

  pruneAreaCache();
}

function pruneAreaCache() {
  if (appState.areaCache.size <= MAX_SESSION_AREAS) {
    return;
  }

  const protectedKeys = new Set([
    ...appState.requestedAreaKeys,
    ...appState.inFlightAreaKeys,
    ...appState.queuedAreaKeys
  ]);

  const sorted = Array.from(appState.areaCache.entries()).sort(
    (a, b) => Number(a[1].lastUsedAt || 0) - Number(b[1].lastUsedAt || 0)
  );

  for (const [key] of sorted) {
    if (appState.areaCache.size <= MAX_SESSION_AREAS) {
      break;
    }
    if (protectedKeys.has(key)) {
      continue;
    }
    appState.areaCache.delete(key);
  }
}

function routeStopCacheKey(lineKey) {
  return `${String(lineKey || "")}|types:${ROUTE_STOP_TYPES_KEY}`;
}

function pruneLineStopsCache() {
  if (appState.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
    return;
  }

  const focusedCacheKey = appState.focusedLineKey ? routeStopCacheKey(appState.focusedLineKey) : "";

  const sorted = Array.from(appState.lineStopsCache.entries()).sort(
    (a, b) => Number(a[1]?.lastUsedAt || 0) - Number(b[1]?.lastUsedAt || 0)
  );

  for (const [cacheKey] of sorted) {
    if (appState.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
      break;
    }
    if (cacheKey === focusedCacheKey || appState.inFlightLineStopKeys.has(cacheKey)) {
      continue;
    }
    appState.lineStopsCache.delete(cacheKey);
  }
}

function syncActiveAreaKeys(options = {}) {
  const now = Date.now();
  const previousActiveAreaKeys = new Set(appState.activeAreaKeys);
  const retainedVisibleKeys = options.retainVisibleKeys || null;
  const allowRetainOutsideRequested = Boolean(options.allowRetainOutsideRequested);

  appState.visibleAreaKeys = new Set();

  for (const key of appState.requestedAreaKeys) {
    const entry = appState.areaCache.get(key);
    if (!entry) {
      continue;
    }

    entry.lastUsedAt = now;
    appState.visibleAreaKeys.add(key);
  }

  if (retainedVisibleKeys instanceof Set && options.mergeRetainedVisibleKeys) {
    for (const key of retainedVisibleKeys) {
      if (!appState.areaCache.has(key)) {
        continue;
      }
      if (allowRetainOutsideRequested || appState.requestedAreaKeys.has(key)) {
        appState.visibleAreaKeys.add(key);
      }
    }
  } else if (appState.visibleAreaKeys.size === 0 && retainedVisibleKeys instanceof Set) {
    for (const key of retainedVisibleKeys) {
      if (!appState.areaCache.has(key)) {
        continue;
      }
      if (allowRetainOutsideRequested || appState.requestedAreaKeys.has(key)) {
        appState.visibleAreaKeys.add(key);
      }
    }
  }

  if (appState.visibleAreaKeys.size === 0 && options.fallbackToAllCached) {
    appState.visibleAreaKeys = new Set(appState.activeAreaKeys);
  }

  if (appState.visibleAreaKeys.size > 0) {
    appState.activeAreaKeys = new Set(appState.visibleAreaKeys);
  } else {
    appState.activeAreaKeys = previousActiveAreaKeys;
  }
}

function resetViewAggregation() {
  appState.loadEpoch += 1;
  appState.requestedAreaKeys = new Set();
  appState.visibleAreaKeys = new Set();
  appState.activeAreaKeys = new Set();
  appState.fetchQueue = [];
  appState.queuedAreaKeys.clear();
  appState.focusedLineKey = "";
  appState.lastLoadStats = {
    requested: 0,
    cached: 0,
    queued: 0,
    deferred: 0,
    failed: 0,
    successful: 0
  };
}

function countGeometryCoords(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'LineString') {
    return geometry.coordinates ? geometry.coordinates.length : 0;
  }
  if (geometry.type === 'MultiLineString') {
    var sum = 0;
    var lines = geometry.coordinates;
    if (lines) {
      for (var i = 0; i < lines.length; i++) {
        if (Array.isArray(lines[i])) {
          sum += lines[i].length;
        }
      }
    }
    return sum;
  }
  return 0;
}

function rebuildCombinedTransit(serverPayload) {
  // If called without a payload (e.g., from scheduleBatchRender after a route-click),
  // use the last stored viewport payload so route-stops upgrades work correctly.
  if (!serverPayload && appState._viewportPayload) {
    serverPayload = appState._viewportPayload;
  }

  const rebuildStart = performance.now();

  // Only bail on empty tile cache if we don't have a per-route payload to render.
  // The spatial query path works without any tile cache entries.
  if (!serverPayload && appState.activeAreaKeys.size === 0) {
    appState.transit = null;
    appState.lineSummaries = [];
    appState.loadedLineSummaries = [];
    appState.focusedLineKey = "";
    return;
  }

  const mergeLineEntries = (existing, line) => {
    const existingHeadway = Number(existing?.headwayBestMinutes);
    const lineHeadway = Number(line?.headwayBestMinutes);
    const mergedHeadwayBestMinutes = Number.isFinite(existingHeadway)
      ? existingHeadway
      : Number.isFinite(lineHeadway)
        ? lineHeadway
        : null;

    const existingBucket = String(existing?.frequencyBucket || "").trim().toLowerCase();
    const lineBucket = String(line?.frequencyBucket || "").trim().toLowerCase();

    let mergedFrequencyBucket = "unknown";
    if (Number.isFinite(mergedHeadwayBestMinutes)) {
      mergedFrequencyBucket = frequencyBucketFromHeadwayMinutes(mergedHeadwayBestMinutes);
    } else if (existingBucket && existingBucket !== "unknown") {
      mergedFrequencyBucket = existingBucket;
    } else if (lineBucket) {
      mergedFrequencyBucket = lineBucket;
    }

    return {
      ...(existing || {}),
      ...(line || {}),
      routeOnestopId: existing?.routeOnestopId || line?.routeOnestopId || "",
      lineName: existing?.lineName || line?.lineName || "",
      lineShortName: existing?.lineShortName || line?.lineShortName || "",
      lineLongName: existing?.lineLongName || line?.lineLongName || "",
      operatorName: existing?.operatorName || line?.operatorName || "",
      mode: existing?.mode || line?.mode || modeLabelFromRouteType(line?.routeType),
      routeType: Number.isFinite(Number(existing?.routeType))
        ? Number(existing.routeType)
        : Number.isFinite(Number(line?.routeType))
          ? Number(line.routeType)
          : null,
      routeFeedId: existing?.routeFeedId || line?.routeFeedId || "",
      serviceTier: existing?.serviceTier || line?.serviceTier || lineServiceTier(line),
      frequencyBucket: mergedFrequencyBucket,
      headwayBestMinutes: Number.isFinite(mergedHeadwayBestMinutes)
        ? Number(mergedHeadwayBestMinutes)
        : null,
      headwaySource: existing?.headwaySource || line?.headwaySource || "",
      headwayChecked: Number(existing?.headwayChecked || line?.headwayChecked || 0) === 1 ? 1 : 0,
      color: existing?.color || line?.color
    };
  };

  const routeByLine = new Map();
  const lineByKeyAll = new Map();
  const visibleLineKeys = new Set();
  const viewportBbox = normalizeBboxArray(appState.currentViewportBbox);
  const routeIntersectsViewport = (feature) => {
    if (!viewportBbox) {
      return true;
    }
    return geometryIntersectsBbox(feature?.geometry, viewportBbox);
  };

  // ── Per-route payload path (no tile iteration) ──────────────────────────
  // When the server already merged all route geometry into a single payload
  // via the spatial query (route_geometry_lod), skip the tile-based assembly
  // and build routeByLine / lineByKeyAll directly from the payload.
  if (serverPayload && (serverPayload.routesGeoJson || serverPayload.lineSummaries)) {
    var pf = serverPayload.routesGeoJson?.features || [];
    for (var pi = 0; pi < pf.length; pi++) {
      var pfeature = pf[pi];
      var plineKey = pfeature?.properties?.line_key;
      if (!plineKey) continue;
      routeByLine.set(plineKey, pfeature);
    }

    var plines = serverPayload.lineSummaries || [];
    for (var pj = 0; pj < plines.length; pj++) {
      var pline = plines[pj];
      var lk = pline?.lineKey;
      if (!lk) continue;
      lineByKeyAll.set(lk, pline);
    }

    // Mark all routes in the payload as visible (viewport filtering below)
    // Fall through to shared post-processing: route-stop upgrades,
    // visibility filtering, stop assembly, and appState.transit assignment.
  } else {

  // DEBUG: track per-route tile coverage to diagnose partial-geometry loading
  var _debugRouteTileCoverage = new Map();

  for (const cacheKey of appState.activeAreaKeys) {
    const payload = appState.areaCache.get(cacheKey)?.payload;
    if (!payload) {
      continue;
    }

    for (const feature of payload?.routesGeoJson?.features || []) {
      const lineKey = feature?.properties?.line_key;
      if (!lineKey) {
        continue;
      }
      if (!routeIntersectsViewport(feature)) {
        continue;
      }
      // Pick the tile with the most coordinates for each route, so that
      // higher-detail or larger-coverage tiles are never overridden by
      // lower-detail representations from coarser zoom levels.
      var existingFeature = routeByLine.get(lineKey);
      if (!existingFeature) {
        routeByLine.set(lineKey, feature);
      } else if (countGeometryCoords(feature.geometry) > countGeometryCoords(existingFeature.geometry)) {
        routeByLine.set(lineKey, feature);
      }

      // DEBUG: record coordinate count per tile for this route
      if (!_debugRouteTileCoverage.has(lineKey)) {
        _debugRouteTileCoverage.set(lineKey, []);
      }
      var coords = (feature?.geometry?.type === 'LineString')
        ? (feature.geometry.coordinates?.length || 0)
        : (feature?.geometry?.type === 'MultiLineString')
          ? (feature.geometry.coordinates || []).reduce(function(s, c) { return s + (Array.isArray(c) ? c.length : 0); }, 0)
          : 0;
      _debugRouteTileCoverage.get(lineKey).push({ cacheKey: cacheKey, coords: coords });
    }

    for (const line of payload?.lineSummaries || []) {
      const lineKey = line?.lineKey;
      if (!lineKey) {
        continue;
      }
      if (!routeByLine.has(lineKey)) {
        continue;
      }

      const merged = mergeLineEntries(lineByKeyAll.get(lineKey), line);
      lineByKeyAll.set(lineKey, merged);
      if (appState.visibleAreaKeys.has(cacheKey)) {
        visibleLineKeys.add(lineKey);
      }
    }
  }

  // DEBUG: log routes whose selected geometry tile has significantly fewer
  // coords than another cached tile — only triggers when most-coords heuristic
  // picks something unexpected (should be rare after the fix).
  for (var _entries = _debugRouteTileCoverage.entries(), _entry; (_entry = _entries.next()) && !_entry.done;) {
    var debugLineKey = _entry.value[0];
    var tiles = _entry.value[1];
    if (tiles.length > 1) {
      var maxCoords = tiles.reduce(function(m, t) { return Math.max(m, t.coords); }, 0);
      // The selected tile should be the one with maxCoords after the heuristic.
      // Warn only if the first-processed tile was notably smaller (informational).
      var firstCoords = tiles[0].coords;
      if (maxCoords > firstCoords * 1.5 && maxCoords > 20) {
        var selectedFeature = routeByLine.get(debugLineKey);
        var selectedCoords = countGeometryCoords(selectedFeature?.geometry);
        if (selectedCoords < maxCoords) {
          console.warn(
            '[rebuild] route ' + debugLineKey +
            ' selected tile has ' + selectedCoords + ' coords but another tile has ' + maxCoords +
            ' — geometry may be partial. tiles: ' +
            JSON.stringify(tiles)
          );
        } else {
          console.log(
            '[rebuild] route ' + debugLineKey +
            ' upgraded from ' + firstCoords + ' to ' + selectedCoords + ' coords' +
            ' (discarded lower-detail tiles). tiles: ' +
            JSON.stringify(tiles)
          );
        }
      }
    }
  }
  } // end tile-iteration path

  // Upgrade route geometry from route-stops cache only if it provides more
  // detail than the spatial query geometry. Stale cached geometry (fewer
  // coords) would break the viewport intersection check on pan.
  for (const [lineKey, routeFeature] of routeByLine) {
    const stopCacheKey = typeof routeStopCacheKey === "function" ? routeStopCacheKey(lineKey) : null;
    if (!stopCacheKey) continue;
    const stopEntry = appState.lineStopsCache.get(stopCacheKey);
    const fullGeo = stopEntry?.payload?.routesGeoJson?.features?.[0]?.geometry;
    if (fullGeo && fullGeo.coordinates && fullGeo.type) {
      var existingCoords = countGeometryCoords(routeFeature.geometry);
      var cachedCoords = countGeometryCoords(fullGeo);
      if (cachedCoords > existingCoords) {
        routeByLine.set(lineKey, { ...routeFeature, geometry: fullGeo });
      }
    }
  }

  for (const [lineKey, routeFeature] of routeByLine.entries()) {
    if (!lineKey || !routeFeature) {
      continue;
    }

    if (!viewportBbox || geometryIntersectsBbox(routeFeature.geometry, viewportBbox)) {
      visibleLineKeys.add(lineKey);
    }
  }

  if (appState.focusedLineKey && !lineByKeyAll.has(appState.focusedLineKey)) {
    appState.focusedLineKey = "";
  }

  const effectiveVisibleLineKeys = new Set(visibleLineKeys);

  for (const [lineKey, override] of appState.manualLineVisibility.entries()) {
    const normalizedOverride = String(override || "").trim().toLowerCase();
    if (normalizedOverride === "on" && lineByKeyAll.has(lineKey)) {
      const feature = routeByLine.get(lineKey);
      if (feature && geometryIntersectsBbox(feature.geometry, appState.currentViewportBbox)) {
        effectiveVisibleLineKeys.add(lineKey);
      }
    } else if (normalizedOverride === "off") {
      // Explicitly hidden lines are removed from visibility
      effectiveVisibleLineKeys.delete(lineKey);
    }
  }

  const includeStopLineKeys = new Set();
  if (appState.focusedLineKey && lineByKeyAll.has(appState.focusedLineKey)) {
    includeStopLineKeys.add(appState.focusedLineKey);
  } else if (Boolean(appState.showAllStops)) {
    for (const lineKey of effectiveVisibleLineKeys) {
      includeStopLineKeys.add(lineKey);
    }
  }

  const stopByLineAndStation = new Map();
  const stopStationKeysByLine = new Map();
  const activeStopTypeKey = ROUTE_STOP_TYPES_KEY;
  const now = Date.now();

  for (const entry of appState.lineStopsCache.values()) {
    if (!entry || entry.stopTypesKey !== activeStopTypeKey) {
      continue;
    }

    if (!lineByKeyAll.has(entry.lineKey)) {
      continue;
    }

    entry.lastUsedAt = now;

    for (const feature of entry.payload?.stopsGeoJson?.features || []) {
      const lineKey = String(feature?.properties?.line_key || "").trim();
      const stationKey = String(feature?.properties?.station_key || "").trim();
      if (!lineKey || !stationKey) {
        continue;
      }

      if (!stopStationKeysByLine.has(lineKey)) {
        stopStationKeysByLine.set(lineKey, new Set());
      }
      stopStationKeysByLine.get(lineKey).add(stationKey);

      if (!includeStopLineKeys.has(lineKey)) {
        continue;
      }

      const stopKey = `${lineKey}|${stationKey}`;
      if (!stopByLineAndStation.has(stopKey)) {
        stopByLineAndStation.set(stopKey, feature);
      } else {
        stopByLineAndStation.set(stopKey, mergeStopFeature(stopByLineAndStation.get(stopKey), feature));
      }
    }
  }

  const stopCountsByLine = new Map();
  for (const [lineKey, stationKeys] of stopStationKeysByLine.entries()) {
    stopCountsByLine.set(lineKey, Number(stationKeys?.size || 0));
  }

  const lineSummaries = Array.from(effectiveVisibleLineKeys)
    .map((lineKey) => {
      const line = lineByKeyAll.get(lineKey);
      if (!line) {
        return null;
      }

      return {
        ...line,
        lineKey,
        routeOnestopId: line.routeOnestopId || "",
        stopCount: stopCountsByLine.get(lineKey) || Number(line.stopCount || 0) || 0,
        mode: line.mode || modeLabelFromRouteType(line.routeType),
        serviceTier: line.serviceTier || lineServiceTier(line),
        frequencyBucket: line.frequencyBucket || lineFrequencyBucket(line),
        headwayBestMinutes: lineHeadwayBestMinutes(line),
        headwaySource: String(line.headwaySource || ""),
        headwayChecked: Number(line.headwayChecked || 0) === 1 ? 1 : 0
      };
    })
    .filter(Boolean);

  const loadedLineSummaries = Array.from(lineByKeyAll.entries())
    .map(([lineKey, line]) => {
      if (!line) {
        return null;
      }

      return {
        ...line,
        lineKey,
        routeOnestopId: line.routeOnestopId || "",
        stopCount: stopCountsByLine.get(lineKey) || Number(line.stopCount || 0) || 0,
        mode: line.mode || modeLabelFromRouteType(line.routeType),
        serviceTier: line.serviceTier || lineServiceTier(line),
        frequencyBucket: line.frequencyBucket || lineFrequencyBucket(line),
        headwayBestMinutes: lineHeadwayBestMinutes(line),
        headwaySource: String(line.headwaySource || ""),
        headwayChecked: Number(line.headwayChecked || 0) === 1 ? 1 : 0
      };
    })
    .filter(Boolean);

  lineSummaries.sort((a, b) => {
    const tierDiff = lineSortWeight(a) - lineSortWeight(b);
    if (tierDiff !== 0) {
      return tierDiff;
    }

    const stopDiff = Number(b.stopCount || 0) - Number(a.stopCount || 0);
    if (stopDiff !== 0) {
      return stopDiff;
    }
    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  loadedLineSummaries.sort((a, b) => {
    const tierDiff = lineSortWeight(a) - lineSortWeight(b);
    if (tierDiff !== 0) {
      return tierDiff;
    }

    const stopDiff = Number(b.stopCount || 0) - Number(a.stopCount || 0);
    if (stopDiff !== 0) {
      return stopDiff;
    }
    return lineDisplayName(a).localeCompare(lineDisplayName(b));
  });

  appState.transit = {
    routesGeoJson: {
      type: "FeatureCollection",
      features: Array.from(routeByLine.values())
    },
    stopsGeoJson: {
      type: "FeatureCollection",
      features: Array.from(stopByLineAndStation.values())
    }
  };
  appState.lineSummaries = lineSummaries;
  appState.loadedLineSummaries = loadedLineSummaries;
  const rebuildElapsed = performance.now() - rebuildStart;
  if (rebuildElapsed > 30) {
    console.log(`[perf] rebuildCombinedTransit: ${rebuildElapsed.toFixed(1)}ms, ${appState.activeAreaKeys.size} areas, ${lineSummaries.length} lines`);
  }
}

