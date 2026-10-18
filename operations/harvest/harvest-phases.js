const { fetchRoutesAndStopsForBbox } = require("../../server/sources/transitland/fetch");
const { runBackfill } = require("../../server/sources/transitland/backfill");
const { normalizeRoutes } = require("../../server/sources/transitland/routes");
const budget = require("../../server/sources/transitland/harvest-budget");
const WORLD_CITIES = require("./world-cities");
const { log } = require("./harvest-log");
const {
  cityBbox,
  cellBbox,
  childrenOf,
  seedQuadTree,
  MAX_ZOOM,
  MAX_CELL_FAILURES
} = require("./harvest-grid");
const { accumulateRoutes } = require("./harvest-routes");

async function harvestCities(state, newFeatures) {
  let processed = 0;

  while (state.cityIndex < WORLD_CITIES.length) {
    if (!budget.canContinue("geometry")) {
      log("Daily geometry budget reached — pausing city phase.", budget.getSummary());
      break;
    }

    const city = WORLD_CITIES[state.cityIndex];
    try {
      // v2: fetch only missing routes; complete = none unanswered.
      const result = await runBackfill(cityBbox(city), {
        forceRefresh: false,
        zoom: 10,
        collectOnly: true,
        requestSource: "harvest-geometry",
        enforceDailyCap: true
      });
      const diagnostics = result.diagnostics || {};
      for (const feature of result.features || []) {
        newFeatures.push(feature);
      }
      processed += 1;

      const missing = Number(diagnostics.missingRoutes || 0);
      const fetched = Number(diagnostics.fetchedRoutes || 0);
      const unavailable = Number(diagnostics.unavailableRoutes || 0);
      const failed = Number(diagnostics.failedFetch || 0);
      const complete = missing === 0 || fetched + unavailable >= missing;

      if (complete) {
        state.cityIndex += 1;
        delete state.cityAttempts[city.name];
        log(
          `City ${state.cityIndex}/${WORLD_CITIES.length}: ${city.name} v2 complete (${fetched} fetched, ${unavailable} unavailable).`
        );
      } else {
        const attempts = Number(state.cityAttempts[city.name] || 0) + 1;
        state.cityAttempts[city.name] = attempts;
        log(
          `City ${city.name} incomplete (${fetched}/${missing} fetched, ${failed} failed) — attempt ${attempts}; will retry.`
        );
        // Keep the city queued and pause this pass; the next pass resumes it.
        break;
      }
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        log(`Daily budget reached mid-city (${city.name}).`, budget.getSummary());
        break;
      }
      const attempts = Number(state.cityAttempts[city.name] || 0) + 1;
      state.cityAttempts[city.name] = attempts;
      log(`City ${city.name} failed (attempt ${attempts}): ${error?.message || error}`);
      if (attempts >= 5) {
        state.cityIndex += 1;
        delete state.cityAttempts[city.name];
        log(`City ${city.name} skipped after ${attempts} failed attempts.`);
      }
      break;
    }
  }

  if (state.cityIndex >= WORLD_CITIES.length && state.phase === "cities") {
    state.phase = "gaps";
    if (!state.gapsCompleted && state.queue.length === 0) {
      state.queue = seedQuadTree();
    }
    log("All default cities harvested — moving to gap-filling (quadtree).");
  }

  return processed;
}

async function harvestGaps(state, newFeatures) {
  if (state.gapsCompleted) {
    return 0;
  }
  let processed = 0;

  while (state.queue.length > 0) {
    if (!budget.canContinue("geometry")) {
      log("Daily geometry budget reached — pausing gap-fill phase.", budget.getSummary());
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
        log("Daily geometry budget reached mid-cell — pausing gap-fill.", budget.getSummary());
        break;
      }
      state.failures[cellKey] = Number(state.failures[cellKey] || 0) + 1;
      state.queue.unshift(cell);
      log(`Cell ${cellKey} failed (attempt ${state.failures[cellKey]}): ${error?.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (state.queue.length === 0) {
    state.gapsCompleted = true;
    log("Gap-filling complete for this world pass.");
  }

  return processed;
}

module.exports = {
  harvestCities,
  harvestGaps
};
