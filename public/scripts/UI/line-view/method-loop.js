// Depends on: stop-helpers.js, ranking.js, spatial.js, method-ushape.js

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
        zoom: appState.mapZoom || null
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
      body: JSON.stringify({ lineKey, stops: stopsPayload, zoom: appState.mapZoom || null })
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
