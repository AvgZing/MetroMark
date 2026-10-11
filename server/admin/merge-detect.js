const {
  listArchiveLineKeysInBbox,
  getArchiveFeaturesByLineKeys,
  scanArchiveLineKeysSync
} = require("../sources/transitland/backfill");
const db = require("../processors/data");

// Coordinates are rounded before comparison so GPS jitter doesn't hide an exact
// corridor match; two directions of one route share the same node set.
const COORD_PRECISION = 5;
const NEAR_JACCARD = 0.9;
const NEAR_BBOX_OVERLAP = 0.85;
const BBOX_BUCKET_DEGREES = 0.08;
const MAX_KEYS = 4000;
const MAX_CANDIDATES = 100;

function roundCoord(value) {
  return Number(value).toFixed(COORD_PRECISION);
}

function collectPoints(feature) {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const parts =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  const points = new Set();
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const part of parts) {
    if (!Array.isArray(part)) {
      continue;
    }
    for (const coord of part) {
      if (!Array.isArray(coord) || coord.length < 2) {
        continue;
      }
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }
      points.add(`${roundCoord(lon)},${roundCoord(lat)}`);
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!points.size) {
    return null;
  }
  return { points, bbox: [minLon, minLat, maxLon, maxLat] };
}

function signatureOf(points) {
  return Array.from(points).sort().join(";");
}

function jaccard(a, b) {
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// Intersection-over-union of two [west,south,east,north] boxes.
function bboxOverlap(a, b) {
  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);
  if (west >= east || south >= north) {
    return 0;
  }
  const inter = (east - west) * (north - south);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function featureName(properties) {
  return (
    String(properties?.line_short_name || "").trim() ||
    String(properties?.line_name || "").trim() ||
    String(properties?.lineLongName || "").trim()
  );
}

function buildCandidate(group, reason, score) {
  const keys = group.map((entry) => entry.lineKey);
  return {
    lineKeys: keys,
    names: group.map((entry) => featureName(entry.properties) || entry.lineKey),
    operators: group.map((entry) => String(entry.properties?.operator_name || "").trim()),
    modes: group.map((entry) => Number(entry.properties?.route_type)),
    reason,
    score: Number(score.toFixed(3)),
    suggestedCanonicalKey: pickCanonical(group)
  };
}

// Canonical = the member with the most geometry nodes, tie-broken by key.
function pickCanonical(group) {
  let best = group[0];
  for (const entry of group) {
    if (
      entry.points.size > best.points.size ||
      (entry.points.size === best.points.size && entry.lineKey < best.lineKey)
    ) {
      best = entry;
    }
  }
  return best.lineKey;
}

async function findMergeCandidates(options = {}) {
  const keys = await resolveLineKeys(options);
  if (!keys.length) {
    return { candidates: [], scanned: 0 };
  }

  const features = await getArchiveFeaturesByLineKeys(keys);
  const entries = [];
  for (const [lineKey, feature] of features) {
    const collected = collectPoints(feature);
    if (!collected) {
      continue;
    }
    entries.push({
      lineKey,
      points: collected.points,
      bbox: collected.bbox,
      signature: signatureOf(collected.points),
      properties: feature.properties || {}
    });
  }

  const candidates = [];
  const grouped = new Set();

  // Pass 1: identical node sets (same line, either direction).
  const bySignature = new Map();
  for (const entry of entries) {
    if (!bySignature.has(entry.signature)) {
      bySignature.set(entry.signature, []);
    }
    bySignature.get(entry.signature).push(entry);
  }
  for (const group of bySignature.values()) {
    if (group.length >= 2 && candidates.length < MAX_CANDIDATES) {
      candidates.push(buildCandidate(group, "identical-geometry", 1));
      for (const entry of group) {
        grouped.add(entry.lineKey);
      }
    }
  }

  // Pass 2: near-identical corridors among the leftovers, bucketed by center.
  const remaining = entries.filter((entry) => !grouped.has(entry.lineKey));
  const buckets = new Map();
  for (const entry of remaining) {
    const cx = (entry.bbox[0] + entry.bbox[2]) / 2;
    const cy = (entry.bbox[1] + entry.bbox[3]) / 2;
    const bucketKey = `${Math.round(cx / BBOX_BUCKET_DEGREES)}:${Math.round(cy / BBOX_BUCKET_DEGREES)}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey).push(entry);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2 || candidates.length >= MAX_CANDIDATES) {
      continue;
    }
    const claimed = new Set();
    for (let i = 0; i < bucket.length; i += 1) {
      if (claimed.has(i) || candidates.length >= MAX_CANDIDATES) {
        continue;
      }
      const group = [bucket[i]];
      let minScore = 1;
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (claimed.has(j)) {
          continue;
        }
        const overlap = bboxOverlap(bucket[i].bbox, bucket[j].bbox);
        if (overlap < NEAR_BBOX_OVERLAP) {
          continue;
        }
        const score = jaccard(bucket[i].points, bucket[j].points);
        if (score >= NEAR_JACCARD) {
          group.push(bucket[j]);
          claimed.add(j);
          minScore = Math.min(minScore, score);
        }
      }
      if (group.length >= 2) {
        claimed.add(i);
        candidates.push(buildCandidate(group, "near-geometry", minScore));
      }
    }
  }

  // Enrich with the authoritative route_metadata names (archive props can lag).
  const allKeys = Array.from(new Set(candidates.flatMap((candidate) => candidate.lineKeys)));
  const metadata = await db.getRouteMetadatasByLineKeys(allKeys).catch(() => new Map());
  for (const candidate of candidates) {
    candidate.names = candidate.lineKeys.map((key) => {
      const meta = metadata.get(key);
      return (
        String(meta?.lineShortName || "").trim() ||
        String(meta?.lineName || "").trim() ||
        candidate.names[candidate.lineKeys.indexOf(key)] ||
        key
      );
    });
  }

  candidates.sort((a, b) => (a.reason === b.reason ? a.score - b.score : a.reason === "identical-geometry" ? -1 : 1));
  return { candidates, scanned: entries.length };
}

async function resolveLineKeys(options) {
  if (Array.isArray(options.lineKeys) && options.lineKeys.length) {
    return options.lineKeys.map((key) => String(key || "").trim()).filter(Boolean).slice(0, MAX_KEYS);
  }
  if (options.citySlug) {
    const preset = await db.getCityPreset(String(options.citySlug).trim());
    const keys = preset?.routeKeys;
    if (Array.isArray(keys) && keys.length) {
      return keys.slice(0, MAX_KEYS);
    }
  }
  if (Array.isArray(options.bbox) && options.bbox.length === 4) {
    const keys = await listArchiveLineKeysInBbox(options.bbox.map(Number));
    return Array.from(keys).slice(0, MAX_KEYS);
  }
  return Array.from(scanArchiveLineKeysSync()).slice(0, MAX_KEYS);
}

module.exports = {
  findMergeCandidates
};
