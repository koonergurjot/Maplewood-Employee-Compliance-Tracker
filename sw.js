const BUILD_HASH = self.__SW_BUILD_HASH__ || self.__BUILD_HASH__ || 'v3';
const CACHE = `cmatrix-${BUILD_HASH}`;

const scopeUrl = self.registration.scope;
const PRECACHE_PATHS = [

  './',
  'index.html',
  'calendar.html',
  'convert-icons.html',
  'clear-cache.html',
  'timeline-component.html',
  'manifest.webmanifest',
  'styles.css',
  'icon-192.svg',
  'icon-512.svg',
  'commands.js',
  'activity-log.js',
  'db.js',
  'calendar.js',
  'onboarding.js'
,
  'manifest.webmanifest?v=1',
  'styles.css?v=1'
];

const PRECACHE_URLS = PRECACHE_PATHS.map(path => new URL(path, scopeUrl).toString());
const INDEX_URL = new URL('index.html', scopeUrl).toString();

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
});

const cacheFirst = request =>
  caches.match(request).then(cachedResponse => {
    if (cachedResponse) return cachedResponse;

    return fetch(request).then(response => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, clone));
      }
      return response;
    });
  });

const isVersionedAsset = url => {
  if (url.searchParams && url.searchParams.has('v')) return true;
  return /\.[0-9a-f]{8,}\./i.test(url.pathname);
};

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const acceptHeader = request.headers.get('Accept') || '';
  const url = new URL(request.url);

  if (acceptHeader.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(INDEX_URL))
    );
    return;
  }

  if (url.origin === self.location.origin && isVersionedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then(response => {
          if (response && response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
            return caches.match(INDEX_URL);
          }
          return Promise.reject('offline');
        });
    })
  );
});
