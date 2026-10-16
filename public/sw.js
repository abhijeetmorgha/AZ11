const CACHE='az11-pdf-open-v9';
const STATIC=['/','/index.html','/owner-az11.html','/manifest.webmanifest','/admin-manifest.webmanifest','/logo.png','/icon-192.png','/icon-512.png'];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC.map(x=>new Request(x,{cache:'reload'})))))
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))
});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;

  // APIs remain network-based. The public app already stores synced questions,
  // notes, PDF-test metadata and pending progress locally for offline use.
  if(u.pathname.startsWith('/api/'))return;

  if(e.request.mode==='navigate'){
    const ownerPage=u.pathname.includes('owner-az11.html');
    const fallback=ownerPage?'/owner-az11.html':'/index.html';
    e.respondWith((async()=>{
      const cached=await caches.match(fallback);
      const network=fetch(e.request,{cache:'no-store'}).then(async r=>{
        if(r&&r.ok){const c=await caches.open(CACHE);await c.put(fallback,r.clone())}
        return r;
      });
      if(cached){e.waitUntil(network.catch(()=>{}));return cached}
      try{return await network}catch(err){return (await caches.match(fallback))||Response.error()}
    })());
    return;
  }

  e.respondWith((async()=>{
    const cached=await caches.match(e.request);
    if(cached)return cached;
    try{
      const r=await fetch(e.request);
      if(r&&r.ok&&e.request.method==='GET'){
        const c=await caches.open(CACHE);c.put(e.request,r.clone()).catch(()=>{});
      }
      return r;
    }catch(e){return cached||Response.error()}
  })());
});
