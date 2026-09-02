const config = require("./admin/config");
const db = require("./processors/data");
const { createApp } = require("./app");
const { createLogger } = require("./admin/logger");

const log = createLogger("server");

async function startServer() {
  log.info("Starting MetroMark server", { env: config.APP_ENV, port: config.PORT });

  await db.initializeStorage();

  try {
    const seedResult = await db.seedDefaultAdmin();
    if (!seedResult?.skipped) {
      log.info(`Default admin ensured: ${seedResult.email} (role=${seedResult.role})`);
    }
  } catch (error) {
    log.warn(`Default admin seed skipped: ${error.message}`);
  }

  const app = createApp();

  app.listen(config.PORT, () => {
    log.info(`MetroMark server running on http://localhost:${config.PORT}`);
    log.info(`Storage backend: local Postgres cache (${db.dbPath}) + Supabase auth`);
  });
}

startServer().catch((error) => {
  log.error("Failed to initialize MetroMark storage:", error);
  process.exitCode = 1;
});
