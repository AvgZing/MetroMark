const config = require("../../admin/config");
const db = require("../../processors/data");
const { getCityBySlug } = require("../../processors/city-presets");
const {
  TRANSIT_CACHE_PREFIX,
  getTransitlandMetrics
} = require("./metrics");
const {
  sanitizeText,
  normalizeStopLocationTypes,
  normalizeRouteTypes
} = require("./helpers");
const {
  fetchRoutesAndStopsForBbox
} = require("./fetch");
const {
  toBboxString
} = require("./bbox");
const {
  transitlandRequest,
  buildTransitPayload
} = require("./payload");
const {
  simplifyGeometryForZoom,
  geometrySourceHash
} = require("./geometry");
const {
  buildFeedFingerprint,
  buildFeedFingerprintFromRoutes
} = require("./fingerprint");
const {
  applyRouteOrderingMetadataToPayload
} = require("./ordering");
const {
  getRouteStopsTransit
} = require("./route-stops");
const {
  getRouteHeadway,
  getRouteHeadwaysBulk
} = require("./route-headway");

async function getTransitForArea(area, options = {}) {
  const t0 = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = `${TRANSIT_CACHE_PREFIX}${area.key}`;
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes || area.routeTypes);
  const summaryOnly = Boolean(options.summaryOnly);

  const summaryOnlyPayload = (routesGeoJson, lineSummaries) => ({
    routesGeoJson: routesGeoJson && Array.isArray(routesGeoJson.features)
      ? routesGeoJson
      : { type: "FeatureCollection", features: [] },
    lineSummaries: Array.isArray(lineSummaries) ? lineSummaries : [],
    area: { bbox: area.bbox }
  });

  function logGetTransitTiming(detail) {
    const elapsed = Date.now() - t0;
    if (elapsed > 200) {
      console.log(`[perf] getTransitForArea(${area.key.slice(0, 60)}): ${elapsed}ms - ${detail}`);
    }
  }

  const spatialZoom = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : 15;

  if (summaryOnly) {
    // For summaryOnly (sidebar filter counts), query route_geometry_lod
    if (!forceRefresh) {
      const routeGeometries = await db.getRouteGeometriesByBbox(area.bbox, spatialZoom);
      if (routeGeometries.length > 0) {
        const lineKeys = routeGeometries.map((entry) => entry.lineKey);
        let metadataByLineKey = new Map();
        try {
          metadataByLineKey = await db.getRouteMetadatasByLineKeys(lineKeys);
        } catch { /* best-effort */ }
        const lineSummaries = lineKeys.map((lk) => {
          const meta = metadataByLineKey.get(lk);
          return meta ? { ...meta, lineKey: lk } : { lineKey: lk, lineName: lk };
        });
        logGetTransitTiming("route-geometry:summaryOnly:" + routeGeometries.length);
        return {
          payload: summaryOnlyPayload({ type: "FeatureCollection", features: [] }, lineSummaries),
          cacheStatus: "hit",
          cacheKey: area.key,
          stopLocationTypes
        };
      }
    }
    // Not found in route_geometry_lod
    if (Boolean(options.cacheOnly)) {
      return {
        payload: summaryOnlyPayload({ type: "FeatureCollection", features: [] }, []),
        cacheStatus: "miss",
        cacheKey: area.key,
        stopLocationTypes
      };
    }
    // Not cacheOnly — fall through to Transitland fetch below
  }

  // ─── Per-route spatial query path ──────────────────────────────────────
  // One source of truth for route geometry: route_geometry_lod.
  // Keyed by line_key, GiST-indexed, no tile fragmentation.
  // Transitland feeds this table when it's empty for a viewport.
  if (!forceRefresh) {
    const routeGeometries = await db.getRouteGeometriesByBbox(area.bbox, spatialZoom);

    if (routeGeometries.length > 0) {
      const routeFeatures = [];
      const lineSummaries = [];

      // Collect all line keys for batch metadata lookup
      const lineKeys = routeGeometries.map((entry) => entry.lineKey);

      // Query route_metadata for per-route properties (name, color, operator, etc.)
      let metadataByLineKey = new Map();
      try {
        metadataByLineKey = await db.getRouteMetadatasByLineKeys(lineKeys);
      } catch (error) {
        console.warn("[perf] getMetadatasByLineKeys failed: " + (error?.message || error) + " (lineKeys: " + lineKeys.length + ")");
        // Non-critical — routes display fine without enriched metadata
      }

      if (metadataByLineKey.size > 0) {
        console.log("[perf] getMetadatasByLineKeys: found " + metadataByLineKey.size + " metadata entries for " + lineKeys.length + " routes");
      }

      for (const entry of routeGeometries) {
        const geometry = simplifyGeometryForZoom(entry.geometry, spatialZoom);
        const lk = entry.lineKey;
        const meta = metadataByLineKey.get(lk);

        const properties = meta ? {
          feature_id: lk,
          line_key: lk,
          route_onestop_id: String(meta.routeOnestopId || ""),
          line_name: String(meta.lineName || ""),
          line_short_name: String(meta.lineShortName || ""),
          line_long_name: String(meta.lineLongName || ""),
          operator_name: String(meta.operatorName || ""),
          mode: String(meta.mode || ""),
          route_type: Number.isFinite(Number(meta.routeType)) ? Number(meta.routeType) : null,
          route_feed_id: String(meta.routeFeedId || ""),
          service_tier: String(meta.serviceTier || ""),
          frequency_bucket: String(meta.frequencyBucket || "unknown"),
          headway_best_minutes: Number.isFinite(Number(meta.headwayBestMinutes))
            ? Number(meta.headwayBestMinutes) : null,
          headway_source: String(meta.headwaySource || ""),
          headway_checked: Number(meta.headwayChecked || 0) === 1 ? 1 : 0,
          color: String(meta.color || "#d44d1f")
        } : { line_key: lk };

        routeFeatures.push({
          type: "Feature",
          id: lk,
          geometry,
          properties
        });

        lineSummaries.push(meta ? { ...meta, lineKey: lk, stopCount: meta.stopCount || 0 } : { lineKey: lk, lineName: lk, stopCount: 0 });
      }

    const routesGeoJson = { type: "FeatureCollection", features: routeFeatures };
    const stopsGeoJson = { type: "FeatureCollection", features: [] };

    const spatialPayload = {
      routesGeoJson,
      stopsGeoJson,
      lineSummaries,
      area: { bbox: area.bbox },
      matchingStats: {
        routeCount: routeGeometries.length,
        metadataCacheCount: metadataByLineKey.size
      }
    };

    if (summaryOnly) {
      logGetTransitTiming("route-geometry:summaryOnly");
      return {
        payload: summaryOnlyPayload(routesGeoJson, lineSummaries),
        cacheStatus: "hit",
        cacheKey: area.key,
        stopLocationTypes
      };
    }

    let enrichedPayload = spatialPayload;
    try {
      enrichedPayload = await applyRouteOrderingMetadataToPayload(spatialPayload);
    } catch {
      // Best-effort
    }

    logGetTransitTiming(`route-geometry:${routeGeometries.length}routes`);
    return {
      payload: enrichedPayload,
      cacheStatus: "hit",
      cacheKey: area.key,
      stopLocationTypes
    };
  }

  // route_geometry_lod is empty for this viewport.
  // If cacheOnly, return miss. If NOT cacheOnly, go to Transitland.
  if (Boolean(options.cacheOnly) && !forceRefresh) {
    logGetTransitTiming("route-geometry:empty");
    return {
      payload: summaryOnly
        ? summaryOnlyPayload({ type: "FeatureCollection", features: [] }, [])
        : { routesGeoJson: { type: "FeatureCollection", features: [] }, stopsGeoJson: { type: "FeatureCollection", features: [] }, lineSummaries: [], area: { bbox: area.bbox } },
      cacheStatus: "miss",
      cacheKey: area.key,
      stopLocationTypes
    };
  }

  // If neither spatial query nor cacheOnly returned, fall through to Transitland
  }

  logGetTransitTiming('fetching-from-transitland');
  const fetchResult = await fetchRoutesAndStopsForBbox(area.bbox, {
    ...options,
    stopLocationTypes,
    routeTypes
  });

  const payload = await buildTransitPayload(area, fetchResult.routes || [], fetchResult.stops || [], {
    zoom: Number(options.zoom),
    stopLocationTypes,
    routeTypes,
    vectorHeadwayMeta: fetchResult.vectorHeadwayMeta,
    requestSource: options.requestSource
  });

  const enrichedPayload = await applyRouteOrderingMetadataToPayload(payload);

  const storeZoom = Math.max(15, Math.round(Number(options.zoom) || 15));
  for (const feature of enrichedPayload?.routesGeoJson?.features || []) {
    const lineKey = feature?.properties?.line_key;
    const geometry = feature?.geometry;
    if (lineKey && geometry && geometry.type && geometry.coordinates) {
      try {
        await db.upsertRouteGeometryLod(lineKey, storeZoom, geometry, {
          sourceHash: geometrySourceHash(geometry)
        });
      } catch { /* Best-effort */ }
    }
  }

  for (const line of enrichedPayload?.lineSummaries || []) {
    const lk = line?.lineKey;
    if (lk) {
      try {
        await db.setRouteMetadata(lk, {
          routeOnestopId: line.routeOnestopId,
          lineName: line.lineName,
          lineShortName: line.lineShortName,
          lineLongName: line.lineLongName,
          operatorName: line.operatorName,
          mode: line.mode,
          routeType: line.routeType,
          routeFeedId: line.routeFeedId,
          serviceTier: line.serviceTier,
          frequencyBucket: line.frequencyBucket,
          headwayBestMinutes: line.headwayBestMinutes,
          headwaySource: line.headwaySource,
          headwayChecked: line.headwayChecked,
          color: line.color,
          stopCount: Number(line.stopCount || 0)
        });
      } catch { /* Best-effort */ }
    }
  }

  const ttlSeconds = Math.max(60, Number(config.TRANSIT_CACHE_TTL_HOURS || 2160) * 3600);
  const fetchedAt = Math.floor(Date.now() / 1000);
  const feedFingerprint = buildFeedFingerprint(payload);

  await db.setCache(cacheKey, payload, ttlSeconds, {
    cacheKind: area.kind || "bbox",
    citySlug: area.slug || null,
    feedFingerprint,
    verifiedAt: fetchedAt
  });

  // Serve from Postgres — never raw Transitland response
  const responseGeometries = await db.getRouteGeometriesByBbox(area.bbox, spatialZoom);
  const responseFeatures = [];
  const responseLineSummaries = [];
  const responseLineKeys = responseGeometries.map((entry) => entry.lineKey);
  let responseMetadata = new Map();

  if (responseLineKeys.length) {
    try {
      responseMetadata = await db.getRouteMetadatasByLineKeys(responseLineKeys);
    } catch { /* Best-effort */ }
  }

  for (const entry of responseGeometries) {
    const geometry = simplifyGeometryForZoom(entry.geometry, spatialZoom);
    const lk = entry.lineKey;
    const meta = responseMetadata.get(lk);

    responseFeatures.push({
      type: "Feature",
      id: lk,
      geometry,
      properties: meta ? {
        feature_id: lk,
        line_key: lk,
        route_onestop_id: String(meta.routeOnestopId || ""),
        line_name: String(meta.lineName || ""),
        line_short_name: String(meta.lineShortName || ""),
        line_long_name: String(meta.lineLongName || ""),
        operator_name: String(meta.operatorName || ""),
        mode: String(meta.mode || ""),
        route_type: Number.isFinite(Number(meta.routeType)) ? Number(meta.routeType) : null,
        route_feed_id: String(meta.routeFeedId || ""),
        service_tier: String(meta.serviceTier || ""),
        frequency_bucket: String(meta.frequencyBucket || "unknown"),
        headway_best_minutes: Number.isFinite(Number(meta.headwayBestMinutes)) ? Number(meta.headwayBestMinutes) : null,
        headway_source: String(meta.headwaySource || ""),
        headway_checked: Number(meta.headwayChecked || 0) === 1 ? 1 : 0,
        color: String(meta.color || "#d44d1f")
      } : { line_key: lk }
    });

    responseLineSummaries.push(meta ? { ...meta, lineKey: lk, stopCount: meta.stopCount || 0 } : { lineKey: lk, lineName: lk, stopCount: 0 });
  }

  const fromPostgresPayload = {
    routesGeoJson: { type: "FeatureCollection", features: responseFeatures },
    stopsGeoJson: { type: "FeatureCollection", features: [] },
    lineSummaries: responseLineSummaries,
    area: { bbox: area.bbox },
    matchingStats: { routeCount: responseFeatures.length }
  };

  let enrichedFromPostgres = fromPostgresPayload;
  try {
    enrichedFromPostgres = await applyRouteOrderingMetadataToPayload(fromPostgresPayload);
  } catch { /* Best-effort */ }

  const result = {
    payload: enrichedFromPostgres,
    cacheStatus: "miss",
    cacheKey: area.key,
    cacheExpiresAt: fetchedAt + ttlSeconds,
    cacheVerifiedAt: fetchedAt,
    feedFingerprint,
    stopLocationTypes
  };

  if (options.debug) {
    result.debug = {
      fetchDiagnostics: fetchResult.diagnostics || null,
      areaBbox: area.bbox,
      requestedRouteTypes: routeTypes,
      vectorHeadwayMeta: fetchResult.vectorHeadwayMeta || null
    };
  }

  return result;
}

async function getCityTransit(slug, options = {}) {
  const city = getCityBySlug(slug);
  if (!city) {
    return null;
  }

  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const routeTypeKey = routeTypes.length ? routeTypes.join("-") : "all";

  const area = {
    key: `city:${city.slug}:route-catalog:route-types:${routeTypeKey}`,
    kind: "city",
    slug: city.slug,
    name: city.name,
    country: city.country,
    center: city.center,
    bbox: city.bbox,
    routeTypes,
    harvestPriority: Number(options.harvestPriority || 100)
  };

  const result = await getTransitForArea(area, {
    ...options,
    stopLocationTypes,
    routeTypes
  });

  return {
    ...result,
    stopLocationTypes,
    routeTypes
  };
}

async function getCityFeedFingerprint(slug, options = {}) {
  const city = getCityBySlug(slug);
  if (!city) {
    return null;
  }

  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const routeLimit = Math.max(80, Number(config.ROUTE_CATALOG_MAX_RESULTS || 220));
  const params = {
    bbox: toBboxString(city.bbox),
    include_geometry: "false",
    limit: String(routeLimit)
  };

  if (routeTypes.length) {
    params.route_types = routeTypes.join(",");
  }

  const routesResponse = await transitlandRequest("/routes", params, {
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  const routes = Array.isArray(routesResponse?.routes) ? routesResponse.routes : [];
  return {
    citySlug: city.slug,
    routeCount: routes.length,
    feedFingerprint: buildFeedFingerprintFromRoutes(routes)
  };
}

module.exports = {
  getCityTransit,
  getCityFeedFingerprint,
  getRouteStopsTransit,
  getRouteHeadway,
  getRouteHeadwaysBulk,
  getTransitlandMetrics,
  TRANSIT_CACHE_PREFIX
};
