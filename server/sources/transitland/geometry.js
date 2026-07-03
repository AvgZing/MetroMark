const crypto = require("crypto");
const config = require("../../admin/config");
const db = require("../../processors/data");

function sanitizeText(value) {
  return String(value || "").trim();
}

function geometryToleranceForZoom(zoom) {
  const numeric = Number(zoom);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (numeric >= 15) return 0;
  if (numeric >= 14) return 0.00002;
  if (numeric >= 13) return 0.00004;
  if (numeric >= 12) return 0.00008;
  if (numeric >= 11) return 0.00016;
  if (numeric >= 10) return 0.0003;
  if (numeric >= 9) return 0.00055;
  if (numeric >= 8) return 0.0009;
  return 0.0015;
}

function perpendicularDistance(point, start, end) {
  const x = Number(point?.[0]);
  const y = Number(point?.[1]);
  const x1 = Number(start?.[0]);
  const y1 = Number(start?.[1]);
  const x2 = Number(end?.[0]);
  const y2 = Number(end?.[1]);

  if ([x, y, x1, y1, x2, y2].some((value) => !Number.isFinite(value))) {
    return 0;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    const ox = x - x1;
    const oy = y - y1;
    return Math.sqrt((ox * ox) + (oy * oy));
  }

  const numerator = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt((dx * dx) + (dy * dy));
  return denominator > 0 ? numerator / denominator : 0;
}

function simplifyLineStringCoordinates(coords, tolerance) {
  if (!Array.isArray(coords) || coords.length <= 2 || tolerance <= 0) {
    return coords;
  }

  const simplify = (points) => {
    if (points.length <= 2) {
      return points.slice();
    }

    let maxDistance = 0;
    let maxIndex = 0;

    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = perpendicularDistance(points[index], points[0], points[points.length - 1]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }

    if (maxDistance <= tolerance) {
      return [points[0], points[points.length - 1]];
    }

    const left = simplify(points.slice(0, maxIndex + 1));
    const right = simplify(points.slice(maxIndex));
    return left.slice(0, -1).concat(right);
  };

  return simplify(coords);
}

function simplifyGeometryForZoom(geometry, zoom) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return geometry || null;
  }

  const tolerance = geometryToleranceForZoom(zoom);
  if (tolerance <= 0) {
    return geometry;
  }

  if (geometry.type === "LineString") {
    const simplified = simplifyLineStringCoordinates(geometry.coordinates, tolerance);
    return Array.isArray(simplified) && simplified.length >= 2
      ? { type: "LineString", coordinates: simplified }
      : null;
  }

  if (geometry.type === "MultiLineString") {
    const lines = geometry.coordinates
      .map((line) => simplifyLineStringCoordinates(line, tolerance))
      .filter((line) => Array.isArray(line) && line.length >= 2);

    if (!lines.length) {
      return null;
    }

    return {
      type: "MultiLineString",
      coordinates: lines
    };
  }

  return geometry;
}

function geometrySourceHash(geometry) {
  if (!geometry) {
    return "";
  }

  return crypto.createHash("sha1").update(JSON.stringify(geometry)).digest("hex");
}

async function resolveGeometryForZoom(route, options = {}) {
  const lineKey = sanitizeText(route?.lineKey);
  const zoom = Number(options.zoom);
  const bbox = Array.isArray(options.bbox) && options.bbox.length === 4
    ? options.bbox.map((value) => Number(value))
    : null;

  const fallbackGeometry = simplifyGeometryForZoom(route?.geometry || null, zoom);
  if (!lineKey || !Number.isFinite(zoom) || !fallbackGeometry) {
    return fallbackGeometry || null;
  }

  try {
    const cached = await db.getRouteGeometryLod(lineKey, zoom, { bbox });
    if (cached?.geometry) {
      return cached.geometry;
    }
  } catch {
    // Fall through to local simplification and best-effort storage.
  }

  try {
    await db.upsertRouteGeometryLod(lineKey, zoom, fallbackGeometry, {
      sourceHash: geometrySourceHash(route.geometry || fallbackGeometry)
    });
  } catch {
    // Ignore storage failures and keep serving the simplified geometry.
  }

  if (bbox) {
    try {
      const clipped = await db.getRouteGeometryLod(lineKey, zoom, { bbox });
      if (clipped?.geometry) {
        return clipped.geometry;
      }
    } catch {
      // Ignore clipping read failures.
    }
  }

  return fallbackGeometry;
}

module.exports = {
  geometryToleranceForZoom,
  perpendicularDistance,
  simplifyLineStringCoordinates,
  simplifyGeometryForZoom,
  geometrySourceHash,
  resolveGeometryForZoom
};
