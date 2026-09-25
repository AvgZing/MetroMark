/*
 * MetroMark service worker
 *
 * 1. Precache the app shell (index.html, CSS, JS) on install.
 * 2. Range-aware cache for /api/tiles/routes.pmtiles: serve 206 slices from the
 *    cached full archive; on cache miss fetch the FULL body (no Range header),
 *    cache it once, then answer the request from the cache.
 * 3. Stale-while-revalidate for static assets; network-first for API routes
 *    outside the tile archive.
 * 4. skipWaiting() on install; clients.claim() on activate.
 *
 * Note: service workers require a secure context. Registration only works on
 * HTTPS or http://localhost.
 */

const VERSION = "15";
const APP_SHELL_CACHE = `metromark-shell-v${VERSION}`;
const TILES_CACHE = `metromark-tiles-v${VERSION}`;
const RUNTIME_CACHE = `metromark-runtime-v${VERSION}`;
const API_CACHE = `metromark-api-v${VERSION}`;
const TILES_PATHNAME = "/api/tiles/routes.pmtiles";
const ARCHIVE_VERSION_PATHNAME = "/api/tiles/archive-version";
const CATALOG_PATHNAME = "/api/catalog/cities";
const REVIEWS_PATHNAME = "/api/transit/reviews";
const NAV_TIMEOUT_MS = 3000;
const API_TIMEOUT_MS = 20000;
const API_STALE_MS = 5 * 60 * 1000;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/Styles/base.css",
  "/Styles/map.css",
  "/Styles/lineview.css"
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(url) {
  if (!isSameOrigin(url)) {
    return false;
  }
  if (url.pathname.startsWith("/api/")) {
    return false;
  }
  if (url.pathname.startsWith("/Styles/") || url.pathname.startsWith("/Scripts/")) {
    return true;
  }
  return /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|json)$/.test(url.pathname);
}

async function discoverShellUrls() {
  const urls = [];
  try {
    const response = await fetch("/index.html", { cache: "no-store" });
    if (!response.ok) {
      return urls;
    }
    const html = await response.text();
    const pattern = /(?:src|href)=["']((?:\/Scripts\/[^"']+\.js[^"']*)|(?:\/Styles\/[^"']+\.css[^"']*))["']/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      urls.push(match[1]);
    }
  } catch {
    // Keep the base shell list if discovery fails.
  }
  return urls;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      const discovered = await discoverShellUrls();
      const urls = Array.from(new Set([...PRECACHE_URLS, ...discovered]));
      await Promise.allSettled(urls.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_SHELL_CACHE, TILES_CACHE, RUNTIME_CACHE, API_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function sliceCachedResponse(response, rangeHeader) {
  const total = Number(response.headers.get("content-length"));
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || "").trim());
  if (!match || !Number.isFinite(total) || total <= 0) {
    return response;
  }

  const startText = match[1];
  const endText = match[2];

  let start;
  let end;
  if (startText === "" && endText === "") {
    return response;
  }
  if (startText === "") {
    // Suffix range "bytes=-N": the last N bytes.
    const suffix = Number(endText);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? total - 1 : Math.min(Number(endText), total - 1);
  }

  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${total}`
      }
    });
  }

  return response.blob().then((blob) =>
    new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/x-protobuf",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes"
      }
    })
  );
}

// Respect mobile data-saver / slow connections: skip the one-time full-archive
// pre-cache so a quick browse doesn't download the whole archive. The map still
// works (range requests pass through to the network); the archive is only fully
// cached when it's cheap to do so.
function shouldPrefetchFullArchive() {
  try {
    const connection = self.navigator && self.navigator.connection;
    if (connection && (connection.saveData === true || connection.effectiveType === "slow-2g" || connection.effectiveType === "2g")) {
      return false;
    }
  } catch {
    // Unknown — default to prefetching.
  }
  return true;
}

async function handleTilesRequest(request, url) {
  const cache = await caches.open(TILES_CACHE);
  const range = request.headers.get("range");

  // The cache key includes the archive build stamp, so a rebuilt archive is a
  // different entry: bytes and PMTiles directory always come from the same
  // build. Serving slices of one build against another build's directory is
  // what made routes vanish after a harvest until the app was restarted.
  const cacheKey = tilesCacheKey(url);
  const cached = await cache.match(cacheKey);

  if (cached && cached.ok) {
    if (range) {
      return sliceCachedResponse(cached, range);
    }
    return cached;
  }

  if (!shouldPrefetchFullArchive()) {
    // Slow/data-saver connection and no cached archive: pass the range request
    // straight through. Never cache partial (206) responses.
    return fetch(request);
  }

  // Miss: fetch the FULL archive (no Range header so the complete body is
  // cached), store it once under this build's key, then satisfy the request.
  const fullRequest = new Request(url.href, {
    method: "GET",
    headers: {
      Accept: request.headers.get("accept") || ""
    }
  });

  try {
    const networkResponse = await fetch(fullRequest);
    if (networkResponse.ok) {
      await cache.put(cacheKey, networkResponse.clone());
      await dropOtherArchiveEntries(cache, cacheKey);
    }

    const fresh = await cache.match(cacheKey);
    if (fresh) {
      if (range) {
        return sliceCachedResponse(fresh, range);
      }
      return fresh;
    }

    return networkResponse;
  } catch (error) {
    if (cached) {
      if (range) {
        return sliceCachedResponse(cached, range);
      }
      return cached;
    }
    throw error;
  }
}

function tilesCacheKey(url) {
  const version = url.searchParams.get("v") || "unversioned";
  return `${TILES_PATHNAME}?v=${version}`;
}

// Keep a single archive body cached: once a new build is stored, drop the rest.
async function dropOtherArchiveEntries(cache, keepKey) {
  try {
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((key) => new URL(key.url).pathname === TILES_PATHNAME && key.url !== keepKey && !key.url.endsWith(keepKey))
        .map((key) => cache.delete(key))
    );
  } catch {
    // Non-critical
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || refresh;
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(request, { signal: controller.signal }).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function networkFirst(request, cacheName, timeoutMs = NAV_TIMEOUT_MS) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (cached) {
      return cached;
    }
    throw error;
  }
}

function stampResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("x-metromark-cached-at", String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// API GETs (route-stops, headway, coverage, cities, reviews, presets, …):
// serve a fresh cached copy instantly (app-like, works offline), refresh it in
// the background, and fall back to cache when the network is unreachable.
async function apiStaleWhileRevalidate(request, event) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  const cachedAt = cached ? Number(cached.headers.get("x-metromark-cached-at") || 0) : 0;
  const fresh = Boolean(cached && Date.now() - cachedAt < API_STALE_MS);

  if (cached && fresh) {
    event.waitUntil(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            return cache.put(request, stampResponse(response.clone()));
          }
        })
        .catch(() => {})
    );
    return cached;
  }

  try {
    // Slow first-request API calls (e.g. the coverage probe at low zoom) need
    // a much longer budget than navigations.
    const response = await fetchWithTimeout(request, API_TIMEOUT_MS);
    if (response.ok) {
      await cache.put(request, stampResponse(response.clone()));
    }
    return response;
  } catch (error) {
    if (cached) {
      return cached;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return;
  }

  if (url.pathname === TILES_PATHNAME) {
    event.respondWith(handleTilesRequest(request, url));
    return;
  }

  if (url.pathname === ARCHIVE_VERSION_PATHNAME) {
    // Never serve a stale build stamp from the API cache: this drives whether
    // clients switch to a rebuilt archive.
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.pathname === CATALOG_PATHNAME) {
    // Network-first so newly published cities appear immediately.
    event.respondWith(networkFirst(request, API_CACHE, API_TIMEOUT_MS));
    return;
  }

  if (url.pathname === REVIEWS_PATHNAME) {
    // Network-first so saved overrides/reviews show immediately.
    event.respondWith(networkFirst(request, API_CACHE, API_TIMEOUT_MS));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(apiStaleWhileRevalidate(request, event));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, APP_SHELL_CACHE).catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
