// Service worker minimo: cachea el shell de la app para que abra rapido
// y sea instalable en el celular. Los datos (contactos, envios) siempre
// se piden en vivo a /api/*, no se cachean.

const CACHE_NAME = 'sputnikship-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // nunca cachear la API

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
