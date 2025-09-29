const CACHE='cmatrix-v4_5';
const ASSETS=['./','index.html','manifest.webmanifest?v=1','styles.css?v=1','icon-192.svg?v=1','icon-512.svg?v=1'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))) });
self.addEventListener('fetch',e=>{ 
  if(e.request.method!=='GET') return; 
  const url=new URL(e.request.url);
  e.respondWith(
    caches.match(e.request).then(c=>{
      if(c) return c;
      return fetch(e.request).then(r=>{ 
        if(url.origin===location.origin && r.ok) {
          const responseClone = r.clone();
          caches.open(CACHE).then(cs=>cs.put(e.request,responseClone));
        }
        return r; 
      }).catch(()=>{
        if(url.pathname.startsWith('/')) {
          return caches.match('index.html').then(res=>res||caches.match('./'));
        }
        return Promise.reject('offline');
      });
    })
  );
});
