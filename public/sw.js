// Pages: shown from the device straight away, refreshed in the background for next time (the lessons
// themselves come from Firestore, so a page here is just the frame). Code and styles (/assets/, named by
// their contents so they never change): from the device, fetched once.
// Source library (the big FAA PDFs and saved web pages) + PDF engine: kept on the device in their own cache
// that survives app updates. Served from there straight away; checked for a newer copy at most once a day,
// in the background (the library itself only changes weekly). The lessons themselves sync through Firestore,
// which keeps its own copy on the device.
const C = 'cfi-binder-v6';
const LIB = 'cfi-library-v1';
const DAY = 864e5;
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['./', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png']).catch(() => {}))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C && k !== LIB).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
const keep = (r, res) => { if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(C).then((c) => c.put(r, copy)).catch(() => {}); } return res; };
// Stamp library copies with when they were saved, so they're only re-checked once a day.
async function keepLib(r, res) {
  if (!res.ok || res.status !== 200) return res;
  const h = new Headers(res.headers); h.set('x-saved-at', String(Date.now()));
  const body = await res.clone().arrayBuffer();
  await caches.open(LIB).then((c) => c.put(r, new Response(body, { status: 200, statusText: 'OK', headers: h }))).catch(() => {});
  return res;
}
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || r.headers.has('range') || u.pathname.includes('/api/')) return;
  if (/\/(library|vendor)\//.test(u.pathname)) {
    e.respondWith(caches.open(LIB).then((c) => c.match(r)).then((hit) => {
      if (hit) {
        if (Date.now() - Number(hit.headers.get('x-saved-at') || 0) > DAY) e.waitUntil(fetch(r, { cache: 'no-cache' }).then((res) => keepLib(r, res)).catch(() => {}));
        return hit;
      }
      return fetch(r).then((res) => { e.waitUntil(keepLib(r, res.clone())); return res; });
    }));
    return;
  }
  if (u.pathname.includes('/assets/')) {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => keep(r, res))));
    return;
  }
  // Pages: from the device at once when we have them, and a fresh copy saved for next time.
  if (r.mode === 'navigate' && !/\/(login|screen)(\/|$)/.test(u.pathname)) {
    e.respondWith(caches.match(r, { ignoreSearch: true }).then((hit) => {
      const net = fetch(r).then((res) => (res.redirected ? res : keep(r, res)));
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net.catch(() => caches.match(r, { ignoreSearch: true }));
    }));
    return;
  }
  e.respondWith(fetch(r).then((res) => keep(r, res)).catch(() => caches.match(r)));
});
