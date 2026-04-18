const config = require("./config");
const db = require("./db");
const { createApp } = require("./app");

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`MetroMark server running on http://localhost:${config.PORT}`);
  console.log(`SQLite data file: ${db.dbPath}`);
});
