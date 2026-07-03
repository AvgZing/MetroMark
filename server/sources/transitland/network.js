const config = require("../../admin/config");
const db = require("../../processors/data");
const { transitlandMetrics } = require("./metrics");

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isBackgroundRequest(options = {}) {
  const source = String(options.requestSource || "").trim().toLowerCase();
  return source === "background" || source === "harvest" || source === "scheduler";
}

async function enforceDailyUsageCapsIfNeeded(kind, options = {}) {
  const enforce = Boolean(options.enforceDailyCap) || isBackgroundRequest(options);
  if (!enforce) {
    return;
  }

  const usageState = await db.getDailyUsageCapsState({
    rest: config.HARVEST_DAILY_REST_LIMIT,
    vector: config.HARVEST_DAILY_VECTOR_LIMIT,
    routing: config.HARVEST_DAILY_ROUTING_LIMIT
  });

  const reached =
    (kind === "rest" && usageState.reached.rest) ||
    (kind === "vector" && usageState.reached.vector) ||
    (kind === "routing" && usageState.reached.routing);

  if (!reached) {
    return;
  }

  const error = new Error(
    `Daily ${kind} API cap reached. Background harvesting is paused until the next UTC day.`
  );
  error.code = "DAILY_USAGE_LIMIT_REACHED";
  throw error;
}

async function recordUsage(kind, amount = 1) {
  try {
    await db.incrementUsage(kind, amount);
  } catch {
    // Keep request flow resilient if usage logging has a transient DB issue.
  }
}

module.exports = {
  wait,
  isBackgroundRequest,
  enforceDailyUsageCapsIfNeeded,
  recordUsage
};
