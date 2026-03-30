// Cache-Name
const CACHE_NAME = 'pfpue-cache-v1';

// Liste der Dateien, die gecached werden sollen (offline verfügbar)
const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  // Leaflet CSS/JS (CDN)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  // Icons hinzufügen, sobald verfügbar
  // './icons/icon-192.png',
  // './icons/icon-512.png'
];

// 'install'-Event: Cachen der statischen Dateien
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching statischer Dateien...');
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

// 'activate'-Event: Alten Cache bereinigen
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Entferne alten Cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
});

// 'fetch'-Event: Versuche, vom Cache zu laden, andernfalls vom Netzwerk
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});