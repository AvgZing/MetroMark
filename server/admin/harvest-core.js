#!/usr/bin/env node

const config = require("./config");
const db = require("../processors/data");
const { log } = require("./core-log");
const { getUsageCapState, summarizeUsage } = require("./core-usage");
const { seedCoreCityQueue, queueStaleCoreCities } = require("./core-queue");
const { harvestCity } = require("./core-city");

async function runHarvestCore(options = {}) {
  if (!config.HARVEST_ENABLED) {
    log("Harvest is disabled by HARVEST_ENABLED=0.");
    return {
      skipped: true,
      reason: "harvest-disabled"
    };
  }

  await db.initializeStorage();

  const seedResult = await seedCoreCityQueue();
  log("Core city queue prepared.", seedResult);
  const staleQueued = await queueStaleCoreCities(seedResult.slugs);
  if (staleQueued > 0) {
    log(`Queued ${staleQueued} stale core cities for verification.`);
  }

  const beforeState = await getUsageCapState();
  log("Usage state before run.", summarizeUsage(beforeState));
  if (!beforeState.backgroundAllowed) {
    log("Daily API cap reached. Harvest skipped.");
    return {
      skipped: true,
      reason: "daily-cap-reached"
    };
  }

  const batchSize = Math.max(1, Number(config.HARVEST_BATCH_CITY_LIMIT || 3));
  const candidates = await db.listPendingHarvestCities(batchSize);

  if (!candidates.length) {
    log("No pending cities in harvest queue.");
    return {
      skipped: true,
      reason: "no-pending-cities"
    };
  }

  const summary = {
    refreshed: 0,
    skipped: 0,
    errors: 0,
    stoppedByCap: false,
    processed: []
  };

  for (const cityState of candidates) {
    const capState = await getUsageCapState();
    if (!capState.backgroundAllowed) {
      summary.stoppedByCap = true;
      log("Stopping harvest due to daily cap.", summarizeUsage(capState));
      break;
    }

    try {
      const result = await harvestCity(cityState);
      summary.processed.push(result);
      if (result.status === "refreshed") {
        summary.refreshed += 1;
      } else if (result.status === "skipped") {
        summary.skipped += 1;
      } else {
        summary.errors += 1;
      }
    } catch (error) {
      if (error?.code === "DAILY_USAGE_LIMIT_REACHED" || error?.code === "TRANSITLAND_DAILY_CAP_REACHED") {
        summary.stoppedByCap = true;
        await db.queueCityRefresh(cityState.citySlug);
        await db.logHarvestJob(
          cityState.citySlug,
          "cap",
          "blocked",
          error.message || "Daily cap reached"
        );
        log(`Cap reached while harvesting ${cityState.citySlug}.`);
        break;
      }

      await db.markCityHarvestError(cityState.citySlug, error?.message || "Harvest failed");
      await db.logHarvestJob(
        cityState.citySlug,
        "error",
        "failed",
        error?.message || "Harvest failed"
      );
      summary.errors += 1;
      summary.processed.push({
        status: "error",
        citySlug: cityState.citySlug,
        reason: error?.message || "Harvest failed"
      });
    }
  }

  const afterState = await getUsageCapState();
  log("Harvest run complete.", {
    ...summary,
    usageAfter: summarizeUsage(afterState)
  });

  return {
    ...summary,
    staleQueued,
    usageAfter: summarizeUsage(afterState),
    triggerSource: String(options.triggerSource || "script")
  };
}

module.exports = {
  runHarvestCore
};

if (require.main === module) {
  runHarvestCore()
    .then(() => {})
    .catch((error) => {
      console.error("[harvest-core] Unhandled error", error);
      process.exitCode = 1;
    });
}
