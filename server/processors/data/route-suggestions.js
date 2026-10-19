const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeText } = require("./utils");

// Fields a user may suggest (admin-only edits excluded).
const STRING_FIELDS = ["lineName", "lineShortName", "lineLongName", "operatorName", "color"];
const NUMBER_FIELDS = ["mode", "headwayBestMinutes"];
const FREQUENCY_VALUES = ["frequent", "regular", "local", "unknown"];
const ORDERING_VALUES = ["auto", "geometry-revised", "legacy-geometry", "fractions", "manual"];

function sanitizePayload(input) {
  const source = input && typeof input === "object" ? input : {};
  const payload = {};
  for (const field of STRING_FIELDS) {
    const value = String(source[field] ?? "").trim();
    if (value) {
      payload[field] = value.slice(0, 200);
    }
  }
  for (const field of NUMBER_FIELDS) {
    const value = Number(source[field]);
    if (Number.isFinite(value)) {
      payload[field] = field === "mode" ? Math.trunc(value) : value;
    }
  }
  const frequency = String(source.frequencyBucket ?? "").trim().toLowerCase();
  if (FREQUENCY_VALUES.includes(frequency)) {
    payload.frequencyBucket = frequency;
  }
  const orderingMode = String(source.orderingMode ?? "").trim().toLowerCase();
  if (ORDERING_VALUES.includes(orderingMode)) {
    payload.orderingMode = orderingMode;
  }
  return payload;
}

function mapRow(row) {
  return {
    id: Number(row.id),
    lineKey: normalizeText(row.line_key),
    citySlug: normalizeText(row.city_slug),
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    note: String(row.note || ""),
    status: normalizeText(row.status) || "open",
    reporterName: normalizeText(row.reporter_name),
    reporterEmail: normalizeText(row.reporter_email),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: normalizeText(row.resolved_by)
  };
}

async function createRouteSuggestion(data = {}) {
  assertLocalConfigured();
  const lineKey = normalizeText(data.lineKey);
  if (!lineKey) {
    throw new Error("lineKey is required.");
  }
  const payload = sanitizePayload(data.payload);
  const note = String(data.note || "").trim().slice(0, 1000);
  if (!Object.keys(payload).length && !note) {
    throw new Error("Enter a change or a note.");
  }

  const { rows } = await localQuery(
    `insert into public.route_suggestion (
       line_key, city_slug, payload, note, status, reporter_name, reporter_email, created_at
     ) values (
       $1, $2, $3::jsonb, $4, 'open', $5, $6, now()
     )
     returning *`,
    [
      lineKey,
      normalizeText(data.citySlug) || null,
      JSON.stringify(payload),
      note || null,
      normalizeText(data.reporterName) || null,
      normalizeText(data.reporterEmail) || null
    ]
  );
  return rows?.[0] ? mapRow(rows[0]) : null;
}

async function listRouteSuggestions(options = {}) {
  assertLocalConfigured();
  const status = normalizeText(options.status);
  const params = [];
  let where = "";
  if (status) {
    params.push(status);
    where = "where status = $1";
  }
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 2000));
  params.push(limit);
  const { rows } = await localQuery(
    `select id, line_key, city_slug, payload, note, status, reporter_name, reporter_email,
            created_at, resolved_at, resolved_by
     from public.route_suggestion
     ${where}
     order by created_at desc
     limit $${params.length}`,
    params
  );
  return (rows || []).map(mapRow);
}

async function getRouteSuggestion(suggestionId) {
  assertLocalConfigured();
  const id = Number(suggestionId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const { rows } = await localQuery(
    `select id, line_key, city_slug, payload, note, status, reporter_name, reporter_email,
            created_at, resolved_at, resolved_by
     from public.route_suggestion
     where id = $1 limit 1`,
    [id]
  );
  return rows?.[0] ? mapRow(rows[0]) : null;
}

async function resolveRouteSuggestion(suggestionId, status, resolvedBy = "") {
  assertLocalConfigured();
  const id = Number(suggestionId);
  const nextStatus = normalizeText(status) || "applied";
  if (!Number.isFinite(id)) {
    return null;
  }
  const { rows } = await localQuery(
    `update public.route_suggestion
     set status = $2, resolved_at = now(), resolved_by = $3
     where id = $1 returning id`,
    [id, nextStatus, normalizeText(resolvedBy) || null]
  );
  return rows?.[0] ? { id: Number(rows[0].id) } : null;
}

module.exports = {
  createRouteSuggestion,
  listRouteSuggestions,
  getRouteSuggestion,
  resolveRouteSuggestion,
  sanitizePayload
};
