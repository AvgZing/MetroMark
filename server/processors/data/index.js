const { dbPath } = require("./core");
const auth = require("./auth");
const cache = require("./cache");
const geometry = require("./geometry");
const metadata = require("./metadata");
const stations = require("./stations");
const visits = require("./visits");
const presets = require("./presets");
const usage = require("./usage");
const harvest = require("./harvest");
const overrides = require("./overrides");

module.exports = {
  dbPath,
  initializeStorage: auth.initializeStorage,
  registerAccount: auth.registerAccount,
  loginAccount: auth.loginAccount,
  getUserFromToken: auth.getUserFromToken,
  createUser: auth.createUser,
  verifyUser: auth.verifyUser,
  getUserByEmail: auth.getUserByEmail,
  getUserById: auth.getUserById,
  getCache: cache.getCache,
  getCacheAny: cache.getCacheAny,
  getCacheByBbox: cache.getCacheByBbox,
  setCache: cache.setCache,
  getRouteGeometryLod: geometry.getRouteGeometryLod,
  upsertRouteGeometryLod: geometry.upsertRouteGeometryLod,
  getRouteGeometriesByBbox: geometry.getRouteGeometriesByBbox,
  getRouteMetadatasByLineKeys: metadata.getRouteMetadatasByLineKeys,
  setRouteMetadata: metadata.setRouteMetadata,
  getFractionOnRoute: geometry.getFractionOnRoute,
  clearCacheByPrefix: cache.clearCacheByPrefix,
  getCacheStats: cache.getCacheStats,
  getAccountStats: auth.getAccountStats,
  upsertStopTranslation: stations.upsertStopTranslation,
  getStationOverride: stations.getStationOverride,
  upsertStationOverride: stations.upsertStationOverride,
  getRouteOverride: overrides.getRouteOverride,
  listRouteOverrides: overrides.listRouteOverrides,
  listRouteOverridesByLineKeys: overrides.listRouteOverridesByLineKeys,
  upsertRouteOverride: overrides.upsertRouteOverride,
  deleteRouteOverride: overrides.deleteRouteOverride,
  getRouteOrderingVote: overrides.getRouteOrderingVote,
  upsertRouteOrderingVote: overrides.upsertRouteOrderingVote,
  listRouteOrderingVoteCountsByLineKeys: overrides.listRouteOrderingVoteCountsByLineKeys,
  getRouteOrderingMetadataByLineKeys: overrides.getRouteOrderingMetadataByLineKeys,
  getRouteReview: overrides.getRouteReview,
  listRouteReviews: overrides.listRouteReviews,
  upsertRouteReview: overrides.upsertRouteReview,
  getAgencyReview: overrides.getAgencyReview,
  listAgencyReviews: overrides.listAgencyReviews,
  upsertAgencyReview: overrides.upsertAgencyReview,
  setVisitedState: visits.setVisitedState,
  getVisitedStations: visits.getVisitedStations,
  clearVisitedStationsForLine: visits.clearVisitedStationsForLine,
  listFilterPresets: presets.listFilterPresets,
  upsertFilterPreset: presets.upsertFilterPreset,
  deleteFilterPreset: presets.deleteFilterPreset,
  dayKeyFromTimestamp: usage.dayKeyFromTimestamp,
  getUsageForDay: usage.getUsageForDay,
  getTodayUsage: usage.getTodayUsage,
  incrementUsage: usage.incrementUsage,
  getDailyUsageCapsState: usage.getDailyUsageCapsState,
  ensureCityHarvestState: harvest.ensureCityHarvestState,
  getCityHarvestState: harvest.getCityHarvestState,
  listPendingHarvestCities: harvest.listPendingHarvestCities,
  markHarvestInProgress: harvest.markHarvestInProgress,
  markGeometryHarvested: harvest.markGeometryHarvested,
  markStopsHarvested: harvest.markStopsHarvested,
  queueCityRefresh: harvest.queueCityRefresh,
  markCityVerified: harvest.markCityVerified,
  markCityHarvestError: harvest.markCityHarvestError,
  logHarvestJob: harvest.logHarvestJob,
  getHarvestSummary: harvest.getHarvestSummary,
  getDatabaseFileStats: harvest.getDatabaseFileStats
};
