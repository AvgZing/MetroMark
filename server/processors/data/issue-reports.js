const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeText } = require("./utils");

// Guard for stored screenshot payloads. Mirrors REPORT_SCREENSHOT_MAX_CHARS in
// public/scripts/shared/constants.js, which keeps the client under this limit.
const MAX_SCREENSHOT_CHARS = 600000;

function mapRow(row) {
  return {
    id: Number(row.id),
    bbox: row.bbox,
    zoom: row.zoom !== null && row.zoom !== undefined ? Number(row.zoom) : null,
    center: row.center,
    screenshot: row.screenshot || "",
    description: String(row.description || ""),
    reporterName: normalizeText(row.reporter_name),
    reporterEmail: normalizeText(row.reporter_email),
    status: normalizeText(row.status) || "open",
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

async function createIssueReport(data = {}) {
  assertLocalConfigured();
  const bbox = Array.isArray(data.bbox) && data.bbox.length === 4
    ? data.bbox.map((value) => Number(value))
    : null;
  if (!bbox || bbox.some((value) => !Number.isFinite(value))) {
    throw new Error("A valid bbox (west,south,east,north) is required.");
  }

  const center = data.center && Number.isFinite(Number(data.center.lon)) && Number.isFinite(Number(data.center.lat))
    ? { lon: Number(data.center.lon), lat: Number(data.center.lat) }
    : null;
  const zoom = Number.isFinite(Number(data.zoom)) ? Number(data.zoom) : null;
  const screenshot = String(data.screenshot || "").slice(0, MAX_SCREENSHOT_CHARS) || null;
  const description = String(data.description || "").trim().slice(0, 2000) || null;

  const { rows } = await localQuery(
    `insert into public.issue_report (
       bbox, zoom, center, screenshot, description, reporter_name, reporter_email, status, created_at
     ) values (
       $1::jsonb, $2, $3::jsonb, $4, $5, $6, $7, 'open', now()
     )
     returning *`,
    [
      JSON.stringify(bbox),
      zoom,
      center ? JSON.stringify(center) : null,
      screenshot,
      description,
      normalizeText(data.reporterName) || null,
      normalizeText(data.reporterEmail) || null
    ]
  );
  return rows?.[0] ? mapRow(rows[0]) : null;
}

async function listIssueReports(options = {}) {
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
    `select id, bbox, zoom, center, screenshot, description, reporter_name, reporter_email,
            status, created_at, resolved_at
     from public.issue_report
     ${where}
     order by created_at desc
     limit $${params.length}`,
    params
  );
  return (rows || []).map(mapRow);
}

async function getIssueReport(issueId) {
  assertLocalConfigured();
  const id = Number(issueId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const { rows } = await localQuery(
    `select id, bbox, zoom, center, screenshot, description, reporter_name, reporter_email,
            status, created_at, resolved_at
     from public.issue_report
     where id = $1 limit 1`,
    [id]
  );
  return rows?.[0] ? mapRow(rows[0]) : null;
}

async function resolveIssueReport(issueId) {
  assertLocalConfigured();
  const id = Number(issueId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const { rows } = await localQuery(
    "update public.issue_report set status = 'resolved', resolved_at = now() where id = $1 returning id",
    [id]
  );
  return rows?.[0] ? { id: Number(rows[0].id) } : null;
}

async function reopenIssueReport(issueId) {
  assertLocalConfigured();
  const id = Number(issueId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const { rows } = await localQuery(
    "update public.issue_report set status = 'open', resolved_at = null where id = $1 returning id",
    [id]
  );
  return rows?.[0] ? { id: Number(rows[0].id) } : null;
}

module.exports = {
  createIssueReport,
  listIssueReports,
  getIssueReport,
  resolveIssueReport,
  reopenIssueReport
};
