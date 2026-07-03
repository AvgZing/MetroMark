var MODE_FILTER_ALL = "all";
var MODE_FILTER_BUS = "bus";
var MODE_FILTER_FERRY = "ferry";
var MODE_FILTER_METRO = "metro";
var MODE_FILTER_TRAM = "tram";
var MODE_FILTER_RAIL = "rail";
var MODE_FILTER_OTHER = "other";

var MODE_DEFS = [
  { key: MODE_FILTER_ALL, label: "All Modes", routeTypes: [] },
  { key: MODE_FILTER_BUS, label: "Bus", routeTypes: [3, 11] },
  { key: MODE_FILTER_FERRY, label: "Ferries", routeTypes: [4] },
  { key: MODE_FILTER_METRO, label: "Metro", routeTypes: [1] },
  { key: MODE_FILTER_TRAM, label: "Tram", routeTypes: [0] },
  { key: MODE_FILTER_RAIL, label: "Rail", routeTypes: [2] },
  { key: MODE_FILTER_OTHER, label: "Other", routeTypes: [5, 6, 7, 12] }
];

var MODE_DEF_BY_KEY = new Map(MODE_DEFS.map(function(entry) { return [entry.key, entry]; }));

var FREQUENCY_FILTER_ALL = "all";
var FREQUENCY_FILTER_FREQUENT = "frequent";
var FREQUENCY_FILTER_REGULAR = "regular";
var FREQUENCY_FILTER_LOCAL = "local";
var FREQUENCY_FILTER_UNKNOWN = "unknown";

var GTFS_MODE_LABELS = {
  0: "Tram", 1: "Metro", 2: "Rail", 3: "Bus",
  4: "Ferry", 5: "Cable Tram", 6: "Aerial", 7: "Funicular",
  11: "Trolleybus", 12: "Monorail"
};

var FALLBACK_HEADWAY_MINUTES = Number((100000 / 60).toFixed(1));

/** Constrain a numeric value between a minimum and maximum. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Escape HTML special characters in a string to prevent XSS. */
function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Resolve a GTFS route type number to its human-readable mode label. */
function modeLabelFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }
  return GTFS_MODE_LABELS[numeric] || "Unknown";
}

/** Map a GTFS route type number to its mode filter key. */
function modeKeyFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return MODE_FILTER_OTHER;
  }

  if (numeric === 3 || numeric === 11) return MODE_FILTER_BUS;
  if (numeric === 4) return MODE_FILTER_FERRY;
  if (numeric === 1) return MODE_FILTER_METRO;
  if (numeric === 0) return MODE_FILTER_TRAM;
  if (numeric === 2) return MODE_FILTER_RAIL;
  return MODE_FILTER_OTHER;
}

/** Resolve a mode filter key to its display label. */
function modeLabelFromModeKey(modeKey) {
  const modeDef = MODE_DEF_BY_KEY.get(modeKey);
  if (modeDef) {
    return modeDef.label;
  }
  return "Unknown";
}

/** Derive the mode filter key for a line object from its route type. */
function lineModeKey(line) {
  return modeKeyFromRouteType(line?.routeType);
}

/** Derive the display mode label for a line object. */
function lineMode(line) {
  return modeLabelFromModeKey(lineModeKey(line));
}

/** Determine whether a GTFS route type represents a bus-like mode. */
function isBusLikeRouteType(routeType) {
  const numeric = Number(routeType);
  return numeric === 3 || numeric === 11;
}

/** Determine whether a GTFS route type represents a rail-like mode. */
function isRailLikeRouteType(routeType) {
  const numeric = Number(routeType);
  return numeric === 0 || numeric === 1 || numeric === 2 || numeric === 12;
}

/** Derive the service tier (rail, bus, special, other) for a line. */
function lineServiceTier(line) {
  const explicit = String(line?.serviceTier || "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  if (isRailLikeRouteType(line?.routeType)) {
    return "rail";
  }

  if (isBusLikeRouteType(line?.routeType)) {
    return "bus";
  }

  return "other";
}

/** Compute a sort weight for a line based on its service tier. */
function lineSortWeight(line) {
  const tier = lineServiceTier(line);
  if (tier === "rail") return 0;
  if (tier === "special") return 1;
  if (tier === "other") return 2;
  return 3;
}

/** Build the operator display label for a line, with fallbacks. */
function lineOperatorLabel(line) {
  return String(line.operatorName || line.routeFeedId || "Operator unavailable");
}

/** Construct a combined display name from a line's short and long names. */
function lineDisplayName(line) {
  const shortName = String(line.lineShortName || "").trim();
  const longName = String(line.lineLongName || "").trim();

  if (shortName && longName && !longName.toLowerCase().includes(shortName.toLowerCase())) {
    return `${shortName} | ${longName}`;
  }

  return shortName || longName || line.lineName || "Line";
}

/** Assemble a line's searchable text blob from all its identifying fields. */
function lineSearchText(line) {
  return [
    line.lineName,
    line.lineShortName,
    line.lineLongName,
    line.routeOnestopId,
    line.headwayBestMinutes,
    lineMode(line),
    lineServiceTier(line),
    lineFrequencyBucket(line),
    lineOperatorLabel(line),
    line.routeFeedId
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

/** Classify headway minutes into a frequency bucket (frequent, regular, local, unknown). */
function frequencyBucketFromHeadwayMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return FREQUENCY_FILTER_UNKNOWN;
  }

  if (minutes <= 10) {
    return FREQUENCY_FILTER_FREQUENT;
  }

  if (minutes < 30) {
    return FREQUENCY_FILTER_REGULAR;
  }

  return FREQUENCY_FILTER_LOCAL;
}

/** Check whether a headway value matches the system fallback (no real data). */
function isFallbackHeadwayMinutes(minutes) {
  const numeric = Number(minutes);
  return Number.isFinite(numeric) && Math.abs(numeric - FALLBACK_HEADWAY_MINUTES) < 0.2;
}

/** Estimate a frequency bucket for a line when only fallback headway data is available. */
function lineFallbackFrequencyBucket(line) {
  const routeType = Number(line?.routeType);
  const routeMode = String(line?.mode || line?.lineMode || "").trim().toLowerCase();
  const routeName = [line?.lineShortName, line?.lineLongName, line?.lineName]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  const combined = `${routeMode} ${routeName}`;

  if (routeType === 1 || /\b(subway|metro|rapid transit)\b/.test(combined)) {
    return FREQUENCY_FILTER_FREQUENT;
  }

  if (routeType === 0 || /\b(tram|streetcar|light rail)\b/.test(combined)) {
    return FREQUENCY_FILTER_REGULAR;
  }

  if (routeType === 12 || /\b(airport|people mover|monorail)\b/.test(combined)) {
    return FREQUENCY_FILTER_FREQUENT;
  }

  return FREQUENCY_FILTER_LOCAL;
}

/** Determine whether a line is using a fallback (estimated) headway value. */
function lineHasFallbackHeadway(line) {
  if (Number(line?.headwayFallback || 0) === 1) {
    return true;
  }

  return isFallbackHeadwayMinutes(line?.headwayBestMinutes);
}

/** Return the best headway minutes for a line, or null if unavailable or fallback. */
function lineHeadwayBestMinutes(line) {
  const minutes = Number(line?.headwayBestMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || lineHasFallbackHeadway(line)) {
    return null;
  }

  return minutes;
}

/** Resolve the frequency bucket for a line using best-available headway data. */
function lineFrequencyBucket(line) {
  const bestHeadwayMinutes = lineHeadwayBestMinutes(line);
  if (bestHeadwayMinutes !== null) {
    return frequencyBucketFromHeadwayMinutes(bestHeadwayMinutes);
  }

  if (lineHasFallbackHeadway(line)) {
    return lineFallbackFrequencyBucket(line);
  }

  const explicit = String(line?.frequencyBucket || "").trim().toLowerCase();
  if (
    explicit === FREQUENCY_FILTER_FREQUENT ||
    explicit === FREQUENCY_FILTER_REGULAR ||
    explicit === FREQUENCY_FILTER_LOCAL ||
    explicit === FREQUENCY_FILTER_UNKNOWN
  ) {
    return explicit;
  }

  return FREQUENCY_FILTER_UNKNOWN;
}

/** Map a frequency bucket key to its human-readable label. */
function frequencyBucketLabel(bucket) {
  if (bucket === FREQUENCY_FILTER_ALL) return "All Frequencies";
  if (bucket === FREQUENCY_FILTER_FREQUENT) return "Frequent (Up to 10m)";
  if (bucket === FREQUENCY_FILTER_REGULAR) return "Regular (11-29m)";
  if (bucket === FREQUENCY_FILTER_LOCAL) return "Local (30m+)";
  return "Frequency Unknown";
}

/** Build a human-readable headway label for a line, with fallback descriptions. */
function lineHeadwayLabel(line) {
  const bestHeadwayMinutes = lineHeadwayBestMinutes(line);
  if (bestHeadwayMinutes !== null) {
    return `Peak headway ~${bestHeadwayMinutes} min`;
  }

  if (lineHasFallbackHeadway(line)) {
    const fallbackBucket = lineFrequencyBucket(line);
    if (fallbackBucket === FREQUENCY_FILTER_FREQUENT) {
      return "Frequency Frequent";
    }

    if (fallbackBucket === FREQUENCY_FILTER_REGULAR) {
      return "Frequency Regular";
    }

    return "Frequency Varies";
  }

  return frequencyBucketLabel(lineFrequencyBucket(line));
}

/** Format a count label for a filter chip, showing "?" when uncertain. */
function filterChipCountLabel(count, uncertain) {
  if (uncertain) {
    return "?";
  }

  const numeric = Number(count);
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : "0";
}

/** Score a line against a search query for relevance-based sorting. */
function calculateLineSearchScore(line, query) {
  if (!query) return 0;
  
  const searchText = lineSearchText(line);
  if (!searchText.includes(query)) {
    return -999;
  }
  
  const shortName = String(line.lineShortName || "").toLowerCase();
  const longName = String(line.lineLongName || "").toLowerCase();
  const lineName = String(line.lineName || "").toLowerCase();
  
  if (shortName === query) return 1000;
  if (lineName === query) return 950;
  if (longName === query) return 900;
  if (shortName.startsWith(query)) return 800;
  if (lineName.startsWith(query)) return 750;
  if (longName.startsWith(query)) return 700;
  
  const shortNameIndex = shortName.indexOf(query);
  if (shortNameIndex !== -1) {
    return 500 - shortNameIndex;
  }
  
  if (searchText.includes(query)) {
    return 100;
  }
  
  return -999;
}

/** Map a GTFS stop location type number to its display label. */
function stopLocationTypeLabel(value) {
  const numeric = Number(value);
  if (numeric === 0) return "Platform/Stop";
  if (numeric === 1) return "Station";
  if (numeric === 2) return "Entrance/Exit";
  if (numeric === 3) return "Generic Node";
  if (numeric === 4) return "Boarding Area";
  return "Unknown";
}

/** Construct a line-like plain object from GeoJSON feature properties. */
function lineLikeFromFeatureProperties(properties) {
  const headwayBestMinutes = Number(
    properties?.headway_best_minutes ?? properties?.headwayBestMinutes
  );

  return {
    lineKey: String(properties?.line_key || properties?.lineKey || "").trim(),
    lineName: properties?.line_name || properties?.lineName,
    lineShortName: properties?.line_short_name || properties?.lineShortName,
    lineLongName: properties?.line_long_name || properties?.lineLongName,
    operatorName: properties?.operator_name || properties?.operatorName,
    mode: properties?.mode,
    routeType: Number(properties?.route_type ?? properties?.routeType),
    routeFeedId: properties?.route_feed_id || properties?.routeFeedId,
    frequencyBucket: properties?.frequency_bucket || properties?.frequencyBucket,
    headwayBestMinutes: Number.isFinite(headwayBestMinutes) ? headwayBestMinutes : null,
    stopCount: Number((properties?.stop_count ?? properties?.stopCount) || 0)
  };
}
