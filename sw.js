// Luna Pro — Service Worker
// Stratégie : cache-first pour les assets locaux, network-first pour l'API météo

const CACHE_NAME = 'luna-pro-v3';
const CACHE_DURATION_API = 30 * 60 * 1000; // 30 min pour Open-Meteo

// Assets à mettre en cache immédiatement à l'installation
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── Installation : précache des assets statiques ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activation : nettoyage des anciens caches ─────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie selon la ressource ─────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Open-Meteo API → network-first avec fallback cache (30 min)
  if (url.hostname === 'api.open-meteo.com') {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // Google Fonts → network-first (besoin de mise à jour possible)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(networkFirstWithCache(event.request));
    return;
  }

  // Assets locaux → cache-first (app fonctionne hors ligne)
  event.respondWith(cacheFirstWithNetwork(event.request));
});

// Cache-first : essaie le cache, sinon réseau puis stocke
async function cacheFirstWithNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Hors ligne et pas en cache → réponse offline générique
    return new Response(
      '<html><body style="background:#08081a;color:#d0c8b0;font-family:sans-serif;text-align:center;padding:40px">' +
      '<h2>🌙 Luna Pro</h2><p>Hors ligne — chargement impossible.</p>' +
      '<p>Ouvrez l\'app une première fois avec du réseau pour activer le mode hors ligne.</p></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// Network-first : essaie le réseau, stocke en cache, sinon utilise le cache
async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
