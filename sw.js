const scopeUrl = self.registration.scope;

const buildHashFromDefine = (() => {
  try {
    if (typeof __SW_BUILD_HASH__ !== 'undefined') return __SW_BUILD_HASH__;
  } catch (error) {
    // ignored
  }

  try {
    if (typeof __BUILD_HASH__ !== 'undefined') return __BUILD_HASH__;
  } catch (error) {
    // ignored
  }

  return undefined;
})();

if (buildHashFromDefine && !self.__SW_BUILD_HASH__) {
  self.__SW_BUILD_HASH__ = buildHashFromDefine;
}

const initialHash = (() => {
  if (self.__SW_BUILD_HASH__) return self.__SW_BUILD_HASH__;
  if (self.__BUILD_HASH__) return self.__BUILD_HASH__;
  try {
    const swUrl = new URL(self.location.href);
    return swUrl.searchParams.get('build') || 'dev';
  } catch (error) {
    console.warn('Failed to determine build hash from service worker URL', error);
    return 'dev';
  }
})();

const currentCacheName = `cmatrix-${initialHash}`;

const PRECACHE_URLS = ['/', 'manifest.webmanifest', 'icon-192.svg', 'icon-512.svg'];
const INDEX_URL = new URL('/', scopeUrl).toString();

const cacheFirst = async (request) => {
  const cache = await caches.open(currentCacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
};

const isVersionedAsset = (url) => {
  if (url.searchParams && url.searchParams.has('v')) return true;
  return /\.[0-9a-f]{8,}\.[a-z0-9]+$/i.test(url.pathname);
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(currentCacheName);
    const results = await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Failed to precache asset: ${PRECACHE_URLS[index]}`, result.reason);
      }
    });
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== currentCacheName).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    const acceptHeader = request.headers.get('Accept') || '';
    const url = new URL(request.url);

    if (acceptHeader.includes('text/html')) {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          const cache = await caches.open(currentCacheName);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        const cached = await caches.match(INDEX_URL);
        if (cached) return cached;
        throw error;
      }
    }

    if (url.origin === self.location.origin && isVersionedAsset(url)) {
      return cacheFirst(request);
    }

    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    try {
      const response = await fetch(request);
      if (response && response.ok && url.origin === self.location.origin) {
        const cache = await caches.open(currentCacheName);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
        const fallback = await caches.match(INDEX_URL);
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
