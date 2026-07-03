const config = require("../../admin/config");
const db = require("../../processors/data");
const { TRANSIT_CACHE_PREFIX, transitlandMetrics } = require("./metrics");
const { sanitizeText } = require("./helpers");
const { enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");

function parseVectorTileHeadwaySeconds(properties) {
  const candidates = [
    properties?.headway_secs,
    properties?.headway_seconds,
    properties?.headway
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
  }

  return null;
}

function frequencyBucketFromHeadwayMinutes(minutes) {
  const numeric = Number(minutes);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "unknown";
  }

  if (numeric <= 10) {
    return "frequent";
  }

  if (numeric < 30) {
    return "regular";
  }

  return "local";
}

const FALLBACK_HEADWAY_SECONDS = 100000;
const FALLBACK_HEADWAY_MINUTES = Number((FALLBACK_HEADWAY_SECONDS / 60).toFixed(1));

function isFallbackHeadwaySeconds(seconds) {
  const numeric = Number(seconds);
  return Number.isFinite(numeric) && Math.abs(numeric - FALLBACK_HEADWAY_SECONDS) < 1;
}

function isFallbackHeadwayMinutes(minutes) {
  const numeric = Number(minutes);
  return Number.isFinite(numeric) && Math.abs(numeric - FALLBACK_HEADWAY_MINUTES) < 0.2;
}

function fallbackFrequencyBucketForRoute(route = {}) {
  const routeType = Number(route?.route_type ?? route?.routeType);
  const routeMode = String(route?.route_type_name || route?.mode || "").toLowerCase();
  const routeName = [route?.route_short_name, route?.route_long_name, route?.name, route?.route_name]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  const combined = `${routeMode} ${routeName}`;

  if (routeType === 1 || /\b(subway|metro|rapid transit)\b/.test(combined)) {
    return "frequent";
  }

  if (routeType === 0 || /\b(tram|streetcar|light rail)\b/.test(combined)) {
    return "regular";
  }

  if (routeType === 12 || /\b(airport|people mover|monorail)\b/.test(combined)) {
    return "frequent";
  }

  return "local";
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlTags(text) {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseHeadwayCellMinutes(cellText) {
  const text = String(cellText || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!text || /\b(no service|none|n\/a)\b/.test(text)) {
    return null;
  }

  const hasTripWord = /\btrips?\b/.test(text);
  const minuteValues = [];

  const rangeRegex = /(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)(?:\s*(?:min|mins|minute|minutes))?/g;
  let rangeMatch = rangeRegex.exec(text);
  while (rangeMatch) {
    const low = Number(rangeMatch[1]);
    const high = Number(rangeMatch[2]);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      minuteValues.push(Number(((low + high) / 2).toFixed(1)));
    }
    rangeMatch = rangeRegex.exec(text);
  }

  const explicitMinutesRegex = /(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/g;
  let minutesMatch = explicitMinutesRegex.exec(text);
  while (minutesMatch) {
    const value = Number(minutesMatch[1]);
    if (Number.isFinite(value)) {
      minuteValues.push(value);
    }
    minutesMatch = explicitMinutesRegex.exec(text);
  }

  const explicitHoursRegex = /(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/g;
  let hoursMatch = explicitHoursRegex.exec(text);
  while (hoursMatch) {
    const value = Number(hoursMatch[1]);
    if (Number.isFinite(value)) {
      minuteValues.push(Number((value * 60).toFixed(1)));
    }
    hoursMatch = explicitHoursRegex.exec(text);
  }

  const everyRegex = /every\s+(\d+(?:\.\d+)?)/g;
  let everyMatch = everyRegex.exec(text);
  while (everyMatch) {
    const value = Number(everyMatch[1]);
    if (Number.isFinite(value)) {
      minuteValues.push(value);
    }
    everyMatch = everyRegex.exec(text);
  }

  if (minuteValues.length) {
    return Number(Math.min(...minuteValues).toFixed(1));
  }

  if (hasTripWord) {
    return null;
  }

  const values = text
    .match(/\d+(?:\.\d+)?/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 5 && value <= 240);

  if (!values || !values.length) {
    return null;
  }

  if (values.length === 1) {
    return values[0];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  return Number(((min + max) / 2).toFixed(1));
}

function parseHeadwaySummaryFromRoutePageHtml(html) {
  const pageHtml = String(html || "");
  const tableMatch = pageHtml.match(/<table[^>]*>[\s\S]*?<th>[\s\S]*?Headways[\s\S]*?<\/th>[\s\S]*?<\/table>/i);
  const tableHtml = tableMatch ? tableMatch[0] : pageHtml;

  const rowRegex =
    /<tr>[\s\S]*?<td[^>]*>\s*(Weekday|Saturday|Sunday)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

  const windows = ["7-9am", "9am-4pm", "4-6pm", "6pm-7am"];
  const rows = {};
  const allMinutes = [];

  let match = rowRegex.exec(tableHtml);
  while (match) {
    const dayKey = String(match[1] || "").toLowerCase();
    const cellsRaw = [match[2], match[3], match[4], match[5]];

    const cells = cellsRaw.map((entry) => {
      const text = stripHtmlTags(entry);
      const minutes = parseHeadwayCellMinutes(text);
      if (Number.isFinite(minutes)) {
        allMinutes.push(minutes);
      }
      return {
        text,
        minutes
      };
    });

    rows[dayKey] = {
      label: stripHtmlTags(match[1]),
      cells
    };

    match = rowRegex.exec(tableHtml);
  }

  if (!Object.keys(rows).length) {
    return null;
  }

  const bestMinutes = allMinutes.length ? Math.min(...allMinutes) : null;

  return {
    source: "transitland-route-page",
    windows,
    rows,
    bestMinutes: Number.isFinite(bestMinutes) ? Number(bestMinutes.toFixed(1)) : null,
    frequencyBucket: frequencyBucketFromHeadwayMinutes(bestMinutes)
  };
}

async function fetchRouteHeadwaySummary(routeLookupKey, options = {}) {
  const key = sanitizeText(routeLookupKey);
  if (!key) {
    return null;
  }

  const cacheKey = `${TRANSIT_CACHE_PREFIX}headway:${key}`;
  if (!options.forceRefresh) {
    const cached = await db.getCacheAny(cacheKey);
    if (cached && cached.payload) {
      return cached.payload;
    }
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1500, Number(config.ROUTE_HEADWAY_TIMEOUT_MS || 9000));
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await enforceDailyUsageCapsIfNeeded("routing", options);
    transitlandMetrics.routingApiRequestCount += 1;
    transitlandMetrics.lastRoutingRequestAt = new Date().toISOString();
    await recordUsage("routing", 1);

    const response = await fetch(`https://www.transit.land/routes/${encodeURIComponent(key)}`, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MetroMark/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      transitlandMetrics.routingApiRequestFailureCount += 1;
      return null;
    }

    const html = await response.text();
    const summary = parseHeadwaySummaryFromRoutePageHtml(html);
    if (!summary) {
      return null;
    }

    const ttlHours = Math.max(1, Number(config.ROUTE_HEADWAY_CACHE_TTL_HOURS || 72));
    await db.setCache(cacheKey, summary, ttlHours * 3600, {
      cacheKind: "route-headway"
    });
    return summary;
  } catch {
    transitlandMetrics.routingApiRequestFailureCount += 1;
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  parseVectorTileHeadwaySeconds,
  frequencyBucketFromHeadwayMinutes,
  FALLBACK_HEADWAY_SECONDS,
  FALLBACK_HEADWAY_MINUTES,
  isFallbackHeadwaySeconds,
  isFallbackHeadwayMinutes,
  fallbackFrequencyBucketForRoute,
  decodeHtmlEntities,
  stripHtmlTags,
  parseHeadwayCellMinutes,
  parseHeadwaySummaryFromRoutePageHtml,
  fetchRouteHeadwaySummary
};
