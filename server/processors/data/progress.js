const { statements, nowSeconds } = require("./client");

function setVisitedState(userId, payload) {
  const lineKey = String(payload.lineKey || "").trim();
  const stationKey = String(payload.stationKey || "").trim();
  const stationName = String(payload.stationName || "").trim() || "Unnamed Stop";
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const visited = Boolean(payload.visited);

  if (!lineKey || !stationKey || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid station payload.");
  }

  if (!visited) {
    statements.deleteVisit.run(userId, lineKey, stationKey);
    return;
  }

  statements.upsertVisit.run(
    userId,
    lineKey,
    stationKey,
    stationName,
    lat,
    lon,
    1,
    nowSeconds()
  );
}

function getVisitedStations(userId, lineKey = "") {
  const rows = lineKey
    ? statements.getVisitsForUserByLine.all(userId, lineKey)
    : statements.getVisitsForUser.all(userId);

  return rows.map((row) => ({
    lineKey: row.line_key,
    stationKey: row.station_key,
    stationName: row.station_name,
    lat: row.lat,
    lon: row.lon,
    updatedAt: row.updated_at
  }));
}

function clearVisitedStationsForLine(userId, lineKey) {
  const normalizedLineKey = String(lineKey || "").trim();
  if (!normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  const result = statements.deleteVisitsForUserByLine.run(userId, normalizedLineKey);
  return Number(result.changes || 0);
}

module.exports = {
  setVisitedState,
  getVisitedStations,
  clearVisitedStationsForLine
};
