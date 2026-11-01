// Страна посетителя по IP (заголовок Vercel) — для показа цен в валюте страны. Ничего не хранит.
module.exports = (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ c: String(req.headers['x-vercel-ip-country'] || '').toUpperCase() });
};
