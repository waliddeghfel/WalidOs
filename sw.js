/* ============================================================
   WALID OS v15 — Service Worker
   Onyx Edition · Offline-first caching strategy
   ============================================================ */

const CACHE_VERSION = 'walidos-v15-3';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const CDN_CACHE     = `${CACHE_VERSION}-cdn`;
const FONT_CACHE    = `${CACHE_VERSION}-fonts`;

/* Resources to pre-cache on install */
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

/* CDN scripts — cache on first fetch, serve from cache thereafter */
const CDN_ORIGINS = [
  'cdnjs.cloudflare.com',
  'fonts.cdnfonts.com'
];

/* Google Fonts — stale-while-revalidate */
const FONT_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* Never cache these — always network */
const NETWORK_ONLY = [
  'webradio.tda.dz',
  'api.unsplash.com',
  'images.unsplash.com',
  'api.radio-browser.info'
];

// ── Install: pre-cache app shell ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('walidos-') && k !== STATIC_CACHE && k !== CDN_CACHE && k !== FONT_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: tiered caching strategy ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Network-only: radio streams, live APIs
  if (NETWORK_ONLY.some(h => url.hostname.includes(h))) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } })
    ));
    return;
  }

  // 2. Fonts: stale-while-revalidate
  if (FONT_ORIGINS.some(h => url.hostname === h)) {
    event.respondWith(staleWhileRevalidate(event.request, FONT_CACHE));
    return;
  }

  // 3. CDN scripts (xlsx, jszip, html2canvas): cache-first
  if (CDN_ORIGINS.some(h => url.hostname.includes(h))) {
    event.respondWith(cacheFirst(event.request, CDN_CACHE));
    return;
  }

  // 4. App shell (same origin): cache-first with network fallback
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // 5. Everything else: network with cache fallback
  event.respondWith(networkWithCacheFallback(event.request));
});

// ── Cache strategies ────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || await networkPromise || new Response('Offline', { status: 503 });
}

async function networkWithCacheFallback(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CDN_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// ── Message handler (skip waiting on demand) ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
