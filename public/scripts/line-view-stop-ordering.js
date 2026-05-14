/**
 * Line View Stop Ordering Logic
 * 
 * This file contains all logic for ordering and matching stops in the line view.
 * All stop ordering, direction handling, and stop sequencing happens here.
 */

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

function matchSequenceFeatureWithThreshold(entry, stopFeatures, featureByLookupKey, selectedFeatures, minScore = 0.67) {
  const candidateKeys = [entry?.id, entry?.stopId, entry?.name]
    .map((value) => normalizeStopLookupKey(value))
    .filter(Boolean);

  for (const candidateKey of candidateKeys) {
    const exact = featureByLookupKey.get(candidateKey);
    if (!exact || selectedFeatures.has(exact)) {
      continue;
    }
    return exact;
  }

  const entryName = String(entry?.name || entry?.stopId || entry?.id || "").trim();
  if (!entryName) {
    return null;
  }

  let best = null;
  let bestScore = 0;

  for (const feature of stopFeatures) {
    if (selectedFeatures.has(feature)) {
      continue;
    }

    const score = stopNameSimilarity(entryName, stopFeatureDisplayName(feature));
    if (score > bestScore) {
      best = feature;
      bestScore = score;
    }
  }

  return bestScore >= minScore ? best : null;
}

function matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures) {
  return matchSequenceFeatureWithThreshold(entry, stopFeatures, featureByLookupKey, selectedFeatures, 0.67);
}

function rankValueForFeature(rankMap, feature) {
  if (!(rankMap instanceof Map)) {
    return null;
  }

  const identity = stopIdentityKey(feature);
  if (identity && rankMap.has(identity)) {
    return Number(rankMap.get(identity));
  }

  const stationKey = String(stopKeyForFeature(feature) || "").trim();
  if (stationKey && rankMap.has(stationKey)) {
    return Number(rankMap.get(stationKey));
  }

  return null;
}

function compareRankValues(a, b) {
  const aFinite = Number.isFinite(a);
  const bFinite = Number.isFinite(b);

  if (aFinite && bFinite) {
    return a - b;
  }

  if (aFinite) {
    return -1;
  }

  if (bFinite) {
    return 1;
  }

  return 0;
}

function sortFeaturesByRanking(stopFeatures, ...rankMaps) {
  return Array.from(Array.isArray(stopFeatures) ? stopFeatures : [])
    .map((feature, index) => ({
      feature,
      index,
      ranks: rankMaps
        .map((rankMap) => rankValueForFeature(rankMap, feature))
        .filter((value) => Number.isFinite(value)),
      label: stopFeatureSortLabel(feature)
    }))
    .sort((a, b) => {
      const scoreA = a.ranks.length ? a.ranks.reduce((sum, value) => sum + value, 0) / a.ranks.length : Number.POSITIVE_INFINITY;
      const scoreB = b.ranks.length ? b.ranks.reduce((sum, value) => sum + value, 0) / b.ranks.length : Number.POSITIVE_INFINITY;

      const medianA = a.ranks.length ? [...a.ranks].sort((left, right) => left - right)[Math.floor((a.ranks.length - 1) / 2)] : Number.POSITIVE_INFINITY;
      const medianB = b.ranks.length ? [...b.ranks].sort((left, right) => left - right)[Math.floor((b.ranks.length - 1) / 2)] : Number.POSITIVE_INFINITY;

      const medianDiff = compareRankValues(medianA, medianB);
      if (medianDiff !== 0) {
        return medianDiff;
      }

      const coverageDiff = b.ranks.length - a.ranks.length;
      if (coverageDiff !== 0) {
        return coverageDiff;
      }

      const meanDiff = compareRankValues(scoreA, scoreB);
      if (meanDiff !== 0) {
        return meanDiff;
      }

      const labelDiff = a.label.localeCompare(b.label);
      if (labelDiff !== 0) {
        return labelDiff;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.feature);
}

function sortFeaturesByPrimaryRanking(stopFeatures, primaryRankMap, secondaryRankMap = null) {
  return Array.from(Array.isArray(stopFeatures) ? stopFeatures : [])
    .map((feature, index) => ({
      feature,
      index,
      primaryRank: rankValueForFeature(primaryRankMap, feature),
      secondaryRank: rankValueForFeature(secondaryRankMap, feature),
      label: stopFeatureSortLabel(feature)
    }))
    .sort((a, b) => {
      const aPrimaryFinite = Number.isFinite(a.primaryRank);
      const bPrimaryFinite = Number.isFinite(b.primaryRank);

      if (aPrimaryFinite && bPrimaryFinite) {
        const primaryDiff = a.primaryRank - b.primaryRank;
        if (primaryDiff !== 0) {
          return primaryDiff;
        }
      } else if (aPrimaryFinite !== bPrimaryFinite) {
        return aPrimaryFinite ? -1 : 1;
      }

      const secondaryDiff = compareRankValues(a.secondaryRank, b.secondaryRank);
      if (secondaryDiff !== 0) {
        return secondaryDiff;
      }

      const labelDiff = a.label.localeCompare(b.label);
      if (labelDiff !== 0) {
        return labelDiff;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.feature);
}

function buildGeometryRankMap(stopFeatures, lineKey) {
  const ordered = sortStopsSequentially(stopFeatures, lineKey);
  const rankMap = new Map();

  ordered.forEach((feature, index) => {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, index);
    }

    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, index);
    }
  });

  return rankMap;
}

function buildPayloadRankMap(stopFeatures) {
  const rankMap = new Map();

  Array.from(Array.isArray(stopFeatures) ? stopFeatures : []).forEach((feature, index) => {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, index);
    }

    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, index);
    }
  });

  return rankMap;
}

/**
 * Build rank map from trip pattern sequences
 * CRITICAL: Uses direction sequences directly from actual trip data
 * Selects the longest/most complete pattern and handles branches
 */
function buildTripPatternRankMap(stopFeatures, directionSequences, lineKey = "") {
  if (!directionSequences || typeof directionSequences !== 'object') {
    return { rankMap: new Map(), matchedCount: 0, coverage: 0, usedDirection: null, matchedFeatures: [] };
  }

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const geometryProgressMap = buildGeometryProgressMap(stopFeatures, lineKey);
  const terminalHints = lineTerminalHints(lineKey);
  const patterns = [];

  // Extract and evaluate both direction patterns
  for (const directionKey of ["0", "1"]) {
    const directionSequence = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!directionSequence.length) {
      continue;
    }

    const patternMatches = [];
    const selectedFeatures = new Set();

    // Try to match each entry in the trip sequence to a feature
    for (const entry of directionSequence) {
      const matchedFeature = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures);

      if (matchedFeature) {
        selectedFeatures.add(matchedFeature);
        patternMatches.push(matchedFeature);
      }
    }

    if (patternMatches.length >= 2) {
      const coverage = stopFeatures.length ? patternMatches.length / stopFeatures.length : 0;
      const firstProgress = geometryProgressForFeature(geometryProgressMap, patternMatches[0]);
      const lastProgress = geometryProgressForFeature(geometryProgressMap, patternMatches[patternMatches.length - 1]);
      const span = Number.isFinite(firstProgress) && Number.isFinite(lastProgress)
        ? Math.abs(lastProgress - firstProgress)
        : 0;

      const firstName = stopFeatureDisplayName(patternMatches[0]);
      const lastName = stopFeatureDisplayName(patternMatches[patternMatches.length - 1]);
      const terminalBonus = terminalHints.length >= 2
        ? Math.max(
            stopNameSimilarity(terminalHints[0], firstName) + stopNameSimilarity(terminalHints[1], lastName),
            stopNameSimilarity(terminalHints[0], lastName) + stopNameSimilarity(terminalHints[1], firstName)
          )
        : 0;

      patterns.push({
        directionKey,
        matches: patternMatches,
        matchedCount: patternMatches.length,
        coverage,
        span,
        terminalBonus
      });
    }
  }

  // Select the best pattern (longest/highest coverage/best terminal span)
  const bestPattern = patterns.sort((a, b) => {
    if (a.matchedCount !== b.matchedCount) {
      return b.matchedCount - a.matchedCount;
    }
    if (a.span !== b.span) {
      return b.span - a.span;
    }
    if (a.terminalBonus !== b.terminalBonus) {
      return b.terminalBonus - a.terminalBonus;
    }
    return b.coverage - a.coverage;
  })[0];

  if (!bestPattern) {
    return { rankMap: new Map(), matchedCount: 0, coverage: 0, usedDirection: null, matchedFeatures: [] };
  }

  // Build rank map from the best matched sequence and blend unmatched stops by geometry progress.
  const rankMap = new Map();
  bestPattern.matches.forEach((feature, index) => {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, index);
    }

    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, index);
    }
  });

  const firstProgress = geometryProgressForFeature(geometryProgressMap, bestPattern.matches[0]);
  const lastProgress = geometryProgressForFeature(
    geometryProgressMap,
    bestPattern.matches[bestPattern.matches.length - 1]
  );
  const reverseGeometry = Number.isFinite(firstProgress) && Number.isFinite(lastProgress)
    ? lastProgress < firstProgress
    : false;

  const sequenceScale = Math.max(bestPattern.matches.length - 1, 1);

  for (const feature of stopFeatures) {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);
    const alreadyRanked = (identity && rankMap.has(identity)) || (stationKey && rankMap.has(stationKey));
    if (alreadyRanked) {
      continue;
    }

    const progress = geometryProgressForFeature(geometryProgressMap, feature);
    if (!Number.isFinite(progress)) {
      continue;
    }

    const oriented = reverseGeometry ? 1 - progress : progress;
    const synthesizedRank = oriented * sequenceScale + 0.35;

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, synthesizedRank);
    }
    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, synthesizedRank);
    }
  }

  return {
    rankMap,
    matchedCount: bestPattern.matchedCount,
    coverage: bestPattern.coverage,
    usedDirection: bestPattern.directionKey,
    matchedFeatures: bestPattern.matches
  };
}

function buildDirectionRankMap(stopFeatures, directionSequences) {
  const result = buildTripPatternRankMap(stopFeatures, directionSequences);
  return {
    rankMap: result.rankMap,
    matchedCount: result.matchedCount,
    coverage: result.coverage
  };
}

async function buildFractionRankMap(stopFeatures, lineKey, routeLookupKey) {
  const input = dedupeStopFeatures(stopFeatures);
  const rankMap = new Map();
  const totalCount = Array.isArray(input) ? input.length : 0;

  if (!Array.isArray(input) || input.length <= 1) {
    return { rankMap, matchedCount: 0, coverage: 0 };
  }

  try {
    const stopsPayload = input.map((feature) => ({
      id: stopKeyForFeature(feature),
      lat: feature?.geometry?.coordinates?.[1],
      lon: feature?.geometry?.coordinates?.[0]
    }));

    const payload = await apiRequest('/api/transit/stop-fractions', {
      method: 'POST',
      body: JSON.stringify({
        lineKey: String(routeLookupKey || lineKey || '').trim(),
        stops: stopsPayload,
        zoom: state.mapZoom || null
      })
    }).catch(() => null);

    if (payload && Array.isArray(payload.results)) {
      const fracById = new Map(payload.results.map((row) => [String(row.id || ''), row.fraction]));
      let matchedCount = 0;

      for (const feature of input) {
        const stationKey = stopKeyForFeature(feature);
        if (!stationKey) {
          continue;
        }

        const fraction = fracById.get(stationKey);
        if (!Number.isFinite(Number(fraction))) {
          continue;
        }

        rankMap.set(stationKey, Number(fraction));
        const identity = stopIdentityKey(feature);
        if (identity && !rankMap.has(identity)) {
          rankMap.set(identity, Number(fraction));
        }

        matchedCount += 1;
      }

      return {
        rankMap,
        matchedCount,
        coverage: totalCount ? matchedCount / totalCount : 0
      };
    }
  } catch (e) {
    // Fall through to geometry ranking.
  }

  return { rankMap, matchedCount: 0, coverage: 0 };
}

/**
 * Sort stops sequentially along the route geometry using linear referencing
 */
function sortStopsSequentially(features, lineKey) {
  if (!Array.isArray(features) || features.length <= 1) {
    return features;
  }

  const routeCoords = routeGeometryCoordinatesForLine(lineKey);
  if (Array.isArray(routeCoords) && routeCoords.length >= 2) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const haversineDistance = (a, b) => {
      const deltaLat = toRad(b[1] - a[1]);
      const deltaLon = toRad(b[0] - a[0]);
      const lat1 = toRad(a[1]);
      const lat2 = toRad(b[1]);
      const sinLat = Math.sin(deltaLat / 2);
      const sinLon = Math.sin(deltaLon / 2);
      const aa = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
      return 2 * earthRadius * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
    };

    const segmentLengths = [];
    const cumulativeLengths = [0];
    for (let index = 0; index < routeCoords.length - 1; index += 1) {
      const segmentLength = haversineDistance(routeCoords[index], routeCoords[index + 1]);
      segmentLengths.push(segmentLength);
      cumulativeLengths.push(cumulativeLengths[cumulativeLengths.length - 1] + segmentLength);
    }

    const totalLength = cumulativeLengths[cumulativeLengths.length - 1] || 1;
    const computeAlongDistance = (point) => {
      let best = { distance: Infinity, along: 0 };

      for (let index = 0; index < routeCoords.length - 1; index += 1) {
        const start = routeCoords[index];
        const end = routeCoords[index + 1];
        const ax = start[0];
        const ay = start[1];
        const bx = end[0];
        const by = end[1];
        const px = point[0];
        const py = point[1];

        const abx = bx - ax;
        const aby = by - ay;
        const apx = px - ax;
        const apy = py - ay;
        const denominator = abx * abx + aby * aby;
        let t = 0;
        if (denominator > 0) {
          t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / denominator));
        }

        const closestX = ax + t * abx;
        const closestY = ay + t * aby;
        const deltaX = px - closestX;
        const deltaY = py - closestY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance < best.distance) {
          best = {
            distance,
            along: cumulativeLengths[index] + (t * segmentLengths[index])
          };
        }
      }

      return best.along;
    };

    const scored = features.map((feature) => {
      const point = stopCoordinate(feature);
      const along = point ? computeAlongDistance(point) : 0;
      return { feature, along };
    });

    const terminalHints = lineTerminalHints(lineKey);
    const labels = scored.map((entry) => stopFeatureDisplayName(entry.feature));
    const firstLabel = labels[0] || "";
    const lastLabel = labels[labels.length - 1] || "";
    const forwardScore = terminalHints.length >= 2
      ? stopNameSimilarity(terminalHints[0], firstLabel) + stopNameSimilarity(terminalHints[1], lastLabel)
      : 0;
    const reverseScore = terminalHints.length >= 2
      ? stopNameSimilarity(terminalHints[0], lastLabel) + stopNameSimilarity(terminalHints[1], firstLabel)
      : 0;

    scored.sort((left, right) => left.along - right.along);
    const forwardOrdered = scored.map((entry) => entry.feature);
    const reverseOrdered = [...scored].reverse().map((entry) => entry.feature);

    // Only reverse if the reverseScore is significantly higher (threshold of 0.4)
    // to avoid reversing when scores are ambiguous
    if (reverseScore > forwardScore + 0.4) {
      return reverseOrdered;
    }

    if (!terminalHints.length && totalLength > 0) {
      return forwardOrdered;
    }

    return forwardOrdered;
  }

  return Array.from(features).sort((a, b) => {
    const aLat = a?.geometry?.coordinates?.[1] || 0;
    const bLat = b?.geometry?.coordinates?.[1] || 0;
    return aLat - bLat;
  });
}

/**
 * Order stops using direction-aware sequences from Transitland Trips API
 * Returns the ordered features and a flag indicating if sequences were used
 */
function orderStopsByDirection(stopFeatures, directionSequences, directionKey) {
  const directionSequence = Array.isArray(directionSequences?.[directionKey]) ? directionSequences[directionKey] : [];
  
  if (!directionSequence.length) {
    return { features: stopFeatures, usedSequences: false, matchRatio: 0 };
  }

  // Build a map of normalized stop keys to features
  const featureByLookupKey = new Map();
  for (const feature of stopFeatures) {
    for (const lookupKey of stopFeatureLookupKeys(feature)) {
      const normalizedLookupKey = normalizeStopLookupKey(lookupKey);
      if (!normalizedLookupKey || featureByLookupKey.has(normalizedLookupKey)) {
        continue;
      }
      featureByLookupKey.set(normalizedLookupKey, feature);
    }
  }

  // Try to match each entry in the direction sequence to a feature
  const sequenceOrderedFeatures = [];
  const selected = new Set();
  for (const entry of directionSequence) {
    const candidateKeys = [entry?.id, entry?.stopId, entry?.name]
      .map((value) => normalizeStopLookupKey(value))
      .filter(Boolean);

    let match = null;
    for (const candidateKey of candidateKeys) {
      const candidate = featureByLookupKey.get(candidateKey);
      if (candidate) {
        const identity = stopIdentityKey(candidate);
        if (identity && selected.has(identity)) {
          continue;
        }

        match = candidate;

        if (identity) {
          selected.add(identity);
        }

        break;
      }
    }

    if (match) {
      sequenceOrderedFeatures.push(match);
    }
  }

  const uniqueDirectionFeatures = dedupeStopFeatures(sequenceOrderedFeatures);
  const matchRatio = stopFeatures.length
    ? uniqueDirectionFeatures.length / stopFeatures.length
    : 0;

  // Only trust direction sequences when they cover most of the visible stop set.
  if (uniqueDirectionFeatures.length >= 2 && matchRatio >= 0.5) {
    return {
      features: uniqueDirectionFeatures,
      usedSequences: true,
      matchRatio
    };
  }

  return { features: dedupeStopFeatures(stopFeatures), usedSequences: false, matchRatio };
}

async function orderStopsByFractions(stopFeatures, lineKey) {
  const input = dedupeStopFeatures(stopFeatures);

  if (!Array.isArray(input) || input.length <= 1) {
    return input;
  }

  try {
    const stopsPayload = input.map((f) => ({
      id: stopKeyForFeature(f),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0]
    }));

    const payload = await apiRequest('/api/transit/stop-fractions', {
      method: 'POST',
      body: JSON.stringify({ lineKey, stops: stopsPayload, zoom: state.mapZoom || null })
    }).catch(() => null);

    if (payload && Array.isArray(payload.results)) {
      const fracById = new Map(payload.results.map((r) => [String(r.id || ''), r.fraction]));
      const withFrac = input.map((f) => ({
        feature: f,
        frac: fracById.get(stopKeyForFeature(f))
      }));

      const hasAny = withFrac.some((w) => Number.isFinite(Number(w.frac)));
      if (hasAny) {
        withFrac.sort((a, b) => {
          const va = Number.isFinite(Number(a.frac)) ? Number(a.frac) : Number.POSITIVE_INFINITY;
          const vb = Number.isFinite(Number(b.frac)) ? Number(b.frac) : Number.POSITIVE_INFINITY;
          return va - vb;
        });
        return withFrac.map((w) => w.feature);
      }
    }
  } catch (e) {
    // Fall through to route-geometry ordering.
  }

  return sortStopsSequentially(input, lineKey);
}

/**
 * Detect if a pattern has a loop (stop appears more than once)
 */
function hasLoopInPattern(features) {
  const seen = new Set();
  for (const feature of features) {
    const identity = stopIdentityKey(feature);
    if (!identity) {
      continue;
    }
    if (seen.has(identity)) {
      return true;
    }
    seen.add(identity);
  }
  return false;
}

/**
 * Detect branches in a route (multiple valid orderings from trip patterns)
 */
function detectBranches(directionSequences) {
  const branches = [];
  for (const directionKey of ["0", "1"]) {
    const directionSequence = Array.isArray(directionSequences?.[directionKey]) ? directionSequences[directionKey] : [];
    if (directionSequence.length >= 2) {
      branches.push({
        direction: directionKey,
        stopCount: directionSequence.length
      });
    }
  }

  return branches;
}

function normalizeSequenceKeys(directionSequence) {
  return Array.isArray(directionSequence)
    ? directionSequence
        .map((entry) => normalizeStopLookupKey(entry?.id || entry?.stopId || entry?.name))
        .filter(Boolean)
    : [];
}

function sequencesAreReverse(directionSequences) {
  const seq0 = normalizeSequenceKeys(directionSequences?.['0']);
  const seq1 = normalizeSequenceKeys(directionSequences?.['1']);
  if (!seq0.length || !seq1.length || seq0.length !== seq1.length) {
    return false;
  }
  return seq0.every((key, index) => key === seq1[seq1.length - 1 - index]);
}

function hasNonMonotonicEndpointDistance(orderedFeatures, endCoord, epsMeters = 20) {
  if (!Array.isArray(orderedFeatures) || orderedFeatures.length < 3 || !endCoord) {
    return false;
  }

  let trend = 0;
  let lastDist = null;
  for (const feature of orderedFeatures) {
    const coord = stopCoordinate(feature);
    if (!coord) continue;
    const dist = haversineMeters(coord, endCoord);
    if (lastDist === null) {
      lastDist = dist;
      continue;
    }

    const diff = dist - lastDist;
    if (Math.abs(diff) < epsMeters) {
      lastDist = dist;
      continue;
    }

    const direction = diff > 0 ? 1 : -1;
    if (trend === 0) {
      trend = direction;
    } else if (direction !== trend) {
      return true;
    }

    lastDist = dist;
  }

  return false;
}

function orderMismatchScore(primaryOrder, secondaryOrder) {
  if (!Array.isArray(primaryOrder) || !Array.isArray(secondaryOrder)) return 0;
  const total = Math.min(primaryOrder.length, secondaryOrder.length);
  if (total < 4) return 0;

  const indexByRef = new Map();
  primaryOrder.forEach((feature, index) => {
    if (feature && !indexByRef.has(feature)) indexByRef.set(feature, index);
  });

  let sumDiff = 0;
  let counted = 0;
  secondaryOrder.forEach((feature, index) => {
    if (!feature || !indexByRef.has(feature)) return;
    sumDiff += Math.abs(indexByRef.get(feature) - index);
    counted += 1;
  });

  if (!counted) return 0;
  return (sumDiff / counted) / Math.max(total - 1, 1);
}

function detectSplitSections(stopFeatures, directionSequences) {
  if (!directionSequences || typeof directionSequences !== 'object') return false;

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const patterns = [];
  for (const directionKey of ['0','1']) {
    const seq = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!seq.length) continue;
    const matches = [];
    const selected = new Set();
    for (const entry of seq) {
      const f = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selected);
      if (f) { selected.add(f); matches.push(f); }
    }
    if (matches.length >= 2) patterns.push(matches);
  }
  if (patterns.length < 2) return false;

  const pattern0 = patterns[0];
  const pattern1 = patterns[1];
  const count = Math.min(pattern0.length, pattern1.length);
  let closeMismatches = 0;
  for (let i = 0; i < count; i += 1) {
    const feat0 = pattern0[i];
    const feat1 = pattern1[i];
    if (!feat0 || !feat1) continue;
    const id0 = stopIdentityKey(feat0);
    const id1 = stopIdentityKey(feat1);
    if (id0 === id1) continue;
    const coords0 = feat0?.geometry?.coordinates;
    const coords1 = feat1?.geometry?.coordinates;
    if (coords0 && coords1) {
      const dist = Math.hypot(coords0[0] - coords1[0], coords0[1] - coords1[1]);
      if (dist < 0.0005) {
        closeMismatches += 1;
      }
    }
  }

  return closeMismatches >= 4 && closeMismatches / Math.max(count, 1) >= 0.2;
}

function buildLcsSequence(leftKeys, rightKeys) {
  const m = leftKeys.length;
  const n = rightKeys.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (leftKeys[i] === rightKeys[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lcs = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (leftKeys[i] === rightKeys[j]) {
      lcs.push(leftKeys[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return lcs;
}

function buildBranchGroups(stopFeatures, directionSequences, directionPatterns = null) {
  const result = { isBranching: false, isSplitSections: false, trunkKeys: [], segments: [], patterns: {}, keyToName: new Map() };

  const sequences = [];
  const addSequenceFromEntries = (entries) => {
    const seq = normalizeSequenceKeys(entries);
    if (seq.length < 2) return;
    for (const entry of entries || []) {
      const key = normalizeStopLookupKey(entry?.id || entry?.stopId || entry?.name);
      const name = String(entry?.name || entry?.stopId || entry?.id || '').trim();
      if (key && name && !result.keyToName.has(key)) {
        result.keyToName.set(key, name);
      }
    }
    sequences.push(seq);
  };

  if (directionPatterns && typeof directionPatterns === 'object') {
    for (const directionKey of ['0', '1']) {
      const patterns = Array.isArray(directionPatterns[directionKey]) ? directionPatterns[directionKey] : [];
      for (const pattern of patterns) {
        if (pattern && Array.isArray(pattern.stopEntries)) {
          addSequenceFromEntries(pattern.stopEntries);
        }
      }
    }
  }

  if (!sequences.length && directionSequences && typeof directionSequences === 'object') {
    const seq0 = normalizeSequenceKeys(directionSequences?.['0']);
    const seq1 = normalizeSequenceKeys(directionSequences?.['1']);
    if (seq0.length >= 2 && seq1.length >= 2) {
      if (sequencesAreReverse(directionSequences)) {
        return result;
      }
      addSequenceFromEntries(directionSequences?.['0'] || []);
      addSequenceFromEntries(directionSequences?.['1'] || []);
    }
  }

  if (directionSequences && typeof directionSequences === 'object' && detectSplitSections(stopFeatures, directionSequences)) {
    result.isSplitSections = true;
    return result;
  }

  if (sequences.length < 2) return result;

  let bestPair = null;
  let bestSimilarity = 1;
  let bestLcs = [];

  for (let i = 0; i < sequences.length; i += 1) {
    for (let j = i + 1; j < sequences.length; j += 1) {
      const left = sequences[i];
      const right = sequences[j];
      const lcs = buildLcsSequence(left, right);
      if (lcs.length < 2) {
        continue;
      }
      const similarity = lcs.length / Math.min(left.length, right.length);
      if (similarity < bestSimilarity) {
        bestSimilarity = similarity;
        bestPair = [left, right];
        bestLcs = lcs;
      }
    }
  }

  if (!bestPair || bestSimilarity >= 0.9) return result;

  const seq0 = bestPair[0];
  const seq1 = bestPair[1];
  const lcs = bestLcs;

  const segments = [];
  let idx0 = 0;
  let idx1 = 0;
  let prevKey = null;
  for (const commonKey of lcs) {
    const next0 = seq0.indexOf(commonKey, idx0);
    const next1 = seq1.indexOf(commonKey, idx1);
    const seg0 = seq0.slice(idx0, next0);
    const seg1 = seq1.slice(idx1, next1);
    if (seg0.length || seg1.length) {
      segments.push({ startKey: prevKey, endKey: commonKey, choices: { '0': seg0, '1': seg1 } });
    }
    idx0 = next0 + 1;
    idx1 = next1 + 1;
    prevKey = commonKey;
  }
  const tail0 = seq0.slice(idx0);
  const tail1 = seq1.slice(idx1);
  if (tail0.length || tail1.length) {
    segments.push({ startKey: prevKey, endKey: null, choices: { '0': tail0, '1': tail1 } });
  }

  const filtered = segments
    .filter((seg) => seg.choices['0'].length >= 1 && seg.choices['1'].length >= 1)
    .map((seg, index) => {
      const labelForChoice = (choiceKeys) => {
        const firstKey = choiceKeys[0];
        const lastKey = choiceKeys[choiceKeys.length - 1];
        const name = result.keyToName.get(firstKey) || result.keyToName.get(lastKey) || 'Branch';
        if (!seg.endKey) return `to ${name}`;
        if (!seg.startKey) return `from ${name}`;
        return `via ${name}`;
      };
      return {
        id: `${seg.startKey || 'start'}::${seg.endKey || 'end'}::${index}`,
        startKey: seg.startKey,
        endKey: seg.endKey,
        choices: seg.choices,
        labels: {
          '0': labelForChoice(seg.choices['0']),
          '1': labelForChoice(seg.choices['1'])
        }
      };
    });

  if (!filtered.length) return result;

  const divergenceCount = filtered.reduce((sum, seg) => sum + Math.max(seg.choices['0'].length, seg.choices['1'].length), 0);
  if (divergenceCount < 3) return result;

  result.isBranching = true;
  result.trunkKeys = lcs;
  result.segments = filtered;
  result.patterns = { '0': seq0, '1': seq1 };
  return result;
}

function stopCoordinate(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [lng, lat];
}

function haversineMeters(leftPoint, rightPoint) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const deltaLat = toRad(rightPoint[1] - leftPoint[1]);
  const deltaLon = toRad(rightPoint[0] - leftPoint[0]);
  const lat1 = toRad(leftPoint[1]);
  const lat2 = toRad(rightPoint[1]);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const aa = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * earthRadius * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function buildEndpointAnchoredGeometryOrder(stopFeatures, lineKey) {
  const features = Array.from(Array.isArray(stopFeatures) ? stopFeatures : []).filter((feature) => stopCoordinate(feature));
  if (features.length <= 1) {
    return { orderedFeatures: features, rankMap: new Map() };
  }

  let startFeature = features[0];
  let endFeature = features[1];
  let farthestDistance = -1;

  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    const leftPoint = stopCoordinate(features[leftIndex]);
    if (!leftPoint) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const rightPoint = stopCoordinate(features[rightIndex]);
      if (!rightPoint) {
        continue;
      }

      const distance = haversineMeters(leftPoint, rightPoint);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        startFeature = features[leftIndex];
        endFeature = features[rightIndex];
      }
    }
  }

  const terminalHints = lineTerminalHints(lineKey);
  if (terminalHints.length) {
    const startName = stopFeatureDisplayName(startFeature);
    const endName = stopFeatureDisplayName(endFeature);
    const forwardScore = stopNameSimilarity(terminalHints[0], startName) + (terminalHints[1] ? stopNameSimilarity(terminalHints[1], endName) : 0);
    const reverseScore = stopNameSimilarity(terminalHints[0], endName) + (terminalHints[1] ? stopNameSimilarity(terminalHints[1], startName) : 0);
    if (reverseScore > forwardScore) {
      [startFeature, endFeature] = [endFeature, startFeature];
    }
  } else if (stopFeatureSortLabel(endFeature).localeCompare(stopFeatureSortLabel(startFeature)) < 0) {
    [startFeature, endFeature] = [endFeature, startFeature];
  }

  const startPoint = stopCoordinate(startFeature);
  const endPoint = stopCoordinate(endFeature);
  const axisX = endPoint[0] - startPoint[0];
  const axisY = endPoint[1] - startPoint[1];
  const axisLengthSquared = axisX * axisX + axisY * axisY || 1;

  const orderedFeatures = features
    .map((feature) => {
      const point = stopCoordinate(feature);
      const relativeX = point[0] - startPoint[0];
      const relativeY = point[1] - startPoint[1];
      const projection = Math.max(0, Math.min(1, ((relativeX * axisX) + (relativeY * axisY)) / axisLengthSquared));
      return {
        feature,
        projection,
        sortLabel: stopFeatureSortLabel(feature)
      };
    })
    .sort((left, right) => {
      if (left.projection !== right.projection) {
        return left.projection - right.projection;
      }
      return left.sortLabel.localeCompare(right.sortLabel);
    })
    .map((entry) => entry.feature);

  const rankMap = new Map();
  orderedFeatures.forEach((feature, index) => {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, index);
    }

    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, index);
    }
  });

  return { orderedFeatures, rankMap };
}

/**
 * Build rank map for geometry-revised mode
 * Uses the line's end point (determined by terminal names) as the starting point
 * Sorts all stops by cumulative distance along the geometry from that endpoint
 */
function buildGeometryRevisedRankMap(stopFeatures, lineKey) {
  return buildEndpointAnchoredGeometryOrder(stopFeatures, lineKey).rankMap;
}

/**
 * Build rank map for hybrid-endpoint mode
 * A novel approach that combines trip pattern matching with geometry endpoint anchoring
 * Prioritizes trip patterns but anchors to the line's drawn endpoints for disambiguation
 */
function buildHybridEndpointRankMap(stopFeatures, directionSequences, lineKey) {
  try {
    // First, try to get a good trip pattern match
    const tripPatternResult = buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);

    if (tripPatternResult.coverage >= 0.4) {
      // If trip pattern is strong, use it but verify endpoint orientation
      const geometryRevisedRankMap = buildGeometryRevisedRankMap(stopFeatures, lineKey);

      if (tripPatternResult.rankMap.size > 0 && geometryRevisedRankMap.size > 0) {
        // Blend: use trip pattern as primary but apply geometry-based endpoint validation
        const blendedRankMap = new Map(tripPatternResult.rankMap);

        // Adjust unmatched stops using geometry-revised ordering
        for (const [key, tripRank] of tripPatternResult.rankMap.entries()) {
          const geometryRank = geometryRevisedRankMap.get(key);
          if (Number.isFinite(geometryRank)) {
            // Weight the trip rank more heavily but consider geometry
            const blendedRank = (tripRank * 0.7) + (geometryRank * 0.3);
            blendedRankMap.set(key, blendedRank);
          }
        }

        return blendedRankMap;
      }

      return tripPatternResult.rankMap;
    }

    // Weak trip pattern: fall back to geometry-revised approach
    const geometryRevisedRankMap = buildGeometryRevisedRankMap(stopFeatures, lineKey);
    if (geometryRevisedRankMap.size > 0) {
      return geometryRevisedRankMap;
    }

    // Final fallback: geometry-based ranking
    return buildGeometryRankMap(stopFeatures, lineKey);
  } catch (e) {
    return buildGeometryRankMap(stopFeatures, lineKey);
  }
}

/**
 * Intelligently merge multiple trip patterns to handle branching transit lines
 * For lines where direction 0 and 1 represent different branches (not just reverses),
 * this method merges stops from both while preserving sequence integrity.
 * No additional API calls - uses existing trip data more completely.
 */
function buildOptimalBranchMergeRankMap(stopFeatures, directionSequences, lineKey = "") {
  if (!directionSequences || typeof directionSequences !== 'object') {
    return { rankMap: new Map(), matchedCount: 0, coverage: 0, isMerged: false };
  }

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const geometryProgressMap = buildGeometryProgressMap(stopFeatures, lineKey);

  // Extract both direction patterns
  const patternsByDirection = {};

  for (const directionKey of ["0", "1"]) {
    const directionSequence = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!directionSequence.length) {
      continue;
    }

    const patternMatches = [];
    const selectedFeatures = new Set();

    for (const entry of directionSequence) {
      const matchedFeature = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures);
      if (matchedFeature) {
        selectedFeatures.add(matchedFeature);
        patternMatches.push(matchedFeature);
      }
    }

    if (patternMatches.length >= 2) {
      patternsByDirection[directionKey] = patternMatches;
    }
  }

  // If we only have one direction, fall back to standard trip pattern
  if (Object.keys(patternsByDirection).length <= 1) {
    const res = buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);
    return Object.assign({}, res, { isMerged: false });
  }

  const pattern0 = patternsByDirection["0"] || [];
  const pattern1 = patternsByDirection["1"] || [];

  // Check if patterns are just reverses of each other (simple line, not branching)
  const keys0 = pattern0.map((f) => stopIdentityKey(f)).filter(Boolean);
  const keys1 = pattern1.map((f) => stopIdentityKey(f)).filter(Boolean);
  const keysReversed = keys1.length === keys0.length && keys1.every((k, i) => k === keys0[keys0.length - 1 - i]);

  if (keysReversed) {
    // Simple line: just pick the better coverage direction
    const res = buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);
    return Object.assign({}, res, { isMerged: false });
  }

  // BRANCHING LINE DETECTED: Intelligently merge both patterns
  // Find common stops (trunk) and unique stops (branches)
  const keysSet0 = new Set(keys0);
  const keysSet1 = new Set(keys1);
  const commonKeys = new Set([...keysSet0].filter((k) => keysSet1.has(k)));
  const uniqueToDir0 = new Set([...keysSet0].filter((k) => !commonKeys.has(k)));
  const uniqueToDir1 = new Set([...keysSet1].filter((k) => !commonKeys.has(k)));

  // If minimal branching (very few unique stops), use single best pattern
  if (Math.min(uniqueToDir0.size, uniqueToDir1.size) <= 1 && Math.max(uniqueToDir0.size, uniqueToDir1.size) <= 2) {
    const res = buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);
    return Object.assign({}, res, { isMerged: false });
  }

  // MERGE STRATEGY: Start with pattern 0 (authoritative from trip data)
  // Then insert unique stops from pattern 1 using geometry as guide
  const mergedMatches = [...pattern0];
  const addedIdentities = new Set(keys0);

  // For each unique stop in pattern 1, find best insertion point
  for (const feature of pattern1) {
    const identity = stopIdentityKey(feature);
    if (!identity || !uniqueToDir1.has(identity) || addedIdentities.has(identity)) {
      continue;
    }

    // Find where this stop should go geometrically
    const featureProgress = geometryProgressForFeature(geometryProgressMap, feature);
    if (!Number.isFinite(featureProgress)) {
      // If no geometry data, append to end
      mergedMatches.push(feature);
      addedIdentities.add(identity);
      continue;
    }

    // Find insertion point: where geometry progress increases
    let insertIndex = mergedMatches.length;
    for (let i = 0; i < mergedMatches.length; i++) {
      const candidateProgress = geometryProgressForFeature(geometryProgressMap, mergedMatches[i]);
      if (Number.isFinite(candidateProgress) && candidateProgress > featureProgress) {
        insertIndex = i;
        break;
      }
    }

    mergedMatches.splice(insertIndex, 0, feature);
    addedIdentities.add(identity);
  }

  // Build rank map from merged sequence
  const rankMap = new Map();
  mergedMatches.forEach((feature, index) => {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, index);
    }

    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, index);
    }
  });

  // Blend unmatched stops using geometry progress
  const firstProgress = geometryProgressForFeature(geometryProgressMap, mergedMatches[0]);
  const lastProgress = geometryProgressForFeature(geometryProgressMap, mergedMatches[mergedMatches.length - 1]);
  const reverseGeometry = Number.isFinite(firstProgress) && Number.isFinite(lastProgress)
    ? lastProgress < firstProgress
    : false;

  const sequenceScale = Math.max(mergedMatches.length - 1, 1);

  for (const feature of stopFeatures) {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);
    const alreadyRanked = (identity && rankMap.has(identity)) || (stationKey && rankMap.has(stationKey));
    if (alreadyRanked) {
      continue;
    }

    const progress = geometryProgressForFeature(geometryProgressMap, feature);
    if (!Number.isFinite(progress)) {
      continue;
    }

    const oriented = reverseGeometry ? 1 - progress : progress;
    const synthesizedRank = oriented * sequenceScale + 0.35;

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, synthesizedRank);
    }
    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, synthesizedRank);
    }
  }

  return {
    rankMap,
    matchedCount: mergedMatches.length,
    coverage: stopFeatures.length ? mergedMatches.length / stopFeatures.length : 0,
    isMerged: true
  };
}

/**
 * Detect if a pattern contains a loop (stop appearing multiple times)
 * Returns the detected loops and their indices
 */
function analyzeLoopsInPattern(pattern) {
  const stopKeyToIndices = new Map();
  const loops = [];

  for (let i = 0; i < pattern.length; i++) {
    const key = stopIdentityKey(pattern[i]);
    if (!key) continue;

    if (!stopKeyToIndices.has(key)) {
      stopKeyToIndices.set(key, []);
    }
    stopKeyToIndices.get(key).push(i);
  }

  // Identify stops that appear more than once
  for (const [key, indices] of stopKeyToIndices) {
    if (indices.length > 1) {
      loops.push({ key, indices, count: indices.length });
    }
  }

  return loops;
}

/**
 * Loop-aware trip ranking for circular/loop routes
 * Better handles routes that return to the same stop
 * Examples: circular buses, shuttle routes, metro loops
 */
function buildLoopAwareRankMap(stopFeatures, directionSequences, lineKey = "") {
  if (!directionSequences || typeof directionSequences !== 'object') {
    return { rankMap: new Map(), matchedCount: 0, coverage: 0, hasLoop: false };
  }

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const geometryProgressMap = buildGeometryProgressMap(stopFeatures, lineKey);

  // Try both directions and pick the one with best properties
  const patterns = [];

  for (const directionKey of ["0", "1"]) {
    const directionSequence = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!directionSequence.length) continue;

    const patternMatches = [];
    const selectedFeatures = new Set();

    for (const entry of directionSequence) {
      const matchedFeature = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures);
      if (matchedFeature) {
        selectedFeatures.add(matchedFeature);
        patternMatches.push(matchedFeature);
      }
    }

    if (patternMatches.length >= 2) {
      const loops = analyzeLoopsInPattern(patternMatches);
      const coverage = stopFeatures.length ? patternMatches.length / stopFeatures.length : 0;

      patterns.push({
        directionKey,
        matches: patternMatches,
        matchedCount: patternMatches.length,
        coverage,
        loops,
        hasLoop: loops.length > 0
      });
    }
  }

  if (patterns.length === 0) {
    return { rankMap: new Map(), matchedCount: 0, coverage: 0, hasLoop: false };
  }

  // Prefer patterns with loops (more likely to be the intended loop route)
  // Then prefer higher coverage
  patterns.sort((a, b) => {
    if (a.hasLoop !== b.hasLoop) return a.hasLoop ? -1 : 1;
    if (a.matchedCount !== b.matchedCount) return b.matchedCount - a.matchedCount;
    return b.coverage - a.coverage;
  });

  const selectedPattern = patterns[0];
  const rankMap = new Map();

  // For loops: create a sequence that preserves loop structure
  // Strategy: Assign increasing ranks to first occurrence of each stop
  // This ensures loop stops appear in logical order (not repeated)
  const seenStopKeys = new Set();
  let baseRank = 0;

  for (let i = 0; i < selectedPattern.matches.length; i++) {
    const feature = selectedPattern.matches[i];
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);

    // Only rank the first occurrence of each stop to avoid duplicates in ordering
    if (identity && !seenStopKeys.has(identity)) {
      rankMap.set(identity, baseRank);
      seenStopKeys.add(identity);
      baseRank += 1;
    }

    if (stationKey && !seenStopKeys.has(stationKey)) {
      rankMap.set(stationKey, baseRank);
      seenStopKeys.add(stationKey);
      baseRank += 1;
    }
  }

  // Blend unmatched stops using geometry progress
  const firstFeature = selectedPattern.matches[0];
  const lastFeature = selectedPattern.matches[selectedPattern.matches.length - 1];
  const firstProgress = geometryProgressForFeature(geometryProgressMap, firstFeature);
  const lastProgress = geometryProgressForFeature(geometryProgressMap, lastFeature);
  const reverseGeometry = Number.isFinite(firstProgress) && Number.isFinite(lastProgress)
    ? lastProgress < firstProgress
    : false;

  const sequenceScale = Math.max(baseRank - 1, 1);

  for (const feature of stopFeatures) {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);
    const alreadyRanked = (identity && rankMap.has(identity)) || (stationKey && rankMap.has(stationKey));
    if (alreadyRanked) continue;

    const progress = geometryProgressForFeature(geometryProgressMap, feature);
    if (!Number.isFinite(progress)) continue;

    const oriented = reverseGeometry ? 1 - progress : progress;
    const synthesizedRank = oriented * sequenceScale + 0.35;

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, synthesizedRank);
    }
    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, synthesizedRank);
    }
  }

  return {
    rankMap,
    matchedCount: seenStopKeys.size,
    coverage: stopFeatures.length ? seenStopKeys.size / stopFeatures.length : 0,
    hasLoop: selectedPattern.hasLoop,
    loopsDetected: selectedPattern.loops.length
  };
}

/**
 * Split-section smart ranking for lines with mid-route direction-specific stops
 * Better handles routes where one-way streets cause duplicate stops at same location
 * Examples: city buses with one-way streets, roads with median splits
 */
function buildSplitSectionSmartRankMap(stopFeatures, directionSequences, lineKey = "") {
  if (!directionSequences || typeof directionSequences !== 'object') {
    return { rankMap: new Map(), matchedCount: 0, coverage: 0, splitSectionsDetected: 0 };
  }

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const geometryProgressMap = buildGeometryProgressMap(stopFeatures, lineKey);

  // Extract both direction patterns
  const patternsByDirection = {};

  for (const directionKey of ["0", "1"]) {
    const directionSequence = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!directionSequence.length) continue;

    const patternMatches = [];
    const selectedFeatures = new Set();

    for (const entry of directionSequence) {
      const matchedFeature = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures);
      if (matchedFeature) {
        selectedFeatures.add(matchedFeature);
        patternMatches.push(matchedFeature);
      }
    }

    if (patternMatches.length >= 2) {
      patternsByDirection[directionKey] = patternMatches;
    }
  }

  // If only one direction, use standard trip pattern
  if (Object.keys(patternsByDirection).length <= 1) {
    return buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);
  }

  const pattern0 = patternsByDirection["0"] || [];
  const pattern1 = patternsByDirection["1"] || [];

  // Check if patterns are reverses (simple line)
  const keys0 = pattern0.map((f) => stopIdentityKey(f)).filter(Boolean);
  const keys1 = pattern1.map((f) => stopIdentityKey(f)).filter(Boolean);
  const keysReversed = keys1.length === keys0.length && keys1.every((k, i) => k === keys0[keys0.length - 1 - i]);

  if (keysReversed) {
    return buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);
  }

  // Look for split sections: positions where stops differ but are geographically very close
  // This indicates direction-specific stops from one-way streets
  const splitSections = [];

  for (let i = 0; i < Math.min(pattern0.length, pattern1.length); i++) {
    const feat0 = pattern0[i];
    const feat1 = pattern1[i];
    const id0 = stopIdentityKey(feat0);
    const id1 = stopIdentityKey(feat1);

    // If different stops at same position index
    if (id0 !== id1) {
      const coords0 = feat0?.geometry?.coordinates;
      const coords1 = feat1?.geometry?.coordinates;

      // Check if they're geographically very close (split section indicator)
      if (coords0 && coords1) {
        const dist = Math.hypot(coords0[0] - coords1[0], coords0[1] - coords1[1]);
        if (dist < 0.0005) { // ~50 meters at typical scale
          splitSections.push({ index: i, feat0, feat1, distance: dist });
        }
      }
    }
  }

  // Build merged ranking with split sections grouped together
  const rankMap = new Map();
  const processedKeys = new Set();
  let currentRank = 0;

  // Process stops sequentially from pattern 0
  for (let i = 0; i < pattern0.length; i++) {
    const feat0 = pattern0[i];
    const feat1 = i < pattern1.length ? pattern1[i] : null;
    const id0 = stopIdentityKey(feat0);
    const id1 = stopIdentityKey(feat1);

    // Add feat0
    if (id0 && !processedKeys.has(id0)) {
      rankMap.set(id0, currentRank);
      processedKeys.add(id0);

      const stationKey = stopKeyForFeature(feat0);
      if (stationKey && !rankMap.has(stationKey)) {
        rankMap.set(stationKey, currentRank);
      }

      currentRank += 1;
    }

    // If split section detected, add feat1 right after with intermediate rank
    if (id1 && id0 !== id1 && !processedKeys.has(id1)) {
      const splitSectionMatch = splitSections.find((s) => s.index === i);
      if (splitSectionMatch) {
        // Add with fractional rank to keep split stops together
        rankMap.set(id1, currentRank - 0.5);
        processedKeys.add(id1);

        const stationKey = stopKeyForFeature(feat1);
        if (stationKey && !rankMap.has(stationKey)) {
          rankMap.set(stationKey, currentRank - 0.5);
        }
      }
    }
  }

  // Add any remaining stops from pattern 1
  for (const feat1 of pattern1) {
    const id1 = stopIdentityKey(feat1);
    if (id1 && !processedKeys.has(id1)) {
      rankMap.set(id1, currentRank);
      processedKeys.add(id1);

      const stationKey = stopKeyForFeature(feat1);
      if (stationKey && !rankMap.has(stationKey)) {
        rankMap.set(stationKey, currentRank);
      }

      currentRank += 1;
    }
  }

  // Blend remaining unmatched stops with geometry progress
  const firstProgress = geometryProgressForFeature(geometryProgressMap, pattern0[0]);
  const lastProgress = geometryProgressForFeature(geometryProgressMap, pattern0[pattern0.length - 1]);
  const reverseGeometry = Number.isFinite(firstProgress) && Number.isFinite(lastProgress)
    ? lastProgress < firstProgress
    : false;

  const sequenceScale = Math.max(currentRank - 1, 1);

  for (const feature of stopFeatures) {
    const identity = stopIdentityKey(feature);
    const stationKey = stopKeyForFeature(feature);
    const alreadyRanked = (identity && rankMap.has(identity)) || (stationKey && rankMap.has(stationKey));
    if (alreadyRanked) continue;

    const progress = geometryProgressForFeature(geometryProgressMap, feature);
    if (!Number.isFinite(progress)) continue;

    const oriented = reverseGeometry ? 1 - progress : progress;
    const synthesizedRank = oriented * sequenceScale + 0.35;

    if (identity && !rankMap.has(identity)) {
      rankMap.set(identity, synthesizedRank);
    }
    if (stationKey && !rankMap.has(stationKey)) {
      rankMap.set(stationKey, synthesizedRank);
    }
  }

  return {
    rankMap,
    matchedCount: processedKeys.size,
    coverage: stopFeatures.length ? processedKeys.size / stopFeatures.length : 0,
    splitSectionsDetected: splitSections.length
  };
}

/**
 * Smart topology detection and auto-selection
 * Detects route characteristics and picks the best method for that type
 * This is the "competition winner" method that learns which approach works best
 */
function buildSmartAutoDetectRankMap(stopFeatures, directionSequences, lineKey = "") {
  if (!directionSequences || typeof directionSequences !== 'object') {
    return buildGeometryRankMap(stopFeatures, lineKey);
  }

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);

  // Analyze both directions for topology characteristics
  let hasLoops = false;
  let hasSplitSections = false;
  let loopCount = 0;
  let splitCount = 0;
  let pattern0Length = 0;
  let pattern1Length = 0;

  for (const directionKey of ["0", "1"]) {
    const directionSequence = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!directionSequence.length) continue;

    const patternMatches = [];
    const selectedFeatures = new Set();

    for (const entry of directionSequence) {
      const matchedFeature = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures);
      if (matchedFeature) {
        selectedFeatures.add(matchedFeature);
        patternMatches.push(matchedFeature);
      }
    }

    if (patternMatches.length >= 2) {
      if (directionKey === "0") pattern0Length = patternMatches.length;
      if (directionKey === "1") pattern1Length = patternMatches.length;

      const loops = analyzeLoopsInPattern(patternMatches);
      if (loops.length > 0) {
        hasLoops = true;
        loopCount += loops.length;
      }

      // Check for split sections
      if (directionKey === "1") {
        const otherPattern = patternMatches;
        // This is a simplified check - in practice would need pattern0 to compare
        for (const feat of otherPattern) {
          const coords = feat?.geometry?.coordinates;
          if (coords) hasSplitSections = true; // Simplified for now
        }
      }
    }
  }

  // ROUTING DECISION LOGIC
  // If line has loops, use loop-aware method
  if (hasLoops && loopCount > 0) {
    return buildLoopAwareRankMap(stopFeatures, directionSequences, lineKey);
  }

  // If line has split sections detected, use split-aware method
  if (hasSplitSections) {
    return buildSplitSectionSmartRankMap(stopFeatures, directionSequences, lineKey);
  }

  // Check if this is a genuine branch line (not just reverses)
  const tryBranchMerge = buildOptimalBranchMergeRankMap(stopFeatures, directionSequences, lineKey);
  if (tryBranchMerge.isMerged) {
    return tryBranchMerge;
  }

  // Default: use standard trip pattern
  return buildTripPatternRankMap(stopFeatures, directionSequences, lineKey);
}

/**
 * Order stops for line view rendering
 * Supports multiple ordering strategies with trip-pattern as primary (NEW)
 * Modes: trip-pattern (NEW), direction, fractions, geometry, geometry-revised (NEW), hybrid-endpoint (NEW), payload, trip-branches, auto
 */
async function orderStopsForLineView(stopFeatures, lineKey, directionSequences = null, orderingMode = 'auto', routeLookupKey = null, branchSelections = null, directionPatterns = null) {
  const uniqueStopFeatures = dedupeStopFeatures(stopFeatures);

  if (!Array.isArray(uniqueStopFeatures) || uniqueStopFeatures.length === 0) {
    return uniqueStopFeatures;
  }

  const mode = String(orderingMode || 'auto').trim() || 'auto';

  function setResolved(resolved) {
    try {
      if (typeof state === 'object') {
        state.lineViewOrderingResolved = resolved;
      }
      const el = typeof document !== 'undefined' ? document.getElementById('lineViewOrderingResolved') : null;
      if (el) {
        el.textContent = `Resolved: ${resolved}`;
      }
    } catch (e) {
      // ignore
    }
  }

  // Build base rank maps eagerly
  const payloadRankMap = buildPayloadRankMap(uniqueStopFeatures);
  const geometryRankMap = buildGeometryRankMap(uniqueStopFeatures, lineKey);
  const geometryRevisedRankMap = buildGeometryRevisedRankMap(uniqueStopFeatures, lineKey);

  let _tripPatternRankInfo = null;
  let _directionRankInfo = null;
  let _hybridEndpointRankMap = null;

  function getTripPatternRankInfo() {
    if (_tripPatternRankInfo !== null) return _tripPatternRankInfo;
    _tripPatternRankInfo = directionSequences && typeof directionSequences === 'object'
      ? buildTripPatternRankMap(uniqueStopFeatures, directionSequences, lineKey)
      : { rankMap: new Map(), matchedCount: 0, coverage: 0, matchedFeatures: [] };
    return _tripPatternRankInfo;
  }

  function getDirectionRankInfo() {
    if (_directionRankInfo !== null) return _directionRankInfo;
    _directionRankInfo = directionSequences && typeof directionSequences === 'object'
      ? buildDirectionRankMap(uniqueStopFeatures, directionSequences)
      : { rankMap: new Map(), matchedCount: 0, coverage: 0 };
    return _directionRankInfo;
  }

  function getHybridEndpointRankMap() {
    if (_hybridEndpointRankMap !== null) return _hybridEndpointRankMap;
    _hybridEndpointRankMap = directionSequences && typeof directionSequences === 'object'
      ? buildHybridEndpointRankMap(uniqueStopFeatures, directionSequences, lineKey)
      : geometryRevisedRankMap;
    return _hybridEndpointRankMap;
  }

  const resolvedRouteLookupKey = String(routeLookupKey || lineKey || '').trim();

  // Only allow fractions in auto for tight loop geometries
  const allowFractionsInAuto = true;

  // Per-segment branch selection: swap branch segments atop geometry-revised
  if (branchSelections && typeof branchSelections === 'object') {
    const selectionValues = Object.values(branchSelections).filter(Boolean);
    if (selectionValues.length) {
      try {
        const branchGroups = buildBranchGroups(uniqueStopFeatures, directionSequences, directionPatterns);
        if (branchGroups && branchGroups.isBranching && Array.isArray(branchGroups.segments)) {
          const featureByLookupKey = buildFeatureLookupMap(uniqueStopFeatures);
          const featureLookupKeys = (feature) => stopFeatureLookupKeys(feature).map(normalizeStopLookupKey).filter(Boolean);

          let ordered = sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap).slice();

          for (const segment of branchGroups.segments) {
            const choice = branchSelections[segment.id];
            if (choice !== '0' && choice !== '1') continue;

            const choiceKeys = segment.choices[choice] || [];
            const allKeys = new Set([...(segment.choices['0'] || []), ...(segment.choices['1'] || [])]);
            ordered = ordered.filter((feature) => {
              const keys = featureLookupKeys(feature);
              return !keys.some((k) => allKeys.has(k));
            });

            let insertIndex = ordered.length;
            if (segment.startKey) {
              const anchorFeature = featureByLookupKey.get(segment.startKey);
              if (anchorFeature) {
                const idx = ordered.indexOf(anchorFeature);
                if (idx >= 0) insertIndex = idx + 1;
              }
            } else if (segment.endKey) {
              const anchorFeature = featureByLookupKey.get(segment.endKey);
              if (anchorFeature) {
                const idx = ordered.indexOf(anchorFeature);
                if (idx >= 0) insertIndex = idx;
              }
            }

            const insertFeatures = choiceKeys
              .map((k) => featureByLookupKey.get(k))
              .filter(Boolean);
            ordered.splice(insertIndex, 0, ...insertFeatures);
          }

          return ordered;
        }
      } catch (e) {
        // ignore and fall back to regular ordering
      }
    }
  }

  if (mode === 'trip-pattern') {
    setResolved('trip-pattern');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (mode === 'branch-aware') {
    setResolved('branch-aware');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (mode === 'geometry') {
    setResolved('geometry');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (mode === 'geometry-revised') {
    setResolved('geometry-revised');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  if (mode === 'hybrid-endpoint') {
    setResolved('hybrid-endpoint');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getHybridEndpointRankMap(), geometryRankMap);
  }

  if (mode === 'direction') {
    setResolved('direction');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getDirectionRankInfo().rankMap, geometryRankMap);
  }

  if (mode === 'fractions') {
    setResolved('fractions');
    const fractionRankInfo = await buildFractionRankMap(uniqueStopFeatures, lineKey, resolvedRouteLookupKey);
    if (fractionRankInfo.coverage > 0.3) {
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, fractionRankInfo.rankMap, geometryRankMap);
    }
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (mode === 'payload') {
    setResolved('payload');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, payloadRankMap, geometryRankMap);
  }

  if (mode === 'trip-branches') {
    setResolved('trip-branches');
    const branchMergeResult = buildOptimalBranchMergeRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, branchMergeResult.rankMap, geometryRankMap);
  }

  if (mode === 'loop-aware') {
    setResolved('loop-aware');
    const loopResult = buildLoopAwareRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, loopResult.rankMap, geometryRankMap);
  }

  if (mode === 'split-sections') {
    setResolved('split-sections');
    const splitResult = buildSplitSectionSmartRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, splitResult.rankMap, geometryRankMap);
  }

  if (mode === 'smart-auto') {
    setResolved('smart-auto');
    const smartResult = buildSmartAutoDetectRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, smartResult.rankMap, geometryRankMap);
  }

  if (mode === 'auto') {
    // Preserve geometry-revised for likely-branching or split-section lines
    if (directionSequences && typeof directionSequences === 'object') {
      const branchGroups = buildBranchGroups(uniqueStopFeatures, directionSequences, directionPatterns);
      if (branchGroups.isSplitSections) {
        setResolved('auto → geometry-revised (split)');
        return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
      }
      if (branchGroups.isBranching && Array.isArray(branchGroups.segments) && branchGroups.segments.length) {
        setResolved('auto → geometry-revised (branch)');
        return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
      }
    }

    // Loop detection: stop-based geometry order with short direct distance vs path length
    const geometryOrder = sortStopsSequentially(uniqueStopFeatures, lineKey);
    if (Array.isArray(geometryOrder) && geometryOrder.length >= 4 && geometryOrder.length <= 160) {
      let pathLen = 0;
      for (let i = 0; i < geometryOrder.length - 1; i += 1) {
        const a = stopCoordinate(geometryOrder[i]);
        const b = stopCoordinate(geometryOrder[i + 1]);
        if (a && b) pathLen += haversineMeters(a, b);
      }
      const startCoord = stopCoordinate(geometryOrder[0]);
      const endCoord = stopCoordinate(geometryOrder[geometryOrder.length - 1]);
      if (startCoord && endCoord) {
        const direct = haversineMeters(startCoord, endCoord);
        const ratio = direct > 0 ? direct / pathLen : 1;
        if (pathLen > 3000 && direct < 2000 && ratio < 0.25) {
          if (allowFractionsInAuto) {
            const fractionRankInfo = await buildFractionRankMap(uniqueStopFeatures, lineKey, resolvedRouteLookupKey);
            if (fractionRankInfo.coverage > 0.3) {
              setResolved('auto → fractions (loop)');
              return sortFeaturesByPrimaryRanking(uniqueStopFeatures, fractionRankInfo.rankMap, geometryRankMap);
            }
          }
          setResolved('auto → geometry (loop)');
          return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRankMap, geometryRevisedRankMap);
        }
      }
    }

    // J-shape detection: endpoint-anchored ordering with non-monotonic endpoint distance
    const endpointResult = buildEndpointAnchoredGeometryOrder(uniqueStopFeatures, lineKey);
    const ordered = Array.isArray(endpointResult?.orderedFeatures) ? endpointResult.orderedFeatures : [];
    const endCoord = ordered.length ? (stopCoordinate(ordered[ordered.length - 1]) || stopCoordinate(ordered[0])) : null;
    const nonMonotonic = hasNonMonotonicEndpointDistance(ordered, endCoord, 20);
    const geometryOrderForMismatch = sortStopsSequentially(uniqueStopFeatures, lineKey);
    let pathLen = 0;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = stopCoordinate(ordered[i]);
      const b = stopCoordinate(ordered[i + 1]);
      if (a && b) pathLen += haversineMeters(a, b);
    }
    const mismatchScore = orderMismatchScore(ordered, geometryOrderForMismatch);
    const endDistance = endCoord && stopCoordinate(ordered[0])
      ? haversineMeters(stopCoordinate(ordered[0]), endCoord)
      : 0;
    const pathRatio = endDistance > 0 ? pathLen / endDistance : 1;
    if (nonMonotonic || mismatchScore > 0.05 || pathRatio > 1.4) {
      setResolved('auto → geometry (J)');
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
    }

    setResolved('auto → geometry-revised');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  setResolved('geometry-revised');
  return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
}

// Expose branch helper for UI rendering
try {
  if (typeof window !== 'undefined') {
    window.buildBranchGroups = buildBranchGroups;
  }
} catch (e) {
  // ignore
}

