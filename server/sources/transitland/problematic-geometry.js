// Smart "problematic geometry" detection.
//
// A route is considered to have problematic geometry when Transitland had no
// real routing geometry for it and the map therefore draws a straight line
// between stops. The detector is intentionally conservative: a route is only
// auto-flagged when the geometry and (when available) the stops disagree in a
// way that indicates the geometry was synthesized rather than routed.
//
// Signals used, in order of strength:
//   1. Geometry is essentially a straight line (all vertices collinear within
//      a small perpendicular tolerance).
//   2. The route has 3+ stops that deviate from that straight line by more than
//      a stop tolerance. A real route would route through its stops; a
//      synthesized line ignores them. (A genuinely straight route — ferry,
//      straight subway — keeps its stops ON the line, so it is NOT flagged.)
//   3. No stops available yet: flag only a very low-vertex straight line over a
//      meaningful span (a drawn fallback), never a short or dense geometry.
//
// The result is a boolean; the admin manual override (route_review
// .problematic_override) always takes precedence over this auto-detection.

const STRAIGHT_TOLERANCE_M = 25;
const STOP_DEVIATION_TOLERANCE_M = 150;
const MIN_SPAN_KM = 2;
const MAX_FALLBACK_VERTICES = 3;

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

// Perpendicular distance (meters) of point p from the great-circle chord a-b,
// approximated by the haversine distance to the closest point on the segment.
function distanceToSegmentMeters(p, a, b) {
  const ab = haversineMeters(a, b);
  if (ab <= 0.0001) {
    return haversineMeters(p, a);
  }
  // Project p onto the a->b vector in a local equirectangular plane; using
  // lon/lat as planar x/y is fine for the small angular spans involved here.
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
  return haversineMeters(points[0], points[points.length - 1]) / 1000;
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

// Core detector. Returns true when the geometry is auto-detected as a
// synthesized stop-to-stop line; false otherwise (including "cannot tell").
function detectProblematicGeometry(geometry, stops) {
  const points = flattenGeometryPoints(geometry);
  if (points.length < 2) {
    return false;
  }

  const straightDeviationM = maxDeviationFromChordMeters(points);
  const spanKm = geometrySpanKm(points);
  const isStraight = straightDeviationM <= STRAIGHT_TOLERANCE_M;
  const stopPoints = extractStopPoints(stops);

  // A genuinely straight route keeps its stops on the line. If the geometry is
  // straight AND all stops are also on that line, it is a real straight route
  // (rare) — do not flag.
  if (isStraight && stopPoints.length >= 3) {
    const stopsDeviationM = maxDeviationFromChordMeters(stopPoints);
    if (stopsDeviationM <= STOP_DEVIATION_TOLERANCE_M) {
      return false;
    }
  }

  // Straight geometry + stops that deviate from the line → the geometry was
  // synthesized (it ignored the stops).
  if (isStraight && stopPoints.length >= 3 && spanKm >= MIN_SPAN_KM) {
    const stopsDeviationM = maxDeviationFromChordMeters(stopPoints);
    if (stopsDeviationM > STOP_DEVIATION_TOLERANCE_M) {
      return true;
    }
  }

  // Geometry-only fallback (stops not yet fetched): a nearly straight,
  // very-low-vertex line over a meaningful span is a drawn fallback. Real
  // street-following geometry has dozens–hundreds of vertices (median ~400).
  if (stopPoints.length === 0) {
    if (isStraight && spanKm >= MIN_SPAN_KM) {
      return distinctVertexCount(points) <= MAX_FALLBACK_VERTICES;
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
