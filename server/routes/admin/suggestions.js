const express = require("express");

const db = require("../../processors/data");
const { isAdminAuthorized } = require("./auth");
const { TRANSIT_CACHE_PREFIX } = require("../../processors/transitland");

const router = express.Router();

router.get("/admin/suggestions", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  try {
    const status = String(req.query?.status || "").trim() || undefined;
    const suggestions = await db.listRouteSuggestions({ status, limit: Number(req.query?.limit) || 200 });
    const keys = Array.from(new Set(suggestions.map((entry) => entry.lineKey).filter(Boolean)));
    const metadata = await db.getRouteMetadatasByLineKeys(keys).catch(() => new Map());

    const enriched = [];
    for (const suggestion of suggestions) {
      const meta = metadata.get(suggestion.lineKey) || {};
      let override = null;
      try {
        override = await db.getRouteOverride(suggestion.lineKey);
      } catch {
        override = null;
      }
      const payload = override?.payload || {};
      enriched.push({
        ...suggestion,
        current: {
          lineName: payload.lineName || meta.lineName || "",
          lineShortName: payload.lineShortName || meta.lineShortName || "",
          lineLongName: payload.lineLongName || meta.lineLongName || "",
          operatorName: payload.operatorName || meta.operatorName || "",
          color: payload.color || meta.color || "",
          mode: payload.mode !== undefined ? payload.mode : (meta.routeType ?? ""),
          frequencyBucket: payload.frequencyBucket || meta.frequencyBucket || "",
          headwayBestMinutes:
            payload.headwayBestMinutes !== undefined ? payload.headwayBestMinutes : (meta.headwayBestMinutes ?? "")
        }
      });
    }
    return res.json({ suggestions: enriched });
  } catch (error) {
    return res.status(500).json({ error: "Unable to list suggestions.", detail: String(error?.message || error) });
  }
});

router.post("/admin/suggestions/:id/resolve", async (req, res) => {
  if (!(await isAdminAuthorized(req))) {
    return res.status(403).json({ error: "Admin authorization required." });
  }
  const id = Number(req.params?.id);
  const applied = req.body?.status !== "denied";
  try {
    const suggestion = await db.getRouteSuggestion(id);
    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found." });
    }

    if (applied) {
      const key = suggestion.lineKey;
      const existing = await db.getRouteOverride(key);
      const payload = { ...(existing?.payload || {}), ...suggestion.payload };
      await db.upsertRouteOverride(key, suggestion.citySlug || existing?.city_slug || "", payload);
      await db.clearCacheByPrefix(TRANSIT_CACHE_PREFIX);
    }

    const result = await db.resolveRouteSuggestion(id, applied ? "applied" : "denied", String(req.body?.resolvedBy || "admin"));
    return res.json({ ok: true, id: result?.id, applied });
  } catch (error) {
    return res.status(500).json({ error: "Unable to resolve suggestion.", detail: String(error?.message || error) });
  }
});

module.exports = router;
