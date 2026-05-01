const { normalizeText, normalizeGeometryForStorage, normalizeGeometryFromStorageRow, toEpochSeconds } = require('./helpers');
const { localDbLabel, query: localQuery } = require('../../postgres');
const { hasLocalPostgresConfig } = require('../../postgres');

async function getRouteGeometryLod(lineKey, zoomLevel, options = {}) {
  if (!hasLocalPostgresConfig()) {
    throw new Error('Local Postgres is not configured.');
  }

  const normalizedLineKey = normalizeText(lineKey);
  const numericZoom = Number(zoomLevel);
  if (!normalizedLineKey || !Number.isFinite(numericZoom)) return null;

  const bbox = Array.isArray(options.bbox) && options.bbox.length === 4
    ? options.bbox.map((v) => Number(v))
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

  const { rows } = await localQuery(
    `select line_key, zoom_level, source_hash, updated_at, ${selectColumns}
     from public.route_geometry_lod
     where line_key = $1 and zoom_level = $2
     limit 1`,
    params
  );

  const row = rows?.[0] || null;
  const geometry = normalizeGeometryFromStorageRow(row);
  if (!geometry) return null;

  return {
    lineKey: normalizeText(row.line_key),
    zoomLevel: Number(row.zoom_level),
    sourceHash: normalizeText(row.source_hash),
    updatedAt: toEpochSeconds(row.updated_at),
    geometry
  };
}

async function upsertRouteGeometryLod(lineKey, zoomLevel, geometry, options = {}) {
  if (!hasLocalPostgresConfig()) {
    throw new Error('Local Postgres is not configured.');
  }

  const normalizedLineKey = normalizeText(lineKey);
  const numericZoom = Number(zoomLevel);
  const geometryForStorage = normalizeGeometryForStorage(geometry);
  if (!normalizedLineKey || !Number.isFinite(numericZoom) || !geometryForStorage) return null;

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

module.exports = {
  getRouteGeometryLod,
  upsertRouteGeometryLod
};
