const crypto = require("crypto");
const config = require("../../admin/config");
const db = require("../../processors/data");
const { getCityBySlug } = require("../../processors/city-presets");
const { geometryBbox } = require("../../processors/postgres/spatial");
const {
  TRANSIT_CACHE_PREFIX
} = require("./metrics");
const {
  sanitizeText,
  normalizeStopLocationTypes,
  normalizeRouteTypes,
  isCacheExpiredRow,
  getTransitlandMetrics
} = require("./helpers");
const {
  routeLookupKeysFromObject,
  fetchVectorRouteHeadwaysForBbox
} = require("./routes");
const {
  fetchRoutesAndStopsForBbox,
  fetchRouteByLineKey,
  fetchStopsForRoute
} = require("./fetch");
const {
  normalizeBboxForCache,
  toBboxString,
  bboxCenter
} = require("./bbox");
const {
  frequencyBucketFromHeadwayMinutes,
  isFallbackHeadwaySeconds,
  isFallbackHeadwayMinutes,
  fallbackFrequencyBucketForRoute,
  fetchRouteHeadwaySummary
} = require("./headway");
const {
  transitlandRequest,
  buildTransitPayload,
  buildDirectionStopSequencesForRoute,
  buildRouteStopsPayload
} = require("./payload");
const {
  simplifyGeometryForZoom,
  geometrySourceHash
} = require("./geometry");

async function getRouteStopsTransit(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const cacheOnly = Boolean(options.cacheOnly);
  const summaryOnly = Boolean(options.summaryOnly);
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const stopTypeKey = stopLocationTypes.join("-");
  const cacheKey = `${TRANSIT_CACHE_PREFIX}route:${normalizedLineKey}:types:${stopTypeKey}`;

  if (!forceRefresh) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached) {
      const cacheStatus = isCacheExpiredRow(cached) ? "stale-hit" : "hit";
      const cachedLineSummary = Array.isArray(cached.payload?.lineSummaries) ? cached.payload.lineSummaries[0] || null : null;

      if (cachedLineSummary && normalizedLineKey) {
        try {
          await db.setRouteMetadata(normalizedLineKey, {
            routeOnestopId: cachedLineSummary.routeOnestopId || "",
            lineName: cachedLineSummary.lineName || "",
            lineShortName: cachedLineSummary.lineShortName || "",
            lineLongName: cachedLineSummary.lineLongName || "",
            operatorName: cachedLineSummary.operatorName || "",
            mode: cachedLineSummary.mode || "",
            routeType: Number.isFinite(Number(cachedLineSummary.routeType)) ? Number(cachedLineSummary.routeType) : null,
            routeFeedId: cachedLineSummary.routeFeedId || "",
            serviceTier: cachedLineSummary.serviceTier || "",
            frequencyBucket: cachedLineSummary.frequencyBucket || "unknown",
            headwayBestMinutes: Number.isFinite(Number(cachedLineSummary.headwayBestMinutes)) ? Number(cachedLineSummary.headwayBestMinutes) : null,
            headwaySource: cachedLineSummary.headwaySource || "",
            headwayChecked: Number(cachedLineSummary.headwayChecked || 0) === 1 ? 1 : 0,
            color: cachedLineSummary.color || "#d44d1f"
          });
        } catch (error) {
          console.warn("[perf] getRouteStopsTransit: metadata promotion failed for " + normalizedLineKey + ": " + (error?.message || error));
        }
      }

      if (summaryOnly) {
        return {
          payload: {
            lineSummaries: [{
              lineKey: normalizedLineKey,
              stopCount: Number(cachedLineSummary?.stopCount || 0)
            }]
          },
          cacheStatus,
          cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
          cacheExpiresAt: cached.expiresAt,
          stopLocationTypes
        };
      }

      return {
        payload: cached.payload,
        cacheStatus,
        cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
        cacheExpiresAt: cached.expiresAt,
        stopLocationTypes
      };
    }
  }

  if (cacheOnly) {
    return {
      payload: null,
      cacheStatus: "miss",
      cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
      stopLocationTypes
    };
  }

  const line = await fetchRouteByLineKey(normalizedLineKey, options);
  if (!line) {
    throw new Error(`No route found for ${normalizedLineKey}.`);
  }

  // Upsert full geometry into the LOD cache so subsequent bbox views get the unfiltered detail.
  if (line && line.geometry) {
    try {
      await db.upsertRouteGeometryLod(normalizedLineKey, 15, line.geometry, {
        sourceHash: geometrySourceHash(line.geometry)
      });
    } catch {
      // Best-effort; view will still work with fallback geometry.
    }
  }

  const membershipRouteKey = sanitizeText(line.routeOnestopId || normalizedLineKey);
  const routeStops = await fetchStopsForRoute(membershipRouteKey, options);
  const directionStopSequences = await buildDirectionStopSequencesForRoute(membershipRouteKey, options);
  const payload = buildRouteStopsPayload(line, routeStops.stops, {
    stopLocationTypes,
    sourceStopsTruncated: routeStops.truncated
  });

  if (directionStopSequences) {
    payload.directionStopSequences = directionStopSequences;
    if (directionStopSequences.patterns) {
      payload.directionStopPatterns = directionStopSequences.patterns;
    }
  }

  // Store per-route metadata so page reloads and subsequent viewport loads
  // have headway, stop count, color, and other properties immediately.
  const routeMetadata = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries[0] : null;
  if (routeMetadata && normalizedLineKey) {
    try {
      await db.setRouteMetadata(normalizedLineKey, {
        routeOnestopId: line.routeOnestopId || routeMetadata.routeOnestopId,
        lineName: line.lineName || routeMetadata.lineName,
        lineShortName: line.lineShortName || routeMetadata.lineShortName,
        lineLongName: line.lineLongName || routeMetadata.lineLongName,
        operatorName: line.operatorName || routeMetadata.operatorName,
        mode: line.mode || routeMetadata.mode,
        routeType: line.routeType ?? routeMetadata.routeType,
        routeFeedId: line.routeFeedId || routeMetadata.routeFeedId,
        serviceTier: line.serviceTier || routeMetadata.serviceTier,
        frequencyBucket: routeMetadata.frequencyBucket || "unknown",
        headwayBestMinutes: routeMetadata.headwayBestMinutes ?? null,
        headwaySource: routeMetadata.headwaySource || "",
        headwayChecked: routeMetadata.headwayChecked ?? 0,
        color: line.color || routeMetadata.color || ""
      });
    } catch {
      // Best-effort
    }
  }

  await db.setCache(cacheKey, payload, config.TRANSIT_CACHE_TTL_HOURS * 3600, {
    cacheKind: "route-stops"
  });

  return {
    payload,
    cacheStatus: "miss",
    cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
    stopLocationTypes
  };
}

async function getRouteHeadway(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  // Try Postgres first — avoid Transitland REST call if the route's
  // geometry and metadata are already cached from a previous viewport
  // fetch or route-stops load.
  let line = null;
  let headwayFromPostgres = null;
  try {
    const meta = await db.getRouteMetadatasByLineKeys([normalizedLineKey]);
    const routeMeta = meta.get(normalizedLineKey);
    if (routeMeta) {
      const geoEntry = await db.getRouteGeometryLod(normalizedLineKey, 15);
      const geometry = geoEntry?.geometry || null;
      const bbox = geometry
        ? geometryBbox(geometry)
        : null;
      line = {
        lineKey: normalizedLineKey,
        routeOnestopId: routeMeta.routeOnestopId,
        routeType: routeMeta.routeType,
        routeFeedId: routeMeta.routeFeedId,
        bbox,
        geometry
      };
      if (Number.isFinite(Number(routeMeta.headwayBestMinutes)) && Number(routeMeta.headwayBestMinutes) > 0) {
        headwayFromPostgres = routeMeta;
      }
    }
  } catch {
    // Fall through to Transitland
  }

  if (!line) {
    line = await fetchRouteByLineKey(normalizedLineKey, options);
    if (!line) {
      throw new Error(`No route found for ${normalizedLineKey}.`);
    }
  }

  // If metadata already has valid headway, return it without vector tile fetch
  if (headwayFromPostgres) {
    const bm = Number(headwayFromPostgres.headwayBestMinutes);
    return {
      summary: {
        source: String(headwayFromPostgres.headwaySource || "postgres"),
        headwaySeconds: Math.round(bm * 60),
        bestMinutes: bm,
        frequencyBucket: String(headwayFromPostgres.frequencyBucket || "unknown"),
        headwayFallback: 0,
        routeType: Number.isFinite(Number(line.routeType)) ? Number(line.routeType) : null
      },
      line,
      cacheStatus: "hit",
      cacheKey: `${TRANSIT_CACHE_PREFIX}headway:${sanitizeText(line.routeOnestopId || normalizedLineKey)}`
    };
  }

  const lookupKey = sanitizeText(line.routeOnestopId || normalizedLineKey);
  const cacheKey = `${TRANSIT_CACHE_PREFIX}headway:${lookupKey}`;
  const bbox = Array.isArray(line.bbox) && line.bbox.length === 4 ? line.bbox : null;
  let summary = null;
  let normalizedBestMinutes = null;

  if (bbox) {
    const vectorHeadways = await fetchVectorRouteHeadwaysForBbox(bbox, {
      routeTypes: Number.isFinite(line.routeType) ? [line.routeType] : [],
      zoom: options.zoom,
      forceRefresh: Boolean(options.forceRefresh),
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    const lookupKeys = routeLookupKeysFromObject({
      onestop_id: lookupKey,
      route_onestop_id: line.routeOnestopId,
      line_key: line.lineKey,
      routeFeedId: line.routeFeedId
    });

    let headwaySeconds = null;
    for (const routeKey of lookupKeys) {
      const candidate = Number(vectorHeadways?.headwayByRouteKey?.[routeKey]);
      if (Number.isFinite(candidate) && candidate > 0) {
        headwaySeconds = candidate;
        break;
      }
    }

    if (Number.isFinite(headwaySeconds) && headwaySeconds > 0) {
      const fallbackHeadway = isFallbackHeadwaySeconds(headwaySeconds);
      normalizedBestMinutes = fallbackHeadway ? null : Number((headwaySeconds / 60).toFixed(1));
      summary = {
        source: "transitland-vector-tiles",
        headwaySeconds: fallbackHeadway ? null : headwaySeconds,
        bestMinutes: normalizedBestMinutes,
        frequencyBucket: fallbackHeadway ? fallbackFrequencyBucketForRoute(line) : frequencyBucketFromHeadwayMinutes(normalizedBestMinutes),
        headwayFallback: fallbackHeadway ? 1 : 0,
        routeType: Number.isFinite(Number(line.routeType)) ? Number(line.routeType) : null
      };
    }
  }

  if (!summary) {
    const routePageSummary = await fetchRouteHeadwaySummary(lookupKey, {
      forceRefresh: Boolean(options.forceRefresh),
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    if (routePageSummary) {
      const summaryBestMinutes = Number(routePageSummary.bestMinutes);
      const fallbackHeadway = isFallbackHeadwayMinutes(summaryBestMinutes);
      normalizedBestMinutes = Number.isFinite(summaryBestMinutes) && summaryBestMinutes > 0 && !fallbackHeadway
        ? Number(summaryBestMinutes.toFixed(1))
        : null;

      summary = {
        ...routePageSummary,
        bestMinutes: normalizedBestMinutes,
        frequencyBucket: fallbackHeadway ? fallbackFrequencyBucketForRoute(line) : routePageSummary.frequencyBucket,
        headwayFallback: fallbackHeadway ? 1 : 0,
        routeType: Number.isFinite(Number(line.routeType)) ? Number(line.routeType) : null
      };
    }
  }

  if (summary && Number(summary.headwayFallback || 0) === 1) {
    try {
      const ttlHours = Math.max(1, Number(config.ROUTE_HEADWAY_CACHE_TTL_HOURS || 72));
      await db.setCache(cacheKey, summary, ttlHours * 3600, {
        cacheKind: "route-headway"
      });
    } catch {
      // Keep the response clean even if cache rewrite fails.
    }
  }

  // Store headway to route_metadata so it persists across page reloads
  if (summary && Number.isFinite(Number(summary.bestMinutes)) && Number(summary.bestMinutes) > 0) {
    try {
      await db.setRouteMetadata(normalizedLineKey, {
        frequencyBucket: String(summary.frequencyBucket || "unknown"),
        headwayBestMinutes: Number(summary.bestMinutes),
        headwaySource: String(summary.source || "transitland-vector-tiles"),
        headwayChecked: 1
      });
    } catch {
      // Best-effort
    }
  }

  return {
    lineKey: normalizedLineKey,
    routeOnestopId: lookupKey,
    headwaySummary: summary,
    headwayBestMinutes: normalizedBestMinutes,
    headwaySource: summary?.source || "",
    headwayFallback: Number(summary?.headwayFallback || 0) === 1 ? 1 : 0,
    headwayChecked: 1,
    frequencyBucket: summary?.frequencyBucket || (normalizedBestMinutes
      ? frequencyBucketFromHeadwayMinutes(normalizedBestMinutes)
      : "unknown")
  };
}

function buildFeedFingerprint(payload) {
  const lineSummaries = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries : [];
  if (!lineSummaries.length) {
    return "";
  }

  const stableLines = lineSummaries
    .map((line) => {
      const lineKey = sanitizeText(line?.lineKey || line?.routeOnestopId);
      const feedId = sanitizeText(line?.routeFeedId);
      if (!lineKey) {
        return "";
      }

      return `${feedId || "no-feed"}:${lineKey}`;
    })
    .filter(Boolean)
    .sort();

  if (!stableLines.length) {
    return "";
  }

  return crypto.createHash("sha1").update(stableLines.join("|"), "utf8").digest("hex");
}

function buildFeedFingerprintFromRoutes(routes) {
  const stableRoutes = Array.isArray(routes)
    ? routes
      .map((route) => {
        const routeId = sanitizeText(route?.onestop_id || route?.route_onestop_id);
        const feedId = sanitizeText(route?.route_feed_onestop_id || route?.feed_onestop_id);
        if (!routeId) {
          return "";
        }

        return `${feedId || "no-feed"}:${routeId}`;
      })
      .filter(Boolean)
      .sort()
    : [];

  if (!stableRoutes.length) {
    return "";
  }

  return crypto.createHash("sha1").update(stableRoutes.join("|"), "utf8").digest("hex");
}

async function applyRouteOrderingMetadataToPayload(payload) {
  const lineSummaries = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries : [];
  if (!lineSummaries.length) {
    return payload;
  }

  const lineKeys = Array.from(
    new Set(lineSummaries.map((line) => sanitizeText(line?.lineKey)).filter(Boolean))
  );

  if (!lineKeys.length) {
    return payload;
  }

  const metadataByLineKey = await db.getRouteOrderingMetadataByLineKeys(lineKeys);
  if (!metadataByLineKey || metadataByLineKey.size === 0) {
    return payload;
  }

  const decorateLine = (line) => {
    const lineKey = sanitizeText(line?.lineKey);
    if (!lineKey || !metadataByLineKey.has(lineKey)) {
      return line;
    }

    const metadata = metadataByLineKey.get(lineKey) || {};
    return {
      ...line,
      lineViewOrderingDefaultMode: sanitizeText(metadata.orderingModeDefaultMode || "auto") || "auto",
      lineViewOrderingDefaultSource: sanitizeText(metadata.orderingModeDefaultSource || "auto") || "auto",
      lineViewOrderingAdminMode: sanitizeText(metadata.orderingModeAdminMode || ""),
      lineViewOrderingVoteCounts: metadata.orderingModeVoteCounts || {},
      lineViewOrderingVoteTotal: Number(metadata.orderingModeVoteTotal || 0)
    };
  };

  const nextRoutesGeoJson =
    payload?.routesGeoJson && Array.isArray(payload.routesGeoJson.features)
      ? {
          ...payload.routesGeoJson,
          features: payload.routesGeoJson.features.map((feature) => {
            const lineKey = sanitizeText(feature?.properties?.line_key);
            if (!lineKey || !metadataByLineKey.has(lineKey)) {
              return feature;
            }

            const metadata = metadataByLineKey.get(lineKey) || {};
            return {
              ...feature,
              properties: {
                ...feature.properties,
                line_view_ordering_default_mode: sanitizeText(metadata.orderingModeDefaultMode || "auto") || "auto",
                line_view_ordering_default_source: sanitizeText(metadata.orderingModeDefaultSource || "auto") || "auto",
                line_view_ordering_admin_mode: sanitizeText(metadata.orderingModeAdminMode || ""),
                line_view_ordering_vote_total: Number(metadata.orderingModeVoteTotal || 0)
              }
            };
          })
        }
      : payload?.routesGeoJson;

  return {
    ...payload,
    lineSummaries: lineSummaries.map(decorateLine),
    routesGeoJson: nextRoutesGeoJson
  };
}

async function queueCityReverifyIfStale(area, cached) {
  if (!area || area.kind !== "city" || !area.slug || !cached) {
    return;
  }
  const staleDays = Math.max(1, Number(config.TRANSIT_CACHE_STALE_DAYS || 30));
  const ageSeconds =
    Math.floor(Date.now() / 1000) - Number(cached.verifiedAt || cached.fetchedAt || 0);

  if (!Number.isFinite(ageSeconds) || ageSeconds < staleDays * 86400) {
    return;
  }

  await db.ensureCityHarvestState(
    {
      slug: area.slug,
      name: area.name
    },
    {
      priority: Number(area.harvestPriority || 100),
      initialStatus: "queued",
      pendingRefresh: true
    }
  );
  await db.queueCityRefresh(area.slug);
}

function geometryCoordinateCount(geometry) {
  if (!geometry || !geometry.type) return 0;
  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
  }
  if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates;
    if (!Array.isArray(lines)) return 0;
    let sum = 0;
    for (const line of lines) {
      if (Array.isArray(line)) sum += line.length;
    }
    return sum;
  }
  return 0;
}

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

        lineSummaries.push(meta ? { ...meta, lineKey: lk } : { lineKey: lk, lineName: lk });
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
          color: line.color
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

    responseLineSummaries.push(meta ? { ...meta, lineKey: lk } : { lineKey: lk, lineName: lk });
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

async function getBboxTransit(rawBbox, options = {}) {
  const zoom = Number(options.zoom);
  const bboxInfo = normalizeBboxForCache(rawBbox, zoom, {
    // Cache-only requests are Postgres overlap lookups and should work for broad views.
    // Transitland-fetching requests still obey BBOX_MAX_SPAN_DEGREES.
    allowWideBbox: Boolean(options.cacheOnly)
  });
  const stopLocationTypes = normalizeStopLocationTypes(options.stopLocationTypes);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const routeTypeKey = routeTypes.length ? routeTypes.join("-") : "all";

  const area = {
    key: `${bboxInfo.areaKey}:route-catalog:route-types:${routeTypeKey}`,
    kind: "bbox",
    name: "Visible Area",
    country: "",
    center: bboxCenter(bboxInfo.bbox),
    bbox: bboxInfo.bbox,
    snapStep: bboxInfo.step,
    routeTypes
  };

  const result = await getTransitForArea(area, {
    ...options,
    stopLocationTypes,
    routeTypes
  });
  return {
    ...result,
    normalizedBbox: bboxInfo.bbox,
    snapStep: bboxInfo.step,
    stopLocationTypes,
    routeTypes
  };
}

module.exports = {
  getCityTransit,
  getCityFeedFingerprint,
  getBboxTransit,
  getRouteStopsTransit,
  getRouteHeadway,
  getTransitlandMetrics,
  TRANSIT_CACHE_PREFIX
};
