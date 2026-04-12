const { statements, nowSeconds } = require("./client");

function upsertStopTranslation(inputStopId, stableKey, source = "transitland") {
  if (!inputStopId || !stableKey) {
    return;
  }

  statements.upsertStopTranslation.run(inputStopId, stableKey, source, nowSeconds());
}

function getStationOverride(stableKey) {
  const row = statements.getStationOverride.get(stableKey);
  if (!row) {
    return null;
  }

  return {
    stableKey: row.stable_key,
    manualName: row.manual_name,
    manualLat: row.manual_lat,
    manualLon: row.manual_lon,
    note: row.note,
    updatedAt: row.updated_at
  };
}

function upsertStationOverride(stableKey, manualName, manualLat, manualLon, note) {
  statements.upsertStationOverride.run(
    stableKey,
    manualName || null,
    Number.isFinite(manualLat) ? manualLat : null,
    Number.isFinite(manualLon) ? manualLon : null,
    note || null,
    nowSeconds()
  );
}

module.exports = {
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride
};
