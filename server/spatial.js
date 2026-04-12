const crypto = require("crypto");

const EARTH_METERS_PER_DEG_LAT = 110540;

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function stableStationKey(name, lon, lat) {
  const normalizedName = normalizeName(name).slice(0, 60) || "station";
  const roundedLon = Number(lon).toFixed(4);
  const roundedLat = Number(lat).toFixed(4);
  const input = `${normalizedName}|${roundedLon}|${roundedLat}`;
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 20);
}

function lonMetersPerDegree(latitude) {
  return 111320 * Math.cos((latitude * Math.PI) / 180);
}

function toProjectedMeters(lon, lat, refLat) {
  return {
    x: lon * lonMetersPerDegree(refLat),
    y: lat * EARTH_METERS_PER_DEG_LAT
  };
}

function distanceBetweenPointsMeters(a, b) {
  const refLat = (a[1] + b[1]) / 2;
  const p1 = toProjectedMeters(a[0], a[1], refLat);
  const p2 = toProjectedMeters(b[0], b[1], refLat);
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function pointToSegmentDistanceMeters(point, a, b) {
  const refLat = point[1];
  const p = toProjectedMeters(point[0], point[1], refLat);
  const p1 = toProjectedMeters(a[0], a[1], refLat);
  const p2 = toProjectedMeters(b[0], b[1], refLat);

  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const wx = p.x - p1.x;
  const wy = p.y - p1.y;

  const segmentLengthSquared = vx * vx + vy * vy;
  if (segmentLengthSquared === 0) {
    return Math.hypot(p.x - p1.x, p.y - p1.y);
  }

  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / segmentLengthSquared));
  const projectionX = p1.x + t * vx;
  const projectionY = p1.y + t * vy;

  return Math.hypot(p.x - projectionX, p.y - projectionY);
}

function lineDistanceMeters(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < coordinates.length; i += 1) {
    const distance = pointToSegmentDistanceMeters(point, coordinates[i - 1], coordinates[i]);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}

function geometryDistanceMeters(point, geometry) {
  if (!geometry || !geometry.type) {
    return Number.POSITIVE_INFINITY;
  }

  if (geometry.type === "LineString") {
    return lineDistanceMeters(point, geometry.coordinates);
  }

  if (geometry.type === "MultiLineString") {
    let minDistance = Number.POSITIVE_INFINITY;
    for (const line of geometry.coordinates || []) {
      const distance = lineDistanceMeters(point, line);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance;
  }

  return Number.POSITIVE_INFINITY;
}

function geometryBbox(geometry) {
  const coords = [];
  if (!geometry || !geometry.type) {
    return null;
  }

  if (geometry.type === "LineString") {
    coords.push(...(geometry.coordinates || []));
  }

  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates || []) {
      coords.push(...line);
    }
  }

  if (coords.length === 0) {
    return null;
  }

  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLon, minLat, maxLon, maxLat];
}

function pointInExpandedBbox(point, bbox, meters) {
  if (!bbox) {
    return true;
  }

  const [lon, lat] = point;
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const latPad = meters / EARTH_METERS_PER_DEG_LAT;
  const lonPad = meters / Math.max(lonMetersPerDegree(lat), 1);

  return (
    lon >= minLon - lonPad &&
    lon <= maxLon + lonPad &&
    lat >= minLat - latPad &&
    lat <= maxLat + latPad
  );
}

module.exports = {
  normalizeName,
  stableStationKey,
  distanceBetweenPointsMeters,
  geometryDistanceMeters,
  geometryBbox,
  pointInExpandedBbox
};
