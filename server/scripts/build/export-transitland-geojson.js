// Build pipeline step: export route geometries from Transitland REST as NDJSON.
// One file per city preset at data/tiles/geo/{slug}.ndjson, one GeoJSON
// Feature per line (a route-level MultiLineString).
//
// Usage:
//   node server/scripts/build/export-transitland-geojson.js
//   node server/scripts/build/export-transitland-geojson.js --cities seattle --limit 20
//
// Flags:
//   --cities=<csv>   Comma-separated city slugs (from server/processors/city-presets.js).
//                    Defaults to every preset city.
//   --limit=<n>      Cap the number of routes exported per city (test runs).
//   --help           Print usage.

const fs = require("fs");
const path = require("path");

const config = require("../../admin/config");
const {
  cities,
  getCityBySlug
} = require("../../processors/city-presets");
const { fetchRoutesAndStopsForBbox } = require("../../sources/transitland/fetch");
const { normalizeRoutes } = require("../../sources/transitland/routes");
const { routeToFeature } = require("../../sources/transitland/route-features");
const { getTransitlandMetrics } = require("../../sources/transitland/metrics");
const db = require("../../processors/data");

const OUTPUT_DIR = path.join(__dirname, "..", "..", "..", "data", "tiles", "geo");

function printUsage() {
  console.log(`Usage:
  node server/scripts/build/export-transitland-geojson.js [--cities=<csv>] [--limit=<n>]

Options:
  --cities=<csv>  Comma-separated city slugs (default: all presets)
  --limit=<n>     Cap routes per city (default: unlimited)
  --help          Show this help`);
}

function parseArgs(argv) {
  const args = { cities: null, limit: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    let key = arg;
    let value = null;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      key = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[i + 1];
      i += 1;
    }
    if (key === "--cities") {
      args.cities = value;
    } else if (key === "--limit") {
      const parsed = Number.parseInt(value, 10);
      args.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } else if (key === "--help") {
      args.help = true;
    }
  }
  return args;
}

function resolveCities(rawCsv) {
  if (!rawCsv) {
    return cities.slice();
  }

  const slugs = String(rawCsv)
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  const resolved = [];
  for (const slug of slugs) {
    const city = getCityBySlug(slug);
    if (city) {
      resolved.push(city);
    } else {
      console.warn(`[export] WARN: unknown city slug "${slug}" - skipping`);
    }
  }
  return resolved;
}

// The existing fetch accepts a routeTypes option; passing an empty list means
// no route_types filter is sent, so the REST API returns ALL route types.
async function fetchAllRouteTypesForBbox(bbox) {
  return fetchRoutesAndStopsForBbox(bbox, {
    includeAllTypes: true,
    routeTypes: [],
    enforceDailyCap: false,
    requestSource: "build"
  });
}

async function exportCity(city, limit) {
  const t0 = Date.now();
  const metricsBefore = getTransitlandMetrics();

  const result = await fetchAllRouteTypesForBbox(city.bbox);
  const normalized = normalizeRoutes(Array.isArray(result.routes) ? result.routes : []);
  const routes = limit && limit > 0 ? normalized.slice(0, limit) : normalized;

  const features = routes.map(routeToFeature).filter(Boolean);
  const filePath = path.join(OUTPUT_DIR, `${city.slug}.ndjson`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    features.map((feature) => JSON.stringify(feature)).join("\n") + "\n",
    "utf8"
  );

  const metricsAfter = getTransitlandMetrics();
  return {
    city,
    filePath,
    routeCount: features.length,
    elapsedMs: Date.now() - t0,
    restCalls: Math.max(0, metricsAfter.restApiRequestCount - metricsBefore.restApiRequestCount),
    vectorCalls: Math.max(0, metricsAfter.vectorTileRequestCount - metricsBefore.vectorTileRequestCount)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!config.TRANSITLAND_API_KEY) {
    console.error(
      "[export] ERROR: TRANSITLAND_API_KEY is not set. Set it in .env.development (or the file pointed to by METROMARK_ENV_FILE)."
    );
    process.exit(1);
  }

  const selectedCities = resolveCities(args.cities);
  if (!selectedCities.length) {
    console.error("[export] ERROR: no city presets matched the --cities argument.");
    process.exit(1);
  }

  const limit = args.limit || null;
  console.log(
    `[export] Exporting route GeoJSON for ${selectedCities.length} cities (limit per city: ${limit || "unlimited"})`
  );

  const totalStart = Date.now();
  let totalRoutes = 0;
  let failed = 0;

  for (const city of selectedCities) {
    try {
      const report = await exportCity(city, limit);
      totalRoutes += report.routeCount;
      console.log(
        `[export] ${city.slug}: ${report.routeCount} routes -> ${path.relative(process.cwd(), report.filePath)}` +
          ` (${report.elapsedMs}ms, rest calls: ${report.restCalls}, vector calls: ${report.vectorCalls})`
      );
    } catch (error) {
      failed += 1;
      console.error(`[export] ${city.slug}: FAILED - ${error?.message || error}`);
    }
  }

  const metrics = getTransitlandMetrics();
  const totalElapsedMs = Date.now() - totalStart;

  console.log(`[export] done. total routes: ${totalRoutes}, elapsed: ${(totalElapsedMs / 1000).toFixed(2)}s`);
  console.log(
    `[export] transitland REST calls this process: ${metrics.restApiRequestCount}` +
      ` (failures: ${metrics.restApiRequestFailureCount}), vector tile calls: ${metrics.vectorTileRequestCount}` +
      ` (failures: ${metrics.vectorTileRequestFailureCount})`
  );

  try {
    const usage = await db.getDailyUsageCapsState({
      rest: config.HARVEST_DAILY_REST_LIMIT,
      vector: config.HARVEST_DAILY_VECTOR_LIMIT,
      routing: config.HARVEST_DAILY_ROUTING_LIMIT
    });
    console.log(
      `[export] today's quota: rest ${usage.usage.restApiCalls}/${usage.limits.rest}` +
        ` (${usage.remaining.rest} remaining), vector ${usage.usage.vectorTileCalls}/${usage.limits.vector}` +
        ` (${usage.remaining.vector} remaining)`
    );
  } catch (error) {
    console.warn(`[export] WARN: could not read usage log: ${error?.message || error}`);
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`[export] Fatal: ${error?.stack || error}`);
  process.exit(1);
});
