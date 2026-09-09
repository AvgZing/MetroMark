const express = require("express");

const db = require("../processors/data");
const { createLogger } = require("../admin/logger");

const router = express.Router();
const log = createLogger("issues");

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

// Public endpoint used from the map "Report Issue" control. Guests may report
// without an account; if a signed-in token is present the reporter identity is
// captured for the admin dashboard.
router.post("/issues/report", async (req, res) => {
  pruneRateCounters();
  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `${today}:${clientKey(req)}`;
  const used = Number(ipCounts.get(rateKey) || 0);
  if (used >= DAILY_IP_CAP) {
    return res.status(429).json({ error: "Too many reports today. Please try again tomorrow." });
  }

  const parts = String(req.body?.bbox || "").split(",").map((value) => Number(value.trim()));
  const bbox = parts.length === 4 && parts.every((value) => Number.isFinite(value)) ? parts : null;
  if (!bbox || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    return res.status(400).json({ error: "A valid bbox (west,south,east,north) is required." });
  }

  const screenshot = String(req.body?.screenshot || "");
  const safeScreenshot = screenshot.length <= 700000 && screenshot.startsWith("data:image/")
    ? screenshot
    : "";

  const description = String(req.body?.description || "").trim();

  let reporter = null;
  try {
    reporter = await parseOptionalUser(req);
  } catch {
    reporter = null;
  }

  try {
    const issue = await db.createIssueReport({
      bbox,
      zoom: req.body?.zoom,
      center: req.body?.center,
      screenshot: safeScreenshot,
      description,
      reporterName: reporter?.displayName || reporter?.name || "",
      reporterEmail: reporter?.email || ""
    });
    ipCounts.set(rateKey, used + 1);
    log.info("Issue report received", {
      id: issue.id,
      bbox,
      reporter: reporter?.email || "guest"
    });
    return res.status(201).json({ ok: true, id: issue.id, createdAt: issue.createdAt });
  } catch (error) {
    return res.status(500).json({ error: "Unable to save the report.", detail: String(error?.message || error) });
  }
});

module.exports = router;
