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
  } catch {}
}

function append(source, level, message, details) {
  ensureLogDir();
  let line = `[${utcStamp()}] [${level}] [${source}] ${message}`;
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
  } catch {}
}

function consoleLine(level, source, message) {
  const time = new Date().toTimeString().slice(0, 8);
  const label = level.toUpperCase().padEnd(5);
  // eslint-disable-next-line no-console
  console.log(`${time} [${label}] [${source}] ${message}`);
}

function createLogger(source) {
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
    debug(message, details) {
      append(source, "debug", message, details);
    },
    raw(message) {
      ensureLogDir();
      try {
        fs.appendFileSync(dayFile(source), message + "\n", "utf8");
      } catch {}
    }
  };
}

module.exports = {
  LOG_DIR,
  REPO_ROOT,
  createLogger,
  utcStamp
};
