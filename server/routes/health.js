const express = require("express");

const config = require("../config");
const { hasLocalPostgresConfig } = require("../postgres");
const { withTransitlandMetrics } = require("./helpers");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json(withTransitlandMetrics({
    status: "ok",
    app: "MetroMark",
    hasTransitlandKey: Boolean(config.TRANSITLAND_API_KEY),
    hasLocalPostgres: hasLocalPostgresConfig(),
    transitlandRequestTimeoutMs: config.TRANSITLAND_REQUEST_TIMEOUT_MS,
    transitlandRequestRetries: config.TRANSITLAND_REQUEST_RETRIES,
    cacheTtlHours: config.TRANSIT_CACHE_TTL_HOURS,
    routeCatalogMaxResults: config.ROUTE_CATALOG_MAX_RESULTS,
    stopAssignmentMaxMeters: config.STOP_ASSIGNMENT_MAX_METERS,
    stopDedupMaxMeters: config.STOP_DEDUP_MAX_METERS,
    routeStopPageLimit: config.ROUTE_STOP_PAGE_LIMIT,
    routeStopMaxResults: config.ROUTE_STOP_MAX_RESULTS,
    routeHeadwayTimeoutMs: config.ROUTE_HEADWAY_TIMEOUT_MS,
    routeHeadwayCacheTtlHours: config.ROUTE_HEADWAY_CACHE_TTL_HOURS,
    lineViewOrderingVoteThreshold: config.LINE_VIEW_ORDERING_VOTE_THRESHOLD,
    vectorTileMaxPerBbox: config.VECTOR_TILE_MAX_PER_BBOX,
    stationHubMaxMeters: config.STATION_HUB_MAX_METERS,
    stationHubSnapMaxMeters: config.STATION_HUB_SNAP_MAX_METERS,
    bboxMaxSpanDegrees: config.BBOX_MAX_SPAN_DEGREES
  }));
});

module.exports = router;
