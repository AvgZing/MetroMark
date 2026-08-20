const { localQuery, assertLocalConfigured } = require("./core");
const {
  normalizeText,
  toEpochSeconds,
  normalizeGeometryForStorage,
  normalizeGeometryFromStorageRow
} = require("./utils");

async function getRouteGeometryLod(lineKey, zoomLevel, options = {}) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  const numericZoom = Number(zoomLevel);
  if (!normalizedLineKey || !Number.isFinite(numericZoom)) {
    return null;
  }

  const bbox = Array.isArray(options.bbox) && options.bbox.length === 4
    ? options.bbox.map((value) => Number(value))
    : null;

  const selectColumns = bbox
    ? `case
        when ST_IsEmpty(
          ST_CollectionExtract(
            ST_Intersection(
              geometry,
              ST_MakeEnvelope($3, $4, $5, $6, 4326)
            ),
            2
          )
        ) then null
        else ST_AsGeoJSON(
          ST_CollectionExtract(
            ST_Intersection(
              geometry,
              ST_MakeEnvelope($3, $4, $5, $6, 4326)
            ),
            2
          )
        )::json
      end as geometry_geojson`
    : `ST_AsGeoJSON(geometry)::json as geometry_geojson`;

  const params = bbox
    ? [normalizedLineKey, Math.round(numericZoom), bbox[0], bbox[1], bbox[2], bbox[3]]
    : [normalizedLineKey, Math.round(numericZoom)];

  // Prefer the highest stored zoom_level that is <= requested zoomLevel
  const whereClause = bbox
    ? `where line_key = $1 and zoom_level <= $2`
    : `where line_key = $1 and zoom_level <= $2`;

  const orderClause = `order by zoom_level desc limit 1`;

  const { rows } = await localQuery(
    `select line_key, zoom_level, source_hash, updated_at, ${selectColumns}
     from public.route_geometry_lod
     ${whereClause}
     ${orderClause}`,
    params
  );

  const row = rows?.[0] || null;
  const geometry = normalizeGeometryFromStorageRow(row);
  if (!geometry) {
    return null;
  }

  return {
    lineKey: normalizeText(row.line_key),
    zoomLevel: Number(row.zoom_level),
    sourceHash: normalizeText(row.source_hash),
    updatedAt: toEpochSeconds(row.updated_at),
    geometry
  };
}

async function getFractionOnRoute(lineKey, lon, lat, options = {}) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  const zg = Number.isFinite(Number(options.zoom)) ? Number(options.zoom) : null;
  const numericLon = Number(lon);
  const numericLat = Number(lat);

  if (!normalizedLineKey || !Number.isFinite(numericLon) || !Number.isFinite(numericLat)) {
    return null;
  }

  const params = zg !== null ? [normalizedLineKey, Math.round(zg), numericLon, numericLat] : [normalizedLineKey, 1000, numericLon, numericLat];

  // Select the best available geometry (highest zoom_level <= requested zoom)
  // and compute ST_LineLocatePoint fraction for the provided point.
  const sql = `select
      line_key,
      zoom_level,
      source_hash,
      updated_at,
      ST_LineLocatePoint(ST_LineMerge(geometry), ST_SetSRID(ST_MakePoint($3, $4), 4326)) as fraction
    from public.route_geometry_lod
    where line_key = $1 and zoom_level <= $2
    order by zoom_level desc
    limit 1`;

  const result = await localQuery(sql, params);
  const row = result.rows?.[0] || null;
  if (!row || row.fraction === null || row.fraction === undefined) {
    return null;
  }

  return {
    lineKey: normalizeText(row.line_key),
    zoomLevel: Number(row.zoom_level),
    sourceHash: normalizeText(row.source_hash),
    updatedAt: toEpochSeconds(row.updated_at),
    fraction: Number(row.fraction)
  };
}

async function upsertRouteGeometryLod(lineKey, zoomLevel, geometry, options = {}) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  const numericZoom = Number(zoomLevel);
  const geometryForStorage = normalizeGeometryForStorage(geometry);
  if (!normalizedLineKey || !Number.isFinite(numericZoom) || !geometryForStorage) {
    return null;
  }

  const sourceHash = normalizeText(options.sourceHash) || null;

  await localQuery(
    `insert into public.route_geometry_lod (
      line_key,
      zoom_level,
      geometry,
      source_hash,
      updated_at
    ) values (
      $1,
      $2,
      ST_SetSRID(ST_GeomFromGeoJSON($3::text), 4326),
      $4,
      now()
    )
    on conflict (line_key, zoom_level) do update set
      geometry = excluded.geometry,
      source_hash = excluded.source_hash,
      updated_at = excluded.updated_at`,
    [
      normalizedLineKey,
      Math.round(numericZoom),
      JSON.stringify(geometryForStorage),
      sourceHash
    ]
  );

  return {
    lineKey: normalizedLineKey,
    zoomLevel: Math.round(numericZoom),
    geometry: geometryForStorage,
    sourceHash
  };
}

async function getRouteGeometriesByBbox(bbox, zoom) {
  assertLocalConfigured();

  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return [];
  }

  const numericZoom = Number(zoom);
  if (!Number.isFinite(numericZoom)) {
    return [];
  }

  const [minLon, minLat, maxLon, maxLat] = bbox.map((value) => Number(value));
  if ([minLon, minLat, maxLon, maxLat].some((value) => !Number.isFinite(value))) {
    return [];
  }

  // For each route intersecting the bbox, get the highest-detail geometry.
  // DISTINCT ON (line_key) with ORDER BY zoom_level DESC ensures we get
  // the best available geometry per route. LOD simplification happens
  // at the application layer (simplifyGeometryForZoom), not at query time.
  const { rows } = await localQuery(
    `select distinct on (line_key)
       line_key,
       zoom_level,
       source_hash,
       updated_at,
       ST_AsGeoJSON(geometry)::json as geometry_geojson
     from public.route_geometry_lod
     where ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
     order by line_key, zoom_level desc`,
    [minLon, minLat, maxLon, maxLat]
  );

  if (!rows || !rows.length) {
    return [];
  }

  return rows.map((row) => {
    const geometry = normalizeGeometryFromStorageRow(row);
    return {
      lineKey: normalizeText(row.line_key),
      zoomLevel: Number(row.zoom_level),
      sourceHash: normalizeText(row.source_hash),
      updatedAt: toEpochSeconds(row.updated_at),
      geometry
    };
  }).filter((entry) => entry.geometry);
}

module.exports = {
  getRouteGeometryLod,
  getFractionOnRoute,
  upsertRouteGeometryLod,
  getRouteGeometriesByBbox
};
