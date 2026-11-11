/* お気に入りボックス v1.2.1 | GitHub Pages | preserves all user data */
const CACHE='favbox-shell-v121';
const SHELL=['./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('favbox-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode==='navigate'){
    // Browser always checks live HTML first. Offline-only fall back to cached shell.
    event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>caches.match('./index.html')));
  }else{
    event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
  }
});
