const CACHE_NAME = 'piksta-v1';
const IMAGE_CACHE = 'piksta-images-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

// 03.11.2026: в кэш картинок по ошибке попадали файлы самого сайта, в адресе которых есть слово «pinduoduo»
// (например /guides/piksta-start-pinduoduo.pdf) — и потом всегда отдавалась старая версия. Чистим такие записи.
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(IMAGE_CACHE);
      for (const req of await cache.keys()) if (new URL(req.url).origin === self.location.origin) await cache.delete(req);
    } catch (err) {}
    await clients.claim();
  })());
});

// Картинки Pinduoduo — только с их серверов (по адресу сервера, а не по слову в пути)
function isPddImage(url) {
  try {
    const u = new URL(url);
    if (u.origin === self.location.origin) return false;
    return /(^|\.)pddpic\.com$|pinduoduo|yangkeduo/.test(u.hostname);
  } catch (e) { return false; }
}

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Картинки товаров Pinduoduo — cache-first (для офлайна и скорости)
  if (isPddImage(url)) {
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
