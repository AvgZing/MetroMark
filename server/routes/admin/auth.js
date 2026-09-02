const crypto = require("crypto");
const express = require("express");

const config = require("../../admin/config");
const db = require("../../processors/data");
const { createLogger } = require("../../admin/logger");

const router = express.Router();
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const adminSessions = new Map();
const log = createLogger("server");

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

// Admin accounts live in Supabase (profiles.role = 'admin'). The env var
// ADMIN_EMAIL designates the bootstrap admin: that account is granted the
// admin role on login (best-effort, via seedDefaultAdmin), and its password is
// authenticated by Supabase like any other account.
async function loginAdminAccount(email, password) {
  const normalizedEmail = normalizeEmailSafe(email);
  const isBootstrapEmail = Boolean(
    normalizedEmail && normalizedEmail === normalizeEmailSafe(config.ADMIN_EMAIL)
  );

  if (isBootstrapEmail) {
    try {
      await db.seedDefaultAdmin();
    } catch (error) {
      console.warn("[admin-auth] bootstrap admin seed failed:", error.message);
    }
  }

  const result = await db.loginAccount(email, password);
  const user = result.user;
  if (!user || String(user.role || "").trim() !== "admin") {
    const error = new Error("Account is not an admin.");
    error.status = 403;
    throw error;
  }
  return {
    email: user.email,
    role: user.role,
    source: "supabase-role",
    bootstrap: isBootstrapEmail
  };
}

function normalizeEmailSafe(value) {
  return String(value || "").trim().toLowerCase();
}

router.post("/admin/login", async (req, res) => {
  const email = normalizeAdminText(req.body?.email || req.body?.username);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const account = await loginAdminAccount(email, password);
    const token = issueAdminSession(account.email);
    log.info(`Admin signed in: ${account.email}`);
    return res.json({
      ok: true,
      token,
      email: account.email,
      role: account.role,
      source: account.source,
      expiresInMs: ADMIN_SESSION_TTL_MS
    });
  } catch (error) {
    const status = error.status || (String(error.message || "").includes("Invalid") ? 401 : 401);
    log.warn(`Admin sign-in failed: ${email} :: ${String(error.message || "")}`);
    return res.status(status).json({ error: error.message || "Invalid admin email or password." });
  }
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

  return res.json({ ok: true, email: session.username });
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
