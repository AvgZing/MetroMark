const path = require("path");
const express = require("express");

const healthRoutes = require("./routes/health");
const catalogRoutes = require("./routes/catalog");
const transitRoutes = require("./routes/transit");
const authRoutes = require("./routes/auth");
const progressRoutes = require("./routes/progress");
const adminRoutes = require("./routes/admin");
const presetsRoutes = require("./routes/presets");
const tilesRoutes = require("./routes/tiles");
const tilesBackfillRoutes = require("./routes/tiles-backfill");
const issuesRoutes = require("./routes/issues");

function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use("/api", healthRoutes);
  app.use("/api", catalogRoutes);
  app.use("/api", transitRoutes);
  app.use("/api", authRoutes);
  app.use("/api", progressRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", presetsRoutes);
  app.use("/api", tilesRoutes);
  app.use("/api", tilesBackfillRoutes);
  app.use("/api", issuesRoutes);

  // Service-worker and HTML responses must never be served from an HTTP/CDN
  // cache, or deployed updates (new sw.js byte check, fresh index.html asset
  // list) can be delayed for the cache lifetime.
  const sendNoCache = (filePath) => (req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(filePath);
  };
  app.get("/sw.js", sendNoCache(path.join(__dirname, "..", "public", "sw.js")));
  app.get("/index.html", sendNoCache(path.join(__dirname, "..", "public", "index.html")));

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/terms", sendNoCache(path.join(__dirname, "..", "public", "legal", "terms.html")));
  app.get("/privacy", sendNoCache(path.join(__dirname, "..", "public", "legal", "privacy.html")));

  app.get("/admin", (req, res) => {
    return res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  });

  app.get("/admin/override", (req, res) => {
    return res.sendFile(path.join(__dirname, "..", "public", "admin-override.html"));
  });

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "API endpoint not found." });
    }
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return app;
}

module.exports = {
  createApp
};
