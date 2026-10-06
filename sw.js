// Luna — Service Worker v12
const CACHE_NAME = 'luna-v12';
const PRECACHE = ['./', './index.html', './luna-lib.js', './manifest.json', './icon-192.png', './icon-512.png'];
// Données en temps réel : jamais mises en cache par le service worker
const LIVE = ['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'll.thespacedevs.com', 'api.wheretheiss.at', 'celestrak.org', 'api.bigdatacloud.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE_NAME).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (LIVE.includes(url.hostname)) { e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))); return; }
  // Tout le reste : réseau d'abord (mises à jour immédiates), cache en secours hors ligne
  e.respondWith(networkFirst(e.request, url));
});
async function networkFirst(req, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: url.origin === self.location.origin });
    if (hit) return hit;
    if (req.mode === 'navigate') { const idx = await cache.match('./index.html'); if (idx) return idx; }
    return new Response('Hors ligne', { status: 503 });
  }
}

/* ── Alertes en arrière-plan (Periodic Background Sync) ── */
self.addEventListener('periodicsync', e => { if (e.tag === 'luna-daily-check') e.waitUntil(checkAlerts()); });
function openIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('luna-alerts', 2);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' }); if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function req2p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const pad = n => String(n).padStart(2, '0');
const sod = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
function whenLong(d, now) {
  const n = Math.round((sod(d) - sod(now)) / 86400000), t = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (n === 0) return "Aujourd'hui à " + t;
  if (n === 1) return 'Demain à ' + t;
  return 'Dans ' + n + ' jours (' + d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ') à ' + t;
}
async function checkAlerts() {
  try {
    const db = await openIDB();
    const alerts = await req2p(db.transaction('events', 'readonly').objectStore('events').getAll());
    const metaRow = await req2p(db.transaction('meta', 'readonly').objectStore('meta').get('notified'));
    const notified = (metaRow && metaRow.value) || {};
    const now = new Date();
    for (const a of alerts || []) {
      const d = new Date(a.ts), dd = Math.round((sod(d) - sod(now)) / 86400000);
      if (dd < 0 || dd > 3 || d < now) continue;
      const k = a.id + (dd === 0 ? ':day' : ':pre');
      if (notified[k]) continue;
      await self.registration.showNotification(a.title, { body: whenLong(d, now) + ' · ' + a.body, icon: './icon-192.png', badge: './icon-192.png', tag: a.id, data: { url: './' } });
      notified[k] = Date.now(); if (dd === 0) notified[a.id + ':pre'] = notified[a.id + ':pre'] || Date.now();
    }
    const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ key: 'notified', value: notified });
    await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
  } catch (err) { /* rien à faire */ }
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
