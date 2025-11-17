/* Scribbly Service Worker */
const CACHE_VERSION = 'v3';
const STATIC_CACHE = `scribbly-static-${CACHE_VERSION}`;
const OFFLINE_FALLBACK_PAGE = './index.html';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './icon.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE_ASSETS.map(async (asset) => {
          try {
            const url = new URL(asset, self.location);
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && res.ok) await cache.put(req, res.clone());
          } catch (_) { /* ignore individual asset failures */ }
        })
      );
    } finally {
      self.skipWaiting();
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key.startsWith('scribbly-static-') && key !== STATIC_CACHE) {
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
      // Ensure offline fallback is cached immediately
      const cache = await caches.open(STATIC_CACHE);
      await cache.add(OFFLINE_FALLBACK_PAGE);
    })()
  );
});

// Strategy helpers
function isCacheableRequest(request) {
  try {
    if (request.method !== 'GET') return false;
    const url = new URL(request.url);
    if (!/^https?:$/.test(url.protocol)) return false; // skip chrome-extension, moz-extension, data, blob, file, etc.
    if (url.origin !== self.location.origin) return false; // same-origin only
    return true;
  } catch (_) {
    return false;
  }
}

async function cacheFirst(request) {
  if (!isCacheableRequest(request)) {
    return fetch(request);
  }
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || Promise.reject(err);
  }
}

async function networkFirst(request) {
  if (!isCacheableRequest(request)) {
    return fetch(request);
  }
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle navigation: serve app shell when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch (_) {
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match(OFFLINE_FALLBACK_PAGE, { ignoreSearch: true });
          return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
        }
      })()
    );
    return;
  }

  // Static assets: cache-first
  const dest = request.destination;
  if (['style', 'script', 'image', 'font'].includes(dest) && isCacheableRequest(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default: network-first
  if (isCacheableRequest(request)) {
    event.respondWith(networkFirst(request));
  }
  // Otherwise, let the browser handle non-cacheable requests normally.
});

// Optional: background sync skeleton (queue processing can postMessage to trigger)
self.addEventListener('sync', (event) => {
  if (event.tag === 'scribbly-sync') {
    event.waitUntil(handleQueuedActions());
  }
});

async function handleQueuedActions() {
  // Placeholder for processing queued note changes via IndexedDB.
  // The app can postMessage to the SW to trigger, or rely on SyncManager.
  return true;
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});