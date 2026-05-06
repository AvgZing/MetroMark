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

  const endpointOrder = buildEndpointAnchoredGeometryOrder(features, lineKey);
  if (Array.isArray(endpointOrder.orderedFeatures) && endpointOrder.orderedFeatures.length >= 2) {
    return endpointOrder.orderedFeatures;
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
 * Order stops for line view rendering
 * Supports multiple ordering strategies with trip-pattern as primary (NEW)
 * Modes: trip-pattern (NEW), direction, fractions, geometry, geometry-revised (NEW), hybrid-endpoint (NEW), payload, auto
 */
async function orderStopsForLineView(stopFeatures, lineKey, directionSequences = null, orderingMode = 'auto', routeLookupKey = null) {
  const uniqueStopFeatures = dedupeStopFeatures(stopFeatures);

  if (!Array.isArray(uniqueStopFeatures) || uniqueStopFeatures.length === 0) {
    return uniqueStopFeatures;
  }

  // Build all available rank maps
  const payloadRankMap = buildPayloadRankMap(uniqueStopFeatures);
  const geometryRankMap = buildGeometryRankMap(uniqueStopFeatures, lineKey);
  const geometryRevisedRankMap = buildGeometryRevisedRankMap(uniqueStopFeatures, lineKey);

  // Trip-pattern rank map (NEW PRIMARY METHOD - uses actual trip data)
  const tripPatternRankInfo = directionSequences && typeof directionSequences === 'object'
    ? buildTripPatternRankMap(uniqueStopFeatures, directionSequences, lineKey)
    : { rankMap: new Map(), matchedCount: 0, coverage: 0 };

  // Direction rank map (legacy - uses trip data but with consensus approach)
  const directionRankInfo = directionSequences && typeof directionSequences === 'object'
    ? buildDirectionRankMap(uniqueStopFeatures, directionSequences)
    : { rankMap: new Map(), matchedCount: 0, coverage: 0 };

  // Hybrid-endpoint rank map (novel mode combining trip pattern and geometry endpoint anchoring)
  const hybridEndpointRankMap = directionSequences && typeof directionSequences === 'object'
    ? buildHybridEndpointRankMap(uniqueStopFeatures, directionSequences, lineKey)
    : geometryRevisedRankMap;

  // Delay fraction requests so auto mode does not issue extra failing network calls.
  const resolvedRouteLookupKey = String(routeLookupKey || lineKey || '').trim();

  // Handle explicit mode selections
  if (orderingMode === 'trip-pattern') {
    if (tripPatternRankInfo.coverage > 0.2) {
      return sortFeaturesByRanking(uniqueStopFeatures, tripPatternRankInfo.rankMap, geometryRankMap);
    }
    return sortFeaturesByRanking(uniqueStopFeatures, geometryRankMap);
  }

  if (orderingMode === 'geometry') {
    return sortFeaturesByRanking(uniqueStopFeatures, geometryRankMap);
  }

  if (orderingMode === 'geometry-revised') {
    return sortFeaturesByRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  if (orderingMode === 'hybrid-endpoint') {
    return sortFeaturesByRanking(uniqueStopFeatures, hybridEndpointRankMap, geometryRankMap);
  }

  if (orderingMode === 'direction') {
    return sortFeaturesByRanking(uniqueStopFeatures, directionRankInfo.rankMap, geometryRankMap);
  }

  if (orderingMode === 'fractions') {
    const fractionRankInfo = await buildFractionRankMap(uniqueStopFeatures, lineKey, resolvedRouteLookupKey);
    if (fractionRankInfo.coverage > 0.3) {
      return sortFeaturesByRanking(uniqueStopFeatures, fractionRankInfo.rankMap, geometryRankMap);
    }
    return sortFeaturesByRanking(uniqueStopFeatures, geometryRankMap);
  }

  if (orderingMode === 'payload') {
    return sortFeaturesByRanking(uniqueStopFeatures, payloadRankMap, geometryRankMap);
  }

  // AUTO MODE: Select best available strategy
  if (orderingMode === 'auto') {
    // PRIMARY: Use trip-pattern if available and good coverage
    if (tripPatternRankInfo.coverage >= 0.2) {
      return sortFeaturesByRanking(uniqueStopFeatures, tripPatternRankInfo.rankMap, geometryRankMap);
    }

    // FALLBACK: Try hybrid-endpoint (trip + geometry anchoring)
    if (hybridEndpointRankMap.size > 0 && hybridEndpointRankMap.size >= geometryRankMap.size * 0.3) {
      return sortFeaturesByRanking(uniqueStopFeatures, hybridEndpointRankMap, geometryRankMap);
    }

    // FALLBACK: Try direction ranking if available
    if (directionRankInfo.coverage >= 0.2) {
      return sortFeaturesByRanking(uniqueStopFeatures, directionRankInfo.rankMap, geometryRankMap);
    }

    // FINAL: Use geometry-revised which should work for most routes
    return sortFeaturesByRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
  }

  return sortFeaturesByRanking(uniqueStopFeatures, geometryRevisedRankMap, geometryRankMap);
}
