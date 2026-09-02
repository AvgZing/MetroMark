// Shared MetroMark logger.
//
// Writes timestamped lines to BOTH the console (so the visible windows stay
// live) AND a per-day file under operations\Logs\<source>-YYYY-MM-DD.log.
// Files rotate automatically by date; old files are pruned on startup.
//
// Usage:
//   const { createLogger } = require("../server/admin/logger");
//   const log = createLogger("harvester");   // or "server", "backup"
//   log.info("Pass complete", { cities: 40 });
//   log.warn("Quota reached");
//   log.error("Boom", err);
//   log.debug("quiet detail that should NOT go to the console");

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LOG_DIR = path.join(REPO_ROOT, "operations", "Logs");
const RETENTION_DAYS = 14;

const prunedSources = new Set();

function utcStamp() {
  return new Date().toISOString();
}

function dayFile(source) {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return path.join(LOG_DIR, `${source}-${y}-${m}-${d}.log`);
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function pruneOld(source) {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!name.startsWith(`${source}-`) || !name.endsWith(".log")) {
        continue;
      }
      const filePath = path.join(LOG_DIR, name);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > RETENTION_DAYS * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // best-effort
  }
}

function append(source, level, message, details) {
  ensureLogDir();
  const iso = utcStamp();
  let line = `[${iso}] [${level}] [${source}] ${message}`;
  if (details !== undefined && details !== null) {
    if (details instanceof Error) {
      line += ` :: ${details.message}`;
    } else if (typeof details === "object") {
      try {
        line += ` :: ${JSON.stringify(details)}`;
      } catch {
        line += ` :: ${String(details)}`;
      }
    } else {
      line += ` :: ${String(details)}`;
    }
  }
  try {
    fs.appendFileSync(dayFile(source), line + "\n", "utf8");
  } catch {
    // logging must never crash the app
  }
}

function consoleLine(level, source, message) {
  const time = new Date().toTimeString().slice(0, 8);
  const label = level.toUpperCase().padEnd(5);
  // eslint-disable-next-line no-console
  console.log(`${time} [${label}] [${source}] ${message}`);
}

function createLogger(source) {
  // Prune old files for this source at most once per process.
  if (!prunedSources.has(source)) {
    prunedSources.add(source);
    pruneOld(source);
  }
  return {
    source,
    info(message, details) {
      consoleLine("info", source, message);
      append(source, "info", message, details);
    },
    warn(message, details) {
      consoleLine("warn", source, message);
      append(source, "warn", message, details);
    },
    error(message, details) {
      consoleLine("error", source, message);
      append(source, "error", message, details);
    },
    // File-only: keeps the console clean (route-load perf traces etc).
    debug(message, details) {
      append(source, "debug", message, details);
    },
    // Raw, pre-formatted line (used by harvesters that already build a prefix).
    raw(message) {
      ensureLogDir();
      try {
        fs.appendFileSync(dayFile(source), message + "\n", "utf8");
      } catch {
        // best-effort
      }
    }
  };
}

module.exports = {
  LOG_DIR,
  REPO_ROOT,
  createLogger,
  utcStamp
};
