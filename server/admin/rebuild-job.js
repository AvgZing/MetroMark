const { buildPmtiles } = require("../scripts/build/build-pmtiles");
const { createLogger } = require("./logger");

const log = createLogger("rebuild-job");

// Background tile rebuild: mutations return immediately; the archive rebuilds
// in the background and clients poll getStatus() to know when it is done.
let pendingChanges = [];
let starting = false;

const state = {
  running: false,
  changes: [],
  startedAt: null,
  finishedAt: null,
  error: null
};

async function runRebuildLoop() {
  while (pendingChanges.length > 0) {
    state.running = true;
    state.changes = pendingChanges.slice();
    pendingChanges = [];
    state.startedAt = Date.now();
    state.error = null;
    try {
      await buildPmtiles({ log: { log: () => {} } });
    } catch (error) {
      state.error = String(error?.message || error);
      log.error("Background tile rebuild failed", { error: state.error });
    }
    state.running = false;
    state.finishedAt = Date.now();
  }
}

function scheduleRebuild(changes = []) {
  for (const change of changes) {
    const text = String(change || "").trim();
    if (text) {
      pendingChanges.push(text);
    }
  }
  if (state.running || starting || pendingChanges.length === 0) {
    return;
  }
  starting = true;
  runRebuildLoop()
    .catch(() => {})
    .finally(() => {
      starting = false;
    });
}

function getRebuildStatus() {
  return {
    running: state.running,
    changes: state.changes.slice(),
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error
  };
}

module.exports = { scheduleRebuild, getRebuildStatus };
