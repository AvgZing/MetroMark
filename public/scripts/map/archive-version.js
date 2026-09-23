// Archive identity for the PMTiles vector source.
//
// The harvester rebuilds routes.pmtiles daily and a backfill rebuilds it on
// demand, but the file path never changes — so any cache keyed on the URL (the
// Service Worker's full-archive cache, the browser HTTP cache) would pair a new
// archive's bytes with an old archive's directory and render zero routes. The
// server stamps each build (`mtime-size`); clients put that stamp in the source
// URL and swap it when it changes, which recovers without a page reload.

var ARCHIVE_VERSION_POLL_MS = 60000;
var archiveVersionTimer = null;

async function fetchArchiveVersion() {
  try {
    const payload = await apiRequest("/api/tiles/archive-version", { method: "GET" });
    return String(payload?.version || "").trim();
  } catch {
    return "";
  }
}

function vectorSourceUrl() {
  const version = typeof appState !== "undefined" ? String(appState.vectorArchiveVersion || "").trim() : "";
  return version
    ? `pmtiles:///api/tiles/routes.pmtiles?v=${encodeURIComponent(version)}`
    : "pmtiles:///api/tiles/routes.pmtiles";
}

// Returns true when the archive changed (and the source was reloaded when the
// map was already running).
async function syncArchiveVersion() {
  const version = await fetchArchiveVersion();
  if (!version || version === appState.vectorArchiveVersion) {
    return false;
  }

  const hadVersion = Boolean(appState.vectorArchiveVersion);
  appState.vectorArchiveVersion = version;

  if (hadVersion && appState.mapReady && typeof reloadVectorSource === "function") {
    reloadVectorSource();
  }

  return true;
}

function startArchiveVersionWatch() {
  if (archiveVersionTimer) {
    return;
  }

  syncArchiveVersion().catch(() => {});
  archiveVersionTimer = window.setInterval(() => {
    syncArchiveVersion().catch(() => {});
  }, ARCHIVE_VERSION_POLL_MS);

  // Returning to a backgrounded tab is the most likely moment to have missed a
  // rebuild, so check immediately.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncArchiveVersion().catch(() => {});
    }
  });
}
