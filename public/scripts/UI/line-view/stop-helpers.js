
/**
 * Extract lookup keys from a stop feature for matching against direction sequences
 */
function stopFeatureLookupKeys(feature) {
  const props = feature?.properties || {};
  return Array.from(
    new Set(
      [
        stopKeyForFeature(feature),
        props.station_name,
        props.stop_name,
        props.source_sample_id,
        props.stop_id,
        props.stop_feed_id
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

/**
 * Normalize a stop lookup key for comparison (lowercase, trimmed)
 */
function normalizeStopLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/~/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stopIdentityKey(feature) {
  const props = feature?.properties || {};
  const stopKey = normalizeStopLookupKey(stopKeyForFeature(feature));
  if (stopKey) {
    return `key:${stopKey}`;
  }

  const stationName = normalizeStopLookupKey(props.station_name || props.stop_name);
  const coords = feature?.geometry?.coordinates;
  const lng = Number(Array.isArray(coords) ? coords[0] : NaN);
  const lat = Number(Array.isArray(coords) ? coords[1] : NaN);

  if (stationName && Number.isFinite(lng) && Number.isFinite(lat)) {
    return `name:${stationName}:${lng.toFixed(5)}:${lat.toFixed(5)}`;
  }

  if (stationName) {
    return `name:${stationName}`;
  }

  return "";
}

function dedupeStopFeatures(features) {
  const seen = new Set();

  return Array.isArray(features)
    ? features.filter((feature) => {
        const key = stopIdentityKey(feature);

        if (!key) {
          return true;
        }

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
    : features;
}

function stopFeatureSortLabel(feature) {
  const props = feature?.properties || {};
  return String(props.station_name || props.stop_name || props.stop_id || props.source_sample_id || "").trim().toLowerCase();
}

function buildFeatureLookupMap(stopFeatures) {
  const featureByLookupKey = new Map();

  for (const feature of Array.isArray(stopFeatures) ? stopFeatures : []) {
    for (const lookupKey of stopFeatureLookupKeys(feature)) {
      const normalizedLookupKey = normalizeStopLookupKey(lookupKey);
      if (!normalizedLookupKey || featureByLookupKey.has(normalizedLookupKey)) {
        continue;
      }

      featureByLookupKey.set(normalizedLookupKey, feature);
    }
  }

  return featureByLookupKey;
}

function routeGeometryCoordinatesForLine(lineKey) {
  const features = Array.isArray(state.transit?.routesGeoJson?.features)
    ? state.transit.routesGeoJson.features
    : [];

  const routeFeature = features.find((feature) => String(feature?.properties?.line_key || "") === String(lineKey || ""));
  const geometry = routeFeature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.flat();
  }

  return null;
}

function routeGeometryHasMultipleParts(lineKey) {
  const features = Array.isArray(state.transit?.routesGeoJson?.features)
    ? state.transit.routesGeoJson.features
    : [];

  const routeFeature = features.find((feature) => String(feature?.properties?.line_key || "") === String(lineKey || ""));
  const geometry = routeFeature?.geometry;
  if (!geometry || geometry.type !== "MultiLineString") {
    return false;
  }

  const parts = Array.isArray(geometry.coordinates)
    ? geometry.coordinates.filter((part) => Array.isArray(part) && part.length >= 2)
    : [];

  return parts.length > 1;
}

function stopNameTokens(value) {
  return normalizeStopLookupKey(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !new Set(["station", "stn", "stop", "transit", "center", "ctr", "city"]).has(token));
}

function stopNameSimilarity(leftValue, rightValue) {
  const left = new Set(stopNameTokens(leftValue));
  const right = new Set(stopNameTokens(rightValue));

  if (!left.size || !right.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  const denominator = Math.max(left.size, right.size);
  return denominator > 0 ? overlap / denominator : 0;
}

function stopFeatureDisplayName(feature) {
  const props = feature?.properties || {};
  return String(props.station_name || props.stop_name || props.stop_id || "").trim();
}

function buildGeometryProgressMap(stopFeatures, lineKey) {
  const ordered = sortStopsSequentially(stopFeatures, lineKey);
  const progressMap = new Map();
  const denominator = Math.max(ordered.length - 1, 1);

  ordered.forEach((feature, index) => {
    const progress = index / denominator;
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    if (identity && !progressMap.has(identity)) {
      progressMap.set(identity, progress);
    }

    if (stationKey && !progressMap.has(stationKey)) {
      progressMap.set(stationKey, progress);
    }
  });

  return progressMap;
}

function geometryProgressForFeature(progressMap, feature) {
  const identity = stopIdentityKey(feature);
  if (identity && progressMap.has(identity)) {
    return Number(progressMap.get(identity));
  }

  const stationKey = stopKeyForFeature(feature);
  if (stationKey && progressMap.has(stationKey)) {
    return Number(progressMap.get(stationKey));
  }

  return null;
}

function lineTerminalHints(lineKey) {
  const line = Array.isArray(state.lineSummaries)
    ? state.lineSummaries.find((entry) => String(entry?.lineKey || "") === String(lineKey || ""))
    : null;

  const longName = String(line?.lineLongName || line?.lineName || "").trim();
  if (!longName) {
    return [];
  }

  const separators = [" - ", " to ", " – ", " — "];
  for (const separator of separators) {
    if (!longName.includes(separator)) {
      continue;
    }

    const parts = longName.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return [parts[0], parts[parts.length - 1]];
    }
  }

  return [];
}