const fs = require("fs");
const path = require("path");

const { fetchRoutesAndStopsForBbox } = require("./fetch");
const { normalizeRoutes } = require("./routes");
const { routeToFeature } = require("./route-features");
const { buildPmtiles, listNdjsonFiles, GEO_DIR } = require("../../scripts/build/build-pmtiles");

const BACKFILL_FILE = path.join(GEO_DIR, "routes-feed.ndjson");

// Sharded NDJSON archive (256 shards by hash of line_key) so merges only touch
// the shards their new routes hash into instead of rewriting the whole file.

const SHARD_COUNT = 256;
const SHARD_PREFIX = "shard-";
const MANIFEST_FILE = path.join(GEO_DIR, "archive-manifest.json");
const LOCK_FILE = path.join(GEO_DIR, "archive.lock");
const LOCK_STALE_MS = 60 * 1000;

function isShardFile(name) {
  return /^shard-\d+\.ndjson$/.test(name);
}

function shardFileName(index) {
  return path.join(GEO_DIR, `${SHARD_PREFIX}${String(index).padStart(3, "0")}.ndjson`);
}

function shardIndexFor(lineKey) {
  let hash = 5381;
  for (let i = 0; i < lineKey.length; i += 1) {
    hash = ((hash << 5) + hash + lineKey.charCodeAt(i)) >>> 0;
  }
  return hash % SHARD_COUNT;
}

function readManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
    if (parsed.shardCount === SHARD_COUNT && Array.isArray(parsed.counts) && parsed.counts.length === SHARD_COUNT) {
      return parsed;
    }
  } catch {
    // absent or invalid
  }
  return null;
}

function writeManifest(counts) {
  const manifest = {
    shardCount: SHARD_COUNT,
    counts,
    totalRoutes: counts.reduce((sum, n) => sum + n, 0),
    updatedAt: new Date().toISOString()
  };
  try {
    fs.mkdirSync(GEO_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");
  } catch {
    // Best-effort; stats fall back to a scan.
  }
  return manifest;
}

async function withArchiveLock(fn) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (;;) {
    let acquired = false;
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.closeSync(fd);
      acquired = true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {
        // Lock vanished between check and unlink — retry.
      }
      await wait(150);
      continue;
    }
    try {
      return await fn();
    } finally {
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {
        // Best-effort release.
      }
    }
  }
}

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

async function readNdjsonFeatures(filePath) {
  const map = new Map();
  try {
    const text = await fs.promises.readFile(filePath, "utf8");
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
  } catch {
    // missing/unreadable file → empty map
  }
  return map;
}

async function readShardFeatures(index) {
  return readNdjsonFeatures(shardFileName(index));
}

async function writeShardFeatures(index, features) {
  fs.mkdirSync(GEO_DIR, { recursive: true });
  const lines = Array.from(features.values()).map((f) => JSON.stringify(f)).join("\n");
  await fs.promises.writeFile(shardFileName(index), lines.length ? lines + "\n" : "", "utf8");
}

function scanArchiveLineKeysSync() {
  const keys = new Set();
  for (const file of listNdjsonFiles()) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const feature = JSON.parse(trimmed);
        const key = lineKeyOf(feature);
        if (key) {
          keys.add(key);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  return keys;
}

function totalRoutesInArchive() {
  const manifest = readManifest();
  if (manifest) {
    return manifest.totalRoutes;
  }
  return scanArchiveLineKeysSync().size;
}

let shardsInitialized = false;
let migrationPromise = null;

async function ensureSharded() {
  if (shardsInitialized) {
    return;
  }
  if (migrationPromise) {
    return migrationPromise;
  }
  migrationPromise = withArchiveLock(async () => {
    if (shardsInitialized) {
      return;
    }
    if (readManifest()) {
      shardsInitialized = true;
      return;
    }

    const legacyFiles = listNdjsonFiles();
    if (legacyFiles.length) {
      const perShard = Array.from({ length: SHARD_COUNT }, () => new Map());
      for (const file of legacyFiles) {
        const features = await readNdjsonFeatures(file);
        for (const [key, feature] of features) {
          perShard[shardIndexFor(key)].set(key, feature);
        }
      }
      for (let i = 0; i < SHARD_COUNT; i += 1) {
        if (perShard[i].size > 0) {
          await writeShardFeatures(i, perShard[i]);
        }
      }
      for (const file of legacyFiles) {
        try {
          await fs.promises.unlink(file);
        } catch {
          // Best-effort removal of the legacy file.
        }
      }
    }

    const counts = Array.from({ length: SHARD_COUNT }, (_, i) => {
      const file = shardFileName(i);
      try {
        return fs.existsSync(file) ? readShardFeatureCount(file) : 0;
      } catch {
        return 0;
      }
    });
    writeManifest(counts);
    shardsInitialized = true;
  });
  return migrationPromise;
}

function readShardFeatureCount(filePath) {
  let count = 0;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      if (line.trim()) {
        count += 1;
      }
    }
  } catch {
    return 0;
  }
  return count;
}

async function mergeBackfillFeatures(newFeatures, options = {}) {
  const overwrite = Boolean(options.overwrite);

  const incoming = (newFeatures || []).filter((feature) => lineKeyOf(feature));
  if (!incoming.length) {
    return { added: 0, updated: 0, skipped: 0 };
  }

  await ensureSharded();

  const byShard = new Map();
  for (const feature of incoming) {
    const key = lineKeyOf(feature);
    const index = shardIndexFor(key);
    if (!byShard.has(index)) {
      byShard.set(index, new Map());
    }
    byShard.get(index).set(key, feature);
  }

  return withArchiveLock(async () => {
    const manifest = readManifest() || {
      shardCount: SHARD_COUNT,
      counts: Array(SHARD_COUNT).fill(0),
      totalRoutes: 0
    };
    const counts = manifest.counts.slice();
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const [index, incomingMap] of byShard) {
      const shardMap = await readShardFeatures(index);
      for (const [key, feature] of incomingMap) {
        const existing = shardMap.has(key);
        if (existing && !overwrite) {
          skipped += 1;
          continue;
        }
        if (existing) {
          updated += 1;
        } else {
          added += 1;
        }
        shardMap.set(key, feature);
      }
      await writeShardFeatures(index, shardMap);
      counts[index] = shardMap.size;
    }

    writeManifest(counts);
    return { added, updated, skipped };
  });
}

function invalidateArchiveCount() {
  try {
    fs.unlinkSync(MANIFEST_FILE);
  } catch {
    // Not present — nothing to invalidate.
  }
}

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

  try {
    const result = await fetchRoutesAndStopsForBbox(bbox, {
      includeAllTypes: true,
      routeTypes: [],
      forceRefresh,
      requestSource: "backfill"
    });

    const normalized = normalizeRoutes(Array.isArray(result.routes) ? result.routes : []);
    const features = normalized.map(routeToFeature).filter(Boolean);
    const merged = await mergeBackfillFeatures(features, { overwrite: forceRefresh });

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
  invalidateArchiveCount,
  BACKFILL_FILE
};
