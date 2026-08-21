const CACHE='compasso-static-v3';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['index.html','style.css','app.js','manifest.json','privacy.html','icons/icon-192.png','icons/icon-512.png'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));
