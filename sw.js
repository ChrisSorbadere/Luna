// Luna Pro — Service Worker v2 (structure plate)
const CACHE_NAME = 'luna-pro-v3-flat';

const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Installation : précache immédiat
self.addEventListener('install', event => {
  console.log('[SW] Installation…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Mise en cache des assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Installation terminée');
        return self.skipWaiting();
      })
  );
});

// Activation : nettoyage anciens caches
self.addEventListener('activate', event => {
  console.log('[SW] Activation…');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Suppression ancien cache :', k);
          return caches.delete(k);
        })
      )
    ).then(() => {
      console.log('[SW] Activation terminée — contrôle de tous les clients');
      return self.clients.claim();
    })
  );
});

// Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API météo → network-first
  if (url.hostname === 'api.open-meteo.com') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts → network-first
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Tout le reste (assets locaux) → cache-first
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    console.log('[SW] Depuis cache :', request.url);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    console.warn('[SW] Hors ligne, ressource non cachée :', request.url);
    // Fallback HTML minimal
    if (request.destination === 'document') {
      const cached = await caches.match('./index.html');
      if (cached) return cached;
    }
    return new Response('Hors ligne', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch(e) {
    const cached = await cache.match(request);
    return cached || new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
