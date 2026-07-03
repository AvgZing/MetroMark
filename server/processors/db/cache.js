const { statements, nowSeconds } = require("./client");

function getCache(cacheKey) {
  const row = statements.getCache.get(cacheKey, nowSeconds());
  if (!row) {
    return null;
  }

  try {
    return {
      payload: JSON.parse(row.payload),
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at
    };
  } catch (error) {
    return null;
  }
}

function setCache(cacheKey, payload, ttlSeconds) {
  const fetchedAt = nowSeconds();
  const expiresAt = fetchedAt + Math.max(60, ttlSeconds);
  statements.setCache.run(cacheKey, JSON.stringify(payload), fetchedAt, expiresAt);
}

function clearCacheByPrefix(prefix) {
  statements.clearCacheByPrefix.run(`${prefix}%`);
}

module.exports = {
  getCache,
  setCache,
  clearCacheByPrefix
};
