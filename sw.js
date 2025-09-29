const CACHE='cmatrix-v4_6';
const ASSETS=['/','/index.html','index.html','/manifest.webmanifest','/styles.css','/icon-192.svg','/icon-512.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))) });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);

  if(e.request.mode==='navigate'||e.request.destination==='document'){
    e.respondWith(
      fetch(e.request).then(r=>{
        if(r&&r.ok&&url.origin===location.origin){
          const responseClone=r.clone();
          caches.open(CACHE).then(cs=>cs.put(e.request,responseClone));
        }
        return r;
      }).catch(()=>caches.match('index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(c=>{
      if(c) return c;
      return fetch(e.request).then(r=>{
        if(url.origin===location.origin&&r.ok){
          const responseClone=r.clone();
          caches.open(CACHE).then(cs=>cs.put(e.request,responseClone));
        }
        return r;
      }).catch(()=>{
        if(url.origin===location.origin){
          return caches.match('index.html');
        }
        return Promise.reject('offline');
      });
    })
  );
});
