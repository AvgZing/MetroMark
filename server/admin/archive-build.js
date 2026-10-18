const path = require("path");
const { spawn } = require("child_process");

// Build the archive in a child process so the web server never stalls on tippecanoe.
function runArchiveBuild() {
  return new Promise((resolve, reject) => {
    const worker = path.join(__dirname, "..", "scripts", "rebuild-archive-worker.js");
    const child = spawn(process.execPath, [worker], {
      cwd: path.join(__dirname, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Archive build exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

module.exports = { runArchiveBuild };
