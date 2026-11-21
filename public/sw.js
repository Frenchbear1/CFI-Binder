// Network first, cache fallback: always fresh when online, still works with no signal.
const C = 'cfi-binder-v2';
// Keep the home page and icons so the installed app opens even with no signal.
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['./', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then((res) => { const copy = res.clone(); caches.open(C).then((c) => c.put(r, copy)); return res; })
    .catch(() => caches.match(r)));
});
