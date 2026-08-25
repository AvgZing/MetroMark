const { fetchRoutesAndStopsForBbox } = require("../server/sources/transitland/fetch");
const { normalizeRoutes } = require("../server/sources/transitland/routes");
const budget = require("../server/sources/transitland/harvest-budget");
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
        log(`Daily geometry budget reached mid-city (${city.name}).`, budget.getSummary());
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

  return processed;
}

module.exports = {
  harvestCities,
  harvestGaps
};
