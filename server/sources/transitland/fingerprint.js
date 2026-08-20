const crypto = require("crypto");
const {
  sanitizeText
} = require("./helpers");

function buildFeedFingerprint(payload) {
  const lineSummaries = Array.isArray(payload?.lineSummaries) ? payload.lineSummaries : [];
  if (!lineSummaries.length) {
    return "";
  }

  const stableLines = lineSummaries
    .map((line) => {
      const lineKey = sanitizeText(line?.lineKey || line?.routeOnestopId);
      const feedId = sanitizeText(line?.routeFeedId);
      if (!lineKey) {
        return "";
      }

      return `${feedId || "no-feed"}:${lineKey}`;
    })
    .filter(Boolean)
    .sort();

  if (!stableLines.length) {
    return "";
  }

  return crypto.createHash("sha1").update(stableLines.join("|"), "utf8").digest("hex");
}

function buildFeedFingerprintFromRoutes(routes) {
  const stableRoutes = Array.isArray(routes)
    ? routes
      .map((route) => {
        const routeId = sanitizeText(route?.onestop_id || route?.route_onestop_id);
        const feedId = sanitizeText(route?.route_feed_onestop_id || route?.feed_onestop_id);
        if (!routeId) {
          return "";
        }

        return `${feedId || "no-feed"}:${routeId}`;
      })
      .filter(Boolean)
      .sort()
    : [];

  if (!stableRoutes.length) {
    return "";
  }

  return crypto.createHash("sha1").update(stableRoutes.join("|"), "utf8").digest("hex");
}

function geometryCoordinateCount(geometry) {
  if (!geometry || !geometry.type) return 0;
  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
  }
  if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates;
    if (!Array.isArray(lines)) return 0;
    let sum = 0;
    for (const line of lines) {
      if (Array.isArray(line)) sum += line.length;
    }
    return sum;
  }
  return 0;
}

module.exports = {
  buildFeedFingerprint,
  buildFeedFingerprintFromRoutes,
  geometryCoordinateCount
};
