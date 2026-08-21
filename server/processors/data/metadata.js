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
        stopCount: Number(row.stop_count) || 0
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

  await localQuery(
    `insert into public.route_metadata (
      line_key, route_onestop_id, line_name, line_short_name, line_long_name,
      operator_name, mode, route_type, route_feed_id, service_tier,
      frequency_bucket, headway_best_minutes, headway_source, headway_checked,
      color, stop_count, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now()
    )
    on conflict (line_key) do update set
      route_onestop_id = excluded.route_onestop_id,
      line_name = excluded.line_name,
      line_short_name = excluded.line_short_name,
      line_long_name = excluded.line_long_name,
      operator_name = excluded.operator_name,
      mode = excluded.mode,
      route_type = excluded.route_type,
      route_feed_id = excluded.route_feed_id,
      service_tier = excluded.service_tier,
      frequency_bucket = excluded.frequency_bucket,
      headway_best_minutes = excluded.headway_best_minutes,
      headway_source = excluded.headway_source,
      headway_checked = excluded.headway_checked,
      color = excluded.color,
      stop_count = excluded.stop_count,
      updated_at = excluded.updated_at`,
    [
      normalizedLineKey,
      normalizeText(meta.routeOnestopId),
      normalizeText(meta.lineName),
      normalizeText(meta.lineShortName),
      normalizeText(meta.lineLongName),
      normalizeText(meta.operatorName),
      normalizeText(meta.mode),
      Number.isFinite(Number(meta.routeType)) ? Number(meta.routeType) : null,
      normalizeText(meta.routeFeedId),
      normalizeText(meta.serviceTier),
      normalizeText(meta.frequencyBucket) || "unknown",
      Number.isFinite(Number(meta.headwayBestMinutes)) ? Number(meta.headwayBestMinutes) : null,
      normalizeText(meta.headwaySource),
      Number(meta.headwayChecked || 0) === 1 ? 1 : 0,
      normalizeText(meta.color),
      Number(meta.stopCount || 0)
    ]
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
