const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "state");
const STATE_FILE = path.join(STATE_DIR, "world-harvest.json");

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      phase: parsed.phase === "gaps" ? "gaps" : "cities",
      cityIndex: Number(parsed.cityIndex || 0),
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      processedCells: Number(parsed.processedCells || 0),
      emptyCells: Number(parsed.emptyCells || 0),
      transitCells: Number(parsed.transitCells || 0),
      failures: parsed.failures && typeof parsed.failures === "object" ? parsed.failures : {},
      lastRunAt: parsed.lastRunAt || null,
      totalRuns: Number(parsed.totalRuns || 0)
    };
  } catch {
    return {
      phase: "cities",
      cityIndex: 0,
      queue: [],
      processedCells: 0,
      emptyCells: 0,
      transitCells: 0,
      failures: {},
      lastRunAt: null,
      totalRuns: 0
    };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

module.exports = {
  STATE_DIR,
  STATE_FILE,
  loadState,
  saveState
};
