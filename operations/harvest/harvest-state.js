const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", "state");
const STATE_FILE = path.join(STATE_DIR, "world-harvest.json");
const COMPLETION_VERSION = 2;

function emptyState() {
  return {
    completionVersion: COMPLETION_VERSION,
    phase: "cities",
    cityIndex: 0,
    cityAttempts: {},
    queue: [],
    processedCells: 0,
    emptyCells: 0,
    transitCells: 0,
    failures: {},
    gapsCompleted: false,
    lastRunAt: null,
    totalRuns: 0
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const state = {
      completionVersion: Number(parsed.completionVersion || 1),
      phase: parsed.phase === "gaps" ? "gaps" : "cities",
      cityIndex: Number(parsed.cityIndex || 0),
      cityAttempts:
        parsed.cityAttempts && typeof parsed.cityAttempts === "object" ? parsed.cityAttempts : {},
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      processedCells: Number(parsed.processedCells || 0),
      emptyCells: Number(parsed.emptyCells || 0),
      transitCells: Number(parsed.transitCells || 0),
      failures: parsed.failures && typeof parsed.failures === "object" ? parsed.failures : {},
      gapsCompleted:
        Boolean(parsed.gapsCompleted) ||
        (parsed.phase === "gaps" && Array.isArray(parsed.queue) && parsed.queue.length === 0),
      lastRunAt: parsed.lastRunAt || null,
      totalRuns: Number(parsed.totalRuns || 0)
    };

    if (state.completionVersion < COMPLETION_VERSION) {
      // v2 re-checks every city with the coverage-key diff, so a v1 "done"
      // city (which only meant "one fetch succeeded") starts over.
      state.completionVersion = COMPLETION_VERSION;
      state.phase = "cities";
      state.cityIndex = 0;
      state.cityAttempts = {};
      // Keep gap-phase progress: only the city re-check is required here.
    }

    return state;
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

module.exports = {
  STATE_DIR,
  STATE_FILE,
  COMPLETION_VERSION,
  loadState,
  saveState
};
