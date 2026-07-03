const config = require("./admin/config");
const db = require("./processors/db");
const { createApp } = require("./app");

async function startServer() {
  await db.initializeStorage();

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
