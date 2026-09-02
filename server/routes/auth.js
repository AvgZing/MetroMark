const express = require("express");

const db = require("../processors/data");
const { authMiddleware } = require("../processors/supabase/auth");
const { userResponse } = require("./helpers");
const { createLogger } = require("../admin/logger");

const router = express.Router();
const log = createLogger("server");

router.post("/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const displayName = String(req.body.displayName || "").trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    const result = await db.registerAccount(email, password, displayName);
    log.info(`User registered: ${email}`);
    return res.status(201).json(userResponse(result.user, result.token));
  } catch (error) {
    const message = String(error.message || "Registration failed.");
    log.warn(`User registration failed: ${email} :: ${message}`);
    if (message.toLowerCase().includes("already")) {
      return res.status(409).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
});

router.post("/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  try {
    const result = await db.loginAccount(email, password);
    log.info(`User signed in: ${email}`);
    return res.json(userResponse(result.user, result.token));
  } catch (error) {
    const message = String(error.message || "Invalid email or password.");
    const status = message.toLowerCase().includes("disabled") ? 403 : 401;
    log.warn(`User sign-in failed: ${email} :: ${message}`);
    return res.status(status).json({ error: message });
  }
});

router.get("/auth/me", authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

router.patch("/auth/me/preferences", authMiddleware, async (req, res) => {
  const preferences = req.body && typeof req.body === "object" ? req.body.preferences : null;

  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return res.status(400).json({ error: "preferences payload is required." });
  }

  try {
    const user = await db.updateUserPreferences(req.user.id, preferences);
    return res.json({ user });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
