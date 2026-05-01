const { hasLocalPostgresConfig } = require('../../postgres');

function normalizeText(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function toEpochSeconds(isoText) {
  if (!isoText) return null;
  const parsed = Date.parse(String(isoText));
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function normalizeGeometryForStorage(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) return null;
  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates.filter((line) => Array.isArray(line) && line.length >= 2);
    if (!lines.length) return null;
    return { type: 'MultiLineString', coordinates: lines };
  }
  if (geometry.type === 'LineString') {
    if (geometry.coordinates.length < 2) return null;
    return { type: 'MultiLineString', coordinates: [geometry.coordinates] };
  }
  return null;
}

function normalizeGeometryFromStorageRow(row) {
  if (!row) return null;
  const geometry = row.geometry_geojson || row.geometry || null;
  if (!geometry) return null;
  if (typeof geometry === 'string') {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }
  return geometry;
}

module.exports = {
  normalizeText,
  normalizeEmail,
  nowIso,
  toEpochSeconds,
  normalizeGeometryForStorage,
  normalizeGeometryFromStorageRow,
  hasLocalPostgresConfig
};