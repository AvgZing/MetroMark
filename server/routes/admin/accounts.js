const express = require("express");

const config = require("../../admin/config");
const db = require("../../processors/data");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

router.get("/admin/accounts", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }

  try {
    const profiles = await db.listProfiles();
    return res.json({ accounts: profiles });
  } catch (error) {
    return res.json({
      accounts: [],
      unreachable: true,
      detail: error.message
    });
  }
});

router.post("/admin/accounts/:userId/role", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }

  const userId = String(req.params.userId || "").trim();
  const role = String(req.body?.role || "").trim();
  const isActive = req.body?.isActive === undefined ? undefined : Boolean(req.body.isActive);

  if (!userId) {
    return res.status(400).json({ error: "userId is required." });
  }
  if (role !== "admin" && role !== "user") {
    return res.status(400).json({ error: "role must be 'admin' or 'user'." });
  }

  try {
    const target = await db.getUserById(userId);
    const targetEmail = String(target?.email || "").trim().toLowerCase();
    const bootstrapEmail = String(config.ADMIN_EMAIL || "").trim().toLowerCase();

    if (targetEmail && bootstrapEmail && targetEmail === bootstrapEmail && role !== "admin") {
      return res.status(400).json({
        error: `Cannot demote the env bootstrap admin (${bootstrapEmail}).`
      });
    }

    const profile = await db.setProfileRole(userId, role, isActive);
    return res.json({ ok: true, account: profile });
  } catch (error) {
    return res.status(500).json({ error: "Unable to update account role.", detail: error.message });
  }
});

module.exports = router;
