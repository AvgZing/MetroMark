const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GEO_DIR = path.join(REPO_ROOT, "data", "tiles", "geo");
const OUTPUT_FILE = path.join(REPO_ROOT, "data", "tiles", "routes.pmtiles");

// Build to a unique temp file and atomically rename it over OUTPUT_FILE once
// tippecanoe has fully written it. A reader (Express sendFile, the pmtiles
// protocol's range requests, or the service worker's full-archive fetch) then
// always sees either the complete old archive or the complete new one — never a
// partially-written file mid-rebuild, which previously made the map render
// garbage and the app appear nonresponsive during every rebuild.
//
// The temp name must still END in ".pmtiles": tippecanoe chooses the output
// format from the final file extension, so "routes.pmtiles.<pid>.<ts>" (ending
// in digits) silently produces an MBTiles/SQLite archive instead of PMTiles.
function outputTempFile() {
  return path.join(
    path.dirname(OUTPUT_FILE),
    `routes.pmtiles.${process.pid}.${Date.now()}.pmtiles`
  );
}

// Remove stale temp archives from crashed/interrupted builds so they never
// accumulate in data/tiles/. Only touches our own temp naming pattern.
function cleanStaleTempFiles() {
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) {
    return;
  }
  const staleMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    if (!/^routes\.pmtiles\.\d+\.\d+\.pmtiles$/.test(name)) {
      continue;
    }
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > staleMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // best-effort cleanup
    }
  }
}

function resolveTippecanoe() {
  const candidates = [];
  if (process.env.TIPPECANOE_BIN && String(process.env.TIPPECANOE_BIN).trim()) {
    candidates.push(String(process.env.TIPPECANOE_BIN).trim());
  }
  candidates.push(path.join(REPO_ROOT, "tools", "tippecanoe"));
  candidates.push(path.join(REPO_ROOT, "tools", "tippecanoe.exe"));
  if (process.platform === "win32") {
    candidates.push("C:\\msys64\\usr\\bin\\tippecanoe.exe");
    candidates.push("C:\\msys64\\mingw64\\bin\\tippecanoe.exe");
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    if (fs.statSync(candidate).isDirectory()) {
      for (const name of ["tippecanoe", "tippecanoe.exe"]) {
        const inner = path.join(candidate, name);
        if (fs.existsSync(inner)) {
          return inner;
        }
      }
    } else {
      return candidate;
    }
  }
  return "tippecanoe";
}

// All archive inputs for tippecanoe. Once the sharded layout exists (see
// server/sources/transitland/backfill.js), prefer the shard files so legacy
// routes-feed.ndjson / per-city seed files are never double-counted during
// migration. Before migration, the legacy files are used directly.
function listNdjsonFiles() {
  if (!fs.existsSync(GEO_DIR)) {
    return [];
  }
  const names = fs.readdirSync(GEO_DIR).filter((name) => name.endsWith(".ndjson"));
  const shardNames = names.filter((name) => /^shard-\d+\.ndjson$/.test(name));
  const selected = shardNames.length > 0 ? shardNames : names;
  return selected.sort().map((name) => path.join(GEO_DIR, name));
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function concatFilesToStdin(files, stdin) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = () => {
      if (index >= files.length) {
        stdin.end();
        resolve();
        return;
      }
      const stream = fs.createReadStream(files[index]);
      index += 1;
      stream.on("error", reject);
      stream.on("end", next);
      stream.pipe(stdin, { end: false });
    };
    next();
  });
}

function readTileCount(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(139);
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
    if (bytesRead < 80 || header.toString("ascii", 0, 7) !== "PMTiles") {
      return null;
    }
    return Number(header.readBigUInt64LE(72));
  } finally {
    fs.closeSync(fd);
  }
}

// Serialize tile rebuilds: the world harvester, viewport backfill, and the
// admin rebuild button can all trigger buildPmtiles. Overlapping tippecanoe
// processes would fight over the same archive and double CPU load; instead each
// build waits for the previous one to finish and then reads the NDJSON files as
// they exist at that point, so the newest merge is always included.
let buildChain = Promise.resolve();

function buildPmtiles(options = {}) {
  const run = () => buildPmtilesOnce(options);
  const queued = buildChain.then(run, run);
  // Keep the chain alive even when a caller ignores the result / rejects.
  buildChain = queued.catch(() => {});
  return queued;
}

async function buildPmtilesOnce(options = {}) {
  const log = options.log || console;
  const files = listNdjsonFiles();
  if (!files.length) {
    const error = new Error(
      `No *.ndjson files found in ${GEO_DIR}. Run export-transitland-geojson.js first.`
    );
    error.code = "NO_INPUT";
    throw error;
  }

  const tippecanoeBin = resolveTippecanoe();
  cleanStaleTempFiles();
  const tempOutput = outputTempFile();
  const args = [
    "-zg",
    "--drop-densest-as-needed",
    "-o",
    tempOutput,
    "--name=metromark-routes",
    "-l",
    "routes",
    "-P",
    "--force"
  ];

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

  log.log(`[build] tippecanoe: ${tippecanoeBin}`);
  log.log(`[build] inputs: ${files.length} NDJSON file(s): ${files.map((file) => path.basename(file)).join(", ")}`);

  try {
    const child = spawn(tippecanoeBin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderrTail = "";

    child.stdout.on("data", () => {
      // tippecanoe writes its summary to stderr; keep stdout quiet for server use
    });
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    await new Promise((resolve, reject) => {
      child.on("error", (error) => {
        if (error && error.code === "ENOENT") {
          reject(new Error("tippecanoe is not installed or not on PATH. Set TIPPECANOE_BIN or install tippecanoe (see docs/working/tippecanoe-setup.md)."));
          return;
        }
        reject(error);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`tippecanoe exited with code ${code}: ${stderrTail.slice(-300)}`));
          return;
        }
        resolve();
      });
      concatFilesToStdin(files, child.stdin).catch(reject);
    });

    if (!fs.existsSync(tempOutput)) {
      throw new Error("tippecanoe finished but produced no output file.");
    }

    // Atomic swap: readers see either the complete old archive or the complete
    // new one, never a partially-written file. sendFile/createReadStream open
    // the destination with FILE_SHARE_DELETE on Windows, so an in-flight stream
    // keeps reading the old archive while new requests get the new one.
    fs.renameSync(tempOutput, OUTPUT_FILE);

    const stats = fs.statSync(OUTPUT_FILE);
    return {
      outputFile: OUTPUT_FILE,
      sizeBytes: stats.size,
      tileCount: readTileCount(OUTPUT_FILE),
      fileCount: files.length
    };
  } catch (error) {
    // Never leave a half-written temp file behind.
    try {
      if (fs.existsSync(tempOutput)) {
        fs.unlinkSync(tempOutput);
      }
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

async function main() {
  const result = await buildPmtiles({ log: console });
  console.log(
    `[build] done. routes.pmtiles: ${formatBytes(result.sizeBytes)} (${result.sizeBytes} bytes), tiles: ${
      result.tileCount === null ? "unknown" : result.tileCount
    }`
  );
}

module.exports = {
  buildPmtiles,
  listNdjsonFiles,
  resolveTippecanoe,
  readTileCount,
  GEO_DIR,
  OUTPUT_FILE
};

if (require.main === module) {
  main().catch((error) => {
    if (error && error.code === "ENOENT") {
      console.error(
        "[build] ERROR: tippecanoe was not found. Install it at tools/tippecanoe (or tools/tippecanoe.exe), add it to PATH, or set TIPPECANOE_BIN."
      );
    }
    console.error(`[build] FAILED: ${error?.message || error}`);
    process.exit(1);
  });
}
