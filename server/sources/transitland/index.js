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
  fetchVectorRouteHeadwaysForBbox,
  normalizeRoutes
} = require("./routes");
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

function parseBboxArray(rawBbox, options = {}) {
  if (!Array.isArray(rawBbox) || rawBbox.length !== 4) {
    throw new Error("bbox must contain four comma-separated coordinates.");
  }

  const values = rawBbox.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("bbox includes invalid coordinates.");
  }

  const [west, south, east, north] = values;
  if (west >= east || south >= north) {
    throw new Error("bbox min values must be lower than max values.");
  }

  if (west < -180 || east > 180 || south < -85 || north > 85) {
    throw new Error("bbox coordinates are out of range.");
  }

  const width = east - west;
  const height = north - south;

  const allowWideBbox = Boolean(options.allowWideBbox);
  if (!allowWideBbox && (width > config.BBOX_MAX_SPAN_DEGREES || height > config.BBOX_MAX_SPAN_DEGREES)) {
    throw new Error(
      `bbox span is too large. Zoom in so width/height are under ${config.BBOX_MAX_SPAN_DEGREES} degrees.`
    );
  }

  return [west, south, east, north];
}

function bboxStepFromZoom(zoom) {
  if (Number.isFinite(zoom)) {
    if (zoom >= 13) return 0.025;
    if (zoom >= 11) return 0.04;
    if (zoom >= 9) return 0.06;
    if (zoom >= 7) return 0.09;
    if (zoom >= 5) return 0.12;
  }
  return Math.max(0.06, config.BBOX_DEFAULT_STEP_DEGREES);
}

function snapBboxToGrid(bbox, step) {
  const [west, south, east, north] = bbox;
  const snappedWest = Math.floor(west / step) * step;
  const snappedSouth = Math.floor(south / step) * step;
  const snappedEast = Math.ceil(east / step) * step;
  const snappedNorth = Math.ceil(north / step) * step;

  return [
    Math.max(-180, snappedWest),
    Math.max(-85, snappedSouth),
    Math.min(180, snappedEast),
    Math.min(85, snappedNorth)
  ];
}

function normalizeBboxForCache(rawBbox, zoom, options = {}) {
  const parsed = parseBboxArray(rawBbox, {
    allowWideBbox: Boolean(options.allowWideBbox)
  });
  const step = bboxStepFromZoom(zoom);
  const snapped = snapBboxToGrid(parsed, step);
  const [west, south, east, north] = snapped;

  if (west >= east || south >= north) {
    throw new Error("bbox normalization failed. Try zooming in and loading again.");
  }

  const keyPart = snapped.map((value) => value.toFixed(4)).join(",");
  return {
    bbox: snapped,
    step,
    areaKey: `bbox:${step.toFixed(3)}:${keyPart}`
  };
}

function toBboxString(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

async function fetchRoutesAndStopsForBbox(bboxArray, options = {}) {
  const bbox = toBboxString(bboxArray);
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const allowedRouteTypes = new Set(routeTypes);
  const lonSpan = Math.max(0, Number(bboxArray[2]) - Number(bboxArray[0]));
  const latSpan = Math.max(0, Number(bboxArray[3]) - Number(bboxArray[1]));
  const span = Math.max(lonSpan, latSpan);

  let routeLimit = Math.max(80, Number(config.ROUTE_CATALOG_MAX_RESULTS || 220));

  if (span > 1.6) {
    routeLimit = Math.max(80, Math.round(routeLimit * 0.55));
  } else if (span > 1.2) {
    routeLimit = Math.max(90, Math.round(routeLimit * 0.68));
  } else if (span > 0.8) {
    routeLimit = Math.max(100, Math.round(routeLimit * 0.82));
  }

  const routeParams = {
    bbox,
    include_geometry: "true",
    limit: String(routeLimit)
  };

  if (routeTypes.length) {
    routeParams.route_types = routeTypes.join(",");
  }

  // Page through /routes results to avoid missing routes when a single page
  // is truncated by Transitland limits. Respect routeLimit as the per-request
  // page size and stop when we reach a reasonable maxResults cap.
  const fetchedRoutes = [];
  let afterCursor = null;
  const pageLimit = Math.max(40, Math.min(routeLimit, 500));
  const maxResults = Math.max(routeLimit, Number(config.ROUTE_CATALOG_MAX_RESULTS || 220));

  let pagesFetched = 0;
  while (fetchedRoutes.length < maxResults) {
    const params = {
      ...routeParams,
      limit: String(pageLimit)
    };
    if (afterCursor !== null) {
      params.after = String(afterCursor);
    }

    const pageResponse = await transitlandRequest("/routes", params, {
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    const pageRoutes = Array.isArray(pageResponse.routes) ? pageResponse.routes : [];
    for (const r of pageRoutes) {
      fetchedRoutes.push(r);
      if (fetchedRoutes.length >= maxResults) break;
    }

    pagesFetched += 1;

    const nextAfter = Number(pageResponse?.meta?.after);
    const hasNext = Boolean(pageResponse?.meta?.next) && Number.isFinite(nextAfter);
    if (!hasNext || pageRoutes.length === 0) {
      break;
    }
    afterCursor = nextAfter;
  }
  const filteredRoutes = routeTypes.length
    ? fetchedRoutes.filter((route) => allowedRouteTypes.has(Number(route?.route_type)))
    : fetchedRoutes;

  const vectorHeadways = await fetchVectorRouteHeadwaysForBbox(bboxArray, {
    routeTypes,
    zoom: options.zoom,
    forceRefresh: options.forceRefresh,
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  const headwayByRouteKey = vectorHeadways.headwayByRouteKey || {};
  for (const route of filteredRoutes) {
    const lookupKeys = routeLookupKeysFromObject(route);
    let vectorHeadwaySeconds = null;
    for (const lookupKey of lookupKeys) {
      const candidate = Number(headwayByRouteKey[lookupKey]);
      if (Number.isFinite(candidate) && candidate > 0) {
        vectorHeadwaySeconds = candidate;
        break;
      }
    }

    if (Number.isFinite(vectorHeadwaySeconds) && vectorHeadwaySeconds > 0) {
      if (isFallbackHeadwaySeconds(vectorHeadwaySeconds)) {
        route.headway_secs = null;
        route.headwayFallback = 1;
        route.frequency_bucket = fallbackFrequencyBucketForRoute(route);
      } else {
        route.headway_secs = Math.round(vectorHeadwaySeconds);
        route.headwayFallback = 0;
        route.frequency_bucket = frequencyBucketFromHeadwayMinutes(vectorHeadwaySeconds / 60);
      }
      route.headway_source = "transitland-vector-tiles";
    }
  }

  return {
    routes: filteredRoutes,
    stops: [],
    vectorHeadwayMeta: {
      tileCount: vectorHeadways.tileCount,
      omittedTileCount: vectorHeadways.omittedTileCount,
      zoom: vectorHeadways.zoom
    }
    ,
    diagnostics: {
      pagesFetched,
      fetchedRoutes: fetchedRoutes.length,
      filteredRoutes: filteredRoutes.length,
      requestedRouteLimit: routeLimit,
      pageLimit
    }
  };
}

async function fetchRouteByLineKey(lineKey, options = {}) {
  const response = await transitlandRequest("/routes", {
    onestop_id: lineKey,
    include_geometry: "true",
    limit: "1"
  }, {
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  let normalized = normalizeRoutes(Array.isArray(response.routes) ? response.routes : []);
  if (normalized[0]) {
    return normalized[0];
  }

  try {
    const fallbackResponse = await transitlandRequest(`/routes/${encodeURIComponent(lineKey)}`, {
      include_geometry: "true"
    }, {
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });

    if (fallbackResponse?.route) {
      normalized = normalizeRoutes([fallbackResponse.route]);
      return normalized[0] || null;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchStopsForRoute(lineKey, options = {}) {
  const pageLimit = Math.max(20, Math.min(config.ROUTE_STOP_PAGE_LIMIT, 500));
  const maxResults = Math.max(pageLimit, Math.min(config.ROUTE_STOP_MAX_RESULTS, 5000));

  const stops = [];
  let afterCursor = null;
  let truncated = false;

  while (stops.length < maxResults) {
    const params = {
      served_by_onestop_ids: lineKey,
      limit: String(pageLimit)
    };

    if (Number.isFinite(afterCursor)) {
      params.after = String(afterCursor);
    }

    const response = await transitlandRequest("/stops", params, {
      enforceDailyCap: Boolean(options.enforceDailyCap),
      requestSource: options.requestSource
    });
    const pageStops = Array.isArray(response.stops) ? response.stops : [];

    for (const stop of pageStops) {
      if (stops.length >= maxResults) {
        truncated = true;
        break;
      }
      stops.push(stop);
    }

    const nextAfter = Number(response?.meta?.after);
    const hasNext = Boolean(response?.meta?.next) && Number.isFinite(nextAfter);
    if (!hasNext || pageStops.length === 0 || truncated) {
      break;
    }

    afterCursor = nextAfter;
  }

  return {
    stops,
    truncated
  };
}

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
