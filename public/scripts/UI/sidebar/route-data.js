async function ensureLineStopsLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const cacheKey = routeStopCacheKey(normalizedLineKey);
  const existing = appState.lineStopsCache.get(cacheKey);
  const requestOptions = { ...options };
  if (existing && !requestOptions.forceRefresh) {
    if (requestOptions.cacheOnly) {
      existing.lastUsedAt = Date.now();
      return true;
    }

    const needsPatternRefresh = !existing.payload?.directionStopPatterns && !existing.patternsRefreshAttempted;
    if (!needsPatternRefresh) {
      if (appState.routeStopsAutoLoadAttempts) {
        appState.routeStopsAutoLoadAttempts.delete(cacheKey);
      }
      existing.lastUsedAt = Date.now();
      refreshRouteStopDependentUi({
        forceStopRefresh: false
      });
      return true;
    }
    existing.patternsRefreshAttempted = true;
    requestOptions.forceRefresh = true;
    requestOptions.silent = true;
  }

  if (appState.inFlightLineStopKeys.has(cacheKey)) {
    return false;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  const lineLabel = line ? lineDisplayName(line) : normalizedLineKey;
  const routeStopLookupKey = String(line?.routeOnestopId || normalizedLineKey).trim();

  appState.inFlightLineStopKeys.add(cacheKey);
  updateLoadingStatus();

  if (!requestOptions.silent) {
    setStatus(`Loading stops for ${lineLabel}...`, "ok", "Using route membership from Transitland.");
  }

  try {
    const params = new URLSearchParams({
      lineKey: routeStopLookupKey,
      stopTypes: ROUTE_STOP_TYPES_QUERY
    });

    if (requestOptions.cacheOnly) {
      params.set("cacheOnly", "1");
    }

    if (requestOptions.forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/route-stops?${params.toString()}`, {
      method: "GET"
    });

    const hasStopPayload = Array.isArray(payload?.stopsGeoJson?.features);
    if (!hasStopPayload) {
      return false;
    }

    const compactPayload = compactRouteStopsPayload(payload);

    appState.lineStopsCache.set(cacheKey, {
      lineKey: normalizedLineKey,
      stopTypesKey: ROUTE_STOP_TYPES_KEY,
      payload: compactPayload,
      cacheStatus: payload.cacheStatus || "miss",
      lastUsedAt: Date.now()
    });

    if (appState.routeStopsAutoLoadAttempts) {
      appState.routeStopsAutoLoadAttempts.delete(cacheKey);
    }

    pruneLineStopsCache();
    refreshRouteStopDependentUi({
      forceStopRefresh: Boolean(requestOptions.forceRefresh)
    });
    restoreUserStatusFromFocus();

    const stationCount = Number(payload?.stopsGeoJson?.features?.length || 0);
    setBackendStatus(
      `Route stops ready for ${lineLabel} (${payload.cacheStatus || "miss"} cache, ${stationCount} stops).`
    );

    if (!requestOptions.silent) {
      setStatus(`Loaded ${stationCount} route-linked stops for ${lineLabel}.`, "ok");
    }

    return true;
  } catch (error) {
    setBackendStatus(`Route stop fetch failed for ${lineLabel}: ${error.message}`);
    if (!requestOptions.silent) {
      setStatus(`Could not load stops for ${lineLabel}.`, "error", error.message);
    }
    return false;
  } finally {
    appState.inFlightLineStopKeys.delete(cacheKey);
    updateLoadingStatus();
  }
}

function lineNeedsHeadwayLookup(line) {
  if (!line) {
    return false;
  }

  if (lineHeadwayBestMinutes(line) !== null) {
    return false;
  }

  return Number(line?.headwayChecked || 0) !== 1;
}

function normalizeHeadwayUpdate(payload) {
  const headwayBestMinutes = Number(payload?.headwayBestMinutes);
  const normalizedBestMinutes =
    Number.isFinite(headwayBestMinutes) && headwayBestMinutes > 0
      ? Number(headwayBestMinutes.toFixed(1))
      : null;

  const headwayFallback = Boolean(payload?.headwayFallback);

  const normalizedBucket = String(payload?.frequencyBucket || "").trim().toLowerCase();
  const frequencyBucket = normalizedBestMinutes
    ? frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
    : normalizedBucket || FREQUENCY_FILTER_UNKNOWN;

  return {
    headwayBestMinutes: headwayFallback ? null : normalizedBestMinutes,
    frequencyBucket,
    headwaySource: String(payload?.headwaySource || payload?.headwaySummary?.source || "").trim(),
    headwayChecked: 1,
    headwayFallback: headwayFallback ? 1 : 0
  };
}

function applyHeadwayUpdateToCachedTransit(lineKey, headwayUpdate) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  let updated = false;

  appState.lineSummaries = appState.lineSummaries.map((line) => {
    if (line.lineKey !== normalizedLineKey) {
      return line;
    }

    updated = true;
    return {
      ...line,
      ...headwayUpdate
    };
  });

  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    appState.loadedLineSummaries = appState.loadedLineSummaries.map((line) => {
      if (line.lineKey !== normalizedLineKey) {
        return line;
      }

      updated = true;
      return {
        ...line,
        ...headwayUpdate
      };
    });
  }

  if (appState.transit?.routesGeoJson?.features) {
    for (const feature of appState.transit.routesGeoJson.features) {
      const featureLineKey = String(feature?.properties?.line_key || "").trim();
      if (featureLineKey !== normalizedLineKey) {
        continue;
      }

      feature.properties = {
        ...feature.properties,
        frequency_bucket: headwayUpdate.frequencyBucket,
        headway_best_minutes: headwayUpdate.headwayBestMinutes,
        headway_source: headwayUpdate.headwaySource,
        headway_checked: headwayUpdate.headwayChecked
      };
    }
  }

  return updated;
}

function applyRouteStopCountSummaryToCachedTransit(lineKey, stopCount) {
  const normalizedLineKey = String(lineKey || "").trim();
  const normalizedStopCount = Number(stopCount || 0);
  if (!normalizedLineKey || !Number.isFinite(normalizedStopCount) || normalizedStopCount <= 0) {
    return false;
  }

  let updated = false;

  const updateLine = (line) => {
    if (!line || line.lineKey !== normalizedLineKey) {
      return line;
    }

    updated = true;
    return {
      ...line,
      stopCount: normalizedStopCount
    };
  };

  appState.lineSummaries = appState.lineSummaries.map(updateLine);

  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    appState.loadedLineSummaries = appState.loadedLineSummaries.map(updateLine);
  }

  if (appState.transit?.routesGeoJson?.features) {
    appState.transit.routesGeoJson.features = appState.transit.routesGeoJson.features.map((feature) => {
      const featureLineKey = String(feature?.properties?.line_key || "").trim();
      if (featureLineKey !== normalizedLineKey) {
        return feature;
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
          stop_count: normalizedStopCount,
          stopCount: normalizedStopCount
        }
      };
    });
  }

  return updated;
}

function applyProblematicGeometryToCachedTransit(lineKey, problematicGeometry) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const normalized = Boolean(problematicGeometry);
  let updated = false;

  const updateLine = (line) => {
    if (!line || line.lineKey !== normalizedLineKey) {
      return line;
    }
    updated = true;
    return {
      ...line,
      problematicGeometry: normalized
    };
  };

  appState.lineSummaries = appState.lineSummaries.map(updateLine);

  if (Array.isArray(appState.loadedLineSummaries) && appState.loadedLineSummaries.length > 0) {
    appState.loadedLineSummaries = appState.loadedLineSummaries.map(updateLine);
  }

  if (appState.transit?.routesGeoJson?.features) {
    appState.transit.routesGeoJson.features = appState.transit.routesGeoJson.features.map((feature) => {
      const featureLineKey = String(feature?.properties?.line_key || "").trim();
      if (featureLineKey !== normalizedLineKey) {
        return feature;
      }
      return {
        ...feature,
        properties: {
          ...feature.properties,
          problematic_geometry: normalized ? 1 : 0,
          problematicGeometry: normalized
        }
      };
    });
  }

  return updated;
}

async function ensureLineHeadwayLoaded(lineKey, options = {}) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    return false;
  }

  const line = appState.lineSummaries.find((entry) => entry.lineKey === normalizedLineKey);
  if (!line) {
    return false;
  }

  if (!options.forceRefresh && !lineNeedsHeadwayLookup(line)) {
    return false;
  }

  if (appState.inFlightHeadwayLineKeys.has(normalizedLineKey)) {
    return false;
  }

  const lineLabel = lineDisplayName(line);
  const routeLookupKey = String(line.routeOnestopId || normalizedLineKey).trim();

  appState.inFlightHeadwayLineKeys.add(normalizedLineKey);

  try {
    const params = new URLSearchParams({
      lineKey: routeLookupKey
    });

    if (options.forceRefresh) {
      params.set("refresh", "1");
    }

    const payload = await apiRequest(`/api/transit/route-headway?${params.toString()}`, {
      method: "GET"
    });

    const headwayUpdate = normalizeHeadwayUpdate(payload);
    const didUpdate = applyHeadwayUpdateToCachedTransit(normalizedLineKey, headwayUpdate);

    if (didUpdate) {
      refreshUiFromState();
      restoreUserStatusFromFocus();
    }

    if (!options.silent && headwayUpdate.headwayBestMinutes !== null) {
      setStatus(`Updated frequency for ${lineLabel}.`, "ok");
    }

    return didUpdate;
  } catch (error) {
    if (!options.silent) {
      setStatus(`Could not refresh frequency for ${lineLabel}.`, "error", error.message);
    }
    return false;
  } finally {
    appState.inFlightHeadwayLineKeys.delete(normalizedLineKey);
  }
}

let metadataLoadTimer = null;

// Run the metadata loader once after the map is fully idle (all tiles
// rendered) so every viewport line is present in lineSummaries when queried —
// the moveend-triggered pass can otherwise fire against a partial viewport.
function scheduleMetadataLoad() {
  if (metadataLoadTimer) {
    clearTimeout(metadataLoadTimer);
  }
  metadataLoadTimer = setTimeout(() => {
    metadataLoadTimer = null;
    if (typeof loadVisibleRouteHeadways === "function") {
      loadVisibleRouteHeadways().catch(() => {});
    }
    if (typeof loadVisibleRouteStops === "function") {
      loadVisibleRouteStops().catch(() => {});
    }
  }, 800);
}

// Prefetch stops for the visible viewport (bounded) so dots appear without
// waiting for a click or the "Show all stops" toggle.
let stopsPrefetchInFlight = false;

async function loadVisibleRouteStops() {
  if (!appState.lineSummaries.length || stopsPrefetchInFlight) {
    return false;
  }
  if (!appState.map || !appState.mapReady) {
    return false;
  }

  const zoom = Number(appState.map.getZoom() || 0);
  const minZoom = typeof BACKFILL_MIN_ZOOM !== "undefined" ? BACKFILL_MIN_ZOOM : 8;
  if (zoom < minZoom) {
    return false;
  }

  // Visible, not-yet-cached, not-in-flight lines only.
  const candidates = [];
  for (const line of appState.lineSummaries) {
    if (!line || !line.lineKey) {
      continue;
    }
    if (typeof lineIsVisible === "function" && !lineIsVisible(line)) {
      continue;
    }
    const cacheKey = routeStopCacheKey(line.lineKey);
    const cached = appState.lineStopsCache.get(cacheKey);
    if (cached?.payload?.stopsGeoJson?.features?.length) {
      continue;
    }
    if (appState.inFlightLineStopKeys.has(cacheKey)) {
      continue;
    }
    candidates.push(line.lineKey);
  }

  if (!candidates.length) {
    return false;
  }

  stopsPrefetchInFlight = true;
  const MAX_PREFETCH = 20;
  const batch = candidates.slice(0, MAX_PREFETCH);
  if (batch.length > 0) {
    setStatus(
      `Loading stops for ${batch.length} visible route${batch.length === 1 ? "" : "s"}…`,
      "neutral",
      "Prefetching stops so they appear without clicking."
    );
  }

  const results = await Promise.allSettled(
    batch.map((lineKey) =>
      ensureLineStopsLoaded(lineKey, {
        silent: true,
        cacheOnly: false
      })
    )
  );

  stopsPrefetchInFlight = false;
  const loaded = results.filter((r) => r.status === "fulfilled" && r.value === true).length;

  if (loaded > 0) {
    refreshRouteStopDependentUi({ forceStopRefresh: false });
    if (typeof updateLoadingStatus === "function") {
      updateLoadingStatus();
    }
  }

  return loaded > 0;
}

async function loadVisibleRouteHeadways() {
  if (!appState.lineSummaries.length) {
    return false;
  }

  // Frequency isn't meaningful at global scale; defer the auto-load until the
  // user is zoomed in enough to read individual routes.
  const zoom = appState.map && appState.mapReady ? Number(appState.map.getZoom()) : 0;
  if (zoom < (typeof BACKFILL_MIN_ZOOM !== "undefined" ? BACKFILL_MIN_ZOOM : 8)) {
    return false;
  }

  // Query every line in the current viewport (not just mode-shown lines), so
  // stored headway + stop counts reach the sidebar, filters, and progress panel
  // regardless of the active mode filter.
  const candidates = appState.lineSummaries.filter((line) => {
    if (!line || !line.lineKey) {
      return false;
    }
    const needsHeadway = lineNeedsHeadwayLookup(line);
    const needsStopCount = Number(line.stopCount || 0) <= 0;
    if (!needsHeadway && !needsStopCount) {
      return false;
    }
    if (appState.inFlightHeadwayLineKeys.has(line.lineKey)) {
      return false;
    }
    return true;
  });

  if (!candidates.length) {
    return false;
  }

  // Bulk lookup: one (or a few chunked) request(s) for all lines that still
  // need headway and/or stop counts. The response carries both, read from
  // route_metadata; the rest load individually on focus.
  const keys = candidates.map((line) => line.lineKey);

  const BULK_CHUNK = 500;
  const chunks = [];
  for (let i = 0; i < keys.length; i += BULK_CHUNK) {
    chunks.push(keys.slice(i, i + BULK_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      apiRequest(`/api/transit/route-headway/bulk?${new URLSearchParams({ lineKeys: chunk.join(",") })}`, { method: "GET" })
        .then((payload) => payload?.headwayByLineKey || {})
        .catch(() => ({}))
    )
  );

  let applied = 0;
  for (const headwayByLineKey of results) {
    for (const [lineKey, hw] of Object.entries(headwayByLineKey)) {
      const stopCount = Number(hw.stopCount || 0);
      if (stopCount > 0) {
        const didStopCount = applyRouteStopCountSummaryToCachedTransit(lineKey, stopCount);
        if (didStopCount) {
          applied += 1;
        }
      }
      if (Object.prototype.hasOwnProperty.call(hw, "problematicGeometry")) {
        const didProblematic = applyProblematicGeometryToCachedTransit(lineKey, hw.problematicGeometry);
        if (didProblematic) {
          applied += 1;
        }
      }
      if (Number(hw.headwayChecked || 0) === 1) {
        const didHeadway = applyHeadwayUpdateToCachedTransit(lineKey, {
          headwayBestMinutes: Number(hw.headwayBestMinutes),
          frequencyBucket: String(hw.frequencyBucket || "unknown"),
          headwaySource: String(hw.headwaySource || "postgres"),
          headwayChecked: 1,
          headwayFallback: Number(hw.headwayFallback || 0)
        });
        if (didHeadway) {
          applied += 1;
        }
      }
    }
  }

  if (applied > 0) {
    renderLineList();
    renderProgress();
    renderFrequencyFilterBar();
    if (typeof updateLoadingStatus === "function") {
      updateLoadingStatus();
    }
  }

  return applied > 0;
}
