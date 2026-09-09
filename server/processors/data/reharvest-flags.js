const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeText } = require("./utils");

// Reharvest review flags: records of data that changed or went missing during
// a manual viewport reharvest, so admin overrides / user edits that referenced
// now-missing entities can be reviewed instead of silently dropped.

async function listReharvestFlags(options = {}) {
  assertLocalConfigured();
  const status = normalizeText(options.status) || "";
  const params = [];
  let where = "";
  if (status) {
    params.push(status);
    where = "where status = $1";
  }
  const limit = Math.max(1, Math.min(Number(options.limit) || 500, 5000));
  params.push(limit);
  const { rows } = await localQuery(
    `select id, kind, line_key, station_key, message, status, created_at, resolved_at
     from public.reharvest_flag
     ${where}
     order by created_at desc
     limit $${params.length}`,
    params
  );
  return (rows || []).map((row) => ({
    id: Number(row.id),
    kind: normalizeText(row.kind),
    lineKey: normalizeText(row.line_key),
    stationKey: normalizeText(row.station_key),
    message: String(row.message || ""),
    status: normalizeText(row.status) || "open",
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  }));
}

async function openReharvestFlag(kind, message, data = {}) {
  assertLocalConfigured();
  const lineKey = normalizeText(data.lineKey) || null;
  const stationKey = normalizeText(data.stationKey) || null;
  if (!lineKey && !stationKey) {
    return null;
  }

  const existing = await localQuery(
    `select id from public.reharvest_flag
     where kind = $1 and line_key is not distinct from $2 and station_key is not distinct from $3
       and status = 'open' limit 1`,
    [normalizeText(kind), lineKey, stationKey]
  );
  if (existing.rows?.[0]) {
    return Number(existing.rows[0].id);
  }

  const { rows } = await localQuery(
    `insert into public.reharvest_flag (kind, line_key, station_key, message, status, created_at)
     values ($1, $2, $3, $4, 'open', now())
     returning id`,
    [normalizeText(kind), lineKey, stationKey, String(message || "")]
  );
  return rows?.[0] ? Number(rows[0].id) : null;
}

async function resolveReharvestFlag(flagId) {
  assertLocalConfigured();
  const id = Number(flagId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const { rows } = await localQuery(
    "update public.reharvest_flag set status = 'resolved', resolved_at = now() where id = $1 returning id",
    [id]
  );
  return rows?.[0] ? { id: Number(rows[0].id) } : null;
}

module.exports = {
  listReharvestFlags,
  openReharvestFlag,
  resolveReharvestFlag
};
