const CACHE_NAME = "feed-plant-pwa-v30";

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.png",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/pwa-maskable-512x512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Allow cross-origin requests (e.g. Google Apps Script JSONP) to go directly to network
  if (url.origin !== self.location.origin) {
    return;
  }

  // HTML Navigation: Network-first, fallback to cache for offline support
  if (request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match("/index.html").then(cached => cached || caches.match("/")))
    );
    return;
  }

  // Static Assets (icons, manifest): Cache-first with network background update
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // Fetch in background to keep cache fresh
        fetch(request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response));
          }
        }).catch(() => {});
        return cached;
      }

      return fetch(request).then(response => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
        }
        return response;
      });
    })
  );
});
