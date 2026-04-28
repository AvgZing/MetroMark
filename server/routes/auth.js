const express = require("express");

const db = require("../db");
const { authMiddleware } = require("../auth");
const { userResponse } = require("./helpers");

const router = express.Router();

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
    return res.status(201).json(userResponse(result.user, result.token));
  } catch (error) {
    const message = String(error.message || "Registration failed.");
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
    return res.json(userResponse(result.user, result.token));
  } catch (error) {
    const message = String(error.message || "Invalid email or password.");
    const status = message.toLowerCase().includes("disabled") ? 403 : 401;
    return res.status(status).json({ error: message });
  }
});

router.post("/auth/demo-login", async (req, res) => {
  try {
    const result = await db.loginDemoAccount();
    return res.json(userResponse(result.user, result.token));
  } catch (error) {
    return res.status(500).json({ error: String(error.message || "Demo user is unavailable.") });
  }
});

router.get("/auth/me", authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
