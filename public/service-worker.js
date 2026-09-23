// Service worker: makes the app open instantly and keeps it installable.
//
// History, so nobody walks back into the same traps:
// - v2 was cache-first with no revalidation: a browser kept serving the
//   exact snapshot it first cached, forever, so deploys never showed up.
// - v3/v4 were network-first: always fresh, but on Render's free plan the
//   server sleeps after 15 min idle and the first request is held 30-60 s
//   while it boots - network-first meant a blank screen for that whole time.
// - v5 (this) is stale-while-revalidate: answer from cache immediately, and
//   fetch the fresh copy in the background. When that fresh copy differs,
//   the whole shell is re-downloaded together (so html/js/css never mix
//   versions) and open pages are told a new version is ready; app.js offers
//   a one-tap reload. A deploy is therefore picked up on the very next open.
//
// API data (/api/*) is never touched here - app.js keeps its own
// last-known copy per account so it can paint the inbox while the API wakes.
const CACHE_NAME = 'sputnikship-shell-v6';
// app.js owns this cache (last-known inbox data); never delete it on activate.
const DATA_CACHE_PREFIX = 'sputnikship-data';
const SHELL_FILES = [
  '/app',
  '/css/tokens.css',
  '/css/style.css',
  '/js/app.js',
  '/js/boot.js',
  '/js/scan.js',
  '/js/hero.js',
  '/manifest.json',
  '/icons/logo-mark.svg',
  '/icons/icon-192.png',
];
// Files whose change means "a new version was deployed".
const VERSIONED = new Set(['/app', '/', '/css/style.css', '/css/tokens.css', '/js/app.js', '/js/landing.js']);
// Third-party files worth keeping offline (pinned Leaflet). Only hosts the
// CSP's connect-src allows: a worker's own fetch() obeys connect-src, so
// routing Google Fonts through here got them blocked (fonts fell back to
// the system face). Fonts stay with the browser's HTTP cache instead.
const CDN_HOSTS = new Set(['cdn.jsdelivr.net']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' skips the browser's HTTP cache (the CDN in front of
    // production sets a 4 h max-age), so a fresh install never starts out
    // with yesterday's app.js.
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES.map((path) => new Request(path, { cache: 'reload' }))))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && !k.startsWith(DATA_CACHE_PREFIX))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Every in-app route (/app, /app?track=…, /s/<token>) is the same
// index.html, so they all share one cache entry. Returns null for
// requests this worker should leave to the network.
function cacheKeyFor(request, url) {
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return CDN_HOSTS.has(url.hostname) ? request.url : null; // map tiles, QR images: network only
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/promo/')) return null;
  if (request.headers.has('range')) return null;
  if (request.mode === 'navigate') {
    if (url.pathname === '/') return '/';
    if (url.pathname === '/app' || url.pathname.startsWith('/app/') || url.pathname.startsWith('/s/')) return '/app';
    return null;
  }
  return url.pathname;
}

let refreshingShell = null;
function refreshWholeShell() {
  if (refreshingShell) return refreshingShell;
  refreshingShell = (async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
      SHELL_FILES.map((path) =>
        fetch(path, { cache: 'no-cache' })
          .then((res) => (res.ok && !res.redirected ? cache.put(path, res) : null))
          .catch(() => {})
      )
    );
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach((c) => c.postMessage({ type: 'shell-updated' }));
  })().finally(() => { refreshingShell = null; });
  return refreshingShell;
}

// Fetches the fresh copy and stores it; a cache hiccup never breaks the
// response itself.
async function revalidate(request, key, cached) {
  const fresh = await fetch(request.mode === 'navigate' ? key : request, { cache: 'no-cache' });
  const storable = (fresh.ok || fresh.type === 'opaque') && fresh.status !== 206 && !fresh.redirected;
  if (!storable) return fresh;
  try {
    const cache = await caches.open(CACHE_NAME);
    // Re-read the stored copy: the one handed to respondWith() may already
    // have had its body consumed by the page.
    const old = cached && VERSIONED.has(key) ? await cache.match(key) : null;
    if (old) {
      const [a, b] = await Promise.all([old.text(), fresh.clone().text()]);
      await cache.put(key, fresh.clone());
      if (a !== b) await refreshWholeShell();
    } else {
      await cache.put(key, fresh.clone());
    }
  } catch (err) {
    // quota or a body that can't be cached: still answer with the network copy
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const key = cacheKeyFor(request, url);
  if (!key) return;

  const cachedP = caches.match(key, { ignoreSearch: url.origin === self.location.origin });
  const networkP = cachedP.then((cached) => revalidate(request, key, cached));
  event.respondWith(cachedP.then((cached) => cached || networkP));
  event.waitUntil(networkP.catch(() => {}));
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
      return self.clients.openWindow('/app');
    })
  );
});
