const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeText } = require("./utils");

async function getRouteMetadatasByLineKeys(lineKeys) {
  assertLocalConfigured();

  if (!Array.isArray(lineKeys) || lineKeys.length === 0) {
    return new Map();
  }

  const placeholders = lineKeys.map((_, index) => `$${index + 1}`).join(", ");
  const { rows } = await localQuery(
    `select * from public.route_metadata where line_key in (${placeholders})`,
    lineKeys.map((lk) => normalizeText(lk))
  );

  const metadataByLineKey = new Map();
  for (const row of rows || []) {
    const lk = normalizeText(row.line_key);
    if (lk) {
      metadataByLineKey.set(lk, {
        lineKey: lk,
        routeOnestopId: normalizeText(row.route_onestop_id),
        lineName: normalizeText(row.line_name),
        lineShortName: normalizeText(row.line_short_name),
        lineLongName: normalizeText(row.line_long_name),
        operatorName: normalizeText(row.operator_name),
        mode: normalizeText(row.mode),
        routeType: Number.isFinite(Number(row.route_type)) ? Number(row.route_type) : null,
        routeFeedId: normalizeText(row.route_feed_id),
        serviceTier: normalizeText(row.service_tier),
        frequencyBucket: normalizeText(row.frequency_bucket) || "unknown",
        headwayBestMinutes: Number.isFinite(Number(row.headway_best_minutes))
          ? Number(row.headway_best_minutes) : null,
        headwaySource: normalizeText(row.headway_source),
        headwayChecked: Number(row.headway_checked) === 1 ? 1 : 0,
        color: normalizeText(row.color),
        stopCount: Number(row.stop_count) || 0,
        problematicGeometry: Number(row.problematic_geometry) === 1
      });
    }
  }

  return metadataByLineKey;
}

async function setRouteMetadata(lineKey, metadata) {
  assertLocalConfigured();

  const normalizedLineKey = normalizeText(lineKey);
  if (!normalizedLineKey) {
    return null;
  }

  const meta = metadata || {};

  // Partial merge: only the columns the caller explicitly provides are
  // written; everything else is preserved. This stops a non-headway update
  // (e.g. a route-stops fetch) from clobbering stored headway/stop-count data.
  const COLUMN_MAP = {
    routeOnestopId: "route_onestop_id",
    lineName: "line_name",
    lineShortName: "line_short_name",
    lineLongName: "line_long_name",
    operatorName: "operator_name",
    mode: "mode",
    routeType: "route_type",
    routeFeedId: "route_feed_id",
    serviceTier: "service_tier",
    frequencyBucket: "frequency_bucket",
    headwayBestMinutes: "headway_best_minutes",
    headwaySource: "headway_source",
    headwayChecked: "headway_checked",
    color: "color",
    stopCount: "stop_count",
    problematicGeometry: "problematic_geometry"
  };

  const columns = [];
  const values = [];
  const setClauses = [];

  for (const [prop, column] of Object.entries(COLUMN_MAP)) {
    if (!Object.prototype.hasOwnProperty.call(meta, prop)) {
      continue;
    }

    let value;
    if (prop === "routeType") {
      value = Number.isFinite(Number(meta[prop])) ? Number(meta[prop]) : null;
    } else if (prop === "frequencyBucket") {
      value = normalizeText(meta[prop]) || "unknown";
    } else if (prop === "headwayBestMinutes") {
      value = Number.isFinite(Number(meta[prop])) ? Number(meta[prop]) : null;
    } else if (prop === "headwayChecked") {
      value = Number(meta[prop] || 0) === 1 ? 1 : 0;
    } else if (prop === "stopCount") {
      value = Number(meta[prop] || 0);
    } else if (prop === "problematicGeometry") {
      value = Boolean(meta[prop]) ? 1 : 0;
    } else {
      value = normalizeText(meta[prop]);
    }

    columns.push(column);
    values.push(value);
    setClauses.push(`${column} = excluded.${column}`);
  }

  if (!columns.length) {
    return { lineKey: normalizedLineKey };
  }

  const placeholders = columns.map((_, index) => `$${index + 2}`).join(", ");
  await localQuery(
    `insert into public.route_metadata (line_key, ${columns.join(", ")}, updated_at)
     values ($1, ${placeholders}, now())
     on conflict (line_key) do update set
       ${setClauses.join(", ")},
       updated_at = excluded.updated_at`,
    [normalizedLineKey, ...values]
  );

  return { lineKey: normalizedLineKey };
}

async function getRouteMetadataCoverageStats() {
  assertLocalConfigured();
  const result = await localQuery(
    `select
       count(*)::int as total_routes,
       count(*) filter (where headway_checked = 1)::int as covered_headway,
       count(distinct operator_name)::int as distinct_operators,
       count(*) filter (where stop_count > 0)::int as routes_with_stop_counts
     from public.route_metadata`
  );
  const row = result.rows?.[0] || {};
  return {
    totalRoutes: Number(row.total_routes || 0),
    coveredHeadway: Number(row.covered_headway || 0),
    distinctOperators: Number(row.distinct_operators || 0),
    routesWithStopCounts: Number(row.routes_with_stop_counts || 0)
  };
}

module.exports = {
  getRouteMetadatasByLineKeys,
  setRouteMetadata,
  getRouteMetadataCoverageStats
};
