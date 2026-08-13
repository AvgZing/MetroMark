const { VectorTile } = require("@mapbox/vector-tile");
const Pbf = require("pbf").default;
const { transitlandRequest } = require("./payload");
const { TRANSITLAND_VECTOR_BASE_URL, transitlandMetrics } = require("./metrics");
const { normalizeRouteTypes, sanitizeText } = require("./helpers");
const { routeLookupKeysFromObject } = require("./routes");
const { enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");
const config = require("../../admin/config");

/**
 * Fetch routes and stops for a given bbox with full geometry.
 * Uses a capped maxResults to keep requests fast (~20s per city).
 * Routes beyond the cap are filled individually via per-route clicks.
 */
async function fetchRoutesAndStopsForBbox(bbox, options = {}) {
  const routeTypes = normalizeRouteTypes(options.routeTypes);
  const allowedRouteTypes = new Set(routeTypes);

  const routeParams = {
    bbox: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`,
    include_geometry: "true",
    per_page: "2000"
  };

  if (routeTypes.length) {
    routeParams.route_type = Array.from(allowedRouteTypes).join(",");
  }

  // Single 220-route page per request. Fast (~20s), under any timeout.
  // Cursor carry-over between requests: accept `after`, return `nextAfter`.
  const fetchedRoutes = [];
  const pageLimit = Math.max(40, Math.min(Number(config.ROUTE_CATALOG_MAX_RESULTS || 220), 220));

  const params = {
    ...routeParams,
    limit: String(pageLimit)
  };
  if (Number.isFinite(Number(options.after))) {
    params.after = String(options.after);
  }

  const pageResponse = await transitlandRequest("/routes", params, {
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  const pageRoutes = Array.isArray(pageResponse.routes) ? pageResponse.routes : [];
  for (const r of pageRoutes) {
    fetchedRoutes.push(r);
  }

  const nextAfter = Number(pageResponse?.meta?.after);
  const hasNext = Boolean(pageResponse?.meta?.next) && Number.isFinite(nextAfter);

  // Filter by route type
  const filteredRoutes = routeTypes.length
    ? fetchedRoutes.filter((route) => allowedRouteTypes.has(Number(route?.route_type)))
    : fetchedRoutes;

  // Fetch stops for all routes in a single request
  const routeOnestopIds = filteredRoutes.map((route) => route.onestop_id).filter(Boolean);
  const stops = await fetchStopsForBbox(bbox, routeOnestopIds, options);

  // Fetch vector headway data
  const vectorHeadwayMeta = await fetchVectorRouteHeadwaysForBbox(bbox, {
    routeTypes: Array.from(allowedRouteTypes),
    zoom: options.zoom,
    forceRefresh: Boolean(options.forceRefresh),
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  return {
    routes: filteredRoutes,
    stops,
    diagnostics: {
      totalFetched: fetchedRoutes.length,
      afterFilter: filteredRoutes.length,
      pages: 1
    },
    vectorHeadwayMeta,
    routeTypes: Array.from(allowedRouteTypes),
    nextAfter: hasNext ? nextAfter : null
  };
}

async function fetchStopsForBbox(bbox, servedByOnestopIds, options = {}) {
  if (!Array.isArray(servedByOnestopIds) || servedByOnestopIds.length === 0) {
    return [];
  }

  const params = {
    bbox: `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`,
    per_page: "2000",
    served_by_onestop_ids: servedByOnestopIds.slice(0, 50).join(","),
    include_geometry: "true"
  };

  const response = await transitlandRequest("/stops", params, {
    enforceDailyCap: Boolean(options.enforceDailyCap),
    requestSource: options.requestSource
  });

  return Array.isArray(response.stops) ? response.stops : [];
}

async function fetchVectorRouteHeadwaysForBbox(bbox, options = {}) {
  const result = {
    headwayByRouteKey: {},
    diagnostics: null
  };

  const zoom = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : 10;
  const tileZoom = Math.max(8, Math.min(12, Math.round(zoom)));
  const size = 2 ** tileZoom;

  const minX = Math.max(0, Math.floor((bbox[0] + 180) / 360 * size) - 1);
  const maxX = Math.min(size - 1, Math.floor((bbox[2] + 180) / 360 * size) + 1);
  const minY = Math.max(0, Math.floor(
    (1 - Math.log(Math.tan(bbox[3] * Math.PI / 180) + 1 / Math.cos(bbox[3] * Math.PI / 180)) / Math.PI) / 2 * size
  ) - 1);
  const maxY = Math.min(size - 1, Math.floor(
    (1 - Math.log(Math.tan(bbox[1] * Math.PI / 180) + 1 / Math.cos(bbox[1] * Math.PI / 180)) / Math.PI) / 2 * size
  ) + 1);

  let totalDiagnostics = { tiles: 0, hits: 0 };
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (options.maxTiles && totalDiagnostics.tiles >= options.maxTiles) break;
      try {
        const tileData = await fetchRoutesVectorTile(tileZoom, x, y, {
          enforceDailyCap: Boolean(options.enforceDailyCap),
          requestSource: options.requestSource
        });
        totalDiagnostics.tiles += 1;
        if (tileData?.headwayByRouteKey) {
          totalDiagnostics.hits += 1;
          Object.assign(result.headwayByRouteKey, tileData.headwayByRouteKey);
        }
      } catch {
        totalDiagnostics.tiles += 1;
      }
      if (options.maxTiles && totalDiagnostics.tiles >= options.maxTiles) break;
    }
    if (options.maxTiles && totalDiagnostics.tiles >= options.maxTiles) break;
  }

  result.diagnostics = totalDiagnostics;
  return result;
}

function normalizeRouteLookupKey(key) {
  const normalized = String(key || "").replace(/-/g, "").toLowerCase().trim();
  return normalized || null;
}

async function fetchRoutesVectorTile(z, x, y, options = {}) {
  if (!config.TRANSITLAND_API_KEY) {
    return null;
  }
  const controller = new AbortController();
  const timeoutMs = Math.max(1500, Number(config.TRANSITLAND_REQUEST_TIMEOUT_MS || 15000));
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const searchParams = new URLSearchParams({ api_key: config.TRANSITLAND_API_KEY });
  const url = `${TRANSITLAND_VECTOR_BASE_URL}/routes/tiles/${z}/${x}/${y}.pbf?${searchParams.toString()}`;

  await enforceDailyUsageCapsIfNeeded("vector", options);
  transitlandMetrics.vectorTileRequestCount += 1;
  transitlandMetrics.lastVectorTileRequestAt = new Date().toISOString();
  await recordUsage("vector", 1);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/x-protobuf" },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tile = new VectorTile(new Pbf(buffer));
    const layer = tile.layers?.routes;
    if (!layer || !Number.isFinite(layer.length) || layer.length === 0) {
      return null;
    }

    const headwayByRouteKey = {};
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      const properties = feature?.properties || {};
      const routeKeys = routeLookupKeysFromObject(properties);

      const headwaySeconds = properties.headway_seconds ?? properties.headwaySeconds ?? null;
      if (Number.isFinite(Number(headwaySeconds)) && Number(headwaySeconds) > 0) {
        for (const routeKey of routeKeys) {
          if (!headwayByRouteKey[routeKey]) {
            headwayByRouteKey[routeKey] = {};
          }
          const prev = headwayByRouteKey[routeKey]?.headwaySeconds ?? null;
          if (prev === null || Number(headwaySeconds) < Number(prev)) {
            headwayByRouteKey[routeKey] = {
              headwaySeconds: Number(headwaySeconds),
              routeKey,
              onestopId: normalizeRouteLookupKey(properties.onestop_id) || undefined,
              routeType: Number.isFinite(Number(properties.route_type)) ? Number(properties.route_type) : undefined
            };
          }
        }
      }
    }

    return {
      headwayByRouteKey,
      diagnostics: {
        lineKeys: Object.keys(headwayByRouteKey).length,
        totalFeatures: layer.length
      }
    };
  } catch {
    transitlandMetrics.vectorTileRequestFailureCount += 1;
    if (options.requestSource) {
      transitlandMetrics.lastVectorTileRequestFailureAt = new Date().toISOString();
    }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  fetchRoutesAndStopsForBbox,
  fetchVectorRouteHeadwaysForBbox
};
