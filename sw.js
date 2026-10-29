/* ELV Cash: keeps the app files so it opens fast and can be installed. Data always comes from the network. */
const CACHE = 'elv-cash-v1';
const FILES = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './icons/logo.png', './icons/icon-192.png', './icons/favicon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google sign-in and the script: never cached
  // Network first, so a new version shows at once; the saved copy only when offline.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
