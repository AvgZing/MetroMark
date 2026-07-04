/**
 * Line View Stop Ordering Logic
 * 
 * This file contains all logic for ordering and matching stops in the line view.
 * All stop ordering, direction handling, and stop sequencing happens here.
 */

function normalizeLineViewOrderingMode(orderingMode) {
  const mode = String(orderingMode || 'geometry-revised').trim();

  if (mode === 'auto' || mode === 'geometry-revised' || mode === 'legacy-geometry' || mode === 'fractions') {
    return mode;
  }

  if (mode === 'geometry-only') {
    return 'legacy-geometry';
  }

  if (mode === 'geometry') {
    return 'legacy-geometry';
  }

  if (mode === 'fractions-only') {
    return 'fractions';
  }

  if (mode === 'geometry-revised-endpoint-anchored') {
    return 'geometry-revised';
  }

  return 'geometry-revised';
}

function lineViewOrderingDefaultModeForLine(lineKey) {
  const normalizedLineKey = String(lineKey || '').trim();
  if (!normalizedLineKey || !Array.isArray(state?.lineSummaries)) {
    return 'auto';
  }

  const line = state.lineSummaries.find((entry) => String(entry?.lineKey || '').trim() === normalizedLineKey);
  if (!line) {
    return 'auto';
  }

  const candidate = normalizeLineViewOrderingMode(
    line.lineViewOrderingDefaultMode ||
    line.orderingModeDefaultMode ||
    line.stopOrderingMode ||
    line.orderingMode ||
    'auto'
  );

  return candidate || 'auto';
}

function setResolved(resolved) {
  try {
    if (typeof state === 'object') {
      state.lineViewOrderingResolved = resolved;
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Order stops for line view rendering
 * Supported modes: auto, geometry-revised, legacy-geometry, fractions
 */
async function orderStopsForLineView(stopFeatures, lineKey, directionSequences = null, orderingMode = 'geometry-revised', routeLookupKey = null, branchSelections = null, directionPatterns = null) {
  const uniqueStopFeatures = dedupeStopFeatures(stopFeatures);

  if (!Array.isArray(uniqueStopFeatures) || uniqueStopFeatures.length === 0) {
    return uniqueStopFeatures;
  }

  const mode = normalizeLineViewOrderingMode(orderingMode);

  const geometryRankMap = buildGeometryRankMap(uniqueStopFeatures, lineKey);
  const geometryRevisedRankMap = buildGeometryRevisedRankMap(uniqueStopFeatures, lineKey);
  const legacyGeometryRankMap = directionSequences && typeof directionSequences === 'object'
    ? buildTripPatternRankMap(uniqueStopFeatures, directionSequences, lineKey).rankMap
    : new Map();

  const resolvedRouteLookupKey = String(routeLookupKey || lineKey || '').trim();

  if (mode === 'legacy-geometry') {
    setResolved('legacy-geometry');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, legacyGeometryRankMap, geometryRevisedRankMap);
  }

  if (mode === 'geometry-revised') {
    setResolved('geometry-revised');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  if (mode === 'fractions') {
    setResolved('fractions');
    const fractionRankInfo = await buildFractionRankMap(uniqueStopFeatures, lineKey, resolvedRouteLookupKey);
    if (fractionRankInfo.coverage > 0.3) {
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, fractionRankInfo.rankMap, geometryRankMap);
    }
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRankMap, geometryRevisedRankMap);
  }

  if (mode === 'auto') {
    const autoMode = detectAutoLineViewOrderingMode(uniqueStopFeatures, lineKey, directionSequences, directionPatterns);

    if (autoMode === 'fractions') {
      const fractionRankInfo = await buildFractionRankMap(uniqueStopFeatures, lineKey, resolvedRouteLookupKey);
      if (fractionRankInfo.coverage > 0.3) {
        setResolved('fractions');
        return sortFeaturesByPrimaryRanking(uniqueStopFeatures, fractionRankInfo.rankMap, geometryRankMap);
      }

      setResolved('geometry-revised');
      return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
    }

    setResolved('geometry-revised');
    return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  setResolved('geometry-revised');
  return sortFeaturesByPrimaryRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
}



