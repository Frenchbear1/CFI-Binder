// Pages: network first, cache fallback (always fresh when online, still works with no signal).
// Source library + PDF engine: served from the cache straight away and refreshed in the background, so a
// reference opens instantly the second time (the library itself only changes weekly).
const C = 'cfi-binder-v4';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['./', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
const keep = (r, res) => { if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(C).then((c) => c.put(r, copy)).catch(() => {}); } return res; };
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || r.headers.has('range') || u.pathname.includes('/api/')) return;
  if (/\/(library|vendor)\//.test(u.pathname)) {
    e.respondWith(caches.match(r).then((hit) => {
      const net = fetch(r).then((res) => keep(r, res));
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }));
    return;
  }
  e.respondWith(fetch(r).then((res) => keep(r, res)).catch(() => caches.match(r)));
});
