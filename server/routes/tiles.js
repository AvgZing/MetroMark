const fs = require("fs");
const path = require("path");
const express = require("express");

const TILES_FILE = path.join(__dirname, "..", "..", "data", "tiles", "routes.pmtiles");

const router = express.Router();

router.get("/tiles/routes.pmtiles", (req, res) => {
  if (!fs.existsSync(TILES_FILE)) {
    return res.status(404).json({ error: "Tile archive not found. Run npm run build:tiles first." });
  }
  res.type("application/x-protobuf");
  return res.sendFile(TILES_FILE, { acceptRanges: true, maxAge: "1d" }, (err) => {
    if (err && !res.headersSent) {
      if (err.code === "ENOENT") {
        return res.status(404).json({ error: "Tile archive not found." });
      }
      return res.status(500).json({ error: "Failed to stream tile archive." });
    }
  });
});

module.exports = router;
