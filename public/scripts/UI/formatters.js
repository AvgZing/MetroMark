function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function modeLabelFromRouteType(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }
  return GTFS_MODE_LABELS[numeric] || "Unknown";
}

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

function modeLabelFromModeKey(modeKey) {
  const modeDef = MODE_DEF_BY_KEY.get(modeKey);
  if (modeDef) {
    return modeDef.label;
  }
  return "Unknown";
}

function lineModeKey(line) {
  return modeKeyFromRouteType(line?.routeType);
}

function lineMode(line) {
  return modeLabelFromModeKey(lineModeKey(line));
}

function isBusLikeRouteType(routeType) {
  const numeric = Number(routeType);
  return numeric === 3 || numeric === 11;
}

function isRailLikeRouteType(routeType) {
  const numeric = Number(routeType);
  return numeric === 0 || numeric === 1 || numeric === 2 || numeric === 12;
}

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

function lineSortWeight(line) {
  const tier = lineServiceTier(line);
  if (tier === "rail") return 0;
  if (tier === "special") return 1;
  if (tier === "other") return 2;
  return 3;
}

function lineOperatorLabel(line) {
  return String(line.operatorName || line.routeFeedId || "Operator unavailable");
}

function lineDisplayName(line) {
  const shortName = String(line.lineShortName || "").trim();
  const longName = String(line.lineLongName || "").trim();

  if (shortName && longName && !longName.toLowerCase().includes(shortName.toLowerCase())) {
    return `${shortName} | ${longName}`;
  }

  return shortName || longName || line.lineName || "Line";
}

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

function isFallbackHeadwayMinutes(minutes) {
  const numeric = Number(minutes);
  return Number.isFinite(numeric) && Math.abs(numeric - FALLBACK_HEADWAY_MINUTES) < 0.2;
}

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

function lineHasFallbackHeadway(line) {
  if (Number(line?.headwayFallback || 0) === 1) {
    return true;
  }

  return isFallbackHeadwayMinutes(line?.headwayBestMinutes);
}

function lineHeadwayBestMinutes(line) {
  const minutes = Number(line?.headwayBestMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || lineHasFallbackHeadway(line)) {
    return null;
  }

  return minutes;
}

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

function frequencyBucketLabel(bucket) {
  if (bucket === FREQUENCY_FILTER_ALL) return "All Frequencies";
  if (bucket === FREQUENCY_FILTER_FREQUENT) return "Frequent (Up to 10m)";
  if (bucket === FREQUENCY_FILTER_REGULAR) return "Regular (11-29m)";
  if (bucket === FREQUENCY_FILTER_LOCAL) return "Local (30m+)";
  return "Frequency Unknown";
}

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

function filterChipCountLabel(count, uncertain) {
  if (uncertain) {
    return "?";
  }

  const numeric = Number(count);
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : "0";
}

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

function stopLocationTypeLabel(value) {
  const numeric = Number(value);
  if (numeric === 0) return "Platform/Stop";
  if (numeric === 1) return "Station";
  if (numeric === 2) return "Entrance/Exit";
  if (numeric === 3) return "Generic Node";
  if (numeric === 4) return "Boarding Area";
  return "Unknown";
}

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
