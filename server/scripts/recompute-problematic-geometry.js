#!/usr/bin/env node

const db = require("../processors/data");
const { SHARD_COUNT, ensureSharded, readShardFeatures } = require("../sources/transitland/archive/shards");
const { detectProblematicGeometry } = require("../sources/transitland/problematic-geometry");
const { createLogger } = require("../admin/logger");
const { TRANSIT_CACHE_PREFIX } = require("../sources/transitland");

const log = createLogger("problematic-geometry");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : 0;
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Math.max(0, argValue("--limit"));
  await ensureSharded();
  let scanned = 0;
  let flagged = 0;
  let updated = 0;

  for (let shard = 0; shard < SHARD_COUNT; shard += 1) {
    const features = await readShardFeatures(shard);
    for (const [lineKey, feature] of features) {
      if (limit && scanned >= limit) {
        break;
      }
      scanned += 1;
      if (detectProblematicGeometry(feature.geometry, [], feature.properties?.route_type)) {
        flagged += 1;
        if (!dryRun) {
          try {
            await db.setRouteMetadata(lineKey, { problematicGeometry: true });
            updated += 1;
          } catch (error) {
            log.warn(`Could not update ${lineKey}: ${error.message}`);
          }
        }
      }
      if (scanned % 1000 === 0) {
        log.info(`Scanned ${scanned}; flagged ${flagged}; updated ${updated}.`);
      }
    }
    if (limit && scanned >= limit) {
      break;
    }
  }

  if (!dryRun && updated > 0) {
    await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    log.info(`Cleared transit cache prefix ${TRANSIT_CACHE_PREFIX}.`);
  }
  log.info(`${dryRun ? "Dry run: " : ""}scanned ${scanned}; flagged ${flagged}; updated ${updated}.`);
}

run().catch((error) => {
  log.error("Recompute failed:", error);
  process.exitCode = 1;
});
