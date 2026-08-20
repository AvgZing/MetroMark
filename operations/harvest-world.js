#!/usr/bin/env node

// MetroMark world harvester.
//
// Phase 1: walks a curated list of populous world cities (operations/world-cities.js),
// harvesting each at full detail (all routes + headway + metadata).
// Phase 2: once all default cities are done, fills the gaps with a coarse-to-
// fine quadtree over the whole globe (covers intercity corridors + rural
// transit). Each pass is quota-budgeted (stops at the daily REST/vector/routing
// caps) and resumable, so the whole world builds up over time without
// maintaining a list of city slugs. Runs are orchestrated by operations/run-harvesters.bat.

const fs = require("fs");
const path = require("path");

const config = require("../server/admin/config");
const db = require("../server/processors/data");
const { fetchRoutesAndStopsForBbox } = require("../server/sources/transitland/fetch");
const { normalizeRoutes } = require("../server/sources/transitland/routes");
const { routeToFeature } = require("../server/sources/transitland/route-features");
const { mergeBackfillFeatures } = require("../server/sources/transitland/backfill");
const { buildPmtiles } = require("../server/scripts/build/build-pmtiles");
const { isFallbackHeadwaySeconds } = require("../server/sources/transitland/headway");
const WORLD_CITIES = require("./world-cities");

const START_ZOOM = Number(process.env.WORLD_HARVEST_START_ZOOM || 4);
const MAX_ZOOM = Number(process.env.WORLD_HARVEST_MAX_ZOOM || 9);
const CITY_SPAN_DEGREES = Number(process.env.WORLD_CITY_SPAN_DEGREES || 0.7);
const MAX_CELL_FAILURES = 5;
const STATE_DIR = path.join(__dirname, "state");
const STATE_FILE = path.join(STATE_DIR, "world-harvest.json");

function nowIso() {
  return new Date().toISOString();
}

function log(message, details = null) {
  const prefix = `[harvest-world ${nowIso()}]`;
  if (details === null || details === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, details);
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

function cellBbox(z, x, y) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  return [west, (southRad * 180) / Math.PI, east, (northRad * 180) / Math.PI];
}

function childrenOf(z, x, y) {
  return [
    [z + 1, x * 2, y * 2],
    [z + 1, x * 2 + 1, y * 2],
    [z + 1, x * 2, y * 2 + 1],
    [z + 1, x * 2 + 1, y * 2 + 1]
  ];
}

function cityBbox(city) {
  const half = CITY_SPAN_DEGREES / 2;
  return [
    city.lon - half,
    Math.max(-85, city.lat - half),
    city.lon + half,
    Math.min(85, city.lat + half)
  ];
}

function seedQuadTree() {
  const queue = [];
  const n = 2 ** START_ZOOM;
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      queue.push([START_ZOOM, x, y]);
    }
  }
  return queue;
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      phase: parsed.phase === "gaps" ? "gaps" : "cities",
      cityIndex: Number(parsed.cityIndex || 0),
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      processedCells: Number(parsed.processedCells || 0),
      emptyCells: Number(parsed.emptyCells || 0),
      transitCells: Number(parsed.transitCells || 0),
      failures: parsed.failures && typeof parsed.failures === "object" ? parsed.failures : {},
      lastRunAt: parsed.lastRunAt || null,
      totalRuns: Number(parsed.totalRuns || 0)
    };
  } catch {
    return {
      phase: "cities",
      cityIndex: 0,
      queue: [],
      processedCells: 0,
      emptyCells: 0,
      transitCells: 0,
      failures: {},
      lastRunAt: null,
      totalRuns: 0
    };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function storeRouteMetadata(route) {
  const headwaySeconds = Number(route.headway_secs);
  const hasHeadway = Number.isFinite(headwaySeconds) && headwaySeconds > 0;
  const fallback = hasHeadway && isFallbackHeadwaySeconds(headwaySeconds);

  await db.setRouteMetadata(route.lineKey, {
    routeOnestopId: route.routeOnestopId,
    lineName: route.lineName,
    lineShortName: route.lineShortName,
    lineLongName: route.lineLongName,
    operatorName: route.operatorName,
    mode: route.mode,
    routeType: route.routeType,
    routeFeedId: route.routeFeedId,
    color: route.color,
    frequencyBucket: route.frequency_bucket || "unknown",
    headwayBestMinutes: fallback || !hasHeadway ? null : Number((headwaySeconds / 60).toFixed(1)),
    headwaySource: hasHeadway ? String(route.headway_source || "transitland-vector-tiles") : "",
    headwayChecked: hasHeadway ? 1 : 0
  });
}

function accumulateRoutes(routes, newFeatures) {
  for (const route of routes) {
    storeRouteMetadata(route).catch(() => {});
    const feature = routeToFeature(route);
    if (feature) {
      newFeatures.push(feature);
    }
  }
}

async function harvestCities(state, newFeatures) {
  let processed = 0;

  while (state.cityIndex < WORLD_CITIES.length) {
    const capNow = await getUsageCapState();
    if (!capNow.backgroundAllowed) {
      log("Daily cap reached — pausing city phase.", summarizeUsage(capNow));
      break;
    }

    const city = WORLD_CITIES[state.cityIndex];
    try {
      const result = await fetchRoutesAndStopsForBbox(cityBbox(city), {
        enforceDailyCap: true,
        requestSource: "harvest-world"
      });
      const routes = normalizeRoutes(Array.isArray(result.routes) ? result.routes : []);
      processed += 1;
      accumulateRoutes(routes, newFeatures);
      state.cityIndex += 1;
      log(`City ${state.cityIndex}/${WORLD_CITIES.length}: ${city.name} (${routes.length} routes)`);
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        log(`Daily cap reached mid-city (${city.name}).`, summarizeUsage(capNow));
        break;
      }
      state.cityIndex += 1;
      log(`City ${city.name} failed: ${error?.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (state.cityIndex >= WORLD_CITIES.length && state.phase === "cities") {
    state.phase = "gaps";
    state.queue = seedQuadTree();
    log("All default cities harvested — moving to gap-filling (quadtree).");
  }

  return processed;
}

async function harvestGaps(state, newFeatures) {
  let processed = 0;

  while (state.queue.length > 0) {
    const capNow = await getUsageCapState();
    if (!capNow.backgroundAllowed) {
      log("Daily cap reached — pausing gap-fill phase.", summarizeUsage(capNow));
      break;
    }

    const cell = state.queue.shift();
    const [z, x, y] = cell;
    const cellKey = `${z}/${x}/${y}`;

    if (Number(state.failures[cellKey] || 0) >= MAX_CELL_FAILURES) {
      continue;
    }

    try {
      const result = await fetchRoutesAndStopsForBbox(cellBbox(z, x, y), {
        enforceDailyCap: true,
        requestSource: "harvest-world"
      });
      const routes = normalizeRoutes(Array.isArray(result.routes) ? result.routes : []);
      processed += 1;
      state.processedCells += 1;

      if (routes.length) {
        state.transitCells += 1;
        if (z < MAX_ZOOM) {
          state.queue.push(...childrenOf(z, x, y));
        }
        accumulateRoutes(routes, newFeatures);
      } else {
        state.emptyCells += 1;
      }

      delete state.failures[cellKey];

      if (processed % 20 === 0) {
        log(`Processed ${processed} gap cells this pass (${state.queue.length} queued)...`);
      }
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        state.queue.unshift(cell);
        log("Daily cap reached mid-cell — pausing gap-fill.", summarizeUsage(capNow));
        break;
      }
      state.failures[cellKey] = Number(state.failures[cellKey] || 0) + 1;
      state.queue.unshift(cell);
      log(`Cell ${cellKey} failed (attempt ${state.failures[cellKey]}): ${error?.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return processed;
}

async function run() {
  const state = loadState();
  const cap = await getUsageCapState();
  if (!cap.backgroundAllowed) {
    log("Daily cap already reached — skipping this pass.", summarizeUsage(cap));
    saveState(state);
    return;
  }

  let newFeatures = [];
  let citiesDone = 0;
  let gapsDone = 0;

  if (state.phase === "cities") {
    citiesDone = await harvestCities(state, newFeatures);
  }
  if (state.phase === "gaps") {
    gapsDone = await harvestGaps(state, newFeatures);
  }

  if (newFeatures.length) {
    log(`Merging ${newFeatures.length} new route features and rebuilding tiles...`);
    mergeBackfillFeatures(newFeatures, { overwrite: false });
    const built = await buildPmtiles({ log: { log: () => {} } });
    log(`Tiles rebuilt: ${built.sizeBytes} bytes, ${built.tileCount} tiles.`);
  }

  state.totalRuns += 1;
  state.lastRunAt = new Date().toISOString();
  saveState(state);

  const after = await getUsageCapState();
  log("World harvest pass complete.", {
    phase: state.phase,
    cityIndex: state.cityIndex,
    totalCities: WORLD_CITIES.length,
    citiesDoneThisRun: citiesDone,
    gapCellsDoneThisRun: gapsDone,
    queuedGapCells: state.queue.length,
    processedGapCells: state.processedCells,
    transitCells: state.transitCells,
    newFeatures: newFeatures.length,
    usageAfter: summarizeUsage(after)
  });
}

run().catch((error) => {
  console.error(`[harvest-world] FAILED: ${error?.message || error}`);
  process.exit(1);
});
