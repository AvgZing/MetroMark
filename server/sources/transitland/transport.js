const config = require("../../admin/config");
const {
  TRANSITLAND_BASE_URL,
  transitlandMetrics
} = require("./metrics");
const { wait, enforceDailyUsageCapsIfNeeded, recordUsage } = require("./network");

async function transitlandRequest(path, params, options = {}) {
  if (!config.TRANSITLAND_API_KEY) {
    throw new Error("Transitland API key is missing. Set TRANSITLAND_API_KEY in .env.");
  }

  const searchParams = new URLSearchParams({
    ...params,
    api_key: config.TRANSITLAND_API_KEY
  });

  const url = `${TRANSITLAND_BASE_URL}${path}?${searchParams.toString()}`;
  const source = String(options.requestSource || "").trim().toLowerCase();
  const configuredRetries = Math.max(0, Number(config.TRANSITLAND_REQUEST_RETRIES || 0));
  // One retry is enough for bulk backfill pages; a timeout storm stalls the run.
  const retries = source === "backfill" ? Math.min(1, configuredRetries) : configuredRetries;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const configuredTimeout = Number(config.TRANSITLAND_REQUEST_TIMEOUT_MS || 15000);
    // Harvest requests cap at 30s so one hung route can't stall the backfill.
    const isHarvest = source.startsWith("harvest");
    // Backfill pages are quick; reharvest bulk geometry needs longer.
    const isBackfill = source === "backfill";
    const isReharvest = source === "reharvest";
    const timeoutMs = Math.max(
      1500,
      isBackfill
        ? 30000
        : isReharvest
          ? Math.max(configuredTimeout, 180000)
          : isHarvest
            ? Math.min(configuredTimeout, 30000)
            : configuredTimeout
    );
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    await enforceDailyUsageCapsIfNeeded("rest", options);
    transitlandMetrics.restApiRequestCount += 1;
    transitlandMetrics.lastRestRequestAt = new Date().toISOString();
    await recordUsage("rest", 1, options);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        transitlandMetrics.restApiRequestFailureCount += 1;

        if (retryable && attempt < retries) {
          await wait(280 * (attempt + 1));
          continue;
        }

        const requestError = new Error(
          `Transitland request failed (${response.status}): ${detail.slice(0, 220)}`
        );
        requestError.alreadyCounted = true;
        throw requestError;
      }

      return response.json();
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      if (!error?.alreadyCounted) {
        transitlandMetrics.restApiRequestFailureCount += 1;
      }

      if (timedOut && attempt < retries) {
        await wait(220 * (attempt + 1));
        continue;
      }

      if (timedOut) {
        throw new Error(`Transitland request timed out after ${timeoutMs}ms.`);
      }

      if (attempt < retries) {
        await wait(220 * (attempt + 1));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error("Transitland request failed after retries.");
}

module.exports = {
  transitlandRequest
};
