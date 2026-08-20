const config = require("../../admin/config");
const { sanitizeText } = require("./helpers");
const { transitlandRequest } = require("./transport");

function extractTripStopTimes(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const candidates = [
    trip?.stop_times,
    trip?.stopTimes,
    tripResponse?.trips?.[0]?.stop_times,
    tripResponse?.trips?.[0]?.stopTimes,
    tripResponse?.stop_times,
    tripResponse?.stopTimes
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function extractTripDirectionId(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const value = trip?.direction_id ?? tripResponse?.direction_id ?? trip?.directionId;
  const directionId = Number(value);
  return Number.isFinite(directionId) ? directionId : null;
}

function extractTripPatternId(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const value = trip?.stop_pattern_id ?? tripResponse?.stop_pattern_id ?? trip?.stopPatternId;
  const patternId = Number(value);
  return Number.isFinite(patternId) ? patternId : null;
}

function extractTripInternalId(tripResponse) {
  const trip = tripResponse?.trip || tripResponse?.trips?.[0] || tripResponse || {};
  const value = trip?.id ?? tripResponse?.id ?? trip?.trip_id ?? tripResponse?.trip_id;
  const internalId = Number(value);
  return Number.isFinite(internalId) ? internalId : null;
}

function extractStopIdFromTripStopTime(stopTime) {
  const stop = stopTime?.stop || stopTime || {};
  return sanitizeText(
    stop?.onestop_id ||
      stop?.stop_onestop_id ||
      stop?.id ||
      stop?.stop_id ||
      stopTime?.stop_id ||
      stopTime?.stop_onestop_id
  );
}

async function fetchRouteTripsForRoute(lineKey, options = {}) {
  const normalizedLineKey = sanitizeText(lineKey);
  if (!normalizedLineKey) {
    return [];
  }

  const trips = [];
  let afterCursor = null;
  let truncated = false;
  const pageLimit = Math.max(20, Math.min(200, Number(config.ROUTE_STOP_PAGE_LIMIT || 200)));
  const maxResults = Math.max(pageLimit, Math.min(1200, Number(config.ROUTE_STOP_MAX_RESULTS || 1200)));

  while (trips.length < maxResults) {
    const params = {
      limit: String(pageLimit),
      include_geometry: "false"
    };

    if (Number.isFinite(afterCursor)) {
      params.after = String(afterCursor);
    }

    const response = await transitlandRequest(
      `/routes/${encodeURIComponent(normalizedLineKey)}/trips`,
      params,
      {
        enforceDailyCap: Boolean(options.enforceDailyCap),
        requestSource: options.requestSource
      }
    );

    const pageTrips = Array.isArray(response?.trips) ? response.trips : [];
    for (const trip of pageTrips) {
      if (trips.length >= maxResults) {
        truncated = true;
        break;
      }
      trips.push(trip);
    }

    const nextAfter = Number(response?.meta?.after);
    const hasNext = Boolean(response?.meta?.next) && Number.isFinite(nextAfter);
    if (!hasNext || pageTrips.length === 0 || truncated) {
      break;
    }

    afterCursor = nextAfter;
  }

  return trips;
}

async function fetchTripDetailById(routeKey, tripId, options = {}) {
  const normalizedRouteKey = sanitizeText(routeKey);
  const normalizedTripId = sanitizeText(tripId);
  if (!normalizedRouteKey || !normalizedTripId) {
    return null;
  }

  try {
    return await transitlandRequest(
      `/routes/${encodeURIComponent(normalizedRouteKey)}/trips/${encodeURIComponent(normalizedTripId)}`,
      {
        include_geometry: "true"
      },
      {
        enforceDailyCap: Boolean(options.enforceDailyCap),
        requestSource: options.requestSource
      }
    );
  } catch {
    return null;
  }
}

async function buildDirectionStopSequencesForRoute(routeKey, options = {}) {
  const routeTrips = await fetchRouteTripsForRoute(routeKey, options);
  if (!routeTrips.length) {
    return null;
  }

  const representativeTrips = new Map();
  for (const trip of routeTrips) {
    const directionId = extractTripDirectionId(trip);
    if (!Number.isFinite(directionId) || (directionId !== 0 && directionId !== 1)) {
      continue;
    }

    const patternId = extractTripPatternId(trip);
    const tripId = extractTripInternalId(trip);
    if (!Number.isFinite(tripId)) {
      continue;
    }

    const groupingKey = `${directionId}:${Number.isFinite(patternId) ? patternId : tripId}`;
    if (!representativeTrips.has(groupingKey)) {
      representativeTrips.set(groupingKey, {
        directionId,
        tripId,
        trip
      });
    }
  }

  const bestByDirection = new Map();
  const patternsByDirection = new Map([[0, []], [1, []]]);
  for (const representative of representativeTrips.values()) {
    const detail = await fetchTripDetailById(routeKey, representative.tripId, options);
    const stopTimes = extractTripStopTimes(detail);
    if (!stopTimes.length) {
      continue;
    }

    const stopEntries = stopTimes
      .map((stopTime) => {
        const stop = stopTime?.stop || stopTime || {};
        return {
          id: extractStopIdFromTripStopTime(stopTime),
          stopId: sanitizeText(stop?.stop_id || stopTime?.stop_id),
          name: sanitizeText(stop?.stop_name || stopTime?.stop_name)
        };
      })
      .filter((entry) => Boolean(entry.id || entry.stopId || entry.name));

    if (!stopEntries.length) {
      continue;
    }

    const payload = {
      tripId: representative.tripId,
      patternId: extractTripPatternId(detail) ?? extractTripPatternId(representative.trip),
      stopEntries
    };

    const existing = bestByDirection.get(representative.directionId);
    if (!existing || stopEntries.length > existing.stopEntries.length) {
      bestByDirection.set(representative.directionId, payload);
    }

    const list = patternsByDirection.get(representative.directionId) || [];
    list.push(payload);
    patternsByDirection.set(representative.directionId, list);
  }

  if (!bestByDirection.size) {
    return null;
  }

  return {
    0: bestByDirection.get(0)?.stopEntries || [],
    1: bestByDirection.get(1)?.stopEntries || [],
    patterns: {
      0: patternsByDirection.get(0) || [],
      1: patternsByDirection.get(1) || []
    }
  };
}

module.exports = {
  buildDirectionStopSequencesForRoute
};
