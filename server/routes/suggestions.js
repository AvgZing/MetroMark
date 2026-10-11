const express = require("express");

const db = require("../processors/data");
const { createLogger } = require("../admin/logger");

const router = express.Router();
const log = createLogger("suggestions");

const DAILY_IP_CAP = 25;
const ipCounts = new Map();

function clientKey(req) {
  return String(req.ip || (req.socket && req.socket.remoteAddress) || "unknown");
}

function pruneRateCounters() {
  const today = new Date().toISOString().slice(0, 10);
  if (ipCounts.size < 5000) {
    return;
  }
  for (const key of ipCounts.keys()) {
    if (!key.startsWith(`${today}:`)) {
      ipCounts.delete(key);
    }
  }
}

function parseOptionalUser(req) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return Promise.resolve(null);
  }
  return db.getUserFromToken(token).catch(() => null);
}

// Public endpoint: signed-in users and guests can suggest route changes from the
// line view. Submissions are queued for admin review; nothing is applied here.
router.post("/suggestions", async (req, res) => {
  pruneRateCounters();
  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `${today}:${clientKey(req)}`;
  const used = Number(ipCounts.get(rateKey) || 0);
  if (used >= DAILY_IP_CAP) {
    return res.status(429).json({ error: "Too many suggestions today. Please try again tomorrow." });
  }

  const lineKey = String(req.body?.lineKey || "").trim();
  if (!lineKey) {
    return res.status(400).json({ error: "lineKey is required." });
  }

  let reporter = null;
  try {
    reporter = await parseOptionalUser(req);
  } catch {
    reporter = null;
  }

  try {
    const suggestion = await db.createRouteSuggestion({
      lineKey,
      citySlug: req.body?.citySlug,
      payload: req.body?.payload,
      note: req.body?.note,
      reporterName: reporter?.displayName || reporter?.name || "",
      reporterEmail: reporter?.email || ""
    });
    ipCounts.set(rateKey, used + 1);
    log.info("Route suggestion received", { id: suggestion.id, lineKey, reporter: reporter?.email || "guest" });
    return res.status(201).json({ ok: true, id: suggestion.id, createdAt: suggestion.createdAt });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || error) });
  }
});

module.exports = router;
