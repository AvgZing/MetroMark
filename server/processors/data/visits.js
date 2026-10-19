const { requireSupabaseClients, assertConfigured } = require("./core");
const { normalizeText, nowIso, toEpochSeconds } = require("./utils");

async function setVisitedState(userId, payload) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  const lineKey = normalizeText(payload.lineKey);
  const stationKey = normalizeText(payload.stationKey);
  const stationName = normalizeText(payload.stationName, "Unnamed Stop");
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const visited = Boolean(payload.visited);

  if (!safeUserId || !lineKey || !stationKey || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid station payload.");
  }

  if (!visited) {
    const { error } = await serviceClient
      .from("user_station_visit")
      .delete()
      .eq("user_id", safeUserId)
      .eq("line_key", lineKey)
      .eq("station_key", stationKey);

    if (error) {
      throw new Error(`Unable to remove visited station: ${error.message}`);
    }

    return;
  }

  const { error } = await serviceClient.from("user_station_visit").upsert(
    {
      user_id: safeUserId,
      line_key: lineKey,
      station_key: stationKey,
      station_name: stationName,
      lat,
      lon,
      visited: true,
      updated_at: nowIso()
    },
    {
      onConflict: "user_id,line_key,station_key"
    }
  );

  if (error) {
    throw new Error(`Unable to save visited station: ${error.message}`);
  }
}

async function getVisitedStations(userId, lineKey = "") {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  if (!safeUserId) {
    return [];
  }

  let query = serviceClient
    .from("user_station_visit")
    .select("line_key,station_key,station_name,lat,lon,updated_at")
    .eq("user_id", safeUserId)
    .eq("visited", true)
    .order("updated_at", { ascending: false });

  const normalizedLineKey = normalizeText(lineKey);
  if (normalizedLineKey) {
    query = query.eq("line_key", normalizedLineKey);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to read progress: ${error.message}`);
  }

  return (data || []).map((row) => ({
    lineKey: row.line_key,
    stationKey: row.station_key,
    stationName: row.station_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    updatedAt: toEpochSeconds(row.updated_at) || 0
  }));
}

async function clearVisitedStationsForLine(userId, lineKey) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  const normalizedLineKey = normalizeText(lineKey);
  if (!safeUserId || !normalizedLineKey) {
    throw new Error("lineKey is required.");
  }

  const existing = await serviceClient
    .from("user_station_visit")
    .select("station_key", { count: "exact", head: true })
    .eq("user_id", safeUserId)
    .eq("line_key", normalizedLineKey)
    .eq("visited", true);

  if (existing.error) {
    throw new Error(`Unable to read progress count: ${existing.error.message}`);
  }

  const { error } = await serviceClient
    .from("user_station_visit")
    .delete()
    .eq("user_id", safeUserId)
    .eq("line_key", normalizedLineKey);

  if (error) {
    throw new Error(`Unable to clear route progress: ${error.message}`);
  }

  return Number(existing.count || 0);
}

async function importVisitedStations(userId, visits) {
  assertConfigured();
  const { serviceClient } = requireSupabaseClients();

  const safeUserId = normalizeText(userId);
  if (!safeUserId) {
    throw new Error("userId is required.");
  }
  if (!Array.isArray(visits)) {
    throw new Error("visits must be an array.");
  }

  const byKey = new Map();
  for (const raw of visits) {
    const lineKey = normalizeText(raw?.lineKey);
    const stationKey = normalizeText(raw?.stationKey);
    const stationName = normalizeText(raw?.stationName).slice(0, 200) || "Unnamed Stop";
    const lat = Number(raw?.lat);
    const lon = Number(raw?.lon);
    if (
      !lineKey ||
      !stationKey ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      continue;
    }
    const visitedAt = raw?.visitedAt && !Number.isNaN(Date.parse(raw.visitedAt))
      ? new Date(raw.visitedAt).toISOString()
      : nowIso();
    byKey.set(`${lineKey}\u0000${stationKey}`, {
      user_id: safeUserId,
      line_key: lineKey,
      station_key: stationKey,
      station_name: stationName,
      lat,
      lon,
      visited: true,
      updated_at: visitedAt
    });
  }

  const rows = Array.from(byKey.values());
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await serviceClient.from("user_station_visit").upsert(chunk, {
      onConflict: "user_id,line_key,station_key"
    });
    if (error) {
      throw new Error(`Unable to import visited stations: ${error.message}`);
    }
  }

  return {
    imported: rows.length,
    skipped: Math.max(0, visits.length - rows.length)
  };
}

module.exports = {
  setVisitedState,
  getVisitedStations,
  clearVisitedStationsForLine,
  importVisitedStations
};
