// Lightweight route catalog comparison: fetches Transitland's route catalog
// (include_geometry=false) for a bbox in one fast request, compares against
// Postgres lineKey count, and if there's a gap, backfills geometry in small
// pages (100 routes/page) stored immediately so routes trickle in on refresh.
const { transitlandRequest } = require("./payload");
const { normalizeRouteTypes } = require("./helpers");
const db = require("../../processors/data");
const { geometrySourceHash } = require("./geometry");
const config = require("../../admin/config");

async function getCatalogLineKeyCount(bbox, routeTypes) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;

  const allowedRouteTypes = new Set(normalizeRouteTypes(routeTypes));
  const params = {
    bbox: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`,
    include_geometry: "false",
    per_page: "5000"
  };
  if (allowedRouteTypes.size) {
    params.route_type = Array.from(allowedRouteTypes).join(",");
  }

  try {
    const response = await transitlandRequest("/routes", params, {
      enforceDailyCap: false,
      requestSource: options?.requestSource
    });

    const routes = Array.isArray(response.routes) ? response.routes : [];
    const lineKeys = routes.map((route) => route.onestop_id).filter(Boolean);
    return {
      count: lineKeys.length,
      sampleLineKeys: lineKeys.slice(0, 20),
      hasMore: Boolean(response?.meta?.next)
    };
  } catch {
    return null;
  }
}

async function backfillMissingGeometry(bbox, missingCount, spatialZoom, routeTypes) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !Number.isFinite(missingCount) || missingCount <= 0) {
    return 0;
  }

  var storedCount = 0;

  // Phase 1: fetch currently filtered route types first — smaller payload,
  // faster response. The user's visible modes appear before the full set.
  var filteredTypes = Array.isArray(routeTypes) && routeTypes.length > 0
    ? Array.from(new Set(routeTypes.map(Number).filter(Number.isFinite)))
    : null;

  if (filteredTypes && filteredTypes.length > 0) {
    storedCount += await fetchAndStoreRoutes(bbox, 100, filteredTypes);
  }

  // Phase 2: fetch ALL route types including unfiltered (buses, ferries).
  // Already-stored routes from phase 1 are idempotent upserts — harmless.
  storedCount += await fetchAndStoreRoutes(bbox, Math.max(100, Math.ceil(missingCount * 0.8)), null);

  return storedCount;
}

async function fetchAndStoreRoutes(bbox, pageSize, routeTypeFilter) {
  var afterCursor = null;
  var storedCount = 0;
  var pages = 0;
  var MAX_PAGES = 5;

  while (pages < MAX_PAGES) {
      var params = {
        bbox: bbox[0] + "," + bbox[1] + "," + bbox[2] + "," + bbox[3],
        include_geometry: "true",
      per_page: String(pageSize)
    };
    if (routeTypeFilter && routeTypeFilter.length > 0) {
      params.route_type = routeTypeFilter.join(",");
    }
    if (afterCursor !== null) {
      params.after = String(afterCursor);
    }

    try {
      var response = await transitlandRequest("/routes", params, {
        enforceDailyCap: false,
        requestSource: "catalog-backfill"
      });

      var routes = Array.isArray(response.routes) ? response.routes : [];
      if (routes.length === 0) break;

      for (var r = 0; r < routes.length; r++) {
        var route = routes[r];
        var lineKey = route?.onestop_id;
        var geometry = route?.geometry;
        if (!lineKey || !geometry) continue;

        try {
          await db.upsertRouteGeometryLod(lineKey, 15, geometry, {
            sourceHash: geometrySourceHash(geometry)
          });
        } catch { /* Best-effort */ }

        try {
          await db.setRouteMetadata(lineKey, {
            routeOnestopId: route.onestop_id || "",
            lineName: route.route_name || "",
            lineShortName: route.route_short_name || "",
            lineLongName: route.route_long_name || "",
            operatorName: route.operator?.name || "",
            mode: route.route_type_name || "",
            routeType: Number.isFinite(Number(route.route_type)) ? Number(route.route_type) : null,
            routeFeedId: route.feed_onestop_id || "",
            color: route.color || ""
          });
        } catch { /* Best-effort */ }

        storedCount += 1;
      }

      pages += 1;

      var nextAfter = Number(response?.meta?.after);
      if (!Number.isFinite(nextAfter) || !Boolean(response?.meta?.next)) break;
      afterCursor = nextAfter;
    } catch {
      break;
    }
  }

  return storedCount;
}

module.exports = { getCatalogLineKeyCount, backfillMissingGeometry };
