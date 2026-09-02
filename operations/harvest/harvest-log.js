const config = require("../../server/admin/config");
const db = require("../../server/processors/data");
const { createLogger } = require("../../server/admin/logger");

const fileLog = createLogger("harvester");

function nowIso() {
  return new Date().toISOString();
}

function log(message, details = null) {
  const prefix = `[harvest-world ${nowIso()}]`;
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

module.exports = {
  nowIso,
  log,
  getUsageCapState,
  summarizeUsage
};
