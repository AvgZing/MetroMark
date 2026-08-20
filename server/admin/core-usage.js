const config = require("./config");
const db = require("../processors/data");

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
  getUsageCapState,
  summarizeUsage
};
