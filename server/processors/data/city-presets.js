const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeText } = require("./utils");

// Curated city collections: a city is an admin-vetted set of routes. Membership
// comes from two rules, resolved at read time so upstream service changes flow
// in without re-editing the city:
//   - operator rules: every current route of an included operator
//   - route rules: explicit per-route include/exclude
// Resolution = (included operators ∪ included routes) − excluded routes, where
// an explicit route include beats an operator exclude and a route exclude wins.
// Vetting (accuracy / up-to-date / stop order) is per explicit route row and is
// QA metadata, not membership.
//
// Deliberately separate from:
//   - server/processors/city-presets.js (static harvest baseline metro list)
//   - user_filter_presets (Supabase, per-user filter snapshots)

function normalizeCityRow(row) {
  if (!row) {
    return null;
  }
  const hasCenter = Number.isFinite(Number(row.center_lon)) && Number.isFinite(Number(row.center_lat));
  return {
    slug: normalizeText(row.slug),
    name: normalizeText(row.name),
    country: normalizeText(row.country),
    center: hasCenter ? [Number(row.center_lon), Number(row.center_lat)] : null,
    bbox: Array.isArray(row.bbox) ? row.bbox.map(Number) : null,
    defaultZoom: row.default_zoom === null || row.default_zoom === undefined ? null : Number(row.default_zoom),
    published: Boolean(row.published),
    notes: normalizeText(row.notes),
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: row.updated_at || null
  };
}

function normalizeRouteRow(row) {
  if (!row) {
    return null;
  }
  return {
    lineKey: normalizeText(row.line_key),
    included: row.included !== false,
    vettedAccuracy: Boolean(row.vetted_accuracy),
    vettedUpToDate: Boolean(row.vetted_up_to_date),
    vettedStopOrder: Boolean(row.vetted_stop_order),
    vettedAt: row.vetted_at || null,
    vettedBy: normalizeText(row.vetted_by) || "",
    sortOrder: Number(row.sort_order) || 0
  };
}

function normalizeOperatorRow(row) {
  if (!row) {
    return null;
  }
  return {
    operatorName: normalizeText(row.operator_name),
    included: row.included !== false,
    sortOrder: Number(row.sort_order) || 0
  };
}

async function listLineKeysByOperatorNames(names = []) {
  const wanted = Array.from(new Set((Array.isArray(names) ? names : []).map(normalizeText).filter(Boolean)));
  const map = new Map();
  if (!wanted.length) {
    return map;
  }
  const result = await localQuery(
    "select line_key, operator_name from public.route_metadata where operator_name = any($1::text[])",
    [wanted]
  );
  for (const row of result.rows || []) {
    const operator = normalizeText(row.operator_name);
    if (!operator) continue;
    if (!map.has(operator)) {
      map.set(operator, []);
    }
    map.get(operator).push(normalizeText(row.line_key));
  }
  return map;
}

// Pure resolution shared by getCityPreset and listCityRouteKeySets.
function computeResolvedKeys(routeRows, operatorRows, operatorKeyMap) {
  const includedRoutes = new Set(
    (routeRows || []).filter((row) => row.included !== false).map((row) => normalizeText(row.line_key))
  );
  const excludedRoutes = new Set(
    (routeRows || []).filter((row) => row.included === false).map((row) => normalizeText(row.line_key))
  );

  const resolved = new Set(includedRoutes);
  for (const operator of operatorRows || []) {
    const operatorName = normalizeText(operator.operator_name);
    const keys = operatorKeyMap.get(operatorName) || [];
    if (operator.included !== false) {
      for (const key of keys) {
        resolved.add(key);
      }
    } else {
      for (const key of keys) {
        if (!includedRoutes.has(key)) {
          resolved.delete(key);
        }
      }
    }
  }

  for (const key of excludedRoutes) {
    resolved.delete(key);
  }

  return Array.from(resolved).filter(Boolean).sort();
}

async function listCityPresets(options = {}) {
  assertLocalConfigured();
  const where = options.publishedOnly ? "where c.published = true" : "";
  const result = await localQuery(
    `select c.slug, c.name, c.country, c.center_lon, c.center_lat, c.bbox, c.default_zoom,
            c.published, c.notes, c.sort_order, c.updated_at
       from public.city_preset c
       ${where}
      order by c.sort_order asc, c.name asc`
  );
  const rowList = result.rows || [];
  if (!rowList.length) {
    return [];
  }
  const keySets = await listCityRouteKeySets({ publishedOnly: Boolean(options.publishedOnly) });
  const operatorCounts = await listCityOperatorCounts();
  return rowList.map((row) => {
    const slug = normalizeText(row.slug);
    const keys = keySets.get(slug) || [];
    return {
      ...normalizeCityRow(row),
      routeCount: keys.length,
      operatorCount: operatorCounts.get(slug) || 0
    };
  });
}

async function listCityOperatorCounts() {
  const result = await localQuery(
    "select city_slug, count(*) filter (where included) as operator_count from public.city_preset_operator group by city_slug"
  );
  const map = new Map();
  for (const row of result.rows || []) {
    map.set(normalizeText(row.city_slug), Number(row.operator_count) || 0);
  }
  return map;
}

async function getCityPreset(slug) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    return null;
  }
  const meta = await localQuery("select * from public.city_preset where slug = $1 limit 1", [key]);
  const cityRow = meta.rows?.[0];
  if (!cityRow) {
    return null;
  }

  const [routeResult, operatorResult] = await Promise.all([
    localQuery(
      `select line_key, included, vetted_accuracy, vetted_up_to_date, vetted_stop_order,
              vetted_at, vetted_by, sort_order
         from public.city_preset_route
        where city_slug = $1
        order by sort_order asc, line_key asc`,
      [key]
    ),
    localQuery(
      `select operator_name, included, sort_order
         from public.city_preset_operator
        where city_slug = $1
        order by sort_order asc, operator_name asc`,
      [key]
    )
  ]);

  const routes = (routeResult.rows || []).map(normalizeRouteRow).filter(Boolean);
  const operators = (operatorResult.rows || []).map(normalizeOperatorRow).filter(Boolean);
  const operatorKeyMap = await listLineKeysByOperatorNames(operators.map((entry) => entry.operatorName));
  const routeKeys = computeResolvedKeys(routeResult.rows || [], operatorResult.rows || [], operatorKeyMap);

  return {
    ...normalizeCityRow(cityRow),
    routeCount: routeKeys.length,
    routeKeys,
    routes,
    operators
  };
}

async function upsertCityPreset(slug, fields = {}) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    throw new Error("slug is required");
  }
  const name = normalizeText(fields.name) || key;
  const country = normalizeText(fields.country) || "";
  const center = Array.isArray(fields.center) && fields.center.length === 2
    ? fields.center.map(Number)
    : [null, null];
  const centerLon = Number.isFinite(center[0]) ? center[0] : null;
  const centerLat = Number.isFinite(center[1]) ? center[1] : null;
  const bbox = Array.isArray(fields.bbox) && fields.bbox.length === 4
    ? fields.bbox.map((value) => Number(value))
    : null;
  const defaultZoom = Number.isFinite(Number(fields.defaultZoom)) ? Number(fields.defaultZoom) : null;
  const published = Boolean(fields.published);
  const notes = normalizeText(fields.notes) || "";
  const sortOrder = Number.isFinite(Number(fields.sortOrder)) ? Number(fields.sortOrder) : 0;

  await localQuery(
    `insert into public.city_preset
       (slug, name, country, center_lon, center_lat, bbox, default_zoom, published, notes, sort_order, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, now())
     on conflict (slug) do update set
       name = excluded.name,
       country = excluded.country,
       center_lon = excluded.center_lon,
       center_lat = excluded.center_lat,
       bbox = excluded.bbox,
       default_zoom = excluded.default_zoom,
       published = excluded.published,
       notes = excluded.notes,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
    [key, name, country, centerLon, centerLat, JSON.stringify(bbox), defaultZoom, published, notes, sortOrder]
  );

  return getCityPreset(key);
}

async function deleteCityPreset(slug) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    return;
  }
  await localQuery("delete from public.city_preset where slug = $1", [key]);
}

function normalizeRouteInput(entry) {
  const lineKey = normalizeText(entry?.lineKey || entry?.line_key);
  if (!lineKey) {
    return null;
  }
  const vettedAccuracy = Boolean(entry?.vettedAccuracy ?? entry?.vetted_accuracy);
  const vettedUpToDate = Boolean(entry?.vettedUpToDate ?? entry?.vetted_up_to_date);
  const vettedStopOrder = Boolean(entry?.vettedStopOrder ?? entry?.vetted_stop_order);
  const anyVetted = vettedAccuracy || vettedUpToDate || vettedStopOrder;
  return {
    lineKey,
    included: entry?.included !== false,
    vettedAccuracy,
    vettedUpToDate,
    vettedStopOrder,
    anyVetted,
    vettedBy: normalizeText(entry?.vettedBy ?? entry?.vetted_by) || "",
    sortOrder: Number.isFinite(Number(entry?.sortOrder ?? entry?.sort_order)) ? Number(entry.sortOrder ?? entry.sort_order) : 0
  };
}

async function upsertCityRouteRows(slug, routes = []) {
  const entries = (Array.isArray(routes) ? routes : []).map(normalizeRouteInput).filter(Boolean);
  for (const entry of entries) {
    await localQuery(
      `insert into public.city_preset_route
         (city_slug, line_key, included, vetted_accuracy, vetted_up_to_date, vetted_stop_order,
          vetted_at, vetted_by, sort_order, updated_at)
       values ($1, $2, $3, $4, $5, $6, case when $7 then now() else null end, $8, $9, now())
       on conflict (city_slug, line_key) do update set
         included = excluded.included,
         vetted_accuracy = excluded.vetted_accuracy,
         vetted_up_to_date = excluded.vetted_up_to_date,
         vetted_stop_order = excluded.vetted_stop_order,
         vetted_at = case when $7 then now() else null end,
         vetted_by = excluded.vetted_by,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
      [
        slug,
        entry.lineKey,
        entry.included,
        entry.vettedAccuracy,
        entry.vettedUpToDate,
        entry.vettedStopOrder,
        entry.anyVetted,
        entry.vettedBy || null,
        entry.sortOrder
      ]
    );
  }
  return entries;
}

// Set explicit route rules. Replaces the full set unless { replace: false }.
async function setCityPresetRoutes(slug, routes = [], options = {}) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    throw new Error("slug is required");
  }
  const entries = await upsertCityRouteRows(key, routes);
  if (options.replace !== false) {
    await localQuery(
      "delete from public.city_preset_route where city_slug = $1 and not (line_key = any($2::text[]))",
      [key, entries.map((entry) => entry.lineKey)]
    );
  }
  return getCityPreset(key);
}

// Patch individual route rules (add/update/exclude) without touching the rest.
async function patchCityPresetRoutes(slug, routes = []) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    throw new Error("slug is required");
  }
  await upsertCityRouteRows(key, routes);
  return getCityPreset(key);
}

async function removeCityPresetRoutes(slug, lineKeys = []) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  const keys = Array.from(new Set((Array.isArray(lineKeys) ? lineKeys : []).map(normalizeText).filter(Boolean)));
  if (!key || !keys.length) {
    return getCityPreset(key);
  }
  await localQuery(
    "delete from public.city_preset_route where city_slug = $1 and line_key = any($2::text[])",
    [key, keys]
  );
  return getCityPreset(key);
}

function normalizeOperatorInput(entry) {
  const operatorName = normalizeText(entry?.operatorName || entry?.operator_name);
  if (!operatorName) {
    return null;
  }
  return {
    operatorName,
    included: entry?.included !== false,
    sortOrder: Number.isFinite(Number(entry?.sortOrder ?? entry?.sort_order)) ? Number(entry.sortOrder ?? entry.sort_order) : 0
  };
}

async function upsertCityOperatorRows(slug, operators = []) {
  const entries = (Array.isArray(operators) ? operators : []).map(normalizeOperatorInput).filter(Boolean);
  for (const entry of entries) {
    await localQuery(
      `insert into public.city_preset_operator (city_slug, operator_name, included, sort_order, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (city_slug, operator_name) do update set
         included = excluded.included,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
      [slug, entry.operatorName, entry.included, entry.sortOrder]
    );
  }
  return entries;
}

// Set operator rules. Replaces the full set unless { replace: false }.
async function setCityPresetOperators(slug, operators = [], options = {}) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    throw new Error("slug is required");
  }
  const entries = await upsertCityOperatorRows(key, operators);
  if (options.replace !== false) {
    await localQuery(
      "delete from public.city_preset_operator where city_slug = $1 and not (operator_name = any($2::text[]))",
      [key, entries.map((entry) => entry.operatorName)]
    );
  }
  return getCityPreset(key);
}

// Patch individual operator rules (add/update/exclude) without touching the rest.
async function patchCityPresetOperators(slug, operators = []) {
  assertLocalConfigured();
  const key = normalizeText(slug);
  if (!key) {
    throw new Error("slug is required");
  }
  await upsertCityOperatorRows(key, operators);
  return getCityPreset(key);
}

// Resolve every city's route keys in one pass (used by the catalog and counts).
async function listCityRouteKeySets(options = {}) {
  assertLocalConfigured();
  const cityWhere = options.publishedOnly ? "where published = true" : "";
  const citiesResult = await localQuery(`select slug from public.city_preset ${cityWhere}`);
  const slugs = (citiesResult.rows || []).map((row) => normalizeText(row.slug)).filter(Boolean);
  const map = new Map();
  if (!slugs.length) {
    return map;
  }

  const [routeResult, operatorResult] = await Promise.all([
    localQuery("select city_slug, line_key, included from public.city_preset_route"),
    localQuery("select city_slug, operator_name, included from public.city_preset_operator")
  ]);
  const routeRows = routeResult.rows || [];
  const operatorRows = operatorResult.rows || [];
  const operatorNames = Array.from(
    new Set(operatorRows.map((row) => normalizeText(row.operator_name)).filter(Boolean))
  );
  const operatorKeyMap = await listLineKeysByOperatorNames(operatorNames);

  for (const slug of slugs) {
    map.set(
      slug,
      computeResolvedKeys(
        routeRows.filter((row) => normalizeText(row.city_slug) === slug),
        operatorRows.filter((row) => normalizeText(row.city_slug) === slug),
        operatorKeyMap
      )
    );
  }
  return map;
}

// Distinct operators that have route metadata, for the admin operator picker.
async function listOperators(query = "") {
  assertLocalConfigured();
  const search = normalizeText(query);
  const result = await localQuery(
    `select operator_name, count(*)::int as route_count
       from public.route_metadata
      where operator_name <> '' and ($1 = '' or operator_name ilike '%' || $1 || '%')
      group by operator_name
      order by route_count desc, operator_name asc
      limit 200`,
    [search]
  );
  return (result.rows || []).map((row) => ({
    operatorName: normalizeText(row.operator_name),
    routeCount: Number(row.route_count) || 0
  }));
}

module.exports = {
  listCityPresets,
  getCityPreset,
  upsertCityPreset,
  deleteCityPreset,
  setCityPresetRoutes,
  patchCityPresetRoutes,
  removeCityPresetRoutes,
  setCityPresetOperators,
  patchCityPresetOperators,
  listCityRouteKeySets,
  listOperators
};
