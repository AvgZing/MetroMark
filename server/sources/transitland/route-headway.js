const config = require("../../admin/config");
const db = require("../../processors/data");
const { geometryBbox } = require("../../processors/postgres/spatial");
const {
  TRANSIT_CACHE_PREFIX
} = require("./metrics");
const {
  sanitizeText
} = require("./helpers");
const {
  routeLookupKeysFromObject,
  fetchVectorRouteHeadwaysForBbox
} = require("./routes");
const {
  fetchRouteByLineKey
} = require("./fetch");
const {
  frequencyBucketFromHeadwayMinutes,
  isFallbackHeadwaySeconds,
  isFallbackHeadwayMinutes,
  fallbackFrequencyBucketForRoute,
  fetchRouteHeadwaySummary
} = require("./headway");

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

  // Store headway to route_metadata so it persists across page reloads. This
  // includes the fallback case (no usable headway): checking it once means the
  // bulk loader can serve the "local" bucket permanently instead of re-fetching
  // and showing "unknown" forever.
  if (summary && (Number.isFinite(Number(summary.bestMinutes)) && Number(summary.bestMinutes) > 0 || Number(summary.headwayFallback || 0) === 1)) {
    try {
      await db.setRouteMetadata(normalizedLineKey, {
        frequencyBucket: String(summary.frequencyBucket || "unknown"),
        headwayBestMinutes: Number.isFinite(Number(summary.bestMinutes)) ? Number(summary.bestMinutes) : null,
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

async function getRouteHeadwaysBulk(lineKeys, options = {}) {
  const keys = Array.isArray(lineKeys)
    ? lineKeys.map((key) => sanitizeText(String(key || ""))).filter(Boolean).slice(0, 500)
    : [];

  const headwayByLineKey = {};
  if (!keys.length) {
    return { headwayByLineKey };
  }

  let meta = new Map();
  try {
    meta = await db.getRouteMetadatasByLineKeys(keys);
  } catch {
    return { headwayByLineKey };
  }

  for (const [lineKey, routeMeta] of meta) {
    const checked = Number(routeMeta?.headwayChecked || 0) === 1;
    const stopCount = Number(routeMeta?.stopCount || 0);
    const problematicGeometry = Boolean(routeMeta?.problematicGeometry);

    // Emit the entry when there is anything to report — including the
    // auto-detected problematic flag, which must reach the client even for
    // lines whose headway/stop count is already known (or unknown).
    if (!checked && stopCount <= 0 && !problematicGeometry) {
      continue;
    }

    const entry = {
      headwayChecked: checked ? 1 : 0,
      stopCount,
      problematicGeometry
    };

    if (checked) {
      const bm = Number(routeMeta?.headwayBestMinutes);
      if (Number.isFinite(bm) && bm > 0) {
        entry.headwayBestMinutes = bm;
        entry.frequencyBucket = String(routeMeta.frequencyBucket || "unknown");
        entry.headwaySource = String(routeMeta.headwaySource || "postgres");
        entry.headwayFallback = 0;
      } else {
        // Checked but no usable headway (the 1667-minute fallback) — mark it so
        // the client maps the line into the Local bucket instead of "unknown".
        entry.headwayBestMinutes = null;
        entry.frequencyBucket = String(routeMeta.frequencyBucket || "local");
        entry.headwaySource = String(routeMeta.headwaySource || "transitland-vector-tiles");
        entry.headwayFallback = 1;
      }
    }

    headwayByLineKey[lineKey] = entry;
  }

  return { headwayByLineKey };
}

module.exports = {
  getRouteHeadway,
  getRouteHeadwaysBulk
};
