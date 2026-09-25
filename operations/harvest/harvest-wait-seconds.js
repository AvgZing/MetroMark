#!/usr/bin/env node

// Runner wait seconds (idle, or until next UTC day when budget is spent).

const budget = require("../../server/sources/transitland/harvest-budget");

const IDLE_SECONDS = Math.max(30, Number(process.env.HARVEST_DELAY_SECONDS || 600));

function secondsToNextUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

try {
  const summary = budget.getSummary();
  const anyRemaining = summary.categories.some((category) => category.used < category.budget);
  process.stdout.write(String(anyRemaining ? IDLE_SECONDS : secondsToNextUtcMidnight()));
} catch {
  // If the budget state can't be read, fall back to the normal idle delay.
  process.stdout.write(String(IDLE_SECONDS));
}
