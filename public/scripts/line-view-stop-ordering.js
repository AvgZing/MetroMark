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

/**
 * Sort stops sequentially along the route geometry using linear referencing
 */
function sortStopsSequentially(features, lineKey) {
  if (!Array.isArray(features) || features.length <= 1) {
    return features;
  }

  const coords = features.map((f) => f?.geometry?.coordinates).filter((c) => Array.isArray(c));
  if (coords.length <= 1) {
    return features;
  }

  // If we have the route geometry for this line, project stops onto the route
  // polyline and compute a distance-along-route to order stops robustly for loops.
  try {
    const routeFeatures = Array.isArray(state.transit?.routesGeoJson?.features)
      ? state.transit.routesGeoJson.features
      : [];

    const routeFeature = routeFeatures.find((r) => String(r?.properties?.line_key || "") === String(lineKey || ""));
    const routeCoords = (routeFeature && routeFeature.geometry && Array.isArray(routeFeature.geometry.coordinates))
      ? (routeFeature.geometry.type === 'MultiLineString'
          ? routeFeature.geometry.coordinates.flat()
          : routeFeature.geometry.coordinates)
      : null;

    if (Array.isArray(routeCoords) && routeCoords.length >= 2) {
      // Helper: Euclidean distance (approx) in lon/lat degrees scaled by cosine of latitude
      const haversineDistance = (a, b) => {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371000; // meters
        const dLat = toRad(b[1] - a[1]);
        const dLon = toRad(b[0] - a[0]);
        const lat1 = toRad(a[1]);
        const lat2 = toRad(b[1]);
        const sinDLat = Math.sin(dLat / 2);
        const sinDLon = Math.sin(dLon / 2);
        const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
        const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
        return R * c;
      };

      // Precompute segment lengths and cumulative lengths
      const segLengths = [];
      const cumLengths = [0];
      for (let i = 0; i < routeCoords.length - 1; i++) {
        const l = haversineDistance(routeCoords[i], routeCoords[i + 1]);
        segLengths.push(l);
        cumLengths.push(cumLengths[cumLengths.length - 1] + l);
      }

      const computeAlongDistance = (pt) => {
        let best = { dist: Infinity, along: 0 };
        for (let i = 0; i < routeCoords.length - 1; i++) {
          const a = routeCoords[i];
          const b = routeCoords[i + 1];
          const ax = a[0];
          const ay = a[1];
          const bx = b[0];
          const by = b[1];
          const px = pt[0];
          const py = pt[1];

          const abx = bx - ax;
          const aby = by - ay;
          const apx = px - ax;
          const apy = py - ay;
          const abab = abx * abx + aby * aby;
          let t = 0;
          if (abab > 0) {
            t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abab));
          }

          const closestx = ax + t * abx;
          const closesty = ay + t * aby;
          const dx = px - closestx;
          const dy = py - closesty;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < best.dist) {
            best = {
              dist,
              along: cumLengths[i] + t * segLengths[i]
            };
          }
        }
        return best.along;
      };

      const withAlongDist = features.map((f) => ({
        feature: f,
        along: computeAlongDistance(f.geometry.coordinates)
      }));

      withAlongDist.sort((a, b) => a.along - b.along);
      return withAlongDist.map((w) => w.feature);
    }
  } catch (e) {
    // Fall through to default sort
  }

  // Default: sort by latitude (simple north-south)
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
 * Order stops for line view rendering
 * Applies direction sequences first (if available), then linear referencing fractions
 */
async function orderStopsForLineView(stopFeatures, lineKey, lineViewReverse, directionSequences) {
  const uniqueStopFeatures = dedupeStopFeatures(stopFeatures);

  // Step 1: Build a stable base order from fractions or route geometry.
  const fractionOrderedFeatures = await orderStopsByFractions(uniqueStopFeatures, lineKey);

  // Step 2: Apply direction sequence only when it has strong coverage.
  const directionKey = lineViewReverse ? "1" : "0";
  const { features: directionOrderedFeatures, usedSequences } = orderStopsByDirection(
    fractionOrderedFeatures,
    directionSequences,
    directionKey
  );

  let featuresToRender = usedSequences ? directionOrderedFeatures : fractionOrderedFeatures;

  // Step 3: Reverse fallback order when sequence data is not trusted/available.
  if (!usedSequences && lineViewReverse) {
    featuresToRender = Array.from(featuresToRender).reverse();
  }

  return dedupeStopFeatures(featuresToRender);
}
