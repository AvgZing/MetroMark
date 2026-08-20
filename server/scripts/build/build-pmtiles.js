const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GEO_DIR = path.join(REPO_ROOT, "data", "tiles", "geo");
const OUTPUT_FILE = path.join(REPO_ROOT, "data", "tiles", "routes.pmtiles");

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

function listNdjsonFiles() {
  if (!fs.existsSync(GEO_DIR)) {
    return [];
  }
  return fs
    .readdirSync(GEO_DIR)
    .filter((name) => name.endsWith(".ndjson"))
    .sort()
    .map((name) => path.join(GEO_DIR, name));
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

async function buildPmtiles(options = {}) {
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
  const args = [
    "-zg",
    "--drop-densest-as-needed",
    "-o",
    OUTPUT_FILE,
    "--name=metromark-routes",
    "-l",
    "routes",
    "-P",
    "--force"
  ];

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

  log.log(`[build] tippecanoe: ${tippecanoeBin}`);
  log.log(`[build] inputs: ${files.length} NDJSON file(s): ${files.map((file) => path.basename(file)).join(", ")}`);

  const child = spawn(tippecanoeBin, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderrTail = "";

  child.stdout.on("data", (chunk) => {
    if (options.captureStderr !== false) {
      // tippecanoe writes its summary to stderr; keep stdout quiet for server use
    }
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

  if (!fs.existsSync(OUTPUT_FILE)) {
    throw new Error("tippecanoe finished but produced no output file.");
  }

  const stats = fs.statSync(OUTPUT_FILE);
  return {
    outputFile: OUTPUT_FILE,
    sizeBytes: stats.size,
    tileCount: readTileCount(OUTPUT_FILE),
    fileCount: files.length
  };
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
