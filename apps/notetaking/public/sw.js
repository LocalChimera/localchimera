const CACHE_NAME = 'chimera-pwa-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const isNavigation = request.mode === 'navigate';
  const isAsset = /\.(js|css|svg|png|woff2?)$/.test(request.url);

  event.respondWith(
    caches.match(request).then((cached) => {
      // Navigation: network-first, fallback to cache
      if (isNavigation) {
        return fetch(request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() => cached || caches.match('./index.html'));
      }

      // Assets: return cached immediately, then update in background
      if (cached && isAsset) {
        fetch(request).then((response) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }).catch(() => {});
        return cached;
      }

      return fetch(request).then((response) => {
        if (isAsset && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
