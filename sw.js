const CACHE = 'cmatrix-v4_5';
const scopePath = self.registration.scope.replace(location.origin, '');
const BASE = scopePath ? (scopePath.endsWith('/') ? scopePath : `${scopePath}/`) : '/';
const withBase = (path = '') => `${BASE}${path.replace(/^\//, '')}`;
const ASSET_PATHS = ['', 'index.html', 'manifest.webmanifest', 'styles.css', 'icon-192.svg', 'icon-512.svg'];
const ASSETS = ASSET_PATHS.map(withBase);
const OFFLINE_HTML = withBase('index.html');
const OFFLINE_ROOT = withBase('');

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const inScope = url.origin === location.origin && url.pathname.startsWith(BASE);

  event.respondWith(
    caches.match(event.request).then(cacheResponse => {
      if (cacheResponse) return cacheResponse;

      return fetch(event.request).then(networkResponse => {
        if (inScope && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => {
        if (inScope) {
          return caches.match(OFFLINE_HTML).then(response => response || caches.match(OFFLINE_ROOT));
        }
        return Promise.reject('offline');
      });
    })
  );
});
