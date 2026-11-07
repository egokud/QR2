// Vercel serverless-функция: прокси для фото товаров с площадок.
// Скачивает фото на сервере и отдаёт браузеру как «своё» (с нашего домена).
// Путь: /api/img?url=<адрес фото>
// Где используется (маршрутизация):
//  • выгрузка для описи (exportForInventory в js/app.js) — фото Pinduoduo;
//  • 07.11.2026: все фото Taobao и 1688 (pkImg в js/app.js) — их сервер alicdn.com из Беларуси часто не отвечает,
//    а наш сервер забирает фото без проблем. Ответ кэшируется на CDN Vercel на год: каждое фото качается с alicdn один раз.
const ALLOW = /^https:\/\/([a-z0-9-]+\.)*(pddpic\.com|pddugc\.com|alicdn\.com)\//i;

export default async function handler(req, res) {
  const { url } = req.query;
  // только фото площадок — не открытый прокси на весь интернет
  if (!url || !ALLOW.test(url)) {
    res.status(400).json({ error: 'Разрешены только фото Pinduoduo, Taobao и 1688' });
    return;
  }
  const ali = /alicdn\.com\//i.test(url);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const upstream = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'Referer': ali ? 'https://www.taobao.com/' : 'https://mobile.pinduoduo.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    });
    clearTimeout(t);
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'Фото недоступно: ' + upstream.status });
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(contentType)) { res.status(415).json({ error: 'Это не картинка' }); return; }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > 3 * 1024 * 1024) { res.status(413).json({ error: 'Слишком большое фото' }); return; }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // фото по одному адресу не меняется — браузер держит месяц, CDN Vercel — год
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=31536000, immutable');
    res.status(200).send(buffer);
  } catch (e) {
    res.status(502).json({ error: 'Ошибка загрузки: ' + e.message });
  }
}
