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

const { loadState, saveState } = require("./harvest-state");
const { log, getUsageCapState, summarizeUsage } = require("./harvest-log");
const { harvestCities, harvestGaps } = require("./harvest-phases");
const { mergeBackfillFeatures } = require("../server/sources/transitland/backfill");
const { buildPmtiles } = require("../server/scripts/build/build-pmtiles");
const WORLD_CITIES = require("./world-cities");

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
