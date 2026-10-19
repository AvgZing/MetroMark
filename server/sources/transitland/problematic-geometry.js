// Detects routes whose geometry is a synthesized straight line between stops
// rather than real routing geometry. Manual route_review overrides win.
const STRAIGHT_TOLERANCE_M = 25;
const STOP_DEVIATION_TOLERANCE_M = 150;
const MIN_SPAN_KM = 2;
const MAX_FALLBACK_VERTICES = 3;
const STOP_MATCH_TOLERANCE_M = 50;
const MAX_STOP_VERTEX_RATIO = 1.25;
const MIN_STOP_MATCH_RATIO = 0.8;
const SPARSE_MIN_SPAN_KM = 10;
const SPARSE_MAX_VERTICES = 300;
const SPARSE_MIN_AVG_KM = 0.4;
const EXEMPT_ROUTE_TYPES = new Set([4, 5, 6, 7]);

function toRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const lon1 = Number(a?.[0]);
  const lat1 = Number(a?.[1]);
  const lon2 = Number(b?.[0]);
  const lat2 = Number(b?.[1]);
  if (!Number.isFinite(lon1) || !Number.isFinite(lat1) || !Number.isFinite(lon2) || !Number.isFinite(lat2)) {
    return Infinity;
  }
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Distance of point p to segment a-b (meters).
function distanceToSegmentMeters(p, a, b) {
  const ab = haversineMeters(a, b);
  if (ab <= 0.0001) {
    return haversineMeters(p, a);
  }
  // Planar lon/lat projection is fine at these small angular spans.
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  const px = p[0];
  const py = p[1];
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (ab === 0 ? 1 : ((bx - ax) ** 2 + (by - ay) ** 2)))
  );
  const closest = [ax + t * (bx - ax), ay + t * (by - ay)];
  return haversineMeters(p, closest);
}

function flattenGeometryPoints(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return [];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates
      .map((c) => [Number(c?.[0]), Number(c?.[1])])
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  }
  if (geometry.type === "MultiLineString") {
    const out = [];
    for (const part of geometry.coordinates) {
      for (const c of part) {
        const x = Number(c?.[0]);
        const y = Number(c?.[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          out.push([x, y]);
        }
      }
    }
    return out;
  }
  return [];
}

// Maximum perpendicular deviation (meters) of any point from the chord between
// the first and last point of the geometry.
function maxDeviationFromChordMeters(points) {
  if (points.length < 2) {
    return 0;
  }
  const a = points[0];
  const b = points[points.length - 1];
  let maxDev = 0;
  for (const p of points) {
    maxDev = Math.max(maxDev, distanceToSegmentMeters(p, a, b));
  }
  return maxDev;
}

function geometrySpanKm(points) {
  if (points.length < 2) {
    return 0;
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const point of points) {
    minLon = Math.min(minLon, point[0]);
    maxLon = Math.max(maxLon, point[0]);
    minLat = Math.min(minLat, point[1]);
    maxLat = Math.max(maxLat, point[1]);
  }
  return haversineMeters([minLon, minLat], [maxLon, maxLat]) / 1000;
}

function dedupePoints(points) {
  const out = [];
  for (const point of points) {
    if (!out.length || haversineMeters(out[out.length - 1], point) > 0.5) {
      out.push(point);
    }
  }
  return out;
}

function countVerticesNearStops(points, stopPoints, toleranceM) {
  const unique = dedupePoints(points);
  let matched = 0;
  for (const point of unique) {
    for (const stop of stopPoints) {
      if (haversineMeters(point, stop) <= toleranceM) {
        matched += 1;
        break;
      }
    }
  }
  return matched;
}

// Extract [lon, lat] stop points from a raw stops array (Transitland shapes).
function extractStopPoints(stops) {
  const out = [];
  for (const stop of stops || []) {
    let point = null;
    if (Array.isArray(stop?.geometry?.coordinates) && stop.geometry.coordinates.length >= 2) {
      point = [Number(stop.geometry.coordinates[0]), Number(stop.geometry.coordinates[1])];
    } else if (Array.isArray(stop?.location?.coordinates) && stop.location.coordinates.length >= 2) {
      point = [Number(stop.location.coordinates[0]), Number(stop.location.coordinates[1])];
    } else if (Number.isFinite(Number(stop?.stop_lon)) && Number.isFinite(Number(stop?.stop_lat))) {
      point = [Number(stop.stop_lon), Number(stop.stop_lat)];
    } else if (Number.isFinite(Number(stop?.lon)) && Number.isFinite(Number(stop?.lat))) {
      point = [Number(stop.lon), Number(stop.lat)];
    } else if (Array.isArray(stop?.point)) {
      point = [Number(stop.point[0]), Number(stop.point[1])];
    }
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      out.push(point);
    }
  }
  return out;
}

// Count unique vertices (dedupe consecutive identical coordinates).
function distinctVertexCount(points) {
  let count = 0;
  let last = null;
  for (const p of points) {
    if (!last || haversineMeters(last, p) > 0.5) {
      count += 1;
      last = p;
    }
  }
  return count;
}

function detectProblematicGeometry(geometry, stops, routeType) {
  if (EXEMPT_ROUTE_TYPES.has(Number(routeType))) {
    return false;
  }

  const points = flattenGeometryPoints(geometry);
  if (points.length < 2) {
    return false;
  }

  const distinct = distinctVertexCount(points);
  const spanKm = geometrySpanKm(points);
  const straightDeviationM = maxDeviationFromChordMeters(points);
  const isStraight = straightDeviationM <= STRAIGHT_TOLERANCE_M;
  const stopPoints = extractStopPoints(stops);
  const stopsDeviationM = stopPoints.length >= 3 ? maxDeviationFromChordMeters(stopPoints) : null;

  // Genuine straight routes keep their stops on the line — don't flag those.
  if (isStraight && stopPoints.length >= 3 && stopsDeviationM <= STOP_DEVIATION_TOLERANCE_M) {
    return false;
  }

  // Sparse geometry over a real span is the stop-to-stop fallback: many long
  // straight segments and too few shape points for a real route.
  const averageSegmentKm = spanKm / Math.max(1, distinct - 1);
  if (
    (spanKm >= SPARSE_MIN_SPAN_KM &&
      distinct <= SPARSE_MAX_VERTICES &&
      averageSegmentKm >= SPARSE_MIN_AVG_KM) ||
    (spanKm >= 50 && averageSegmentKm >= 2)
  ) {
    return true;
  }

  // Geometry built from stops has a vertex at almost every stop and no shape
  // points between them.
  if (stopPoints.length >= 3 && spanKm >= MIN_SPAN_KM) {
    const maxVertices = Math.round(stopPoints.length * MAX_STOP_VERTEX_RATIO) + 2;
    if (distinct <= maxVertices) {
      const matched = countVerticesNearStops(points, stopPoints, STOP_MATCH_TOLERANCE_M);
      if (matched / distinct >= MIN_STOP_MATCH_RATIO) {
        return true;
      }
    }
  }

  // Straight geometry + stops off the line -> synthesized (ignored the stops).
  if (isStraight && stopPoints.length >= 3 && spanKm >= MIN_SPAN_KM) {
    if (stopsDeviationM > STOP_DEVIATION_TOLERANCE_M) {
      return true;
    }
  }

  // No stops yet: a nearly straight, very-low-vertex line over a real span is
  // a drawn fallback (real street geometry has many vertices).
  if (stopPoints.length === 0) {
    if (isStraight && spanKm >= MIN_SPAN_KM) {
      return distinct <= MAX_FALLBACK_VERTICES;
    }
  }

  return false;
}

module.exports = {
  detectProblematicGeometry,
  flattenGeometryPoints,
  extractStopPoints,
  maxDeviationFromChordMeters,
  geometrySpanKm,
  distinctVertexCount,
  haversineMeters,
  distanceToSegmentMeters
};
