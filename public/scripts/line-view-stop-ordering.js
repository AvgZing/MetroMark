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

// Export functions for Node-based testing harness (file-level)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    orderStopsForLineView,
    buildEndpointAnchoredGeometryOrder,
    buildPolylineProjectedRankMap,
    buildOptimalBranchMergeRankMap,
    buildBranchGroups,
    buildLoopAwareRankMap,
    buildSplitSectionSmartRankMap,
    buildSmartAutoDetectRankMap
  };
}

// Also attach to global for test harness convenience
try {
  if (typeof global !== 'undefined') {
    global._lineOrdering = global._lineOrdering || {};
    Object.assign(global._lineOrdering, {
      orderStopsForLineView,
      buildEndpointAnchoredGeometryOrder,
      buildPolylineProjectedRankMap,
      buildOptimalBranchMergeRankMap,
      buildBranchGroups,
      buildLoopAwareRankMap,
      buildSplitSectionSmartRankMap,
      buildSmartAutoDetectRankMap
    });
  }
} catch (e) {
  // ignore
}

// Expose branch helper to window for UI to consume
try {
  if (typeof window !== 'undefined') {
    window.buildBranchGroups = buildBranchGroups;
  }
} catch (e) {}

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

// Cache for projected route computations keyed by lineKey to reduce repeated work
const _polylineProjectionCache = new Map();

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

function matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selectedFeatures) {
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

  return bestScore >= 0.67 ? best : null;
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
 * Build rank map by projecting stops onto the route polyline, preserving route direction
 * This is a new, non-destructive mode that complements the existing endpoint-anchored method
 * - Handles J-shaped routes by using the real route polyline
 * - Detects looped geometries and falls back to sequential ordering for loops
 */
function buildPolylineProjectedRankMap(stopFeatures, lineKey) {
  const features = Array.from(Array.isArray(stopFeatures) ? stopFeatures : []).filter((f) => stopCoordinate(f));
  if (features.length <= 1) return { rankMap: new Map(), orderedFeatures: features };

  const routeCoords = routeGeometryCoordinatesForLine(lineKey);
  if (!Array.isArray(routeCoords) || routeCoords.length < 2) {
    // No route geometry: fall back to endpoint-anchored ordering
    return buildEndpointAnchoredGeometryOrder(features, lineKey);
  }

  // Detect loop: if route start and end are close treat as loop and use sequential ordering
  try {
    const start = routeCoords[0];
    const end = routeCoords[routeCoords.length - 1];
    if (haversineMeters(start, end) < 100) {
      const ordered = sortStopsSequentially(features, lineKey);
      const rankMap = new Map();
      ordered.forEach((feature, i) => {
        const id = stopIdentityKey(feature);
        const sk = stopKeyForFeature(feature);
        if (id && !rankMap.has(id)) rankMap.set(id, i);
        if (sk && !rankMap.has(sk)) rankMap.set(sk, i);
      });
      return { rankMap, orderedFeatures: ordered };
    }
  } catch (e) {
    // ignore and continue
  }

  // Reuse cached projection information if available
  let segLengths, cumLengths, totalLen;
  if (_polylineProjectionCache.has(lineKey)) {
    ({ segLengths, cumLengths, totalLen } = _polylineProjectionCache.get(lineKey));
  } else {
    segLengths = [];
    cumLengths = [0];
    totalLen = 0;
    for (let i = 0; i < routeCoords.length - 1; i += 1) {
      const a = routeCoords[i];
      const b = routeCoords[i + 1];
      const d = haversineMeters(a, b);
      segLengths.push(d);
      totalLen += d;
      cumLengths.push(totalLen);
    }
    _polylineProjectionCache.set(lineKey, { segLengths, cumLengths, totalLen });
  }

  function projectPointToRoute(point) {
    let bestDist = Infinity;
    let bestAlong = 0;
    const coords = routeCoords;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const a = coords[i];
      const b = coords[i + 1];
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const wx = point[0] - a[0];
      const wy = point[1] - a[1];
      const segLen2 = vx * vx + vy * vy || 1e-12;
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / segLen2));
      const proj = [a[0] + t * vx, a[1] + t * vy];
      const d = haversineMeters(point, proj);
      if (d < bestDist) {
        bestDist = d;
        const along = cumLengths[i] + (t * segLengths[i]);
        bestAlong = along;
      }
    }
    return totalLen > 0 ? bestAlong / totalLen : 0;
  }

  // Project stops and sort by projected fraction
  const projected = features.map((f) => ({ feature: f, frac: projectPointToRoute(stopCoordinate(f)), label: stopFeatureSortLabel(f) }));

  // Orientation: try to align with terminal hints if available
  const terminalHints = lineTerminalHints(lineKey);
  if (terminalHints.length) {
    const startSample = projected.reduce((best, cur) => (cur.frac < best.frac ? cur : best), projected[0]);
    const endSample = projected.reduce((best, cur) => (cur.frac > best.frac ? cur : best), projected[0]);
    const sName = stopFeatureDisplayName(startSample.feature);
    const eName = stopFeatureDisplayName(endSample.feature);
    const forwardScore = stopNameSimilarity(terminalHints[0], sName) + (terminalHints[1] ? stopNameSimilarity(terminalHints[1], eName) : 0);
    const reverseScore = stopNameSimilarity(terminalHints[0], eName) + (terminalHints[1] ? stopNameSimilarity(terminalHints[1], sName) : 0);
    if (reverseScore > forwardScore) projected.forEach((p) => { p.frac = 1 - p.frac; });
  }

  const orderedFeatures = projected.sort((a, b) => (a.frac !== b.frac ? a.frac - b.frac : a.label.localeCompare(b.label))).map((p) => p.feature);
  const rankMap = new Map();
  orderedFeatures.forEach((feature, i) => {
    const id = stopIdentityKey(feature);
    const sk = stopKeyForFeature(feature);
    if (id && !rankMap.has(id)) rankMap.set(id, i);
    if (sk && !rankMap.has(sk)) rankMap.set(sk, i);
  });

  return { rankMap, orderedFeatures };
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
 * Detect J-shaped geometry: endpoint-anchored projection will be non-monotonic
 * Returns true when distances to the chosen endpoint decrease then increase
 */
function detectJShape(stopFeatures, lineKey) {
  try {
    const result = buildEndpointAnchoredGeometryOrder(stopFeatures, lineKey);
    const ordered = Array.isArray(result.orderedFeatures) ? result.orderedFeatures : [];
    if (ordered.length <= 2) return false;

    const endFeature = ordered[ordered.length - 1];
    const endCoord = stopCoordinate(endFeature);
    if (!endCoord) return false;

    const dists = ordered.map((f) => {
      const c = stopCoordinate(f);
      return c ? haversineMeters(c, endCoord) : Number.POSITIVE_INFINITY;
    });

    // Allow small noise (meters)
    const eps = 20;
    // Detect a decrease after an increase (non-monotonic)
    let sawIncrease = false;
    for (let i = 1; i < dists.length; i += 1) {
      if (dists[i] > dists[i - 1] + eps) {
        sawIncrease = true;
      }
      if (sawIncrease && dists[i] < dists[i - 1] - eps) {
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Find contiguous non-monotonic segments in endpoint-anchored ordering
 * Returns array of { start, end } indices in the orderedFeatures array
 */
function findNonMonotonicSegments(orderedFeatures, endCoord, eps = 20) {
  const dists = orderedFeatures.map((f) => {
    const c = stopCoordinate(f);
    return c ? haversineMeters(c, endCoord) : Number.POSITIVE_INFINITY;
  });

  const segments = [];
  let i = 1;
  while (i < dists.length) {
    // detect a drop after a rise
    if (dists[i] < dists[i - 1] - eps) {
      // start of non-monotonic region: go back to where it first rose
      let start = i - 1;
      while (start > 0 && dists[start] >= dists[start - 1] - eps) start -= 1;
      let end = i;
      while (end + 1 < dists.length && dists[end + 1] < dists[end] - eps) end += 1;
      segments.push({ start, end });
      i = end + 1;
    } else {
      i += 1;
    }
  }

  return segments;
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
 * Build branch groups for UI: returns trunk keys and branches with matched features
 */
function buildBranchGroups(stopFeatures, directionSequences, lineKey = "") {
  const result = { isBranching: false, trunkKeys: [], branches: [] };
  if (!directionSequences || typeof directionSequences !== 'object') return result;

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const patterns = {};
  for (const directionKey of ['0','1']) {
    const seq = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!seq.length) continue;
    const matches = [];
    const selected = new Set();
    for (const entry of seq) {
      const f = matchSequenceFeature(entry, stopFeatures, featureByLookupKey, selected);
      if (f) { selected.add(f); matches.push(f); }
    }
    if (matches.length >= 2) patterns[directionKey] = matches;
  }

  if (Object.keys(patterns).length <= 1) return result;

  const p0 = patterns['0'] || [];
  const p1 = patterns['1'] || [];
  const keys0 = p0.map((f) => stopIdentityKey(f)).filter(Boolean);
  const keys1 = p1.map((f) => stopIdentityKey(f)).filter(Boolean);
  const common = new Set([...keys0].filter((k) => keys1.includes(k)));
  if (common.size === 0) return result;

  result.isBranching = true;
  result.trunkKeys = Array.from(common);
  // Build branches as unique sequences for each direction
  const uniq0 = p0.filter((f) => !common.has(stopIdentityKey(f)));
  const uniq1 = p1.filter((f) => !common.has(stopIdentityKey(f)));
  result.branches.push({ direction: '0', matches: p0, unique: uniq0 });
  result.branches.push({ direction: '1', matches: p1, unique: uniq1 });
  return result;
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
async function orderStopsForLineView(stopFeatures, lineKey, directionSequences = null, orderingMode = 'auto', routeLookupKey = null, branchSelection = null) {
  const uniqueStopFeatures = dedupeStopFeatures(stopFeatures);

  if (!Array.isArray(uniqueStopFeatures) || uniqueStopFeatures.length === 0) {
    return uniqueStopFeatures;
  }

  // Build cheap rank maps eagerly; expensive/trip-based maps are computed lazily to avoid lag
  const payloadRankMap = buildPayloadRankMap(uniqueStopFeatures);
  const geometryRankMap = buildGeometryRankMap(uniqueStopFeatures, lineKey);
  const geometryRevisedRankMap = buildGeometryRevisedRankMap(uniqueStopFeatures, lineKey);

  let _tripPatternRankInfo = null;
  let _directionRankInfo = null;
  let _hybridEndpointRankMap = null;

  function getTripPatternRankInfo() {
    if (_tripPatternRankInfo !== null) return _tripPatternRankInfo;
    _tripPatternRankInfo = (directionSequences && typeof directionSequences === 'object')
      ? buildTripPatternRankMap(uniqueStopFeatures, directionSequences, lineKey)
      : { rankMap: new Map(), matchedCount: 0, coverage: 0 };
    return _tripPatternRankInfo;
  }

  function getDirectionRankInfo() {
    if (_directionRankInfo !== null) return _directionRankInfo;
    _directionRankInfo = (directionSequences && typeof directionSequences === 'object')
      ? buildDirectionRankMap(uniqueStopFeatures, directionSequences)
      : { rankMap: new Map(), matchedCount: 0, coverage: 0 };
    return _directionRankInfo;
  }

  function getHybridEndpointRankMap() {
    if (_hybridEndpointRankMap !== null) return _hybridEndpointRankMap;
    _hybridEndpointRankMap = (directionSequences && typeof directionSequences === 'object')
      ? buildHybridEndpointRankMap(uniqueStopFeatures, directionSequences, lineKey)
      : geometryRevisedRankMap;
    return _hybridEndpointRankMap;
  }

  // Delay fraction requests so auto mode does not issue extra failing network calls.
  const resolvedRouteLookupKey = String(routeLookupKey || lineKey || '').trim();

  // If caller requested a specific branch segment, construct a baseline geometry-revised
  // ordering and then substitute the selected branch's unique stops using trip-pattern
  // matched ordering. This swaps only branch segments, preserving baseline elsewhere.
  if (branchSelection) {
    try {
      const branchGroups = buildBranchGroups(uniqueStopFeatures, directionSequences, lineKey);
      const branch = branchGroups && Array.isArray(branchGroups.branches)
        ? branchGroups.branches.find((b) => String(b.direction) === String(branchSelection))
        : null;
      if (branch && branch.unique && branch.unique.length) {
        // base ordering is geometry-revised
        const baseOrdered = sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap).map((r) => r.feature || r);

        // map identities
        const trunkSet = new Set((branchGroups.trunkKeys || []).filter(Boolean));

        // determine insertion point: find first unique in baseOrdered and previous trunk index
        const uniqueIds = branch.unique.map((f) => stopIdentityKey(f) || stopKeyForFeature(f)).filter(Boolean);
        let firstUniqueIdx = -1;
        for (let i = 0; i < baseOrdered.length; i += 1) {
          const k = stopIdentityKey(baseOrdered[i]) || stopKeyForFeature(baseOrdered[i]);
          if (k && uniqueIds.includes(k)) { firstUniqueIdx = i; break; }
        }

        let insertAfter = -1;
        if (firstUniqueIdx > 0) {
          for (let j = firstUniqueIdx - 1; j >= 0; j -= 1) {
            const k = stopIdentityKey(baseOrdered[j]) || stopKeyForFeature(baseOrdered[j]);
            if (trunkSet.has(k)) { insertAfter = j; break; }
          }
        }
        if (insertAfter === -1) insertAfter = baseOrdered.length - 1;

        // Determine replacement sequence using matched order where possible
        const matchedOrder = (branch.matches || []).map((f) => stopIdentityKey(f) || stopKeyForFeature(f)).filter(Boolean);
        const selectedUnique = branch.unique.slice().sort((a, b) => matchedOrder.indexOf(stopIdentityKey(a) || stopKeyForFeature(a)) - matchedOrder.indexOf(stopIdentityKey(b) || stopKeyForFeature(b)));

        // Determine other branches' unique stops to move out of the trunk area
        const otherUniqueKeys = new Set();
        for (const b of (branchGroups.branches || [])) {
          if (String(b.direction) === String(branchSelection)) continue;
          for (const u of (b.unique || [])) {
            const k = stopIdentityKey(u) || stopKeyForFeature(u);
            if (k) otherUniqueKeys.add(k);
          }
        }

        // Remove selectedUnique and other branch uniques from baseOrdered, then insert selectedUnique after insertAfter and append other uniques at end
        const removedKeys = new Set([...selectedUnique.map((f) => stopIdentityKey(f) || stopKeyForFeature(f)).filter(Boolean), ...Array.from(otherUniqueKeys)]);
        const cleaned = baseOrdered.filter((f) => !removedKeys.has(stopIdentityKey(f) || stopKeyForFeature(f)));
        const head = cleaned.slice(0, insertAfter + 1);
        const tail = cleaned.slice(insertAfter + 1);

        // Append selectedUnique next, then append other unique stops (in their matched order if possible)
        const otherUniquesOrdered = [];
        for (const b of (branchGroups.branches || [])) {
          if (String(b.direction) === String(branchSelection)) continue;
          const matched = (b.matches || []).map((f) => stopIdentityKey(f) || stopKeyForFeature(f)).filter(Boolean);
          for (const u of (b.unique || [])) {
            const k = stopIdentityKey(u) || stopKeyForFeature(u);
            if (k && otherUniqueKeys.has(k)) {
              // try to order by matched sequence
              const idx = matched.indexOf(k);
              otherUniquesOrdered.push({ idx: idx < 0 ? 9999 : idx, feature: u });
            }
          }
        }
        otherUniquesOrdered.sort((a, b) => a.idx - b.idx);
        const otherFeatures = otherUniquesOrdered.map((e) => e.feature);

        const finalOrdered = head.concat(selectedUnique, tail, otherFeatures);
        return finalOrdered;
      }
    } catch (e) {
      // ignore and continue with normal processing
    }
  }

  // Handle explicit mode selections
  if (orderingMode === 'trip-pattern') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (orderingMode === 'branch-aware') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (orderingMode === 'geometry') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (orderingMode === 'geometry-revised') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  if (orderingMode === 'geometry-projected') {
    const projected = buildPolylineProjectedRankMap(uniqueStopFeatures, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, projected.rankMap, geometryRankMap);
  }

  if (orderingMode === 'geometry-smart') {
    // Default: geometry-revised (preserve baseline behavior for branching and common cases)
    const geom = geometryRevisedRankMap;

    // If we have direction/trip data, check for branching first. If branching is present,
    // KEEP the baseline geometry-revised behavior because it handles branching and split streets well.
    if (directionSequences && typeof directionSequences === 'object') {
      try {
        const branchCheck = buildOptimalBranchMergeRankMap(uniqueStopFeatures, directionSequences, lineKey);
        if (typeof global !== 'undefined' && global.__ORDERING_DEBUG) {
          try { console.log('DEBUG branchCheck:', branchCheck && { isMerged: branchCheck.isMerged, coverage: branchCheck.coverage }); } catch (e) {}
        }
        if (branchCheck && branchCheck.isMerged) {
          return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geom, geometryRankMap);
        }
      } catch (e) {
        // ignore and continue
      }
    }

    // Loop detection via route geometry: if the drawn route is a loop (start/end close), prefer hybrid-endpoint
    const routeCoords = routeGeometryCoordinatesForLine(lineKey);
    if (Array.isArray(routeCoords) && routeCoords.length >= 2) {
      try {
        const routeStart = routeCoords[0];
        const routeEnd = routeCoords[routeCoords.length - 1];
        if (haversineMeters(routeStart, routeEnd) < 100) {
          // Hybrid endpoint anchor handles loops better
          return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getHybridEndpointRankMap(), geometryRankMap);
        }
      } catch (e) {
        // ignore geometry errors
      }
    }

    // J-shaped detection and localized correction: detect non-monotonic segments in
    // endpoint-anchored ordering and *only* reorder those segments using trip-pattern,
    // direction, or projected geometry as fallbacks. This preserves baseline behavior
    // for branching and split-street routes and avoids global replacements that regress.
    try {
      const endpointResult = buildEndpointAnchoredGeometryOrder(uniqueStopFeatures, lineKey);
      const ordered = Array.isArray(endpointResult?.orderedFeatures) ? endpointResult.orderedFeatures : [];
      if (ordered.length > 1) {
        const endCoord = stopCoordinate(ordered[ordered.length - 1]) || stopCoordinate(ordered[0]);
        const segments = findNonMonotonicSegments(ordered, endCoord, 20);
        if (typeof global !== 'undefined' && global.__ORDERING_DEBUG) {
          try { console.log('DEBUG non-monotonic segments:', segments); } catch (e) {}
        }
        if (segments.length === 0) {
          // No J-shaped non-monotonic regions detected — keep baseline geometry-revised
          return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geom, geometryRankMap);
        }

        // Build a mutable copy and replace each non-monotonic segment with a safer ordering
        const replaced = ordered.slice();
        for (const seg of segments) {
          const slice = ordered.slice(seg.start, seg.end + 1);

          // Attempt to order slice by trip-pattern if coverage is good
          let replacement = null;
          const _tpi = getTripPatternRankInfo();
          if (_tpi && _tpi.coverage >= 0.2 && Array.isArray(_tpi.matchedFeatures) && _tpi.matchedFeatures.length) {
            // Prefer the actual matched trip pattern ordering (stable) for stops that appear in the matched pattern
            const matchedOrder = _tpi.matchedFeatures.map((f) => stopIdentityKey(f) || stopKeyForFeature(f)).filter(Boolean);
            const inPattern = [];
            const notInPattern = [];
            for (const s of slice) {
              const k = stopIdentityKey(s) || stopKeyForFeature(s);
              if (k && matchedOrder.includes(k)) inPattern.push(s);
              else notInPattern.push(s);
            }
            // Order inPattern by their index in matchedOrder
            inPattern.sort((a, b) => matchedOrder.indexOf(stopIdentityKey(a) || stopKeyForFeature(a)) - matchedOrder.indexOf(stopIdentityKey(b) || stopKeyForFeature(b)));
            // Order remaining by geometry projection as a stable fallback
            const projFallback = buildPolylineProjectedRankMap(notInPattern, lineKey).orderedFeatures || notInPattern;
            replacement = [...inPattern, ...projFallback];
          }

          // Otherwise try direction sequences
          const _dri = getDirectionRankInfo();
          if (!replacement && _dri && _dri.coverage >= 0.2 && _dri.rankMap) {
            replacement = slice.slice().sort((a, b) => {
              const aKey = stopIdentityKey(a) || stopKeyForFeature(a);
              const bKey = stopIdentityKey(b) || stopKeyForFeature(b);
              const aRank = _dri.rankMap.has(aKey) ? _dri.rankMap.get(aKey) : Number.POSITIVE_INFINITY;
              const bRank = _dri.rankMap.has(bKey) ? _dri.rankMap.get(bKey) : Number.POSITIVE_INFINITY;
              return aRank - bRank || stopFeatureSortLabel(a).localeCompare(stopFeatureSortLabel(b));
            });
          }

          // Otherwise fallback to projected polyline ordering for this slice only
          if (!replacement) {
            try {
              const projected = buildPolylineProjectedRankMap(slice, lineKey);
              replacement = Array.isArray(projected.orderedFeatures) && projected.orderedFeatures.length ? projected.orderedFeatures : slice;
            } catch (e) {
              replacement = slice;
            }
          }

          // Replace in the mutable array
          for (let k = 0; k < replacement.length; k += 1) {
            replaced[seg.start + k] = replacement[k];
          }
        }

        // Build rank map from the replaced ordering and return
        const newRankMap = new Map();
        replaced.forEach((feature, i) => {
          const id = stopIdentityKey(feature);
          const sk = stopKeyForFeature(feature);
          if (id && !newRankMap.has(id)) newRankMap.set(id, i);
          if (sk && !newRankMap.has(sk)) newRankMap.set(sk, i);
        });
        return sortFeaturesByPrimaryRanking(uniqueStopFeatures, newRankMap, geometryRankMap);
      }
    } catch (e) {
      // If anything goes wrong, fall back to baseline
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geom, geometryRankMap);
    }

    // Default: use geometry-revised baseline
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geom, geometryRankMap);
  }

  if (orderingMode === 'hybrid-endpoint') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getHybridEndpointRankMap(), geometryRankMap);
  }

  if (orderingMode === 'direction') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getDirectionRankInfo().rankMap, geometryRankMap);
  }

  if (orderingMode === 'fractions') {
    const fractionRankInfo = await buildFractionRankMap(uniqueStopFeatures, lineKey, resolvedRouteLookupKey);
    if (fractionRankInfo.coverage > 0.3) {
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, fractionRankInfo.rankMap, geometryRankMap);
    }
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
  }

  if (orderingMode === 'payload') {
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, payloadRankMap, geometryRankMap);
  }

  if (orderingMode === 'trip-branches') {
    const branchMergeResult = buildOptimalBranchMergeRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, branchMergeResult.rankMap, geometryRankMap);
  }

  if (orderingMode === 'loop-aware') {
    const loopResult = buildLoopAwareRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, loopResult.rankMap, geometryRankMap);
  }

  if (orderingMode === 'split-sections') {
    const splitResult = buildSplitSectionSmartRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, splitResult.rankMap, geometryRankMap);
  }

  if (orderingMode === 'smart-auto') {
    const smartResult = buildSmartAutoDetectRankMap(uniqueStopFeatures, directionSequences, lineKey);
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, smartResult.rankMap, geometryRankMap);
  }

  

  // AUTO MODE: Select best available strategy
  if (orderingMode === 'auto') {
    // PRIMARY: Use smart auto-detection that picks best method for route type
    if (directionSequences && typeof directionSequences === 'object') {
      const smartResult = buildSmartAutoDetectRankMap(uniqueStopFeatures, directionSequences, lineKey);
      if (smartResult.rankMap && smartResult.rankMap.size > 0) {
        return sortFeaturesByPrimaryRanking(uniqueStopFeatures, smartResult.rankMap, geometryRankMap);
      }
    }

    // FALLBACK: Try intelligent branch merge if we have trip data with good coverage
    if (directionSequences && typeof directionSequences === 'object') {
      const branchMergeResult = buildOptimalBranchMergeRankMap(uniqueStopFeatures, directionSequences, lineKey);
      if (branchMergeResult.coverage >= 0.2) {
        return sortFeaturesByPrimaryRanking(uniqueStopFeatures, branchMergeResult.rankMap, geometryRankMap);
      }
    }

    // FALLBACK: Use standard trip-pattern if available and good coverage
    if (getTripPatternRankInfo().coverage >= 0.2) {
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getTripPatternRankInfo().rankMap, geometryRankMap);
    }

    // FALLBACK: Try hybrid-endpoint (trip + geometry anchoring)
    const _hy = getHybridEndpointRankMap();
    if (_hy && _hy.size > 0 && _hy.size >= geometryRankMap.size * 0.3) {
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, _hy, geometryRankMap);
    }

    // FALLBACK: Try direction ranking if available
    if (getDirectionRankInfo().coverage >= 0.2) {
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, getDirectionRankInfo().rankMap, geometryRankMap);
    }

    // FINAL: Use geometry-revised which should work for most routes
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
}
