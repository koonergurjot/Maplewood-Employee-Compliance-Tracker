const CACHE = 'cmatrix-v3a';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
    if (url.origin === location.origin && resp.ok) caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
    return resp;
  }).catch(() => url.pathname.startsWith('/') ? caches.match('/index.html') : Promise.reject('offline'))));
});
