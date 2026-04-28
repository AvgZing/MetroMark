const path = require("path");
const express = require("express");

const healthRoutes = require("./routes/health");
const catalogRoutes = require("./routes/catalog");
const transitRoutes = require("./routes/transit");
const authRoutes = require("./routes/auth");
const progressRoutes = require("./routes/progress");
const adminRoutes = require("./routes/admin");

function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use("/api", healthRoutes);
  app.use("/api", catalogRoutes);
  app.use("/api", transitRoutes);
  app.use("/api", authRoutes);
  app.use("/api", progressRoutes);
  app.use("/api", adminRoutes);

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/admin", (req, res) => {
    return res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
  });

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "API endpoint not found." });
    }
    return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return app;
}

module.exports = {
  createApp
};
