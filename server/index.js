const config = require("./config");
const db = require("./db");
const { createApp } = require("./app");

async function startServer() {
  await db.initializeStorage();

  const app = createApp();

  app.listen(config.PORT, () => {
    console.log(`MetroMark server running on http://localhost:${config.PORT}`);
    console.log(`Storage backend: Supabase/Postgres (${db.dbPath})`);
  });
}

startServer().catch((error) => {
  console.error("Failed to initialize MetroMark storage:", error.message);
  process.exitCode = 1;
});
