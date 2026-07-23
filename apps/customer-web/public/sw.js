// GastroFlow customer PWA service worker
// - Precache the app shell so the app opens offline
// - Stale-while-revalidate for menu/API GETs (fast, self-healing)
// - Offline fallback page for navigations when nothing is cached
const VERSION = 'v3';
const SHELL_CACHE = `gastroflow-shell-${VERSION}`;
const DATA_CACHE = `gastroflow-data-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate: serve cache immediately, refresh in the background.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || new Response(null, { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache mutations

  const url = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/');

  // Never cache auth/order/payment endpoints — always hit the network.
  const noCache = /\/api\/(customer\/auth|payments|orders|public\/orders|stream)/.test(url.pathname);
  if (isApi && noCache) return;

  // Menu and other safe API GETs: stale-while-revalidate.
  if (isApi) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // Navigations: try network, fall back to cached shell, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/offline.html'));
      })
    );
    return;
  }

  // Static assets: cache-first with background refresh.
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});
