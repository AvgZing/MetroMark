// Depends on: stop-helpers.js, ranking.js, spatial.js, method-ushape.js

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
