/* Scribbly Service Worker */
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `scribbly-static-${CACHE_VERSION}`;
const OFFLINE_FALLBACK_PAGE = '/index.html';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/icon.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
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
    })()
  );
});

// Strategy helpers
async function cacheFirst(request) {
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

  // Handle navigation: serve app shell when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch (_) {
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match(OFFLINE_FALLBACK_PAGE);
          return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
        }
      })()
    );
    return;
  }

  // Static assets: cache-first
  const dest = request.destination;
  if (['style', 'script', 'image'].includes(dest)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default: network-first
  event.respondWith(networkFirst(request));
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