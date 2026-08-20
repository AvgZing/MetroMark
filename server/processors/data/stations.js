const {
  localQuery,
  hasLocalPostgresConfig,
  stationOverrideCache,
  assertLocalConfigured
} = require("./core");
const { normalizeText, toEpochSeconds, nowSeconds } = require("./utils");

async function loadStationOverridesCache() {
  assertLocalConfigured();
  const result = await localQuery(
    "select stable_key,manual_name,manual_lat,manual_lon,note,updated_at from public.station_override limit 20000"
  );

  stationOverrideCache.clear();

  for (const row of result.rows || []) {
    stationOverrideCache.set(row.stable_key, {
      stableKey: row.stable_key,
      manualName: row.manual_name,
      manualLat: Number.isFinite(Number(row.manual_lat)) ? Number(row.manual_lat) : null,
      manualLon: Number.isFinite(Number(row.manual_lon)) ? Number(row.manual_lon) : null,
      note: row.note,
      updatedAt: toEpochSeconds(row.updated_at) || 0
    });
  }
}

function upsertStopTranslation(inputStopId, stableKey, source = "transitland") {
  const safeInput = normalizeText(inputStopId);
  const safeStable = normalizeText(stableKey);
  const safeSource = normalizeText(source, "transitland");

  if (!safeInput || !safeStable) {
    return;
  }

  if (!hasLocalPostgresConfig()) {
    return;
  }

  localQuery(
    `insert into public.stop_translation (input_stop_id, stable_key, source, updated_at)
     values ($1, $2, $3, now())
     on conflict (input_stop_id) do update set
       stable_key = excluded.stable_key,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    [safeInput, safeStable, safeSource]
  ).catch(() => {});
}

function getStationOverride(stableKey) {
  return stationOverrideCache.get(normalizeText(stableKey)) || null;
}

async function upsertStationOverride(stableKey, manualName, manualLat, manualLon, note) {
  assertLocalConfigured();

  const safeKey = normalizeText(stableKey);
  if (!safeKey) {
    throw new Error("stableKey is required.");
  }

  const payload = {
    stable_key: safeKey,
    manual_name: normalizeText(manualName) || null,
    manual_lat: Number.isFinite(Number(manualLat)) ? Number(manualLat) : null,
    manual_lon: Number.isFinite(Number(manualLon)) ? Number(manualLon) : null,
    note: normalizeText(note) || null
  };

  await localQuery(
    `insert into public.station_override (stable_key, manual_name, manual_lat, manual_lon, note, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (stable_key) do update set
       manual_name = excluded.manual_name,
       manual_lat = excluded.manual_lat,
       manual_lon = excluded.manual_lon,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [payload.stable_key, payload.manual_name, payload.manual_lat, payload.manual_lon, payload.note]
  );

  stationOverrideCache.set(safeKey, {
    stableKey: safeKey,
    manualName: payload.manual_name,
    manualLat: payload.manual_lat,
    manualLon: payload.manual_lon,
    note: payload.note,
    updatedAt: nowSeconds()
  });
}

module.exports = {
  loadStationOverridesCache,
  upsertStopTranslation,
  getStationOverride,
  upsertStationOverride
};
