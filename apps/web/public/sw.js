// WorkHub's service worker: lets the installed app open without a connection, so people
// can still check in (the attendance page queues it and syncs later). It never touches
// /api: data always comes from the server, and nothing private is cached here.
const VERSION = 'v2';
const STATIC = `workhub-static-${VERSION}`;
const PAGES = `workhub-pages-${VERSION}`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll([OFFLINE, '/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('workhub-') && ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Build files have content hashes in their names: once cached, always right.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: the network first; offline, the last copy of that page, then the attendance
  // page (for checking in), then a short "you're offline" page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname.startsWith('/app')) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) || (await caches.match('/app/attendance')) || caches.match(OFFLINE)),
    );
  }
});
