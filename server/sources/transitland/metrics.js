const TRANSITLAND_BASE_URL = "https://transit.land/api/v2/rest";
const TRANSITLAND_VECTOR_BASE_URL = "https://transit.land/api/v2/tiles";
const TRANSIT_CACHE_PREFIX = "transit-v4:";

const transitlandMetrics = {
  restApiRequestCount: 0,
  restApiRequestFailureCount: 0,
  vectorTileRequestCount: 0,
  vectorTileRequestFailureCount: 0,
  routingApiRequestCount: 0,
  routingApiRequestFailureCount: 0,
  lastRestRequestAt: "",
  lastVectorTileRequestAt: "",
  lastRoutingRequestAt: ""
};

function getTransitlandMetrics() {
  return {
    ...transitlandMetrics
  };
}

module.exports = {
  TRANSITLAND_BASE_URL,
  TRANSITLAND_VECTOR_BASE_URL,
  TRANSIT_CACHE_PREFIX,
  transitlandMetrics,
  getTransitlandMetrics
};
