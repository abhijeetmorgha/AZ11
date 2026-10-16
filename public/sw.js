const CACHE='az11-random2600-emoji-game-v7';
const STATIC=['./','./index.html','./owner-az11.html','./manifest.webmanifest','./admin-manifest.webmanifest','./logo.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/'))return;
  if(e.request.mode==='navigate'){
    const ownerPage=u.pathname.includes('owner-az11.html');
    const fallback=ownerPage?'./owner-az11.html':'./index.html';
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(fallback,c));return r})
        .catch(()=>caches.match(fallback))
    );
  }else{
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
  }
});
