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

const VERSION = "56";
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
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || "").trim());
  if (!match) {
    return response;
  }

  const startText = match[1];
  const endText = match[2];
  if (startText === "" && endText === "") {
    return response;
  }

  return response.blob().then((blob) => {
    const total = blob.size;
    if (total <= 0) {
      return new Response(null, { status: 416, headers: { "Content-Range": "bytes */0" } });
    }

    let start;
    let end;
    if (startText === "") {
      const suffix = Number(endText);
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = Number(startText);
      end = endText === "" ? total - 1 : Math.min(Number(endText), total - 1);
    }

    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }

    return new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/x-protobuf",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes"
      }
    });
  });
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

  // Keyed by build stamp so a rebuilt archive never mixes bytes with its directory.
  const cacheKey = tilesCacheKey(url);
  let cached = await cache.match(cacheKey);

  // A previously poisoned/empty cache entry must never be served.
  if (cached && cached.ok && !looksLikeArchiveSize(cached.headers.get("content-length"))) {
    await cache.delete(cacheKey);
    cached = undefined;
  }

  if (cached && cached.ok) {
    return range ? sliceCachedResponse(cached, range) : cached;
  }

  if (!shouldPrefetchFullArchive()) {
    return fetch(request);
  }

  // Miss: fetch the full archive (no Range), cache it under this build's key.
  const fullRequest = new Request(url.href, {
    method: "GET",
    headers: {
      Accept: request.headers.get("accept") || ""
    }
  });

  try {
    const networkResponse = await fetch(fullRequest);
    // Probe separately (reading a clone can disturb the tee); never return a 200 to a ranged request.
    const validSize =
      networkResponse.ok && looksLikeArchiveSize(networkResponse.headers.get("content-length"));
    if (validSize && (await archiveMagicValid(url))) {
      await cache.put(cacheKey, networkResponse.clone());
      await dropOtherArchiveEntries(cache, cacheKey);
      const fresh = await cache.match(cacheKey);
      if (fresh) {
        return range ? sliceCachedResponse(fresh, range) : fresh;
      }
    }
    return fetch(request);
  } catch (error) {
    if (cached) {
      return range ? sliceCachedResponse(cached, range) : cached;
    }
    return fetch(request);
  }
}

// "PMTiles" magic bytes; a valid v3 archive starts with them.
function archiveMagicOk(bytes) {
  return (
    bytes &&
    bytes.length >= 7 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4d &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x69 &&
    bytes[4] === 0x6c &&
    bytes[5] === 0x65 &&
    bytes[6] === 0x73
  );
}

function looksLikeArchiveSize(contentLength) {
  if (contentLength === null || contentLength === undefined || contentLength === "") {
    return true;
  }
  const length = Number(contentLength);
  return !Number.isFinite(length) || length >= 128;
}

// Ranged probe so validation never disturbs the response we cache.
async function archiveMagicValid(url) {
  try {
    const probe = await fetch(new Request(url, { headers: { Range: "bytes=0-15" } }));
    if (!probe.ok && probe.status !== 206) {
      return false;
    }
    return archiveMagicOk(new Uint8Array(await probe.arrayBuffer()));
  } catch {
    return false;
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
