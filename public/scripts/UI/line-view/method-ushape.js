// Depends on: stop-helpers.js, ranking.js, spatial.js
// Provides sortStopsSequentially used by: branch-detection.js, method-loop.js, method-auto.js, ranking.js, stop-helpers.js
// Provides buildTripPatternRankMap used by: method-main.js, branch-detection.js, method-auto.js, stop-ordering.js

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
