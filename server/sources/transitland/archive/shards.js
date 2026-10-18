const fs = require("fs");
const path = require("path");
const { listNdjsonFiles, GEO_DIR } = require("../../../scripts/build/build-pmtiles");

const BACKFILL_FILE = path.join(GEO_DIR, "routes-feed.ndjson");

// Sharded NDJSON archive; merges touch only the affected shards.

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

    const allNames = fs.existsSync(GEO_DIR) ? fs.readdirSync(GEO_DIR) : [];

// Rebuild a missing manifest; never treat shards as legacy inputs.
    if (allNames.some((name) => isShardFile(name))) {
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
      return;
    }

    const legacyFiles = allNames
      .filter((name) => name.endsWith(".ndjson") && !isShardFile(name))
      .map((name) => path.join(GEO_DIR, name));
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

module.exports = {
  BACKFILL_FILE,
  SHARD_COUNT,
  SHARD_PREFIX,
  MANIFEST_FILE,
  LOCK_FILE,
  LOCK_STALE_MS,
  isShardFile,
  shardFileName,
  shardIndexFor,
  readManifest,
  writeManifest,
  withArchiveLock,
  lineKeyOf,
  readNdjsonFeatures,
  readShardFeatures,
  writeShardFeatures,
  scanArchiveLineKeysSync,
  totalRoutesInArchive,
  ensureSharded,
  readShardFeatureCount
};
