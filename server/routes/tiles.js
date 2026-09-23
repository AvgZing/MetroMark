const fs = require("fs");
const path = require("path");
const express = require("express");

const TILES_FILE = path.join(__dirname, "..", "..", "data", "tiles", "routes.pmtiles");

const tilesStats = {
  requests: 0,
  bytesServed: 0,
  totalMs: 0,
  lastAt: null
};

const router = express.Router();

// Archive identity: changes whenever the harvester (or a backfill) rebuilds
// routes.pmtiles. Clients include it in the PMTiles URL so a rebuilt archive is
// a new URL rather than new bytes behind a cached one.
function getArchiveVersion() {
  try {
    const stat = fs.statSync(TILES_FILE);
    const mtimeMs = Math.round(stat.mtimeMs);
    return { version: `${mtimeMs}-${stat.size}`, size: stat.size, mtimeMs };
  } catch {
    return { version: "", size: 0, mtimeMs: 0 };
  }
}

router.get("/tiles/archive-version", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(getArchiveVersion());
});

router.get("/tiles/routes.pmtiles", (req, res) => {
  if (!fs.existsSync(TILES_FILE)) {
    return res.status(404).json({ error: "Tile archive not found. Run npm run build:tiles first." });
  }

  const start = Date.now();
  const range = String(req.headers.range || "");
  const byteStart = range ? Number((range.match(/bytes=(\d+)-/) || [])[1] || 0) : 0;
  const fileSize = fs.statSync(TILES_FILE).size;

  res.type("application/x-protobuf");
  return res.sendFile(TILES_FILE, { acceptRanges: true, maxAge: "1d" }, (err) => {
    if (err && !res.headersSent) {
      if (err.code === "ENOENT") {
        return res.status(404).json({ error: "Tile archive not found." });
      }
      return res.status(500).json({ error: "Failed to stream tile archive." });
    }
    if (!err) {
      tilesStats.requests += 1;
      tilesStats.bytesServed += Math.max(0, fileSize - byteStart);
      tilesStats.totalMs += Date.now() - start;
      tilesStats.lastAt = new Date().toISOString();
    }
  });
});

function getTilesStats() {
  return {
    ...tilesStats,
    archiveVersion: getArchiveVersion().version,
    averageMs: tilesStats.requests > 0 ? Math.round(tilesStats.totalMs / tilesStats.requests) : 0
  };
}

module.exports = router;
module.exports.getTilesStats = getTilesStats;
module.exports.getArchiveVersion = getArchiveVersion;
