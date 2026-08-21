const { localQuery, config, assertLocalConfigured } = require("./core");
const { normalizeText, normalizeRouteOrderingMode } = require("./utils");

async function getRouteOverride(lineKey) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) return null;
  const result = await localQuery(
    "select line_key, city_slug, payload, updated_at from public.route_override where line_key = $1 limit 1",
    [key]
  );
  return result.rows?.[0] || null;
}

async function listRouteOverrides(citySlug = "") {
  assertLocalConfigured();
  if (normalizeText(citySlug)) {
    const result = await localQuery(
      "select line_key, city_slug, payload, updated_at from public.route_override where (city_slug = $1 or city_slug is null) limit 5000",
      [normalizeText(citySlug)]
    );
    return result.rows || [];
  }

  const result = await localQuery("select line_key, city_slug, payload, updated_at from public.route_override limit 5000");
  return result.rows || [];
}

async function upsertRouteOverride(lineKey, citySlug, payload) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) throw new Error("lineKey is required");
  const city = normalizeText(citySlug) || null;
  const jsonPayload = payload && typeof payload === "object" ? payload : JSON.parse(JSON.stringify(payload || {}));

  await localQuery(
    `insert into public.route_override (line_key, city_slug, payload, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (line_key) do update set
       city_slug = excluded.city_slug,
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
    [key, city, JSON.stringify(jsonPayload)]
  );

  return getRouteOverride(key);
}

async function deleteRouteOverride(lineKey) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) return;
  await localQuery("delete from public.route_override where line_key = $1", [key]);
}

async function listRouteOverridesByLineKeys(lineKeys = []) {
  assertLocalConfigured();
  const normalizedLineKeys = Array.from(
    new Set(Array.isArray(lineKeys) ? lineKeys.map((entry) => normalizeText(entry)).filter(Boolean) : [])
  );

  if (!normalizedLineKeys.length) {
    return [];
  }

  const result = await localQuery(
    `select line_key, city_slug, payload, updated_at
     from public.route_override
     where line_key = any($1::text[])`,
    [normalizedLineKeys]
  );

  return result.rows || [];
}

async function upsertRouteOrderingVote(lineKey, citySlug, userId, orderingMode) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  const userKey = normalizeText(userId);
  const city = normalizeText(citySlug) || null;
  const mode = normalizeRouteOrderingMode(orderingMode);

  if (!key) throw new Error("lineKey is required");
  if (!userKey) throw new Error("userId is required");
  if (!mode || mode === "auto") throw new Error("orderingMode is required");

  await localQuery(
    `insert into public.route_ordering_vote (line_key, user_id, city_slug, ordering_mode, vote_source, updated_at)
     values ($1, $2, $3, $4, 'signed-in', now())
     on conflict (line_key, user_id) do update set
       city_slug = excluded.city_slug,
       ordering_mode = excluded.ordering_mode,
       vote_source = excluded.vote_source,
       updated_at = excluded.updated_at`,
    [key, userKey, city, mode]
  );

  return getRouteOrderingVote(key, userKey);
}

async function getRouteOrderingVote(lineKey, userId) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  const userKey = normalizeText(userId);
  if (!key || !userKey) {
    return null;
  }

  const result = await localQuery(
    `select line_key, user_id, city_slug, ordering_mode, vote_source, updated_at
     from public.route_ordering_vote
     where line_key = $1 and user_id = $2
     limit 1`,
    [key, userKey]
  );

  return result.rows?.[0] || null;
}

async function listRouteOrderingVoteCountsByLineKeys(lineKeys = []) {
  assertLocalConfigured();
  const normalizedLineKeys = Array.from(
    new Set(Array.isArray(lineKeys) ? lineKeys.map((entry) => normalizeText(entry)).filter(Boolean) : [])
  );

  if (!normalizedLineKeys.length) {
    return [];
  }

  const result = await localQuery(
    `select line_key, ordering_mode, count(*)::int as vote_count
     from public.route_ordering_vote
     where line_key = any($1::text[])
     group by line_key, ordering_mode`,
    [normalizedLineKeys]
  );

  return result.rows || [];
}

async function getRouteOrderingMetadataByLineKeys(lineKeys = []) {
  assertLocalConfigured();
  const normalizedLineKeys = Array.from(
    new Set(Array.isArray(lineKeys) ? lineKeys.map((entry) => normalizeText(entry)).filter(Boolean) : [])
  );

  if (!normalizedLineKeys.length) {
    return new Map();
  }

  const [overrideRows, voteRows] = await Promise.all([
    listRouteOverridesByLineKeys(normalizedLineKeys),
    listRouteOrderingVoteCountsByLineKeys(normalizedLineKeys)
  ]);

  const overrideByLineKey = new Map();
  for (const row of overrideRows || []) {
    const lineKey = normalizeText(row?.line_key);
    if (!lineKey || overrideByLineKey.has(lineKey)) {
      continue;
    }

    const orderingMode = normalizeRouteOrderingMode(row?.payload?.orderingMode);
    if (!orderingMode || orderingMode === "auto") {
      continue;
    }

    overrideByLineKey.set(lineKey, {
      lineKey,
      orderingModeDefaultMode: orderingMode,
      orderingModeDefaultSource: "admin",
      orderingModeAdminMode: orderingMode,
      orderingModeVoteCounts: {},
      orderingModeVoteTotal: 0
    });
  }

  const votesByLineKey = new Map();
  for (const row of voteRows || []) {
    const lineKey = normalizeText(row?.line_key);
    if (!lineKey) {
      continue;
    }

    const orderingMode = normalizeRouteOrderingMode(row?.ordering_mode);
    if (!orderingMode || orderingMode === "auto") {
      continue;
    }

    if (!votesByLineKey.has(lineKey)) {
      votesByLineKey.set(lineKey, {
        auto: 0,
        "geometry-revised": 0,
        "legacy-geometry": 0,
        fractions: 0,
        total: 0
      });
    }

    const bucket = votesByLineKey.get(lineKey);
    bucket[orderingMode] = Number(row.vote_count || 0);
    bucket.total += Number(row.vote_count || 0);
  }

  const voteThreshold = Math.max(1, Number(config.LINE_VIEW_ORDERING_VOTE_THRESHOLD || 5));
  const metadataByLineKey = new Map();

  for (const lineKey of normalizedLineKeys) {
    const override = overrideByLineKey.get(lineKey);
    if (override) {
      metadataByLineKey.set(lineKey, override);
      continue;
    }

    const voteCounts = votesByLineKey.get(lineKey) || {
      auto: 0,
      "geometry-revised": 0,
      "legacy-geometry": 0,
      fractions: 0,
      total: 0
    };

    const candidateModes = ["geometry-revised", "legacy-geometry", "fractions"];
    let winningMode = "";
    let winningCount = 0;
    let tie = false;

    for (const mode of candidateModes) {
      const count = Number(voteCounts[mode] || 0);
      if (count > winningCount) {
        winningMode = mode;
        winningCount = count;
        tie = false;
      } else if (count === winningCount && count > 0 && mode !== winningMode) {
        tie = true;
      }
    }

    const defaultMode = !tie && winningMode && winningCount >= voteThreshold ? winningMode : "auto";

    metadataByLineKey.set(lineKey, {
      lineKey,
      orderingModeDefaultMode: defaultMode,
      orderingModeDefaultSource: defaultMode === "auto" ? "auto" : "community",
      orderingModeAdminMode: "",
      orderingModeVoteCounts: voteCounts,
      orderingModeVoteTotal: Number(voteCounts.total || 0)
    });
  }

  return metadataByLineKey;
}

async function getRouteReview(lineKey) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) return null;
  const result = await localQuery(
    "select line_key, city_slug, problematic_override, updated_at from public.route_review where line_key = $1 limit 1",
    [key]
  );
  return result.rows?.[0] || null;
}

async function listRouteReviews(citySlug = "") {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  if (city) {
    const result = await localQuery(
      "select line_key, city_slug, problematic_override, updated_at from public.route_review where city_slug = $1 limit 10000",
      [city]
    );
    return result.rows || [];
  }

  const result = await localQuery(
    "select line_key, city_slug, problematic_override, updated_at from public.route_review limit 10000"
  );
  return result.rows || [];
}

async function upsertRouteReview(lineKey, citySlug, problematicOverride) {
  assertLocalConfigured();
  const key = normalizeText(lineKey);
  if (!key) throw new Error("lineKey is required");
  const city = normalizeText(citySlug) || null;
  const normalizedValue =
    problematicOverride === null || problematicOverride === undefined
      ? null
      : Boolean(problematicOverride);

  await localQuery(
    `insert into public.route_review (line_key, city_slug, problematic_override, updated_at)
     values ($1, $2, $3, now())
     on conflict (line_key) do update set
       city_slug = excluded.city_slug,
       problematic_override = excluded.problematic_override,
       updated_at = excluded.updated_at`,
    [key, city, normalizedValue]
  );

  return getRouteReview(key);
}

async function getAgencyReview(citySlug, operatorName) {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  const operator = normalizeText(operatorName);
  if (!city || !operator) return null;

  const result = await localQuery(
    "select city_slug, operator_name, allowed_override, updated_at from public.agency_review where city_slug = $1 and operator_name = $2 limit 1",
    [city, operator]
  );
  return result.rows?.[0] || null;
}

async function listAgencyReviews(citySlug = "") {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  if (city) {
    const result = await localQuery(
      "select city_slug, operator_name, allowed_override, updated_at from public.agency_review where city_slug = $1 order by operator_name asc limit 10000",
      [city]
    );
    return result.rows || [];
  }

  const result = await localQuery(
    "select city_slug, operator_name, allowed_override, updated_at from public.agency_review order by city_slug asc, operator_name asc limit 20000"
  );
  return result.rows || [];
}

async function upsertAgencyReview(citySlug, operatorName, allowedOverride) {
  assertLocalConfigured();
  const city = normalizeText(citySlug);
  const operator = normalizeText(operatorName);
  if (!city) throw new Error("citySlug is required");
  if (!operator) throw new Error("operatorName is required");

  const normalizedValue =
    allowedOverride === null || allowedOverride === undefined ? null : Boolean(allowedOverride);

  await localQuery(
    `insert into public.agency_review (city_slug, operator_name, allowed_override, updated_at)
     values ($1, $2, $3, now())
     on conflict (city_slug, operator_name) do update set
       allowed_override = excluded.allowed_override,
       updated_at = excluded.updated_at`,
    [city, operator, normalizedValue]
  );

  return getAgencyReview(city, operator);
}

module.exports = {
  getRouteOverride,
  listRouteOverrides,
  listRouteOverridesByLineKeys,
  upsertRouteOverride,
  deleteRouteOverride,
  getRouteOrderingVote,
  upsertRouteOrderingVote,
  listRouteOrderingVoteCountsByLineKeys,
  getRouteOrderingMetadataByLineKeys,
  getRouteReview,
  listRouteReviews,
  upsertRouteReview,
  getAgencyReview,
  listAgencyReviews,
  upsertAgencyReview
};
