const config = require("./admin/config");
const db = require("./processors/data");
const { createApp } = require("./app");

async function startServer() {
  await db.initializeStorage();

  try {
    const seedResult = await db.seedDefaultAdmin();
    if (!seedResult?.skipped) {
      console.log(`Default admin ensured: ${seedResult.email} (role=${seedResult.role})`);
    }
  } catch (error) {
    console.warn(`Default admin seed skipped: ${error.message}`);
  }

  const app = createApp();

  app.listen(config.PORT, () => {
    console.log(`MetroMark server running on http://localhost:${config.PORT}`);
    console.log(`Storage backend: local Postgres cache (${db.dbPath}) + Supabase auth`);
  });
}

startServer().catch((error) => {
  console.error("Failed to initialize MetroMark storage:", error.message);
  process.exitCode = 1;
});
