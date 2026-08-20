const {
  hasLocalPostgresConfig,
  localDbLabel,
  query,
  postgresMetrics
} = require("./pool");
const { schemaStatements } = require("./schema");

let initializePromise = null;

async function initializeLocalPostgres() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    if (!hasLocalPostgresConfig()) {
      throw new Error(
        "Local PostgreSQL is not configured. Set METROMARK_LOCAL_PG_URL or METROMARK_LOCAL_PGHOST/METROMARK_LOCAL_PGDATABASE."
      );
    }

    for (const statement of schemaStatements) {
      await query(statement);
    }

    return {
      backend: "local-postgres-postgis",
      endpoint: localDbLabel()
    };
  })();

  try {
    return await initializePromise;
  } catch (error) {
    initializePromise = null;
    throw error;
  }
}

module.exports = {
  hasLocalPostgresConfig,
  initializeLocalPostgres,
  query,
  localDbLabel,
  postgresMetrics
};
