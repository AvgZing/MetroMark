const fs = require("fs");
const path = require("path");

// Per-category daily REST budget for the MetroMark harvesters.
//
// The shared REST cap is split into three categories that never starve each
// other: geometry (harvest-world), headway (harvest-headway), and stops
// (harvest-stops). Each category gets 100 calls/day while active. When a
// category is "nearly done" (its pass has worked through all the main work and
// is only filling the remaining world slowly), its budget drops to 50/day, and
// the total daily limit tightens accordingly:
//
//   0 nearly done: 100 + 100 + 100 = 300
//   1 nearly done:  50 + 100 + 100 = 250
//   2 nearly done:  50 +  50 + 100 = 200
//   3 nearly done:  50 +  50 +  50 = 150
//
// User-side requests (requestSource "user" / "backfill" / "build") are never
// capped and never consume a harvest category budget.

const ACTIVE_BUDGET = 100;
const NEAR_DONE_BUDGET = 50;

const CATEGORIES = ["geometry", "headway", "stops"];

const STATE_DIR = path.join(__dirname, "..", "..", "..", "operations", "state");
const BUDGET_FILE = process.env.HARVEST_BUDGET_FILE
  ? path.resolve(process.env.HARVEST_BUDGET_FILE)
  : path.join(STATE_DIR, "harvest-budget.json");

function utcDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultState() {
  return {
    dayKey: utcDateKey(),
    counts: { geometry: 0, headway: 0, stops: 0 },
    nearDone: { geometry: false, headway: false, stops: false }
  };
}

function loadState() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  } catch {
    // fresh file
  }

  const today = utcDateKey();
  const state = defaultState();

  if (parsed && parsed.nearDone) {
    state.nearDone = {
      geometry: Boolean(parsed.nearDone.geometry),
      headway: Boolean(parsed.nearDone.headway),
      stops: Boolean(parsed.nearDone.stops)
    };
  }

  // New UTC day: reset usage counts but keep the near-done progress.
  if (parsed && parsed.dayKey === today && parsed.counts) {
    state.counts = {
      geometry: Number(parsed.counts.geometry || 0),
      headway: Number(parsed.counts.headway || 0),
      stops: Number(parsed.counts.stops || 0)
    };
  }

  return state;
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(state, null, 2), "utf8");
}

function categoryFromSource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "harvest-world") {
    return "geometry";
  }
  if (normalized === "harvest-headway") {
    return "headway";
  }
  if (normalized === "harvest-stops") {
    return "stops";
  }
  return null;
}

function getCategoryBudget(category) {
  const state = loadState();
  return state.nearDone[category] ? NEAR_DONE_BUDGET : ACTIVE_BUDGET;
}

function getRemaining(category) {
  const state = loadState();
  const budget = getCategoryBudget(category);
  const used = Number(state.counts[category] || 0);
  return Math.max(0, budget - used);
}

function canContinue(category) {
  return getRemaining(category) > 0;
}

function enforceCategory(category) {
  if (!canContinue(category)) {
    const state = loadState();
    const budget = getCategoryBudget(category);
    const used = Number(state.counts[category] || 0);
    const error = new Error(
      `Daily ${category} REST budget reached (${used}/${budget}). Harvesting paused until the next UTC day.`
    );
    error.code = "DAILY_USAGE_LIMIT_REACHED";
    throw error;
  }
}

function recordUsage(category, amount = 1) {
  if (!category || !CATEGORIES.includes(category)) {
    return;
  }
  const state = loadState();
  const safeAmount = Math.max(1, Number(amount || 1));
  state.counts[category] = Number(state.counts[category] || 0) + safeAmount;
  saveState(state);
}

function setNearlyDone(category, value) {
  if (!category || !CATEGORIES.includes(category)) {
    return;
  }
  const state = loadState();
  state.nearDone[category] = Boolean(value);
  saveState(state);
}

function getTotalBudget() {
  const state = loadState();
  return CATEGORIES.reduce((sum, category) => {
    return sum + (state.nearDone[category] ? NEAR_DONE_BUDGET : ACTIVE_BUDGET);
  }, 0);
}

function getSummary() {
  const state = loadState();
  return {
    dayKey: state.dayKey,
    categories: CATEGORIES.map((category) => ({
      category,
      used: Number(state.counts[category] || 0),
      budget: state.nearDone[category] ? NEAR_DONE_BUDGET : ACTIVE_BUDGET,
      nearlyDone: Boolean(state.nearDone[category])
    })),
    totalBudget: getTotalBudget()
  };
}

module.exports = {
  ACTIVE_BUDGET,
  NEAR_DONE_BUDGET,
  CATEGORIES,
  BUDGET_FILE,
  utcDateKey,
  categoryFromSource,
  getCategoryBudget,
  getRemaining,
  canContinue,
  enforceCategory,
  recordUsage,
  setNearlyDone,
  getTotalBudget,
  getSummary
};
