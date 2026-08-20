const { localQuery, assertLocalConfigured } = require("./core");
const { normalizeText, normalizeUsageRow, utcDateKey } = require("./utils");

function dayKeyFromTimestamp(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  return utcDateKey(date);
}

async function ensureUsageDay(dayKey) {
  assertLocalConfigured();
  await localQuery(
    `insert into public.usage_log (day_key, updated_at)
     values ($1, now())
     on conflict (day_key) do update set updated_at = excluded.updated_at`,
    [dayKey]
  );
}

async function getUsageForDay(dayKey) {
  assertLocalConfigured();
  const normalized = normalizeText(dayKey) || utcDateKey();
  await ensureUsageDay(normalized);

  const result = await localQuery(
    "select day_key,rest_api_calls,vector_tile_calls,routing_api_calls,updated_at from public.usage_log where day_key = $1 limit 1",
    [normalized]
  );

  return normalizeUsageRow(result.rows?.[0] || null, normalized);
}

async function getTodayUsage() {
  return getUsageForDay(utcDateKey());
}

async function incrementUsage(kind, amount = 1) {
  assertLocalConfigured();
  const safeKind = normalizeText(kind).toLowerCase();
  const safeAmount = Math.max(0, Number(amount || 0));
  if (!safeAmount) {
    return getTodayUsage();
  }

  const dayKey = utcDateKey();
  if (safeKind === "rest") {
    await localQuery(
      `insert into public.usage_log (day_key, rest_api_calls, updated_at)
       values ($1, $2, now())
       on conflict (day_key) do update set
         rest_api_calls = public.usage_log.rest_api_calls + excluded.rest_api_calls,
         updated_at = excluded.updated_at`,
      [dayKey, safeAmount]
    );
  } else if (safeKind === "vector") {
    await localQuery(
      `insert into public.usage_log (day_key, vector_tile_calls, updated_at)
       values ($1, $2, now())
       on conflict (day_key) do update set
         vector_tile_calls = public.usage_log.vector_tile_calls + excluded.vector_tile_calls,
         updated_at = excluded.updated_at`,
      [dayKey, safeAmount]
    );
  } else if (safeKind === "routing") {
    await localQuery(
      `insert into public.usage_log (day_key, routing_api_calls, updated_at)
       values ($1, $2, now())
       on conflict (day_key) do update set
         routing_api_calls = public.usage_log.routing_api_calls + excluded.routing_api_calls,
         updated_at = excluded.updated_at`,
      [dayKey, safeAmount]
    );
  } else {
    throw new Error(`Unknown usage kind: ${safeKind}`);
  }

  return getUsageForDay(dayKey);
}

async function getDailyUsageCapsState(limits) {
  const usage = await getTodayUsage();
  const restLimit = Math.max(1, Number(limits?.rest || 250));
  const vectorLimit = Math.max(1, Number(limits?.vector || 2500));
  const routingLimit = Math.max(1, Number(limits?.routing || 250));

  const restRemaining = Math.max(0, restLimit - usage.restApiCalls);
  const vectorRemaining = Math.max(0, vectorLimit - usage.vectorTileCalls);
  const routingRemaining = Math.max(0, routingLimit - usage.routingApiCalls);

  return {
    usage,
    limits: {
      rest: restLimit,
      vector: vectorLimit,
      routing: routingLimit
    },
    remaining: {
      rest: restRemaining,
      vector: vectorRemaining,
      routing: routingRemaining
    },
    reached: {
      rest: usage.restApiCalls >= restLimit,
      vector: usage.vectorTileCalls >= vectorLimit,
      routing: usage.routingApiCalls >= routingLimit
    },
    backgroundAllowed: !(
      usage.restApiCalls >= restLimit ||
      usage.vectorTileCalls >= vectorLimit ||
      usage.routingApiCalls >= routingLimit
    )
  };
}

module.exports = {
  dayKeyFromTimestamp,
  getUsageForDay,
  getTodayUsage,
  incrementUsage,
  getDailyUsageCapsState
};
