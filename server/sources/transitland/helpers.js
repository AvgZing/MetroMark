const { normalizeName } = require("../../processors/postgres/spatial");
const { getTransitlandMetrics: readTransitlandMetrics } = require("./metrics");

const fallbackColors = [
  "#3f7cff",
  "#eb4f2d",
  "#0f9d58",
  "#f4b400",
  "#0b7285",
  "#912ca7",
  "#cd5c08",
  "#7d3c98"
];

function colorFromString(input) {
  const value = String(input || "line");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return fallbackColors[Math.abs(hash) % fallbackColors.length];
}

function sanitizeColor(rawColor, fallbackSeed) {
  const text = String(rawColor || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(text)) {
    return `#${text.toLowerCase()}`;
  }
  return colorFromString(fallbackSeed);
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function isCacheExpiredRow(cached) {
  const expiresAt = Number(cached?.expiresAt || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return false;
  }
  return expiresAt <= Math.floor(Date.now() / 1000);
}

function firstTruthy(values) {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return "";
}

function gtfsRouteTypeLabel(routeType) {
  const numeric = Number(routeType);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  const map = {
    0: "Tram", 1: "Subway", 2: "Rail", 3: "Bus",
    4: "Ferry", 5: "Cable Tram", 6: "Aerial", 7: "Funicular",
    11: "Trolleybus", 12: "Monorail"
  };
  return map[numeric] || "";
}

function extractOperatorName(route) {
  const operatorsArray = Array.isArray(route?.operators)
    ? route.operators
        .map((entry) => sanitizeText(entry?.name || entry?.operator_name))
        .filter(Boolean)
        .join(", ")
    : "";
  return firstTruthy([
    sanitizeText(route?.operator_name),
    sanitizeText(route?.operator?.name),
    sanitizeText(route?.agency?.agency_name),
    sanitizeText(route?.agency_name),
    sanitizeText(route?.operated_by_name),
    operatorsArray,
    sanitizeText(route?.operator_onestop_id)
  ]);
}

function extractFeedId(entity) {
  return sanitizeText(entity?.feed_version?.feed?.onestop_id || entity?.feed?.onestop_id);
}

function extractParentStopId(stop) {
  return sanitizeText(stop?.parent?.onestop_id || stop?.parent?.stop_id || stop?.parent_stop_id);
}

function extractParentStopName(stop) {
  return sanitizeText(stop?.parent?.stop_name || stop?.parent?.name);
}

function extractRouteMode(route) {
  return firstTruthy([
    sanitizeText(route?.route_type_name),
    gtfsRouteTypeLabel(route?.route_type)
  ]);
}

function canonicalStationName(name) {
  const normalized = normalizeName(name);
  if (!normalized) {
    return "station";
  }
  const trimmed = normalized
    .replace(/\b(station|stn|stop|platform|entrance|exit|transit center|transit ctr|tc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed || normalized;
}

function normalizeStopLocationTypes(rawValue) {
  const allowed = new Set([0, 1, 2, 3, 4]);
  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  const parsed = source
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && allowed.has(entry));
  const uniqueSorted = Array.from(new Set(parsed)).sort((a, b) => a - b);
  return uniqueSorted.length ? uniqueSorted : [0, 1];
}

function normalizeRouteTypes(rawValue) {
  const allowed = new Set([0, 1, 2, 3, 4, 5, 6, 7, 11, 12]);
  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  const parsed = source
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && allowed.has(entry));
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function getTransitlandMetrics() {
  return readTransitlandMetrics();
}

module.exports = {
  fallbackColors,
  colorFromString,
  sanitizeColor,
  sanitizeText,
  isCacheExpiredRow,
  firstTruthy,
  gtfsRouteTypeLabel,
  extractOperatorName,
  extractFeedId,
  extractParentStopId,
  extractParentStopName,
  extractRouteMode,
  canonicalStationName,
  normalizeStopLocationTypes,
  normalizeRouteTypes,
  getTransitlandMetrics
};
