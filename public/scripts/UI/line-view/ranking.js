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