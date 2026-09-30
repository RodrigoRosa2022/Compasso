const CACHE = 'compasso-static-v39';
const BASE = new URL('./', self.location.href);
const FILES = [
  'index.html',
  'style.css',
  'crop.css',
  'workflow.css',
  'finance.css',
  'mobile-fixes.css',
  'camera.css',
  'data-v2.js',
  'journal.js',
  'firebase.js',
  'app.js',
  'demo-data.json',
  'manifest.json',
  'privacy.html',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'assets/teacher-demo.png',
  'assets/students-demo.png',
  'assets/book-demo.png'
];
const OFFLINE_FILES = new Map(FILES.map(file => {
  const url = new URL(file, BASE);
  return [url.pathname, url.href];
}));
const INDEX = new URL('index.html', BASE).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...OFFLINE_FILES.values()]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('compasso-static-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;

  const isNavigation = request.mode === 'navigate';
  const cacheKey = OFFLINE_FILES.get(url.pathname)
    || (isNavigation && url.pathname === BASE.pathname ? INDEX : null);

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && cacheKey) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(cacheKey, copy)));
      }
      return response;
    } catch (error) {
      const fallback = cacheKey || (isNavigation ? INDEX : null);
      const cached = fallback && await caches.match(fallback, { cacheName: CACHE });
      return cached || Response.error();
    }
  })());
});
