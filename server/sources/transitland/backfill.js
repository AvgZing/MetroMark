const fs = require("fs");
const path = require("path");

const { fetchRoutesAndStopsForBbox } = require("./fetch");
const { normalizeRoutes } = require("./routes");
const { routeToFeature } = require("./route-features");
const { buildPmtiles, listNdjsonFiles, GEO_DIR } = require("../../scripts/build/build-pmtiles");

const BACKFILL_FILE = path.join(GEO_DIR, "routes-feed.ndjson");

const backfillStats = {
  count: 0,
  totalMs: 0,
  fetchedRoutes: 0,
  addedRoutes: 0,
  updatedRoutes: 0,
  lastAt: null,
  lastBbox: null,
  lastError: null,
  current: null
};

function lineKeyOf(feature) {
  return String(feature?.properties?.line_key || feature?.id || "").trim();
}

function readNdjsonFeatures(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) {
    return map;
  }
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const feature = JSON.parse(trimmed);
      const key = lineKeyOf(feature);
      if (key && !map.has(key)) {
        map.set(key, feature);
      }
    } catch {
      // skip malformed lines
    }
  }
  return map;
}

function existingLineKeys() {
  const keys = new Set();
  for (const file of listNdjsonFiles()) {
    for (const key of readNdjsonFeatures(file).keys()) {
      keys.add(key);
    }
  }
  return keys;
}

function seedOwnedLineKeys() {
  const keys = new Set();
  for (const file of listNdjsonFiles()) {
    if (path.basename(file) === path.basename(BACKFILL_FILE)) {
      continue;
    }
    for (const key of readNdjsonFeatures(file).keys()) {
      keys.add(key);
    }
  }
  return keys;
}

function totalRoutesInArchive() {
  return existingLineKeys().size;
}

function mergeBackfillFeatures(newFeatures, options = {}) {
  const overwrite = Boolean(options.overwrite);
  const backfillMap = readNdjsonFeatures(BACKFILL_FILE);
  const seedKeys = seedOwnedLineKeys();

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const feature of newFeatures) {
    const key = lineKeyOf(feature);
    if (!key) {
      skipped += 1;
      continue;
    }

    const inBackfill = backfillMap.has(key);
    const inSeed = seedKeys.has(key);

    if (inSeed && !overwrite) {
      skipped += 1;
      continue;
    }
    if (inBackfill && !overwrite) {
      skipped += 1;
      continue;
    }
    if (inBackfill) {
      updated += 1;
    } else {
      added += 1;
    }
    backfillMap.set(key, feature);
  }

  if (added > 0 || updated > 0) {
    fs.mkdirSync(path.dirname(BACKFILL_FILE), { recursive: true });
    const lines = Array.from(backfillMap.values()).map((f) => JSON.stringify(f)).join("\n") + "\n";
    fs.writeFileSync(BACKFILL_FILE, lines, "utf8");
  }

  return { added, updated, skipped };
}

const MAX_BACKFILL_SPAN_DEGREES = 1.8;

// Transitland rejects bboxes larger than ~2 degrees. Clamp oversized bboxes
// (e.g. the auto-backfill at a low-but-eligible zoom, or a hand-entered admin
// bbox) around their center so the fetch never 500s with "bbox too large".
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

  try {
    const result = await fetchRoutesAndStopsForBbox(bbox, {
      includeAllTypes: true,
      routeTypes: [],
      // User-initiated backfill must not be blocked by the harvester's daily
      // quota — only the background harvesters enforce the cap.
      forceRefresh,
      requestSource: "backfill"
    });

    const normalized = normalizeRoutes(Array.isArray(result.routes) ? result.routes : []);
    const features = normalized.map(routeToFeature).filter(Boolean);
    const merged = mergeBackfillFeatures(features, { overwrite: forceRefresh });

    backfillStats.current = {
      stage: "rebuilding",
      message: `Rebuilding route tiles (${features.length} routes fetched, +${merged.added} new)…`,
      fetchedRoutes: features.length,
      addedRoutes: merged.added,
      startedAt: new Date().toISOString()
    };

    let built = null;
    if (merged.added > 0 || merged.updated > 0) {
      built = await buildPmtiles({ log: { log: () => {} } });
    } else if (totalRoutesInArchive() === 0) {
      built = await buildPmtiles({ log: { log: () => {} } });
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

    return {
      addedRoutes: merged.added,
      updatedRoutes: merged.updated,
      skippedRoutes: merged.skipped,
      fetchedRoutes: features.length,
      totalRoutesInArchive: totalRoutesInArchive(),
      tileCount: built ? built.tileCount : null,
      sizeBytes: built ? built.sizeBytes : null,
      elapsedMs,
      diagnostics: result.diagnostics || null
    };
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
  runBackfill,
  mergeBackfillFeatures,
  getBackfillStats,
  totalRoutesInArchive,
  BACKFILL_FILE
};
