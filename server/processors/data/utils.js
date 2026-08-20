function nowIso() {
  return new Date().toISOString();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function toIsoFromEpoch(epochSeconds) {
  const numeric = Number(epochSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return new Date(numeric * 1000).toISOString();
}

function toEpochSeconds(isoText) {
  if (!isoText) {
    return null;
  }

  const parsed = Date.parse(String(isoText));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

function utcDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDisplayName(value) {
  return normalizeText(value, "MetroMark User");
}

function normalizeRouteOrderingMode(value) {
  const mode = normalizeText(value).toLowerCase();
  if (mode === "auto" || mode === "geometry-revised" || mode === "legacy-geometry" || mode === "fractions") {
    return mode;
  }

  if (mode === "geometry-only" || mode === "geometry") {
    return "legacy-geometry";
  }

  if (mode === "fractions-only") {
    return "fractions";
  }

  return "";
}

function normalizeAuthError(error, fallbackMessage) {
  if (!error) {
    return new Error(fallbackMessage);
  }

  const message = normalizeText(error.message, fallbackMessage);
  const wrapped = new Error(message);
  wrapped.code = error.code;
  wrapped.status = error.status;
  return wrapped;
}

function normalizeProfileRow(row, authUser = null) {
  if (!row && !authUser) {
    return null;
  }

  const authMetadata = authUser?.user_metadata || {};
  const displayName = normalizeText(
    row?.display_name || authMetadata.display_name || authUser?.email?.split("@")[0],
    "MetroMark User"
  );

  const createdAtIso = row?.created_at || authUser?.created_at || nowIso();
  const lastLoginIso = row?.last_login_at || authUser?.last_sign_in_at || null;

  return {
    id: normalizeText(row?.id || authUser?.id),
    email: normalizeEmail(row?.email || authUser?.email || ""),
    displayName,
    role: normalizeText(row?.role, "user"),
    isActive: row?.is_active === false ? false : true,
    lastLoginAt: toEpochSeconds(lastLoginIso),
    createdAt: toEpochSeconds(createdAtIso) || nowSeconds()
  };
}

function normalizeCacheRow(row) {
  if (!row) {
    return null;
  }

  return {
    payload: row.payload,
    fetchedAt: toEpochSeconds(row.fetched_at),
    expiresAt: toEpochSeconds(row.expires_at),
    cacheKind: normalizeText(row.cache_kind, "bbox"),
    citySlug: normalizeText(row.city_slug),
    feedFingerprint: normalizeText(row.feed_fingerprint),
    verifiedAt: toEpochSeconds(row.verified_at)
  };
}

function normalizeBboxArray(value) {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every((entry) => Number.isFinite(entry))) {
    return null;
  }

  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (minLon >= maxLon || minLat >= maxLat) {
    return null;
  }

  return bbox;
}

function bboxIntersects(a, b) {
  return !(
    a[2] < b[0] ||
    a[0] > b[2] ||
    a[3] < b[1] ||
    a[1] > b[3]
  );
}

function normalizeGeometryForStorage(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates.filter((line) => Array.isArray(line) && line.length >= 2);
    if (!lines.length) {
      return null;
    }
    return {
      type: "MultiLineString",
      coordinates: lines
    };
  }

  if (geometry.type === "LineString") {
    if (geometry.coordinates.length < 2) {
      return null;
    }
    return {
      type: "MultiLineString",
      coordinates: [geometry.coordinates]
    };
  }

  return null;
}

function normalizeGeometryFromStorageRow(row) {
  if (!row) {
    return null;
  }

  const geometry = row.geometry_geojson || row.geometry || null;
  if (!geometry) {
    return null;
  }

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }

  return geometry;
}

function normalizeUsageRow(row, dayKey) {
  return {
    dayKey,
    restApiCalls: Number(row?.rest_api_calls || 0),
    vectorTileCalls: Number(row?.vector_tile_calls || 0),
    routingApiCalls: Number(row?.routing_api_calls || 0),
    updatedAt: toEpochSeconds(row?.updated_at) || 0
  };
}

function normalizeHarvestState(row) {
  if (!row) {
    return null;
  }

  return {
    citySlug: normalizeText(row.city_slug),
    cityName: normalizeText(row.city_name),
    harvestPriority: Number(row.harvest_priority || 100),
    harvestStatus: normalizeText(row.harvest_status, "pending"),
    lastGeometryHarvestAt: toEpochSeconds(row.last_geometry_harvest_at),
    lastStopsHarvestAt: toEpochSeconds(row.last_stops_harvest_at),
    lastVerifiedAt: toEpochSeconds(row.last_verified_at),
    lastFeedFingerprint: normalizeText(row.last_feed_fingerprint),
    lastCacheKey: normalizeText(row.last_cache_key),
    pendingRefresh: row.pending_refresh === true,
    lastError: normalizeText(row.last_error),
    updatedAt: toEpochSeconds(row.updated_at) || 0
  };
}

module.exports = {
  nowIso,
  nowSeconds,
  toIsoFromEpoch,
  toEpochSeconds,
  utcDateKey,
  normalizeText,
  normalizeEmail,
  normalizeDisplayName,
  normalizeRouteOrderingMode,
  normalizeAuthError,
  normalizeProfileRow,
  normalizeCacheRow,
  normalizeBboxArray,
  bboxIntersects,
  normalizeGeometryForStorage,
  normalizeGeometryFromStorageRow,
  normalizeUsageRow,
  normalizeHarvestState
};
