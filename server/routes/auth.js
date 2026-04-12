const express = require("express");

const config = require("../config");
const db = require("../db");
const { createAuthToken, authMiddleware } = require("../auth");
const { userResponse } = require("./helpers");

const router = express.Router();

router.post("/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const displayName = String(req.body.displayName || "").trim();

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const created = db.createUser(email, password, displayName);
  if (!created) {
    return res.status(409).json({ error: "User already exists or payload is invalid." });
  }

  const token = createAuthToken(created);
  return res.status(201).json(userResponse(created, token));
});

router.post("/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.verifyUser(email, password);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = createAuthToken(user);
  return res.json(userResponse(user, token));
});

router.post("/auth/demo-login", (req, res) => {
  const demoUser = db.getUserByEmail(config.DEMO_USER_EMAIL);
  if (!demoUser) {
    return res.status(500).json({ error: "Demo user is unavailable." });
  }

  const token = createAuthToken(demoUser);
  return res.json(userResponse(demoUser, token));
});

router.get("/auth/me", authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
