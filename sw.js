/* Auto-generated offline service worker for SQUAD OF ONE.
 * Cache-first: after install the game boots and plays with ZERO network calls. */
const CACHE = "squad-of-one-v0.1.0-1790938063602";
const ASSETS = ["./","./index.html","./manifest.webmanifest","./assets/phaser-D3izK-R_.js","./assets/index-DjgEAcPa.js","./assets/scrubber-worker--Z8Ovt-U.js","./fonts/NotoSans-subset.woff2","./fonts/NotoSansDevanagari-subset.woff2","./fonts/Orbitron-subset.woff2","./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./icons/apple-touch-icon.png"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      // Same-origin only; the game never talks to third parties at play time.
      return fetch(req)
        .then((res) => {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./"));
    }),
  );
});
