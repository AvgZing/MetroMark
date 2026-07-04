const crypto = require("crypto");
const config = require("../../admin/config");
const db = require("../../processors/data");
const { getCityBySlug } = require("../../processors/city-presets");
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

  const line = await fetchRouteByLineKey(normalizedLineKey, options);
  if (!line) {
    throw new Error(`No route found for ${normalizedLineKey}.`);
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

  if (summaryOnly && Boolean(options.cacheOnly)) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached) {
      return {
        payload: summaryOnlyPayload(cached.payload?.routesGeoJson, cached.payload?.lineSummaries || []),
        cacheStatus: isCacheExpiredRow(cached) ? "stale-hit" : "hit",
        cacheKey: area.key,
        cacheExpiresAt: cached.expiresAt,
        cacheVerifiedAt: cached.verifiedAt,
        feedFingerprint: cached.feedFingerprint || "",
        stopLocationTypes
      };
    }

    const [minLon, minLat, maxLon, maxLat] = area.bbox;
    const overlappingCaches = await db.getCacheByBbox(minLon, minLat, maxLon, maxLat, {
      includeExpired: true
    });

    if (overlappingCaches && overlappingCaches.length > 0) {
      const mergedLines = new Map();

      for (const cacheEntry of overlappingCaches) {
        const payload = cacheEntry.payload || {};

        for (const line of payload?.lineSummaries || []) {
          const lineKey = line?.lineKey;
          if (lineKey && !mergedLines.has(lineKey)) {
            mergedLines.set(lineKey, line);
          }
        }
      }

      logGetTransitTiming('summaryOnly+cacheOnly:spatial-partial');
      return {
        payload: summaryOnlyPayload(
          { type: "FeatureCollection", features: [] },
          Array.from(mergedLines.values())
        ),
        cacheStatus: "partial-hit",
        cacheKey: area.key,
        stopLocationTypes
      };
    }

    return {
      payload: summaryOnlyPayload([]),
      cacheStatus: "miss",
      cacheKey: area.key,
      stopLocationTypes
    };
  }

  if (!forceRefresh) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached) {
      const cacheStatus = isCacheExpiredRow(cached) ? "stale-hit" : "hit";
      if (!summaryOnly) {
        await queueCityReverifyIfStale(area, cached);
      }

      if (summaryOnly) {
        return {
          payload: summaryOnlyPayload(cached.payload?.lineSummaries || []),
          cacheStatus,
          cacheKey: area.key,
          cacheExpiresAt: cached.expiresAt,
          cacheVerifiedAt: cached.verifiedAt,
          feedFingerprint: cached.feedFingerprint || "",
          stopLocationTypes
        };
      }

      logGetTransitTiming('cache-hit');
      return {
        payload: await applyRouteOrderingMetadataToPayload(cached.payload || {}),
        cacheStatus,
        cacheKey: area.key,
        cacheExpiresAt: cached.expiresAt,
        cacheVerifiedAt: cached.verifiedAt,
        feedFingerprint: cached.feedFingerprint || "",
        stopLocationTypes
      };
    }

    if (options.cacheOnly) {
      const [minLon, minLat, maxLon, maxLat] = area.bbox;
      const overlappingCaches = await db.getCacheByBbox(minLon, minLat, maxLon, maxLat, {
        includeExpired: true
      });

      if (overlappingCaches && overlappingCaches.length > 0) {
        const mergedRoutes = new Map();
        const mergedStops = new Map();
        const mergedLines = new Map();

        for (const cacheEntry of overlappingCaches) {
          const payload = cacheEntry.payload || {};

          for (const feature of payload?.routesGeoJson?.features || []) {
            const lineKey = feature?.properties?.line_key;
            if (lineKey && !mergedRoutes.has(lineKey)) {
              mergedRoutes.set(lineKey, feature);
            }
          }

          for (const line of payload?.lineSummaries || []) {
            const lineKey = line?.lineKey;
            if (lineKey && !mergedLines.has(lineKey)) {
              mergedLines.set(lineKey, line);
            }
          }

          for (const feature of payload?.stopsGeoJson?.features || []) {
            const stopId = feature?.properties?.stop_id || feature?.id;
            if (stopId && !mergedStops.has(stopId)) {
              mergedStops.set(stopId, feature);
            }
          }
        }

        if (summaryOnly) {
          return {
            payload: summaryOnlyPayload({ type: "FeatureCollection", features: [] }, Array.from(mergedLines.values())),
            cacheStatus: "partial-hit",
            cacheKey: area.key,
            stopLocationTypes
          };
        }

        return {
          payload: {
            routesGeoJson: { type: "FeatureCollection", features: Array.from(mergedRoutes.values()) },
            stopsGeoJson: { type: "FeatureCollection", features: Array.from(mergedStops.values()) },
            lineSummaries: Array.from(mergedLines.values()),
            area: { bbox: area.bbox }
          },
          cacheStatus: "partial-hit",
          cacheKey: area.key,
          stopLocationTypes
        };
      }

      return {
        payload: summaryOnly
          ? summaryOnlyPayload({ type: "FeatureCollection", features: [] }, [])
          : { routesGeoJson: { type: "FeatureCollection", features: [] }, stopsGeoJson: { type: "FeatureCollection", features: [] }, lineSummaries: [], area: { bbox: area.bbox } },
        cacheStatus: "miss",
        cacheKey: area.key,
        stopLocationTypes
      };
    }
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
  const ttlSeconds = Math.max(60, Number(config.TRANSIT_CACHE_TTL_HOURS || 2160) * 3600);
  const fetchedAt = Math.floor(Date.now() / 1000);
  const feedFingerprint = buildFeedFingerprint(enrichedPayload);

  await db.setCache(cacheKey, enrichedPayload, ttlSeconds, {
    cacheKind: area.kind || "bbox",
    citySlug: area.slug || null,
    feedFingerprint,
    verifiedAt: fetchedAt
  });

  const result = {
    payload: enrichedPayload,
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
