const { Pool } = require("pg");

const config = require("../../admin/config");

let pool = null;

const postgresMetrics = {
  queryCount: 0,
  queryFailureCount: 0,
  lastQueryAt: ""
};

function hasLocalPostgresConfig() {
  return Boolean(config.LOCAL_PG_URL || config.LOCAL_PG_HOST || config.LOCAL_PG_DATABASE);
}

function localDbLabel() {
  if (config.LOCAL_PG_URL) {
    return "local-postgres://configured";
  }

  const host = config.LOCAL_PG_HOST || "127.0.0.1";
  const port = config.LOCAL_PG_PORT || 5432;
  const database = config.LOCAL_PG_DATABASE || "metromark_cache";
  return `postgres://${host}:${port}/${database}`;
}

function buildPoolOptions() {
  if (config.LOCAL_PG_URL) {
    return {
      connectionString: config.LOCAL_PG_URL,
      max: 8
    };
  }

  const ssl = config.LOCAL_PG_SSL === "require" ? { rejectUnauthorized: false } : false;

  return {
    host: config.LOCAL_PG_HOST || "127.0.0.1",
    port: config.LOCAL_PG_PORT || 5432,
    user: config.LOCAL_PG_USER || "postgres",
    password: config.LOCAL_PG_PASSWORD || "",
    database: config.LOCAL_PG_DATABASE || "metromark_cache",
    ssl,
    max: 8
  };
}

function getPool() {
  if (!hasLocalPostgresConfig()) {
    throw new Error(
      "Local PostgreSQL is not configured. Set METROMARK_LOCAL_PG_URL or METROMARK_LOCAL_PGHOST/METROMARK_LOCAL_PGDATABASE."
    );
  }

  if (!pool) {
    pool = new Pool(buildPoolOptions());
    pool.on("error", (error) => {
      console.error("[local-postgres] pool error", error.message);
    });
  }

  return pool;
}

async function query(text, params = []) {
  const client = getPool();
  postgresMetrics.queryCount += 1;
  postgresMetrics.lastQueryAt = new Date().toISOString();

  try {
    return await client.query(text, params);
  } catch (error) {
    postgresMetrics.queryFailureCount += 1;
    throw error;
  }
}

module.exports = {
  hasLocalPostgresConfig,
  localDbLabel,
  getPool,
  query,
  postgresMetrics
};
