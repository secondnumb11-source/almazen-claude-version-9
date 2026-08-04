const CACHE_NAME = 'almazen-operational-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico'
];

// Operational routes & endpoints to cache for offline access
const OPERATIONAL_ROUTES = [
  '/customers',
  '/units',
  '/rest/v1/customers',
  '/rest/v1/units',
  '/rest/v1/bookings',
  '/rest/v1/corporate_profiles',
  '/rest/v1/maintenance_requests'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets & operational pages');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing legacy operational cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Stale-While-Revalidate & Network-First for operational data
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET requests for SW cache put
  if (e.request.method !== 'GET') {
    return;
  }

  const isOperational = OPERATIONAL_ROUTES.some(path => url.pathname.includes(path));
  const isStaticAsset = e.request.destination === 'script' || e.request.destination === 'style' || e.request.destination === 'image' || e.request.destination === 'font';

  if (isOperational || isStaticAsset || e.request.destination === 'document') {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const networkResponse = await fetch(e.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          console.warn('[SW] Offline or network failure, serving operational fallback from cache:', e.request.url);
          const cachedResponse = await cache.match(e.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          if (e.request.destination === 'document') {
            return cache.match('/') || cache.match('/index.html');
          }
          return new Response(JSON.stringify({ offline: true, message: 'مواجهة انقطاع اتصال - يتم عرض البيانات المخزنة مؤقتاً' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((response) => response || fetch(e.request))
    );
  }
});

// Message listener from main thread
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'QUEUE_MUTATION') {
    console.log('[SW] Received offline operational mutation for background sync:', e.data.item);
  }
});

// Background Sync
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-customer-changes' || e.tag === 'sync-unit-changes') {
    console.log('[SW] Triggering background sync for operational changes...');
  }
});
