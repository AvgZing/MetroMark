const { fetchRouteCatalogForBbox, fetchRouteByLineKey } = require("./fetch");
const { getCoverageLineKeysForBbox } = require("./coverage");
const { routeToFeature } = require("./route-features");
const { runArchiveBuild } = require("../../admin/archive-build");
const {
  mergeBackfillFeatures,
  totalRoutesInArchive,
  listArchiveLineKeysInBbox
} = require("./archive/store");

const backfillStats = {
  count: 0,
  totalMs: 0,
  fetchedRoutes: 0,
  addedRoutes: 0,
  updatedRoutes: 0,
  lastAt: null,
  lastBbox: null,
  lastError: null,
  lastResult: null,
  current: null
};


const MAX_BACKFILL_SPAN_DEGREES = 1.8;

function clampBackfillBbox(bboxArray) {
  if (!Array.isArray(bboxArray) || bboxArray.length !== 4) {
    return bboxArray;
  }

  const [west, south, east, north] = bboxArray.map((value) => Number(value));
  const spanLon = east - west;
  const spanLat = north - south;
  if (spanLon <= MAX_BACKFILL_SPAN_DEGREES && spanLat <= MAX_BACKFILL_SPAN_DEGREES) {
    return bboxArray;
  }

  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const half = MAX_BACKFILL_SPAN_DEGREES / 2;
  return [
    centerLon - half,
    Math.max(-85, centerLat - half),
    centerLon + half,
    Math.min(85, centerLat + half)
  ];
}

async function runBackfill(bboxArray, options = {}) {
  const t0 = Date.now();
  const forceRefresh = Boolean(options.forceRefresh);
  const bbox = clampBackfillBbox(bboxArray);

  backfillStats.current = {
    stage: "fetching",
    message: "Fetching routes from Transitland…",
    fetchedRoutes: 0,
    addedRoutes: 0,
    startedAt: new Date().toISOString()
  };
  backfillStats.lastError = null;
  backfillStats.lastResult = null;

  try {
    if (backfillStats.current) {
      backfillStats.current.message = "Scanning coverage tiles…";
    }
    const coverage = await getCoverageLineKeysForBbox(bbox, 10, {
      maxTiles: 40,
      requestSource: options.requestSource || "backfill",
      enforceDailyCap: Boolean(options.enforceDailyCap)
    });
    let candidateKeys = coverage.lineKeys;
    let usedCatalogFallback = false;
    if (!candidateKeys.length) {
      // Tiles unavailable: fall back to the metadata catalog.
      usedCatalogFallback = true;
      const catalog = await fetchRouteCatalogForBbox(bbox, {
        requestSource: options.requestSource || "backfill",
        enforceDailyCap: Boolean(options.enforceDailyCap)
      });
      candidateKeys = (catalog.routes || [])
        .map((route) => String(route?.onestop_id || route?.id || "").trim())
        .filter(Boolean);
    }
    const existingKeys = await listArchiveLineKeysInBbox(bbox);
    const missingKeys = Array.from(new Set(candidateKeys)).filter(
      (id) => id && (forceRefresh || !existingKeys.has(id))
    );

    // Fetch geometry only for routes missing from the archive.
    const normalized = [];
    let unavailableRoutes = 0;
    let failedFetch = 0;
    const FETCH_CONCURRENCY = 4;
    for (let i = 0; i < missingKeys.length; i += FETCH_CONCURRENCY) {
      const batch = missingKeys.slice(i, i + FETCH_CONCURRENCY);
      const fetched = await Promise.allSettled(
        batch.map((lineKey) =>
          fetchRouteByLineKey(lineKey, {
            requestSource: options.requestSource || "backfill",
            enforceDailyCap: Boolean(options.enforceDailyCap)
          })
        )
      );
      for (const result of fetched) {
        if (result.status === "fulfilled" && result.value) {
          normalized.push(result.value);
        } else if (result.status === "fulfilled") {
          unavailableRoutes += 1;
        } else {
          failedFetch += 1;
        }
      }
      if (backfillStats.current) {
        backfillStats.current.message =
          `Fetching route geometry (${Math.min(i + FETCH_CONCURRENCY, missingKeys.length)}/${missingKeys.length})…`;
      }
    }

    const features = normalized.map(routeToFeature).filter(Boolean);
    const diagnostics = {
      coverageKeys: coverage.lineKeys.length,
      coverageTiles: coverage.tileCount,
      catalogFallback: usedCatalogFallback,
      missingRoutes: missingKeys.length,
      fetchedRoutes: features.length,
      unavailableRoutes,
      failedFetch
    };

    if (options.collectOnly) {
      backfillStats.current = null;
      return {
        addedRoutes: 0,
        updatedRoutes: 0,
        skippedRoutes: 0,
        fetchedRoutes: features.length,
        totalRoutesInArchive: totalRoutesInArchive(),
        rebuilt: false,
        features,
        diagnostics
      };
    }

    const merged = await mergeBackfillFeatures(features, { overwrite: forceRefresh });

    backfillStats.current = {
      stage: "rebuilding",
      message: `Rebuilding route tiles (${features.length} routes fetched, +${merged.added} new)…`,
      fetchedRoutes: features.length,
      addedRoutes: merged.added,
      startedAt: new Date().toISOString()
    };

    let built = null;
    // Rebuild when routes were fetched; the store may be ahead of the archive.
    if (features.length > 0 || totalRoutesInArchive() === 0) {
      built = await runArchiveBuild();
    }

    backfillStats.current = null;
    const elapsedMs = Date.now() - t0;
    backfillStats.count += 1;
    backfillStats.totalMs += elapsedMs;
    backfillStats.fetchedRoutes += features.length;
    backfillStats.addedRoutes += merged.added;
    backfillStats.updatedRoutes += merged.updated;
    backfillStats.lastAt = new Date().toISOString();
    backfillStats.lastBbox = bboxArray;

    const summary = {
      addedRoutes: merged.added,
      updatedRoutes: merged.updated,
      skippedRoutes: merged.skipped,
      fetchedRoutes: features.length,
      totalRoutesInArchive: totalRoutesInArchive(),
      rebuilt: Boolean(built),
      tileCount: built ? built.tileCount : null,
      sizeBytes: built ? built.sizeBytes : null,
      elapsedMs,
      diagnostics
    };
    backfillStats.lastResult = summary;
    return summary;
  } catch (error) {
    backfillStats.lastError = String(error?.message || error);
    backfillStats.current = null;
    throw error;
  }
}

function getBackfillStats() {
  return {
    ...backfillStats,
    averageMs: backfillStats.count > 0 ? Math.round(backfillStats.totalMs / backfillStats.count) : 0
  };
}

module.exports = {
  ...require("./archive/store"),
  runBackfill,
  getBackfillStats
};
