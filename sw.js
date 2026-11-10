/* Personal Favorites PWA / GitHub Pages compatible, relative scope */
const CACHE='favbox-shell-v116';
const SHELL=['./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('favbox-shell-')&&n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const u=new URL(event.request.url);
  if(u.origin!==self.location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(event.request.mode==='navigate'){
    // Do not cache query strings containing shared URLs/titles.
    event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
  } else {
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
  }
});
