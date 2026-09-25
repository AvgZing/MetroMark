const db = require("../processors/data");
const { createLogger } = require("./logger");
const { fetchRouteByLineKey } = require("../sources/transitland/fetch");
const { normalizeRoutes } = require("../sources/transitland/routes");
const { routeToFeature } = require("../sources/transitland/route-features");
const {
  mergeBackfillFeatures,
  removeFeaturesFromArchive,
  totalRoutesInArchive
} = require("../sources/transitland/backfill");
const { buildPmtiles } = require("../scripts/build/build-pmtiles");
const { transitlandRequest } = require("../sources/transitland/payload");
const { refreshRoute, flagRemovedUserData } = require("./reharvest");

const log = createLogger("route-refresh");

// Per-route counterpart to the viewport reharvest. A service change usually
// touches a handful of routes, so refreshing one (or a small batch) is the
// common case; the whole pmtiles archive is rebuilt once at the end instead of
// once per route.
//
// A route that no longer exists upstream is confirmed by a second failed lookup
// (a thrown request is treated as "still present" and skipped), then removed
// from the archive with any admin override / review / ordering vote preserved
// and flagged for review — the same posture as the viewport reharvest.

const REQUEST_SOURCE = "reharvest";
const MAX_SEARCH_RESULTS = 25;

function normalizeKeys(lineKeys) {
  return Array.from(
    new Set(
      (Array.isArray(lineKeys) ? lineKeys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean)
    )
  );
}

function searchCandidate(route) {
  return {
    lineKey: String(route?.lineKey || ""),
    routeOnestopId: String(route?.routeOnestopId || ""),
    lineName: String(route?.lineName || ""),
    lineShortName: String(route?.lineShortName || ""),
    lineLongName: String(route?.lineLongName || ""),
    operatorName: String(route?.operatorName || ""),
    mode: String(route?.mode || ""),
    routeType: Number.isFinite(Number(route?.routeType)) ? Number(route.routeType) : null,
    color: String(route?.color || "")
  };
}

// Text search across Transitland routes, used to add a route that is not in the
// archive yet. Returns normalized candidates (no geometry).
async function searchTransitlandRoutes(query, options = {}) {
  const search = String(query || "").trim();
  if (!search) {
    return [];
  }
  // A route onestop id is an exact lookup; anything else is a name/number search.
  const isOnestopId = /^r-[\w~-]+$/i.test(search);
  const params = isOnestopId ? { onestop_id: search } : { search };
  // Scoping to the current viewport makes results local/relevant instead of
  // fuzzy global matches (Transitland's text search is worldwide otherwise).
  const bbox = Array.isArray(options.bbox) && options.bbox.length === 4
    ? options.bbox.map((value) => Number(value))
    : null;
  const requestParams = {
    ...params,
    // normalizeRoute() drops routes with no geometry, so geometry must be
    // included even though the search UI only needs identity fields.
    include_geometry: "true",
    limit: String(Math.max(1, Math.min(options.limit || 20, MAX_SEARCH_RESULTS)))
  };
  if (bbox && bbox.every(Number.isFinite)) {
    requestParams.bbox = bbox.join(",");
  }
  const response = await transitlandRequest("/routes", requestParams, { requestSource: REQUEST_SOURCE });
  const normalized = normalizeRoutes(Array.isArray(response?.routes) ? response.routes : []);
  const candidates = normalized.map(searchCandidate).filter((candidate) => candidate.lineKey);
  // Rank exact short-name / key matches above fuzzy substring matches.
  const lowered = search.toLowerCase();
  const rank = (candidate) => {
    if (String(candidate.lineShortName || "").toLowerCase() === lowered) return 0;
    if (String(candidate.lineKey || "").toLowerCase() === lowered) return 1;
    if (String(candidate.lineShortName || "").toLowerCase().includes(lowered)) return 2;
    if (String(candidate.lineName || "").toLowerCase().includes(lowered)) return 3;
    return 4;
  };
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates;
}

async function removeMissingRoute(lineKey, report) {
  const userData = await db.countLineKeyUserData([lineKey]);
  const counts = userData.get(lineKey) || { overrides: 0, reviews: 0, votes: 0 };
  const opened = await flagRemovedUserData(lineKey, counts);
  report.flagsOpened.push(...opened);

  let onestopId = "";
  try {
    const meta = await db.getRouteMetadatasByLineKeys([lineKey]);
    onestopId = String(meta.get(lineKey)?.routeOnestopId || "");
  } catch {
    // best-effort
  }

  await db.deleteRouteMetadata(lineKey);
  await db.deleteRouteGeometryLod(lineKey);
  await db.deleteRouteRelatedCaches(lineKey, onestopId);
  await removeFeaturesFromArchive([lineKey]);

  report.removed.push({ lineKey, userData: counts, flagsOpened: opened });
  log.info("Route refresh removed missing route", { lineKey, userData: counts, flagsOpened: opened });
}

// Refresh one or more routes in a single pass, rebuilding tiles once at the end.
async function refreshRoutes(lineKeys, options = {}) {
  const t0 = Date.now();
  const keys = normalizeKeys(lineKeys);
  const refreshStops = options.refreshStops !== false;
  const refreshHeadway = options.refreshHeadway !== false;
  const zoom = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : null;

  const report = {
    requested: keys.length,
    refreshed: [],
    removed: [],
    failures: [],
    flagsOpened: [],
    merged: { added: 0, updated: 0 },
    tileCount: null,
    sizeBytes: null,
    totalRoutesInArchive: null,
    elapsedMs: 0
  };

  for (const lineKey of keys) {
    let route = null;
    try {
      route = await fetchRouteByLineKey(lineKey, { requestSource: REQUEST_SOURCE });
    } catch (error) {
      // A thrown request is inconclusive — never remove on a transient failure.
      report.failures.push({ lineKey, error: String(error?.message || error) });
      continue;
    }

    if (!route) {
      try {
        await removeMissingRoute(lineKey, report);
      } catch (error) {
        report.failures.push({ lineKey, error: String(error?.message || error) });
      }
      continue;
    }

    try {
      const feature = routeToFeature(route);
      if (feature) {
        const merged = await mergeBackfillFeatures([feature], { overwrite: true });
        report.merged.added += merged.added;
        report.merged.updated += merged.updated;
      }
      const refreshed = await refreshRoute(lineKey, { refreshHeadway, refreshStops, zoom });
      report.refreshed.push(refreshed);
    } catch (error) {
      report.failures.push({ lineKey, error: String(error?.message || error) });
    }
  }

  const changed =
    report.merged.added > 0 || report.merged.updated > 0 || report.removed.length > 0;
  if (changed || totalRoutesInArchive() === 0) {
    const built = await buildPmtiles({ log: { log: () => {} } });
    report.tileCount = built ? built.tileCount : null;
    report.sizeBytes = built ? built.sizeBytes : null;
  }

  report.totalRoutesInArchive = totalRoutesInArchive();
  report.elapsedMs = Date.now() - t0;
  log.info("Route refresh complete", {
    requested: report.requested,
    refreshed: report.refreshed.length,
    removed: report.removed.length,
    failures: report.failures.length,
    elapsedMs: report.elapsedMs
  });
  return report;
}

// Add routes that Transitland knows but the archive does not yet contain. Keys
// that are not found upstream are reported instead of removed/flagged, since
// they were never in the archive to begin with.
async function addRoutes(lineKeys, options = {}) {
  const keys = normalizeKeys(lineKeys);
  const found = [];
  const notFound = [];
  for (const lineKey of keys) {
    try {
      const route = await fetchRouteByLineKey(lineKey, { requestSource: REQUEST_SOURCE });
      if (route) {
        found.push(lineKey);
      } else {
        notFound.push(lineKey);
      }
    } catch {
      notFound.push(lineKey);
    }
  }

  const report = found.length
    ? await refreshRoutes(found, options)
    : {
        requested: 0,
        refreshed: [],
        removed: [],
        failures: [],
        flagsOpened: [],
        merged: { added: 0, updated: 0 },
        tileCount: null,
        sizeBytes: null,
        totalRoutesInArchive: totalRoutesInArchive(),
        elapsedMs: 0
      };
  report.notFound = notFound;
  return report;
}

// Remove routes from the archive explicitly (admin says they are gone). User
// data on each route is preserved and flagged, same as an upstream-confirmed
// removal during a refresh.
async function removeRoutes(lineKeys, options = {}) {
  const t0 = Date.now();
  const keys = normalizeKeys(lineKeys);
  const report = {
    requested: keys.length,
    removed: [],
    failures: [],
    flagsOpened: [],
    merged: { added: 0, updated: 0 },
    tileCount: null,
    sizeBytes: null,
    totalRoutesInArchive: null,
    elapsedMs: 0
  };

  for (const lineKey of keys) {
    try {
      await removeMissingRoute(lineKey, report);
    } catch (error) {
      report.failures.push({ lineKey, error: String(error?.message || error) });
    }
  }

  if (report.removed.length) {
    const built = await buildPmtiles({ log: { log: () => {} } });
    report.tileCount = built ? built.tileCount : null;
    report.sizeBytes = built ? built.sizeBytes : null;
  }

  report.totalRoutesInArchive = totalRoutesInArchive();
  report.elapsedMs = Date.now() - t0;
  log.info("Route removal complete", {
    requested: report.requested,
    removed: report.removed.length,
    failures: report.failures.length,
    elapsedMs: report.elapsedMs
  });
  return report;
}

module.exports = {
  refreshRoutes,
  addRoutes,
  removeRoutes,
  searchTransitlandRoutes
};
