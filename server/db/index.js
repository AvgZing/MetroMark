const { dbPath } = require("./client");
const {
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  seedDemoUser
} = require("./users");
const { getCache, setCache, clearCacheByPrefix } = require("./cache");
const {
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride
} = require("./stations");
const {
  setVisitedState,
  getVisitedStations,
  clearVisitedStationsForLine
} = require("./progress");

seedDemoUser();

module.exports = {
  dbPath,
  createUser,
  verifyUser,
  getUserByEmail,
  getUserById,
  getCache,
  setCache,
  clearCacheByPrefix,
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride,
  setVisitedState,
  getVisitedStations,
  clearVisitedStationsForLine
};
