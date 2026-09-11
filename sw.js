/* Service worker: precaches the app shell, caches fare data and fonts on first use. */
const VERSION = 'ridango-pos-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './clients.json',
  './styles/main.css',
  './src/app.js',
  './src/fare-model.js',
  './src/format.js',
  './assets/app-icon.svg',
  './assets/favicon.svg',
  './favicon.ico',
  './assets/logos/vastmanland.svg',
  './assets/logos/sormland.svg',
  './assets/icons/cart.svg',
  './assets/icons/check.svg',
  './assets/icons/delete.svg',
  './assets/icons/dropdown.svg',
  './assets/icons/menu.svg',
  './assets/icons/minus.svg',
  './assets/icons/plus-red.svg',
  './assets/icons/plus-white.svg',
  './assets/icons/print.svg',
  './assets/icons/status-online.svg',
  './assets/icons/success-check.svg',
  './assets/icons/x.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isData = url.pathname.includes('/data/');
  const isFont = url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');

  if (isData || isFont) {
    // Network first, fall back to cache: fare data may be republished, fonts are static.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
