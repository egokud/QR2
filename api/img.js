// Vercel serverless-функция: прокси для картинок Pinduoduo (обход CORS).
// Скачивает картинку на сервере (с referer pinduoduo) и отдаёт браузеру как "свою".
// Путь: /api/img?url=<адрес картинки>
export default async function handler(req, res) {
  const { url } = req.query;

  // разрешаем только картинки Pinduoduo (безопасность — не открытый прокси на весь интернет)
  if (!url || !/^https:\/\/[a-z0-9.-]*pddpic\.com\//i.test(url)) {
    res.status(400).json({ error: 'Разрешены только картинки pddpic.com' });
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'Referer': 'https://mobile.pinduoduo.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: 'Картинка недоступна: ' + upstream.status });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    // отдаём картинку браузеру с CORS-разрешением (теперь она "с нашего домена")
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buffer);
  } catch (e) {
    res.status(502).json({ error: 'Ошибка загрузки: ' + e.message });
  }
}
