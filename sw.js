// Piksta service worker — работа без интернета (07.11.2026)
// 1. Фото товаров с площадок (Pinduoduo, Taobao, 1688) — сначала с телефона (скачанные «Подготовить к складу»), потом из сети.
// 2. Файлы приложения (страница /app, скрипты, стили, иконки, шрифты, Firebase) — сначала из сети (всегда свежие),
//    сохраняются на телефон; нет связи или сеть «висит» — отдаём сохранённые. Так Piksta открывается и без интернета.
// 3. Всё остальное (база Firestore, вход, /api) — только сеть, не трогаем.
// Маршрутизация: «Подготовить к складу» (js/pkoff.js) заранее кладёт файлы приложения в тот же кэш piksta-app-v2.
const APP_CACHE = 'piksta-app-v2';
const IMAGE_CACHE = 'piksta-images-v1';
const CDN = /^(www\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 03.11.2026: в кэш картинок по ошибке попадали файлы самого сайта — чистим такие записи
    try {
      const cache = await caches.open(IMAGE_CACHE);
      for (const req of await cache.keys()) if (new URL(req.url).origin === self.location.origin) await cache.delete(req);
    } catch (err) {}
    try { for (const k of await caches.keys()) if (k === 'piksta-v1') await caches.delete(k); } catch (err) {}   // старый пустой кэш
    await clients.claim();
  })());
});

// Фото товаров площадок — по адресу сервера, а не по слову в пути
function isMarketImage(url) {
  try {
    const u = new URL(url);
    if (u.origin === self.location.origin) return false;
    return /(^|\.)pddpic\.com$|pinduoduo|yangkeduo|(^|\.)alicdn\.com$|(^|\.)taobaocdn\.com$|(^|\.)tbcdn\.cn$/.test(u.hostname);
  } catch (e) { return false; }
}
function isAppFile(u) {
  if (u.origin === self.location.origin) return !/^\/(api|__)\//.test(u.pathname) && u.pathname !== '/sw.js' && !/\.(pdf|zip|mp4|mov)$/i.test(u.pathname);
  if (u.hostname === 'www.gstatic.com') return u.pathname.startsWith('/firebasejs/');
  return CDN.test(u.hostname);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Сеть с запасом: успели — сохранили и отдали; сеть упала или «висит» дольше ms — отдаём сохранённое (если есть)
async function netFirst(req, key, ms, cors) {
  const cache = await caches.open(APP_CACHE);
  const net = fetch(cors ? new Request(req.url, { mode: 'cors', credentials: 'omit' }) : req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(key, r.clone()).catch(() => {});
    return r;
  });
  const fromCache = async () => (await cache.match(key)) || (await cache.match(key, { ignoreSearch: true }));
  try {
    return await Promise.race([net, wait(ms).then(() => { throw new Error('slow'); })]);
  } catch (e) {
    const c = await fromCache();
    if (c) return c;
    if (cors) { try { return await fetch(req); } catch (e2) {} }   // CDN без CORS — обычный запрос
    return net;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let u; try { u = new URL(req.url); } catch (err) { return; }

  if (isMarketImage(req.url)) {
    // кладёт в кэш только «Подготовить к складу» (одна закупка) — иначе телефон забьётся фото всех закупок
    e.respondWith(caches.open(IMAGE_CACHE).then(cache => cache.match(req).then(cached => cached || fetch(req))));
    return;
  }

  // Страница приложения (/app, /app?ship=…, /) — одна запись /app
  if (req.mode === 'navigate' && u.origin === self.location.origin) {
    const appPage = u.pathname === '/app' || u.pathname === '/app.html';
    const key = appPage ? self.location.origin + '/app' : self.location.origin + u.pathname;
    e.respondWith((async () => {
      try { return await netFirst(req, key, 5000); }
      catch (err) {
        const c = await caches.open(APP_CACHE);
        return (await c.match(self.location.origin + '/app')) || Response.error();   // без связи любая страница → приложение
      }
    })());
    return;
  }

  if (isAppFile(u)) {
    const cors = u.origin !== self.location.origin && req.mode === 'no-cors';
    e.respondWith(netFirst(req, req.url, 6000, cors).catch(() => caches.match(req.url, { ignoreSearch: true }).then(r => r || Response.error())));
  }
});
