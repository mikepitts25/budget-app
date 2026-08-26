/**
 * Offline shell for Two Ledgers.
 *
 * The app's data never leaves the browser, so "offline" only means the code has
 * to be reachable without a network. The strategy is deliberately conservative:
 * navigations try the network first so a deploy is picked up immediately, and
 * fall back to the cached shell; hashed build assets are immutable, so they are
 * served from cache first.
 */

const VERSION = 'two-ledgers-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

/**
 * Hosts commonly serve assets with `Vary: Origin`. Vite marks its module scripts
 * `crossorigin`, so the browser requests them in CORS mode with an Origin
 * header, while precaching stored them without one — and the cache would miss
 * every asset on the first offline load. The URL alone identifies a hashed
 * build asset, so varying on headers buys nothing here.
 */
const MATCH = { ignoreVary: true };

/**
 * The worker registers after first paint, by which time the browser has already
 * fetched the hashed bundles — so they never pass through the fetch handler and
 * would be missing from the cache on the first offline load. Reading index.html
 * and precaching what it references closes that gap without a build step.
 */
async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL);
  try {
    const html = await (await fetch('/index.html', { cache: 'reload' })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    if (assets.length) await cache.addAll(assets);
  } catch {
    // A missing asset must not block installation; the fetch handler will fill in.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html', MATCH).then((r) => r ?? Response.error())),
    );
    return;
  }

  // Build assets carry a content hash, so a cache hit is always correct.
  event.respondWith(
    caches.match(request, MATCH).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
