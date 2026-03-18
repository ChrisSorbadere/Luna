// Luna Pro — Service Worker v3
const CACHE_NAME = 'luna-pro-v4';

const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Domaines dont les réponses ne doivent JAMAIS être mises en cache
const NO_CACHE_DOMAINS = [
  'll.thespacedevs.com',   // Launch Library — données temps réel
  'api.open-meteo.com',    // Météo — géré par cache applicatif interne
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // APIs temps réel → réseau direct, JAMAIS de cache
  if (NO_CACHE_DOMAINS.some(d => url.hostname === d)) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // Google Fonts → network-first avec cache
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Assets locaux → cache-first
  event.respondWith(cacheFirst(event.request));
});

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch(e) {
    return new Response('{"error":"offline","results":[]}', {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    if (request.destination === 'document') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
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
