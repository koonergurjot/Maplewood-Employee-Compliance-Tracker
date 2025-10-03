const scopeUrl = self.registration.scope;

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

let currentCacheName = `cmatrix-${initialHash}`;

const STATIC_PATHS = [
  './',
  'index.html',
  'calendar.html',
  'convert-icons.html',
  'clear-cache.html',
  'timeline-component.html',
  'manifest.webmanifest',
  'manifest.json',
  'icon-192.svg',
  'icon-512.svg'
];

const STATIC_URLS = STATIC_PATHS.map(path => new URL(path, scopeUrl).toString());
const INDEX_URL = new URL('index.html', scopeUrl).toString();

let manifestPromise;

function extractHashFromAssets(assets) {
  for (const url of assets) {
    const match = url.match(/[-.]([a-f0-9]{8,})(?:\.(?:js|css|mjs))$/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

async function loadManifestAssets() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const assets = new Set(STATIC_URLS);
      try {
        const manifestUrl = new URL('manifest.json', scopeUrl);
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        if (response && response.ok) {
          assets.add(manifestUrl.toString());
          const manifest = await response.json();
          const visited = new Set();

          const addEntry = (key) => {
            if (visited.has(key)) return;
            visited.add(key);
            const entry = manifest[key];
            if (!entry) return;

            if (entry.file) {
              assets.add(new URL(entry.file, scopeUrl).toString());
            }

            if (Array.isArray(entry.css)) {
              entry.css.forEach(file => assets.add(new URL(file, scopeUrl).toString()));
            }

            if (Array.isArray(entry.assets)) {
              entry.assets.forEach(file => assets.add(new URL(file, scopeUrl).toString()));
            }

            if (Array.isArray(entry.imports)) {
              entry.imports.forEach(addEntry);
            }
          };

          Object.keys(manifest).forEach(addEntry);

          const derivedHash = extractHashFromAssets(assets);
          if (derivedHash) {
            currentCacheName = `cmatrix-${derivedHash}`;
          }
        } else {
          assets.delete(manifestUrl.toString());
        }
      } catch (error) {
        const manifestUrl = new URL('manifest.json', scopeUrl);
        assets.delete(manifestUrl.toString());
        console.warn('Failed to load Vite manifest for precache', error);
      }

      return { cacheName: currentCacheName, urls: Array.from(assets) };
    })();
  }

  return manifestPromise;
}

loadManifestAssets().catch(() => {});

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
    const { cacheName, urls } = await loadManifestAssets();
    const cache = await caches.open(cacheName);
    const validUrls = urls.filter(Boolean);
    const results = await Promise.allSettled(validUrls.map((url) => cache.add(url)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Failed to precache asset: ${validUrls[index]}`, result.reason);
      }
    });
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const { cacheName } = await loadManifestAssets();
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    await loadManifestAssets().catch(() => {});

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
