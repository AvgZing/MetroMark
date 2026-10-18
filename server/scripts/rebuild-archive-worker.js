const { buildPmtiles } = require("./build/build-pmtiles");

// Runs the archive rebuild in its own process so the web server stays responsive.
buildPmtiles({ log: { log: () => {} } })
  .then((result) => {
    process.stdout.write(JSON.stringify(result || {}));
    process.exit(0);
  })
  .catch((error) => {
    console.error(String(error?.message || error));
    process.exit(1);
  });
