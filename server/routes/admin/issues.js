const express = require("express");

const { listIssueReports, resolveIssueReport, reopenIssueReport } = require("../../processors/data/issue-reports");
const { isAdminAuthorized } = require("./auth");

const router = express.Router();

router.get("/admin/issues", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }
  try {
    const status = String(req.query?.status || "").trim() || undefined;
    const issues = await listIssueReports({ status, limit: Number(req.query?.limit) || 200 });
    return res.json({ issues });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list issue reports.", detail: String(error?.message || error) });
  }
});

router.post("/admin/issues/:id/resolve", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }
  try {
    const result = await resolveIssueReport(Number(req.params?.id));
    if (!result) {
      return res.status(404).json({ error: "Issue report not found." });
    }
    return res.json({ ok: true, id: result.id });
  } catch (error) {
    return res.status(500).json({ error: "Unable to resolve issue report.", detail: String(error?.message || error) });
  }
});

router.post("/admin/issues/:id/reopen", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    res.status(403).json({ error: "Admin authorization required." });
    return;
  }
  try {
    const result = await reopenIssueReport(Number(req.params?.id));
    if (!result) {
      return res.status(404).json({ error: "Issue report not found." });
    }
    return res.json({ ok: true, id: result.id });
  } catch (error) {
    return res.status(500).json({ error: "Unable to reopen issue report.", detail: String(error?.message || error) });
  }
});

module.exports = router;
