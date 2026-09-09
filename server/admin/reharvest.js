const db = require("../processors/data");
const { createLogger } = require("./logger");

const { fetchRoutesAndStopsForBbox, fetchRouteByLineKey } = require("../sources/transitland/fetch");
const { normalizeRoutes } = require("../sources/transitland/routes");
const { routeToFeature } = require("../sources/transitland/route-features");
const { getRouteHeadway } = require("../sources/transitland/route-headway");
const { getRouteStopsTransit } = require("../sources/transitland/route-stops");
const { mergeBackfillFeatures, removeFeaturesFromArchive, listArchiveLineKeysInBbox, totalRoutesInArchive } = require("../sources/transitland/backfill");
const { buildPmtiles } = require("../scripts/build/build-pmtiles");

const log = createLogger("reharvest");

// Manual viewport reharvest: one admin action that forces the whole pipeline
// for a bbox — fresh route catalog, geometry, per-route headway + stops + route
// metadata — and then diffs against the archive to handle routes that went
// away. Runs uncapped (manual, like the live map viewport fetch). Routes that
// disappeared from Transitland are confirmed before removal, and any admin
// override / community review / ordering vote attached to a removed route is
// preserved and flagged for review rather than silently dropped.

const MAX_SPAN_DEGREES = 1.8;
const REQUEST_SOURCE = "reharvest";

const reharvestStats = {
  count: 0,
  totalMs: 0,
  lastAt: null,
  lastBbox: null,
  lastError: null,
  current: null
};

function clampBbox(bboxArray) {
  const [west, south, east, north] = bboxArray.map((value) => Number(value));
  const spanLon = east - west;
  const spanLat = north - south;
  if (spanLon <= MAX_SPAN_DEGREES && spanLat <= MAX_SPAN_DEGREES) {
    return bboxArray;
  }
  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const half = MAX_SPAN_DEGREES / 2;
  return [
    centerLon - half,
    Math.max(-85, centerLat - half),
    centerLon + half,
    Math.min(85, centerLat + half)
  ];
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function lineKeyOf(feature) {
  return String(feature?.properties?.line_key || feature?.id || "").trim();
}

async function flagRemovedUserData(lineKey, counts) {
  const opened = [];
  if (Number(counts.overrides || 0) > 0) {
    const id = await db.openReharvestFlag("route-removed-override", `Route ${lineKey} no longer exists on Transitland. The admin override is preserved for review.`, { lineKey });
    if (id) opened.push(id);
  }
  if (Number(counts.reviews || 0) > 0) {
    const id = await db.openReharvestFlag("route-removed-review", `Route ${lineKey} no longer exists on Transitland. The route review is preserved for review.`, { lineKey });
    if (id) opened.push(id);
  }
  if (Number(counts.votes || 0) > 0) {
    const id = await db.openReharvestFlag("route-removed-votes", `Route ${lineKey} no longer exists on Transitland. ${counts.votes} ordering vote(s) preserved for review.`, { lineKey });
    if (id) opened.push(id);
  }
  return opened;
}

async function refreshRoute(lineKey, options) {
  let headwayStatus = "skipped";
  let stopsStatus = "skipped";
  if (options.refreshHeadway) {
    // Clear the stored headway first: getRouteHeadway returns from Postgres
    // immediately when valid headway exists, even under forceRefresh.
    try {
      await db.setRouteMetadata(lineKey, { headwayBestMinutes: null, headwayChecked: 0 });
    } catch {
      // best-effort
    }
    const headwayResult = await getRouteHeadway(lineKey, {
      forceRefresh: true,
      zoom: options.zoom,
      requestSource: REQUEST_SOURCE
    });
    headwayStatus = headwayResult.headwayFallback ? "fallback" : "ok";
  }
  if (options.refreshStops) {
    const stopsResult = await getRouteStopsTransit(lineKey, {
      forceRefresh: true,
      requestSource: REQUEST_SOURCE
    });
    stopsStatus = stopsResult.payload ? "ok" : "miss";
  }
  return { lineKey, headwayStatus, stopsStatus };
}

async function runReharvest(bboxArray, options = {}) {
  const t0 = Date.now();
  const bbox = clampBbox(bboxArray);
  const refreshStops = options.refreshStops !== false;
  const refreshHeadway = options.refreshHeadway !== false;
  const zoom = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : null;

  reharvestStats.current = {
    stage: "catalog",
    message: "Fetching the fresh route catalog from Transitland…",
    processed: 0,
    total: 0,
    startedAt: new Date().toISOString()
  };

  const report = {
    bbox,
    requestedBbox: bboxArray,
    zoom,
    addedRoutes: 0,
    updatedRoutes: 0,
    removedRoutes: 0,
    confirmedStillPresent: 0,
    refreshOk: 0,
    refreshFailures: [],
    flagsOpened: [],
    refreshed: []
  };

  try {
    log.info("Reharvest started", { bbox, refreshStops, refreshHeadway });

    const catalog = await fetchRoutesAndStopsForBbox(bbox, {
      includeAllTypes: true,
      routeTypes: [],
      forceRefresh: true,
      requestSource: REQUEST_SOURCE
    });

    const normalized = normalizeRoutes(Array.isArray(catalog.routes) ? catalog.routes : []);
    const features = normalized.map(routeToFeature).filter(Boolean);
    const freshKeys = new Set(features.map(lineKeyOf).filter(Boolean));
    const freshKeySet = new Set(freshKeys);

    reharvestStats.current = {
      ...reharvestStats.current,
      stage: "diff",
      message: `Diffing ${freshKeySet.size} fresh routes against the archive…`
    };

    const archiveKeys = await listArchiveLineKeysInBbox(bbox);
    const addedKeys = Array.from(freshKeySet).filter((key) => !archiveKeys.has(key));
    const removedCandidates = Array.from(archiveKeys).filter((key) => !freshKeySet.has(key));
    const existingKeys = Array.from(freshKeySet).filter((key) => archiveKeys.has(key));

    report.addedRoutes = addedKeys.length;
    report.updatedRoutes = existingKeys.length;

    const merged = await mergeBackfillFeatures(features, { overwrite: true });
    report.merged = merged;

    reharvestStats.current = {
      ...reharvestStats.current,
      stage: "refresh",
      message: `Refreshing headway/stops for ${freshKeySet.size} routes…`,
      processed: 0,
      total: freshKeySet.size
    };

    const routeOptions = { refreshHeadway, refreshStops, zoom };
    await mapLimit(Array.from(freshKeySet), Math.max(2, Math.min(6, options.concurrency || 4)), async (lineKey) => {
      try {
        const result = await refreshRoute(lineKey, routeOptions);
        report.refreshed.push(result.lineKey);
        report.refreshOk += 1;
      } catch (error) {
        report.refreshFailures.push({
          lineKey,
          error: String(error?.message || error)
        });
        log.warn("Reharvest route refresh failed", { lineKey, error: String(error?.message || error) });
      }
    });

    reharvestStats.current = {
      ...reharvestStats.current,
      stage: "removals",
      message: `Checking ${removedCandidates.length} route(s) that no longer appear in the viewport…`,
      processed: 0,
      total: removedCandidates.length
    };

    let confirmedRemoved = 0;
    const confirmedRemovedKeys = [];
    for (let i = 0; i < removedCandidates.length; i += 1) {
      const lineKey = removedCandidates[i];
      let stillPresent = false;
      try {
        const confirmed = await fetchRouteByLineKey(lineKey, { requestSource: REQUEST_SOURCE });
        stillPresent = Boolean(confirmed);
      } catch {
        stillPresent = true;
      }
      if (stillPresent) {
        report.confirmedStillPresent += 1;
        continue;
      }
      confirmedRemoved += 1;
      confirmedRemovedKeys.push(lineKey);
      reharvestStats.current.processed = i + 1;
    }

    if (confirmedRemovedKeys.length) {
      const userData = await db.countLineKeyUserData(confirmedRemovedKeys);
      for (const lineKey of confirmedRemovedKeys) {
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
        log.info("Reharvest removed route", { lineKey, userData: counts, flagIds: opened });
      }
      const removed = await removeFeaturesFromArchive(confirmedRemovedKeys);
      report.removedRoutes = removed.removed;
      if (removed.removed !== confirmedRemoved) {
        log.warn("Reharvest removal count mismatch", { expected: confirmedRemoved, removed: removed.removed });
      }
    }

    const changedAnything = report.merged.added > 0 || report.merged.updated > 0 || confirmedRemoved > 0;
    let built = null;
    if (changedAnything || totalRoutesInArchive() === 0) {
      reharvestStats.current = {
        ...reharvestStats.current,
        stage: "rebuilding",
        message: "Rebuilding route tiles…",
        processed: 1,
        total: 1
      };
      built = await buildPmtiles({ log: { log: () => {} } });
    }

    report.tileCount = built ? built.tileCount : null;
    report.sizeBytes = built ? built.sizeBytes : null;
    report.totalRoutesInArchive = totalRoutesInArchive();
    report.catalogDiagnostics = catalog.diagnostics || null;

    const elapsedMs = Date.now() - t0;
    report.elapsedMs = elapsedMs;
    reharvestStats.count += 1;
    reharvestStats.totalMs += elapsedMs;
    reharvestStats.lastAt = new Date().toISOString();
    reharvestStats.lastBbox = bboxArray;
    reharvestStats.current = null;

    log.info("Reharvest complete", {
      bbox,
      added: report.addedRoutes,
      updated: report.updatedRoutes,
      removed: report.removedRoutes,
      stillPresent: report.confirmedStillPresent,
      refreshOk: report.refreshOk,
      refreshFailures: report.refreshFailures.length,
      flagsOpened: report.flagsOpened.length,
      elapsedMs
    });

    return report;
  } catch (error) {
    reharvestStats.lastError = String(error?.message || error);
    reharvestStats.current = null;
    log.error("Reharvest failed", { error: String(error?.message || error) });
    throw error;
  }
}

function getReharvestStats() {
  return {
    ...reharvestStats,
    averageMs: reharvestStats.count > 0 ? Math.round(reharvestStats.totalMs / reharvestStats.count) : 0
  };
}

module.exports = {
  runReharvest,
  getReharvestStats,
  MAX_SPAN_DEGREES
};
