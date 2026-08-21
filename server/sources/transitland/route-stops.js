const config = require("../../admin/config");
const db = require("../../processors/data");
const {
  TRANSIT_CACHE_PREFIX
} = require("./metrics");
const {
  sanitizeText,
  normalizeStopLocationTypes,
  isCacheExpiredRow
} = require("./helpers");
const {
  fetchRouteByLineKey,
  fetchStopsForRoute
} = require("./fetch");
const {
  buildDirectionStopSequencesForRoute,
  buildRouteStopsPayload
} = require("./payload");
const {
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
            color: cachedLineSummary.color || "#d44d1f",
            stopCount: Number(cachedLineSummary.stopCount || 0)
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
    if (summaryOnly) {
      // Cold route-stops cache: fall back to stored route_metadata.stop_count
      // (cheap SQL) so summary queries report a count without a Transitland
      // fetch. The harvesters and any full route-stops fetch populate this.
      try {
        const metaMap = await db.getRouteMetadatasByLineKeys([normalizedLineKey]);
        const meta = metaMap.get(normalizedLineKey);
        const storedCount = Number(meta?.stopCount || 0);
        if (storedCount > 0) {
          return {
            payload: {
              lineSummaries: [{
                lineKey: normalizedLineKey,
                stopCount: storedCount
              }]
            },
            cacheStatus: "stale-hit",
            cacheKey: `route:${normalizedLineKey}:types:${stopTypeKey}`,
            stopLocationTypes
          };
        }
      } catch {
        // fall through to miss
      }
    }

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
        color: line.color || routeMetadata.color || "",
        stopCount: Number(routeMetadata.stopCount || 0)
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

module.exports = {
  getRouteStopsTransit
};
