const fs = require("fs");
const {
  MANIFEST_FILE,
  SHARD_COUNT,
  ensureSharded,
  lineKeyOf,
  readManifest,
  writeManifest,
  withArchiveLock,
  shardIndexFor,
  readShardFeatures,
  writeShardFeatures
} = require("./shards");

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

// Line keys whose geometry bbox intersects the given bbox.
async function listArchiveLineKeysInBbox(bboxArray) {
  await ensureSharded();
  const keys = new Set();
  if (!Array.isArray(bboxArray) || bboxArray.length !== 4) {
    return keys;
  }
  const [west, south, east, north] = bboxArray.map(Number);

  for (let index = 0; index < SHARD_COUNT; index += 1) {
    const shardMap = await readShardFeatures(index);
    for (const [key, feature] of shardMap) {
      const bbox = featureBbox(feature);
      if (!bbox) {
        continue;
      }
      if (bbox[0] <= east && bbox[2] >= west && bbox[1] <= north && bbox[3] >= south) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function featureBbox(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const parts = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
  for (const part of parts) {
    if (!Array.isArray(part)) {
      continue;
    }
    for (const coord of part) {
      if (!Array.isArray(coord) || coord.length < 2) {
        continue;
      }
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (!Number.isFinite(minLon)) {
    return null;
  }
  return [minLon, minLat, maxLon, maxLat];
}

// Remove archive features by line key after a confirmed reharvest.
async function removeFeaturesFromArchive(lineKeys) {
  const targets = Array.from(
    new Set((Array.isArray(lineKeys) ? lineKeys : []).map((key) => String(key || "").trim()).filter(Boolean))
  );
  if (!targets.length) {
    return { removed: 0 };
  }

  await ensureSharded();
  const byShard = new Map();
  for (const key of targets) {
    const index = shardIndexFor(key);
    if (!byShard.has(index)) {
      byShard.set(index, []);
    }
    byShard.get(index).push(key);
  }

  return withArchiveLock(async () => {
    const manifest = readManifest();
    const counts = manifest ? manifest.counts.slice() : Array(SHARD_COUNT).fill(0);
    let removed = 0;
    for (const [index, keys] of byShard) {
      const shardMap = await readShardFeatures(index);
      let changed = false;
      for (const key of keys) {
        if (shardMap.delete(key)) {
          removed += 1;
          changed = true;
        }
      }
      if (changed) {
        await writeShardFeatures(index, shardMap);
        counts[index] = shardMap.size;
      }
    }
    writeManifest(counts);
    return { removed };
  });
}

// Read archive features by line key (affected shards only).
async function getArchiveFeaturesByLineKeys(lineKeys) {
  const wanted = new Set(
    (Array.isArray(lineKeys) ? lineKeys : []).map((key) => String(key || "").trim()).filter(Boolean)
  );
  const result = new Map();
  if (!wanted.size) {
    return result;
  }
  await ensureSharded();
  const byShard = new Map();
  for (const key of wanted) {
    const index = shardIndexFor(key);
    if (!byShard.has(index)) {
      byShard.set(index, new Set());
    }
    byShard.get(index).add(key);
  }
  for (const [index, keys] of byShard) {
    const shardMap = await readShardFeatures(index);
    for (const key of keys) {
      const feature = shardMap.get(key);
      if (feature) {
        result.set(key, feature);
      }
    }
  }
  return result;
}

module.exports = {
  ...require("./shards"),
  mergeBackfillFeatures,
  invalidateArchiveCount,
  listArchiveLineKeysInBbox,
  removeFeaturesFromArchive,
  getArchiveFeaturesByLineKeys
};
