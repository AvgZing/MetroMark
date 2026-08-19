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

async function main() {
  const files = listNdjsonFiles();
  if (!files.length) {
    console.error(
      `[build] ERROR: no *.ndjson files found in ${GEO_DIR}. Run export-transitland-geojson.js first.`
    );
    process.exit(1);
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

  console.log(`[build] tippecanoe: ${tippecanoeBin}`);
  console.log(
    `[build] inputs: ${files.length} NDJSON file(s): ${files
      .map((file) => path.basename(file))
      .join(", ")}`
  );
  console.log(`[build] output: ${OUTPUT_FILE}`);

  const child = spawn(tippecanoeBin, args, { stdio: ["pipe", "pipe", "pipe"] });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tippecanoe exited with code ${code}`));
        return;
      }
      resolve();
    });
    concatFilesToStdin(files, child.stdin).catch(reject);
  });

  if (!fs.existsSync(OUTPUT_FILE)) {
    console.error("[build] ERROR: tippecanoe finished but produced no output file.");
    process.exit(1);
  }

  const stats = fs.statSync(OUTPUT_FILE);
  const tileCount = readTileCount(OUTPUT_FILE);
  console.log(
    `[build] done. routes.pmtiles: ${formatBytes(stats.size)} (${stats.size} bytes), tiles: ${
      tileCount === null ? "unknown" : tileCount
    }`
  );
}

main().catch((error) => {
  if (error && error.code === "ENOENT") {
    console.error(
      "[build] ERROR: tippecanoe was not found. Install it at tools/tippecanoe (or tools/tippecanoe.exe), add it to PATH, or set TIPPECANOE_BIN."
    );
  }
  console.error(`[build] FAILED: ${error?.message || error}`);
  process.exit(1);
});
