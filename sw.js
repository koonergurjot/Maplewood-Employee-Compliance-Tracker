const CACHE='cmatrix-v4_1';
const ASSETS=['/','/index.html','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))) });
self.addEventListener('fetch',e=>{ if(e.request.method!=='GET') return; const url=new URL(e.request.url);
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{ if(url.origin===location.origin && r.ok) caches.open(CACHE).then(cs=>cs.put(e.request,r.clone())); return r; }).catch(()=>url.pathname.startsWith('/')?caches.match('/index.html'):Promise.reject('offline'))));
});
