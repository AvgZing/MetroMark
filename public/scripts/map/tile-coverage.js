// Tile-coverage primitives for the upcoming cross-check/backfill pipeline.
// These helpers compute which map tiles a viewport needs, map between lng/lat
// and tile coordinates, and classify cached areas by bbox — so a future
// transitland-agnostic fetcher can determine what's missing from the PMTiles
// archive and save exactly the gaps. Restored from the legacy viewport-cache
// pipeline; currently not wired to any fetch.

var MAX_TARGET_TILES_PER_VIEW = 24;

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function expandBbox(bbox, paddingDegrees) {
  return [
    clamp(bbox[0] - paddingDegrees, -180, 180),
    clamp(bbox[1] - paddingDegrees, -85, 85),
    clamp(bbox[2] + paddingDegrees, -180, 180),
    clamp(bbox[3] + paddingDegrees, -85, 85)
  ];
}

function tileZoomFromMapZoom(zoom) {
  if (zoom >= 13) return 12;
  if (zoom >= 11) return 11;
  if (zoom >= 9) return 9;
  if (zoom >= 7) return 8;
  if (zoom >= 5) return 7;
  if (zoom >= 3) return 6;
  return 5;
}

function lngLatToTile(lon, lat, zoom) {
  const latClamped = clamp(lat, -85.05112878, 85.05112878);
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  return {
    x,
    y: clamp(y, 0, n - 1)
  };
}

function tileToBbox(x, y, zoom) {
  const n = 2 ** zoom;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;

  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));

  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;

  return [west, south, east, north];
}

function normalizeTileX(x, zoom) {
  const n = 2 ** zoom;
  return ((x % n) + n) % n;
}

function normalizeTileY(y, zoom) {
  const n = 2 ** zoom;
  return clamp(y, 0, n - 1);
}

function modeCacheKeyFromRouteTypes(routeTypes) {
  const normalized = Array.from(
    new Set(
      Array.isArray(routeTypes)
        ? routeTypes
            .map((value) => Number.parseInt(String(value), 10))
            .filter((value) => Number.isFinite(value) && value >= 0)
        : []
    )
  );
  return normalized.length ? normalized.slice().sort((a, b) => a - b).join("-") : "all";
}

function cacheEntryBbox(cacheKey, entry) {
  const payload = entry?.payload;
  const fromArea =
    normalizeBboxArray(payload?.area?.bbox) ||
    normalizeBboxArray(payload?.normalizedBbox) ||
    normalizeBboxArray(payload?.bbox);

  if (fromArea) {
    return fromArea;
  }

  const tileMatch = /^tile:(\d+):(\d+):(\d+):modes:/.exec(String(cacheKey || ""));
  if (!tileMatch) {
    return null;
  }

  const zoom = Number.parseInt(tileMatch[1], 10);
  const x = Number.parseInt(tileMatch[2], 10);
  const y = Number.parseInt(tileMatch[3], 10);

  if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return tileToBbox(x, y, zoom);
}

function buildViewportTileRequests(rawBbox, zoom) {
  if (Number(zoom || 0) < 5) {
    const paddedViewport = expandBbox(rawBbox, 0.18);
    return [
      {
        areaKey: `viewport:${bboxQueryText(paddedViewport)}`,
        bbox: paddedViewport,
        zoom,
        distanceScore: 0
      }
    ];
  }

  const tileZoom = tileZoomFromMapZoom(zoom);
  const padded = expandBbox(rawBbox, 0.18);
  const center = bboxCenter(rawBbox);
  const centerTile = lngLatToTile(center[0], center[1], tileZoom);

  const northWest = lngLatToTile(padded[0], padded[3], tileZoom);
  const southEast = lngLatToTile(padded[2], padded[1], tileZoom);

  const minX = Math.min(northWest.x, southEast.x) - 1;
  const maxX = Math.max(northWest.x, southEast.x) + 1;
  const minY = Math.min(northWest.y, southEast.y) - 1;
  const maxY = Math.max(northWest.y, southEast.y) + 1;

  const requestsByKey = new Map();

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const nx = normalizeTileX(x, tileZoom);
      const ny = normalizeTileY(y, tileZoom);
      const areaKey = `tile:${tileZoom}:${nx}:${ny}`;
      if (requestsByKey.has(areaKey)) {
        continue;
      }

      const bbox = tileToBbox(nx, ny, tileZoom);
      const dx = nx - centerTile.x;
      const dy = ny - centerTile.y;
      const distanceScore = dx * dx + dy * dy;

      requestsByKey.set(areaKey, {
        areaKey,
        bbox,
        zoom,
        distanceScore
      });
    }
  }

  return Array.from(requestsByKey.values())
    .sort((a, b) => a.distanceScore - b.distanceScore)
    .slice(0, MAX_TARGET_TILES_PER_VIEW);
}
