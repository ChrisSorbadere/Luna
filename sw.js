// Luna Pro — Service Worker v4 (avec periodicSync notifications)
const CACHE_NAME = 'luna-pro-v7';

const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

const NO_CACHE_DOMAINS = [
  'll.thespacedevs.com',
  'api.open-meteo.com',
  'api.wheretheiss.at',
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
  if (NO_CACHE_DOMAINS.some(d => url.hostname === d)) {
    event.respondWith(networkOnly(event.request));
    return;
  }
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  // index.html et racine → network-first : les mises à jour arrivent immédiatement
  if (event.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

// ── Periodic Background Sync ────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'luna-daily-check') {
    event.waitUntil(checkAndFireNotifications());
  }
});

async function checkAndFireNotifications() {
  // Lire les alertes pré-calculées depuis IndexedDB
  try {
    const alerts = await readAlertsFromIDB();
    if (!alerts || !alerts.length) return;
    const now = Date.now();
    // Lire l'historique des notifications déjà envoyées
    const notified = await readNotifiedFromIDB();
    for (const alert of alerts) {
      const diff = Math.round((alert.ts - now) / 86400000);
      if (diff >= 0 && diff <= 3) {
        const lastSent = notified[alert.id] || 0;
        if (now - lastSent > 86400000) {
          await self.registration.showNotification(alert.title, {
            body: alert.body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: alert.id,
            data: { url: './' },
          });
          notified[alert.id] = now;
        }
      }
    }
    await writeNotifiedToIDB(notified);
  } catch(e) {
    console.warn('[SW] periodicSync error:', e);
  }
}

// ── IndexedDB helpers ────────────────────────────────────────────
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('luna-alerts', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('events'))
        db.createObjectStore('events', {keyPath:'id'});
      if (!db.objectStoreNames.contains('meta'))
        db.createObjectStore('meta', {keyPath:'key'});
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}

async function readAlertsFromIDB() {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('events', 'readonly');
    const req = tx.objectStore('events').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function readNotifiedFromIDB() {
  const db = await openIDB();
  return new Promise((res) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get('notified');
    req.onsuccess = () => res(req.result ? req.result.value : {});
    req.onerror = () => res({});
  });
}

async function writeNotifiedToIDB(notified) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({key:'notified', value:notified});
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

// Notification click → ouvrir l'app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type:'window'}).then(cs => {
      if (cs.length) return cs[0].focus();
      return clients.openWindow('./');
    })
  );
});

async function networkOnly(request) {
  try { return await fetch(request); }
  catch(e) { return new Response('{"error":"offline","results":[]}', {headers:{'Content-Type':'application/json'}}); }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) { const c = await caches.open(CACHE_NAME); c.put(request, response.clone()); }
    return response;
  } catch(e) {
    if (request.destination === 'document') { const f = await caches.match('./index.html'); if(f) return f; }
    return new Response('Hors ligne', {status:503});
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try { const r = await fetch(request); if(r.ok) cache.put(request, r.clone()); return r; }
  catch(e) { return await cache.match(request) || new Response('{"error":"offline"}', {headers:{'Content-Type':'application/json'}}); }
}
