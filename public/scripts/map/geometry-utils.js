function collectCoordsFromGeometry(geometry, bbox) {
  if (!geometry) {
    return bbox;
  }

  const type = geometry.type;
  const coords = geometry.coordinates;
  if (!coords) {
    return bbox;
  }

  const update = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return;
    }
    bbox.minLng = Math.min(bbox.minLng, lng);
    bbox.minLat = Math.min(bbox.minLat, lat);
    bbox.maxLng = Math.max(bbox.maxLng, lng);
    bbox.maxLat = Math.max(bbox.maxLat, lat);
  };

  if (type === "LineString") {
    coords.forEach(([lng, lat]) => update(lng, lat));
    return bbox;
  }

  if (type === "MultiLineString") {
    coords.forEach((line) => line.forEach(([lng, lat]) => update(lng, lat)));
    return bbox;
  }

  return bbox;
}

function geometryIntersectsBbox(geometry, bbox) {
  if (!geometry || !bbox) {
    return true;
  }

  const geometryBbox = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };

  collectCoordsFromGeometry(geometry, geometryBbox);

  if (
    !Number.isFinite(geometryBbox.minLng) ||
    !Number.isFinite(geometryBbox.minLat) ||
    !Number.isFinite(geometryBbox.maxLng) ||
    !Number.isFinite(geometryBbox.maxLat)
  ) {
    return true;
  }

  return !(
    geometryBbox.maxLng < bbox[0] ||
    geometryBbox.minLng > bbox[2] ||
    geometryBbox.maxLat < bbox[1] ||
    geometryBbox.minLat > bbox[3]
  );
}

function normalizeBboxArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length !== 4) {
    return null;
  }

  const parsed = candidate.map((value) => Number(value));
  if (parsed.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [west, south, east, north] = parsed;
  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

function mapBoundsToBbox() {
  if (!appState.map) {
    return null;
  }

  const bounds = appState.map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = clamp(bounds.getSouth(), -85, 85);
  const north = clamp(bounds.getNorth(), -85, 85);

  if (west > east) {
    return [-180, south, 180, north];
  }

  return [west, south, east, north];
}

function bboxQueryText(bbox) {
  return bbox.map((value) => Number(value).toFixed(6)).join(",");
}
