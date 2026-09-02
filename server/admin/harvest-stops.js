#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const config = require("./config");
const db = require("../processors/data");
const budget = require("../sources/transitland/harvest-budget");
const { getRouteStopsTransit } = require("../sources/transitland");
const { createLogger } = require("./logger");

const fileLog = createLogger("harvester");

const GEO_DIR = path.join(__dirname, "..", "..", "data", "tiles", "geo");

function nowIso() {
  return new Date().toISOString();
}

function log(message, details = null) {
  const prefix = `[harvest-stops ${nowIso()}]`;
  if (details === null || details === undefined) {
    const line = `${prefix} ${message}`;
    console.log(line);
    fileLog.raw(line);
    return;
  }
  const line = `${prefix} ${message}`;
  console.log(line, details);
  fileLog.raw(`${line} :: ${safeStringify(details)}`);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function getUsageCapState() {
  return db.getDailyUsageCapsState({
    rest: config.HARVEST_DAILY_REST_LIMIT,
    vector: config.HARVEST_DAILY_VECTOR_LIMIT,
    routing: config.HARVEST_DAILY_ROUTING_LIMIT
  });
}

function summarizeUsage(state) {
  return {
    dayKey: state.usage.dayKey,
    rest: `${state.usage.restApiCalls}/${state.limits.rest}`,
    vector: `${state.usage.vectorTileCalls}/${state.limits.vector}`,
    routing: `${state.usage.routingApiCalls}/${state.limits.routing}`,
    backgroundAllowed: state.backgroundAllowed
  };
}

function readArchiveLineKeys() {
  const keys = new Set();
  if (!fs.existsSync(GEO_DIR)) {
    return [];
  }

  for (const file of fs.readdirSync(GEO_DIR)) {
    if (!file.endsWith(".ndjson")) {
      continue;
    }
    const text = fs.readFileSync(path.join(GEO_DIR, file), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const feature = JSON.parse(trimmed);
        const key = String(feature?.properties?.line_key || feature?.id || "").trim();
        if (key) {
          keys.add(key);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return Array.from(keys);
}

async function run() {
  const lineKeys = readArchiveLineKeys();
  if (!lineKeys.length) {
    log("No route keys found in the NDJSON store.");
    return { skipped: true, reason: "no-keys" };
  }
  log(`Found ${lineKeys.length} route keys in the archive.`);

  // Bulk-check which already have an exact stop count cached in route_metadata.
  const meta = new Map();
  const CHUNK = 500;
  for (let i = 0; i < lineKeys.length; i += CHUNK) {
    const chunk = lineKeys.slice(i, i + CHUNK);
    try {
      const chunkMeta = await db.getRouteMetadatasByLineKeys(chunk);
      for (const [key, value] of chunkMeta) {
        meta.set(key, value);
      }
    } catch {
      // If one chunk fails, treat those lines as missing so they get fetched.
    }
  }

  const missing = lineKeys.filter((lineKey) => {
    const count = Number(meta.get(lineKey)?.stopCount || 0);
    return !Number.isFinite(count) || count <= 0;
  });

  // Stops are "nearly done" when every route in the archive already has an
  // exact stop count; from that point the pass only fills stragglers.
  budget.setNearlyDone("stops", missing.length === 0);
  log(`${lineKeys.length - missing.length} already have stop counts; ${missing.length} need fetching.`);

  const summary = {
    alreadyCached: lineKeys.length - missing.length,
    fetched: 0,
    errors: 0,
    stoppedByCap: false,
    fetchedKeys: []
  };

  for (const lineKey of missing) {
    if (!budget.canContinue("stops")) {
      summary.stoppedByCap = true;
      log("Stopping stops backfill due to daily budget.", budget.getSummary());
      break;
    }

    try {
      await getRouteStopsTransit(lineKey, {
        enforceDailyCap: true,
        requestSource: "harvest-stops"
      });
      summary.fetched += 1;
      summary.fetchedKeys.push(lineKey);
      if (summary.fetched % 25 === 0) {
        log(`Fetched ${summary.fetched}/${missing.length}...`);
      }
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        summary.stoppedByCap = true;
        log(`Cap reached while fetching stops for ${lineKey}.`, budget.getSummary());
        break;
      }
      summary.errors += 1;
      log(`Failed stops for ${lineKey}: ${error?.message || error}`);
    }
  }

  const afterState = await getUsageCapState();
  log("Stops backfill complete.", {
    ...summary,
    usageAfter: summarizeUsage(afterState),
    budget: budget.getSummary()
  });

  return summary;
}

run().catch((error) => {
  console.error(`[harvest-stops] FAILED: ${error?.message || error}`);
  process.exit(1);
});
