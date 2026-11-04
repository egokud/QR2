// Страна пользователя (04.11.2026). Клиент после входа (почта уже подтверждена) шлёт POST {idToken} или {idToken, pick, other, cur}.
// Сервер сам берёт страну по IP (заголовок Vercel) и записывает её в профиль от имени служебного аккаунта bot@piksta.online —
// только если страна ещё не проставлена (так же требуют правила Firestore). Браузер сам страну записать не может (поле закрыто).
//  • IP из BY / RU / KZ → country = IP, countrySrc = 'ip'.
//  • иначе → {ask: true}: приложение один раз показывает окно выбора; выбор приходит сюда как pick (BY/RU/KZ/OT),
//    для «Другой страны» — other (название) и cur (валюта цен BYN/RUB/KZT). countrySrc = 'user', countryIp — откуда зашёл.
// Секреты: BOT_PASSWORD (уже есть в Vercel).
const FB_KEY = 'AIzaSyASHE3yqM0wOC3QHVbL4UVSHVq2rEzA5ss';
const FS = 'https://firestore.googleapis.com/v1/projects/parcel-scanner-90427/databases/(default)/documents';
const KNOWN = ['BY', 'RU', 'KZ'];
const CURS = ['BYN', 'RUB', 'KZT'];

async function lookup(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  const j = await r.json();
  return j.users && j.users[0];
}
let BOT_TOKEN = null;
async function botLogin() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bot@piksta.online', password: process.env.BOT_PASSWORD || '', returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('bot login failed');
  BOT_TOKEN = j.idToken;
}
async function getProfile(uid) {
  const r = await fetch(`${FS}/users/${uid}`, { headers: { authorization: 'Bearer ' + BOT_TOKEN } });
  if (!r.ok) throw new Error('profile ' + r.status);
  const j = await r.json();
  return j.fields || {};
}
async function patch(uid, fields) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = { stringValue: String(v) };
  const r = await fetch(`${FS}/users/${uid}?${mask}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + BOT_TOKEN }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('write ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(200).send('ok');
  try {
    const { idToken, pick, other, cur } = req.body || {};
    if (!idToken) return res.status(400).json({ ok: false, error: 'no token' });
    const u = await lookup(idToken);
    if (!u || !u.localId) return res.status(401).json({ ok: false, error: 'bad token' });
    if (!u.emailVerified) return res.status(200).json({ ok: false, skip: 'not verified' });
    const ip = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2);
    await botLogin();
    const p = await getProfile(u.localId);
    const has = p.country && p.country.stringValue;
    if (has) return res.status(200).json({ ok: true, c: has });
    if (pick) {
      const c = ['BY', 'RU', 'KZ', 'OT'].includes(pick) ? pick : null;
      if (!c) return res.status(400).json({ ok: false, error: 'bad pick' });
      const f = { country: c, countrySrc: 'user', countryIp: ip || '—' };
      if (c === 'OT') {
        const nm = String(other || '').trim().slice(0, 40); if (nm) f.countryOther = nm;
        f.countryCur = CURS.includes(cur) ? cur : 'RUB';
      }
      await patch(u.localId, f);
      return res.status(200).json({ ok: true, c, cur: f.countryCur || null });
    }
    if (KNOWN.includes(ip)) {
      await patch(u.localId, { country: ip, countrySrc: 'ip', countryIp: ip });
      return res.status(200).json({ ok: true, c: ip });
    }
    return res.status(200).json({ ok: true, ask: true, ip: ip || '' });
  } catch (e) {
    console.log('country-error', e && e.message);
    return res.status(500).json({ ok: false, error: 'failed' });
  }
};
