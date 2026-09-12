const CACHE_NAME = 'piksta-v1';
const IMAGE_CACHE = 'piksta-images-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Картинки товаров Pinduoduo — cache-first (для офлайна и скорости)
  if (url.includes('pddpic.com') || url.includes('pinduoduo')) {
    e.respondWith(
      caches.open(IMAGE_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            // Кэшируем успешно загруженную картинку
            if (resp && (resp.ok || resp.type === 'opaque')) {
              cache.put(e.request, resp.clone());
            }
            return resp;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Всё остальное — network-first с фолбэком на кэш
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
