// Depends on: stop-helpers.js, ranking.js, spatial.js, method-ushape.js
// Provides buildBranchGroups exported to window for UI rendering

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

function detectSplitSectionsFromStops(stopFeatures) {
  const features = Array.isArray(stopFeatures) ? stopFeatures.filter((f) => stopCoordinate(f)) : [];
  if (features.length < 6) {
    return false;
  }

  const inferredLineKey = String(features[0]?.properties?.line_key || "").trim();
  const ordered = sortStopsSequentially(features, inferredLineKey);
  const indexByFeature = new Map();
  ordered.forEach((feature, index) => indexByFeature.set(feature, index));

  const minPairs = Math.max(4, Math.floor(features.length * 0.2));
  const minIndexGap = Math.max(4, Math.floor(ordered.length * 0.12));
  let closePairs = 0;

  for (let i = 0; i < features.length; i += 1) {
    const left = features[i];
    const leftCoord = stopCoordinate(left);
    if (!leftCoord) continue;
    for (let j = i + 1; j < features.length; j += 1) {
      const right = features[j];
      const rightCoord = stopCoordinate(right);
      if (!rightCoord) continue;

      const distMeters = haversineMeters(leftCoord, rightCoord);
      if (distMeters > 220) {
        continue;
      }

      const nameSimilarity = stopNameSimilarity(stopFeatureDisplayName(left), stopFeatureDisplayName(right));
      if (nameSimilarity < 0.5) {
        continue;
      }

      const leftIndex = indexByFeature.get(left);
      const rightIndex = indexByFeature.get(right);
      if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex)) {
        if (Math.abs(leftIndex - rightIndex) < minIndexGap) {
          continue;
        }
      }

      closePairs += 1;
      if (closePairs >= minPairs) {
        return true;
      }
    }
  }

  return false;
}

function detectSplitSections(stopFeatures, directionSequences, directionPatterns = null) {
  if (!directionSequences || typeof directionSequences !== 'object') return false;

  if (detectSplitSectionsFromStops(stopFeatures)) {
    return true;
  }

  const featureByLookupKey = buildFeatureLookupMap(stopFeatures);
  const patterns = [];
  for (const directionKey of ['0','1']) {
    const seq = Array.isArray(directionSequences[directionKey]) ? directionSequences[directionKey] : [];
    if (!seq.length) continue;
    const matches = [];
    const selected = new Set();
    for (const entry of seq) {
      const f = matchSequenceFeatureWithThreshold(entry, stopFeatures, featureByLookupKey, selected, 0.55);
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
    const coords0 = stopCoordinate(feat0);
    const coords1 = stopCoordinate(feat1);
    if (coords0 && coords1) {
      const distMeters = haversineMeters(coords0, coords1);
      const nameSimilarity = stopNameSimilarity(stopFeatureDisplayName(feat0), stopFeatureDisplayName(feat1));
      if (distMeters < 180 && nameSimilarity >= 0.35) {
        closeMismatches += 1;
      }
    }
  }

  return closeMismatches >= 3 && closeMismatches / Math.max(count, 1) >= 0.15;
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

  const sequencesByDirection = new Map([
    ['0', []],
    ['1', []]
  ]);

  const addNamesFromEntries = (entries) => {
    for (const entry of entries || []) {
      const key = normalizeStopLookupKey(entry?.id || entry?.stopId || entry?.name);
      const name = String(entry?.name || entry?.stopId || entry?.id || '').trim();
      if (key && name && !result.keyToName.has(key)) {
        result.keyToName.set(key, name);
      }
    }
  };

  const addSequenceFromEntries = (entries, directionKey) => {
    const seq = normalizeSequenceKeys(entries);
    if (seq.length < 2) return;
    addNamesFromEntries(entries);
    const list = sequencesByDirection.get(directionKey) || [];
    list.push(seq);
    sequencesByDirection.set(directionKey, list);
  };

  if (directionPatterns && typeof directionPatterns === 'object') {
    for (const directionKey of ['0', '1']) {
      const patterns = Array.isArray(directionPatterns[directionKey]) ? directionPatterns[directionKey] : [];
      for (const pattern of patterns) {
        if (pattern && Array.isArray(pattern.stopEntries)) {
          addSequenceFromEntries(pattern.stopEntries, directionKey);
        }
      }
    }
  }

  const splitCandidate = directionSequences && typeof directionSequences === 'object'
    ? detectSplitSections(stopFeatures, directionSequences, directionPatterns)
    : false;

  if (directionSequences && typeof directionSequences === 'object') {
    addNamesFromEntries(Array.isArray(directionSequences?.['0']) ? directionSequences['0'] : []);
    addNamesFromEntries(Array.isArray(directionSequences?.['1']) ? directionSequences['1'] : []);
  }

  if (directionSequences && typeof directionSequences === 'object' && !directionPatterns) {
    const seq0 = normalizeSequenceKeys(directionSequences?.['0']);
    const seq1 = normalizeSequenceKeys(directionSequences?.['1']);
    if (seq0.length >= 2 && seq1.length >= 2) {
      if (sequencesAreReverse(directionSequences)) {
        return result;
      }
      addSequenceFromEntries(directionSequences?.['0'] || [], '0');
      addSequenceFromEntries(directionSequences?.['1'] || [], '1');
    }
  }

  const findBestPair = (sequences) => {
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
        if (similarity < 0.35) {
          continue;
        }
        if (similarity < bestSimilarity) {
          bestSimilarity = similarity;
          bestPair = [left, right];
          bestLcs = lcs;
        }
      }
    }

    return { bestPair, bestSimilarity, bestLcs };
  };

  let chosen = null;
  for (const directionKey of ['0', '1']) {
    const sequences = sequencesByDirection.get(directionKey) || [];
    if (sequences.length < 2) {
      continue;
    }
    const candidate = findBestPair(sequences);
    if (candidate.bestPair && (!chosen || candidate.bestSimilarity < chosen.bestSimilarity)) {
      chosen = candidate;
    }
  }

  if (!chosen || !chosen.bestPair) {
    if (splitCandidate) {
      result.isSplitSections = true;
    }
    return result;
  }

  const seq0 = chosen.bestPair[0];
  const seq1 = chosen.bestPair[1];
  const lcs = chosen.bestLcs;

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

  const trunkSet = new Set(lcs);
  const filtered = segments
    .filter((seg) => {
      const left = seg.choices['0'] || [];
      const right = seg.choices['1'] || [];
      const leftUnique = left.filter((key) => !trunkSet.has(key));
      const rightUnique = right.filter((key) => !trunkSet.has(key));
      return leftUnique.length >= 3 && rightUnique.length >= 3;
    })
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

  if (!filtered.length) {
    if (splitCandidate) {
      result.isSplitSections = true;
    }
    return result;
  }

  const divergenceCount = filtered.reduce((sum, seg) => sum + Math.max(seg.choices['0'].length, seg.choices['1'].length), 0);
  if (divergenceCount < 2) {
    if (splitCandidate) {
      result.isSplitSections = true;
    }
    return result;
  }

  result.isBranching = true;
  result.trunkKeys = lcs;
  result.segments = filtered;
  result.patterns = { '0': seq0, '1': seq1 };
  return result;
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

// Expose branch helper for UI rendering
try {
  if (typeof window !== 'undefined') {
    window.buildBranchGroups = buildBranchGroups;
  }
} catch (e) {
  // ignore
}
