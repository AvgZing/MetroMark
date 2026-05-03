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
  const streetsActive = state.mapMode === "streets";
  els.streetsModeBtn.classList.toggle("btn-primary", streetsActive);
  els.satelliteModeBtn.classList.toggle("btn-primary", !streetsActive);
}

function setMapMode(mode) {
  state.mapMode = mode;
  if (!state.map || !state.map.getLayer("satellite-base")) {
    return;
  }

  state.map.setLayoutProperty("satellite-base", "visibility", mode === "satellite" ? "visible" : "none");
  updateMapModeButtons();
}

function mapBoundsToBbox() {
  if (!state.map) {
    return null;
  }

  const bounds = state.map.getBounds();
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

function visibleCachedAreaKeysForViewport(rawBbox) {
  const normalizedViewportBbox = normalizeBboxArray(rawBbox);
  if (!normalizedViewportBbox) {
    return new Set();
  }
  const visible = new Set();

  for (const [cacheKey, entry] of state.areaCache.entries()) {
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
  // For low-zoom views (below Transitland threshold), do a single viewport overlap
  // request against Postgres instead of tile-budgeting. This avoids city-like limits
  // and allows all intersecting cached geometry in the viewport to be returned.
  if (Number(zoom || 0) < MIN_VIEWPORT_FETCH_ZOOM) {
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
  state.areaCache.set(cacheKey, {
    cacheKey,
    payload,
    cacheStatus,
    lastUsedAt: Date.now()
  });

  pruneAreaCache();
}

function pruneAreaCache() {
  if (state.areaCache.size <= MAX_SESSION_AREAS) {
    return;
  }

  const protectedKeys = new Set([
    ...state.requestedAreaKeys,
    ...state.inFlightAreaKeys,
    ...state.queuedAreaKeys
  ]);

  const sorted = Array.from(state.areaCache.entries()).sort(
    (a, b) => Number(a[1].lastUsedAt || 0) - Number(b[1].lastUsedAt || 0)
  );

  for (const [key] of sorted) {
    if (state.areaCache.size <= MAX_SESSION_AREAS) {
      break;
    }
    if (protectedKeys.has(key)) {
      continue;
    }
    state.areaCache.delete(key);
  }
}

function routeStopCacheKey(lineKey) {
  return `${String(lineKey || "")}|types:${ROUTE_STOP_TYPES_KEY}`;
}

function pruneLineStopsCache() {
  if (state.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
    return;
  }

  const focusedCacheKey = state.focusedLineKey ? routeStopCacheKey(state.focusedLineKey) : "";

  const sorted = Array.from(state.lineStopsCache.entries()).sort(
    (a, b) => Number(a[1]?.lastUsedAt || 0) - Number(b[1]?.lastUsedAt || 0)
  );

  for (const [cacheKey] of sorted) {
    if (state.lineStopsCache.size <= MAX_SESSION_ROUTE_STOP_PAYLOADS) {
      break;
    }
    if (cacheKey === focusedCacheKey || state.inFlightLineStopKeys.has(cacheKey)) {
      continue;
    }
    state.lineStopsCache.delete(cacheKey);
  }
}

function syncActiveAreaKeys(options = {}) {
  const now = Date.now();
  const retainedVisibleKeys = options.retainVisibleKeys || null;
  const allowRetainOutsideRequested = Boolean(options.allowRetainOutsideRequested);

  state.activeAreaKeys = new Set(state.visibleAreaKeys);
  state.visibleAreaKeys = new Set();

  for (const key of state.requestedAreaKeys) {
    const entry = state.areaCache.get(key);
    if (!entry) {
      continue;
    }

    entry.lastUsedAt = now;
    state.visibleAreaKeys.add(key);
  }

  if (retainedVisibleKeys instanceof Set && options.mergeRetainedVisibleKeys) {
    for (const key of retainedVisibleKeys) {
      if (!state.areaCache.has(key)) {
        continue;
      }
      if (allowRetainOutsideRequested || state.requestedAreaKeys.has(key)) {
        state.visibleAreaKeys.add(key);
      }
    }
  } else if (state.visibleAreaKeys.size === 0 && retainedVisibleKeys instanceof Set) {
    for (const key of retainedVisibleKeys) {
      if (!state.areaCache.has(key)) {
        continue;
      }
      if (allowRetainOutsideRequested || state.requestedAreaKeys.has(key)) {
        state.visibleAreaKeys.add(key);
      }
    }
  }

  if (state.visibleAreaKeys.size === 0 && options.fallbackToAllCached) {
    state.visibleAreaKeys = new Set(state.activeAreaKeys);
    state.activeAreaKeys = new Set(state.visibleAreaKeys);
  }
}

// Debounced scheduler for syncActiveAreaKeys to avoid rapid duplicate calls
let _pendingSyncActiveOptions = null;
let _syncActiveAreaKeysTimer = null;
function scheduleSyncActiveAreaKeys(options = {}) {
  _pendingSyncActiveOptions = Object.assign({}, _pendingSyncActiveOptions || {}, options || {});
  if (_syncActiveAreaKeysTimer) {
    clearTimeout(_syncActiveAreaKeysTimer);
  }
  _syncActiveAreaKeysTimer = setTimeout(() => {
    try {
      syncActiveAreaKeys(_pendingSyncActiveOptions || {});
    } finally {
      _pendingSyncActiveOptions = null;
      _syncActiveAreaKeysTimer = null;
    }
  }, 80);
}

function resetViewAggregation() {
  state.loadEpoch += 1;
  state.requestedAreaKeys = new Set();
  state.visibleAreaKeys = new Set();
  state.activeAreaKeys = new Set();
  state.fetchQueue = [];
  state.queuedAreaKeys.clear();
  state.focusedLineKey = "";
  state.lastLoadStats = {
    requested: 0,
    cached: 0,
    queued: 0,
    deferred: 0,
    failed: 0,
    successful: 0
  };
}

function rebuildCombinedTransit() {
  if (state.activeAreaKeys.size === 0) {
    state.transit = null;
    state.lineSummaries = [];
    state.focusedLineKey = "";
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
  const viewportBbox = normalizeBboxArray(state.currentViewportBbox);

  for (const cacheKey of state.activeAreaKeys) {
    const payload = state.areaCache.get(cacheKey)?.payload;
    if (!payload) {
      continue;
    }

    for (const feature of payload?.routesGeoJson?.features || []) {
      const lineKey = feature?.properties?.line_key;
      if (!lineKey) {
        continue;
      }
      if (!routeByLine.has(lineKey)) {
        routeByLine.set(lineKey, feature);
      }
    }

    for (const line of payload?.lineSummaries || []) {
      const lineKey = line?.lineKey;
      if (!lineKey) {
        continue;
      }

      const merged = mergeLineEntries(lineByKeyAll.get(lineKey), line);
      lineByKeyAll.set(lineKey, merged);
      if (state.visibleAreaKeys.has(cacheKey)) {
        visibleLineKeys.add(lineKey);
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

  if (state.focusedLineKey && !lineByKeyAll.has(state.focusedLineKey)) {
    state.focusedLineKey = "";
  }

  const stopByLineAndStation = new Map();
  const activeStopTypeKey = ROUTE_STOP_TYPES_KEY;
  const now = Date.now();

  for (const entry of state.lineStopsCache.values()) {
    if (!entry || entry.stopTypesKey !== activeStopTypeKey) {
      continue;
    }

    if (!lineByKeyAll.has(entry.lineKey)) {
      continue;
    }

    entry.lastUsedAt = now;

    for (const feature of entry.payload?.stopsGeoJson?.features || []) {
      const lineKey = feature?.properties?.line_key;
      const stationKey = feature?.properties?.station_key;
      if (!lineKey || !stationKey) {
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
  for (const feature of stopByLineAndStation.values()) {
    const lineKey = feature?.properties?.line_key;
    if (!lineKey) {
      continue;
    }
    stopCountsByLine.set(lineKey, (stopCountsByLine.get(lineKey) || 0) + 1);
  }

  const effectiveVisibleLineKeys = new Set(visibleLineKeys);

  for (const [lineKey, override] of state.manualLineVisibility.entries()) {
    const normalizedOverride = String(override || "").trim().toLowerCase();
    if (normalizedOverride === "on" && lineByKeyAll.has(lineKey)) {
      // Only include manual override if route geometry intersects current viewport
      const line = lineByKeyAll.get(lineKey);
      if (line && geometryIntersectsBbox(line.geometry, state.currentViewportBbox)) {
        effectiveVisibleLineKeys.add(lineKey);
      }
    } else if (normalizedOverride === "off") {
      // Explicitly hidden lines are removed from visibility
      effectiveVisibleLineKeys.delete(lineKey);
    }
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

  state.transit = {
    routesGeoJson: {
      type: "FeatureCollection",
      features: Array.from(routeByLine.values())
    },
    stopsGeoJson: {
      type: "FeatureCollection",
      features: Array.from(stopByLineAndStation.values())
    }
  };
  state.lineSummaries = lineSummaries;
}

