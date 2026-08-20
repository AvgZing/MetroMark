const crypto = require("crypto");
const express = require("express");

const config = require("../../admin/config");
const db = require("../../processors/data");

const router = express.Router();
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const adminSessions = new Map();

function normalizeAdminText(value) {
  return String(value || "").trim();
}

function cleanupExpiredAdminSessions() {
  const now = Date.now();
  for (const [token, entry] of adminSessions.entries()) {
    if (!entry || entry.expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function issueAdminSession(username) {
  cleanupExpiredAdminSessions();
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, {
    username,
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS
  });
  return token;
}

function getAdminSession(req) {
  cleanupExpiredAdminSessions();
  const header = normalizeAdminText(req.headers.authorization);
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return null;
  }

  const session = adminSessions.get(token) || null;
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function isConfiguredAdminLogin(username, password) {
  if (!config.ADMIN_USERNAME || !config.ADMIN_PASSWORD) {
    return false;
  }

  return normalizeAdminText(username) === config.ADMIN_USERNAME && String(password || "") === config.ADMIN_PASSWORD;
}

function attachAdminSession(res, token) {
  return res.json({
    ok: true,
    token,
    expiresInMs: ADMIN_SESSION_TTL_MS
  });
}

router.post("/admin/login", async (req, res) => {
  const username = normalizeAdminText(req.body?.username);
  const password = String(req.body?.password || "");

  if (!isConfiguredAdminLogin(username, password)) {
    return res.status(401).json({ error: "Invalid admin username or password." });
  }

  const token = issueAdminSession(username);
  return attachAdminSession(res, token);
});

router.post("/admin/logout", (req, res) => {
  const session = getAdminSession(req);
  if (session?.token) {
    adminSessions.delete(session.token);
  }
  return res.json({ ok: true });
});

router.get("/admin/session", (req, res) => {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({ error: "Admin session required." });
  }

  return res.json({ ok: true, username: session.username });
});

async function isAdminAuthorized(req) {
  const session = getAdminSession(req);
  if (session) {
    return true;
  }

  const tokenHeader = String(req.headers.authorization || "").trim();
  const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.slice(7) : tokenHeader || null;
  if (token) {
    try {
      const user = await db.getUserFromToken(token);
      if (user && String(user.role || "").trim() === "admin") {
        return true;
      }
    } catch (e) {
      // ignore
    }
  }
  return false;
}

module.exports = {
  router,
  isAdminAuthorized
};
