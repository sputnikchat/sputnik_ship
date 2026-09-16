// Minimal service worker: caches the app shell so it opens fast and is
// installable on a phone. Data (contacts, shipments) is always fetched
// live from /api/*, never cached.

// v2 (cache-first for the app shell) turned out to be a trap: once a
// browser had it installed, it kept serving that exact snapshot of
// index.html/app.js/style.css forever, since nothing here ever changes
// unless this very file's bytes change - a code update alone (without
// touching this file) never got picked up. v3 fixes that at the root:
// network-first for the shell, only falling back to cache when actually
// offline, so a deploy is visible on the next reload instead of never.
const CACHE_NAME = 'sputnikship-shell-v3';
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
  if (url.pathname.startsWith('/api/')) return; // never cache the API

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Sputnik Ship', body: 'You have a shipment update.' };
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    // if the payload isn't valid JSON, fall back to the default text above
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      if (clientsList.length) return clientsList[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
