// MetroMark SW: shell precache, PMTiles passthrough, SWR assets, network-first API.

const VERSION = "63";
const APP_SHELL_CACHE = `metromark-shell-v${VERSION}`;
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
  // Keep the worker script uncached for version probes.
  if (url.pathname === "/sw.js") {
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
      const keep = new Set([APP_SHELL_CACHE, RUNTIME_CACHE, API_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // Report the running worker's version.
  if (data.type === "GET_SW_VERSION" && event.source) {
    event.source.postMessage({ type: "SW_VERSION", version: VERSION });
  }
});

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
    // PMTiles owns its range requests; never intercept or cache the archive.
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
