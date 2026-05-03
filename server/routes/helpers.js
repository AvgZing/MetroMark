const { getTransitlandMetrics } = require("../transitland");
const { postgresMetrics } = require("../postgres");

function asBoolean(value) {
  const text = String(value || "").toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function parseStopTypes(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const allowed = new Set([0, 1, 2, 3, 4]);
  const parsed = raw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && allowed.has(entry));

  if (!parsed.length) {
    return null;
  }

  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function parseRouteTypes(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const allowed = new Set([0, 1, 2, 3, 4, 5, 6, 7, 11, 12]);
  const parsed = raw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && allowed.has(entry));

  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function withTransitlandMetrics(payload) {
  const metrics = getTransitlandMetrics();
  return {
    ...payload,
    postgresQueryCount: Number(postgresMetrics.queryCount || 0),
    postgresQueryFailureCount: Number(postgresMetrics.queryFailureCount || 0),
    postgresLastQueryAt: postgresMetrics.lastQueryAt || null,
    transitlandRestApiRequests: Number(metrics.restApiRequestCount || 0),
    transitlandRestApiRequestFailures: Number(metrics.restApiRequestFailureCount || 0),
    transitlandVectorTileRequests: Number(metrics.vectorTileRequestCount || 0),
    transitlandVectorTileRequestFailures: Number(metrics.vectorTileRequestFailureCount || 0),
    transitlandRoutingApiRequests: Number(metrics.routingApiRequestCount || 0),
    transitlandRoutingApiRequestFailures: Number(metrics.routingApiRequestFailureCount || 0),
    transitlandLastRestRequestAt: metrics.lastRestRequestAt || null,
    transitlandLastVectorTileRequestAt: metrics.lastVectorTileRequestAt || null,
    transitlandLastRoutingRequestAt: metrics.lastRoutingRequestAt || null
  };
}

function userResponse(user, token) {
  return {
    token,
    user
  };
}

module.exports = {
  asBoolean,
  parseStopTypes,
  parseRouteTypes,
  withTransitlandMetrics,
  userResponse
};
