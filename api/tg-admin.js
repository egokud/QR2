// Piksta Admin — Telegram-бот администратора (Vercel Function).
// Умеет ТОЛЬКО: показать пользователя, продлить подписку, Пилот вкл/выкл, заблокировать/разблокировать, списки,
// и принимать оплаты тарифа из приложения: POST /api/tg-admin?pay=1 → скрин Егору с кнопками «Подтвердить / Отклонить».
// Защита: 1) отвечает только ADMIN_TG_ID (номер подставляет Telegram, подделать нельзя);
// 2) запросы без секретного заголовка Telegram отбрасываются; 3) бот входит в базу служебным аккаунтом,
// которому правила Firestore разрешают менять у обычных пользователей только subscription / blocked / founder
// и писать журнал adminLog. Закупки, клиенты, удаление — недоступны.
// Секреты (задаются в Vercel → Settings → Environment Variables): TG_TOKEN, BOT_PASSWORD.
const crypto = require('crypto');

const ADMIN_TG_ID = 147491542;               // номер Telegram Егора (@ekudinof) — бот отвечает только ему
const BOT_EMAIL = 'bot@piksta.online';       // служебный аккаунт бота в Piksta
const FB_KEY = 'AIzaSyASHE3yqM0wOC3QHVbL4UVSHVq2rEzA5ss'; // публичный ключ веб-приложения (тот же, что в init.js)
const FS = 'https://firestore.googleapis.com/v1/projects/parcel-scanner-90427/databases/(default)/documents';
const HOOK_URL = 'https://www.piksta.online/api/tg-admin';
const TRIAL_DAYS = 30, PILOT_TRIAL_DAYS = 90, GRACE_DAYS = 5, DAY = 864e5;

const TOKEN = () => process.env.TG_TOKEN || '';
const SECRET = () => crypto.createHash('sha256').update('piksta-tg:' + TOKEN()).digest('hex').slice(0, 48);

// ---------- Telegram ----------
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const send = (text, kb) => tg('sendMessage', { chat_id: ADMIN_TG_ID, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) });
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- Firestore (REST, от имени служебного аккаунта) ----------
let ID_TOKEN = null;
async function login() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: BOT_EMAIL, password: process.env.BOT_PASSWORD || '', returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('вход служебного аккаунта не удался');
  ID_TOKEN = j.idToken;
}
async function fs(path, opt = {}) {
  if (!ID_TOKEN) await login();
  const r = await fetch(FS + path, { ...opt, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ID_TOKEN } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.status) || ('HTTP ' + r.status));
  return j;
}
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('mapValue' in v) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = dec(v.mapValue.fields[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
}
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  const f = {}; for (const k in v) f[k] = enc(v[k]); return { mapValue: { fields: f } };
}
const docObj = d => { const o = { id: d.name.split('/').pop() }; for (const k in (d.fields || {})) o[k] = dec(d.fields[k]); return o; };

async function users() {
  const j = await fs('/users?pageSize=300');
  return (j.documents || []).map(docObj).filter(u => (u.role || 'user') === 'user');
}
async function getUser(uid) { return docObj(await fs('/users/' + encodeURIComponent(uid))); }
// Меняет только перечисленные поля (отсутствующее значение = удалить поле)
async function patchUser(uid, fields) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const body = {}; for (const k in fields) if (fields[k] !== undefined) body[k] = enc(fields[k]);
  await fs(`/users/${encodeURIComponent(uid)}?${mask}&currentDocument.exists=true`, { method: 'PATCH', body: JSON.stringify({ fields: body }) });
}
async function log(action, u, prev, next) {
  const j = await fs('/adminLog', { method: 'POST', body: JSON.stringify({ fields: {
    at: enc(new Date()), by: enc('bot'), action: enc(action), uid: enc(u.id), email: enc(u.email || ''),
    prev: enc(prev === undefined ? null : prev), next: enc(next === undefined ? null : next) } }) });
  return j.name.split('/').pop();
}

// ---------- Доступ (как pkAccess в js/init.js и canWrite в правилах) ----------
function access(u) {
  const now = new Date();
  if (u.blocked) return { kind: 'blocked' };
  const created = u.created instanceof Date ? u.created : now;
  const trialEnd = new Date(created.getTime() + (u.founder ? PILOT_TRIAL_DAYS : TRIAL_DAYS) * DAY);
  const subEnd = u.subscription && u.subscription.endDate instanceof Date ? u.subscription.endDate : null;
  const from = subEnd ? 'sub' : 'trial', end = subEnd || trialEnd, until = new Date(end.getTime() + GRACE_DAYS * DAY);
  if (now < end) return { kind: from, from, end, left: Math.ceil((end - now) / DAY) };
  if (now < until) return { kind: 'grace', from, end, until, left: Math.ceil((until - now) / DAY) };
  return { kind: 'readonly', from, end };
}
const d = x => x ? x.toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' }) : '—';
const STATUS = { trial: 'Пробный', sub: 'Подписка', grace: '5 дней на оплату', readonly: 'Только просмотр', blocked: 'Заблокирован' };

// Кнопки карточки: тариф (выбранный отмечен), срок +1 / +12 мес, «Подарок» переключает режим продления (02.11.2026)
const curPlan = u => (u.subscription && PLANS[u.subscription.plan]) ? u.subscription.plan : 'main';
function cardKb(u, plan, gift) {
  plan = PLANS[plan] ? plan : curPlan(u); gift = gift ? 1 : 0;
  return [
    Object.keys(PLANS).map(k => ({ text: (k === plan ? '● ' : '') + PLANS[k], callback_data: `k:${u.id}:${k}:${gift}` })),
    [1, 12].map(n => ({ text: `${gift ? '🎁 ' : ''}+${n} мес`, callback_data: `e:${u.id}:${n}:${plan}:${gift}` }))
      .concat([{ text: gift ? 'Оплата' : '🎁 Подарок', callback_data: `k:${u.id}:${plan}:${gift ? 0 : 1}` }]),
    [{ text: u.founder ? 'Пилот: снять' : 'Пилот: включить', callback_data: `p:${u.id}:${u.founder ? 0 : 1}` },
     u.blocked ? { text: 'Разблокировать', callback_data: `u:${u.id}` } : { text: 'Заблокировать', callback_data: `b:${u.id}` }]
  ];
}
function card(u) {
  const A = access(u);
  const stats = Array.isArray(u.shipmentStats) ? u.shipmentStats : [];
  const items = stats.reduce((n, s) => n + (Number(s && s.count) || 0), 0);
  let st = STATUS[A.kind] + (A.from === 'sub' ? ` «${PLANS[curPlan(u)]}»` : '') + (u.founder ? ' · пилот' : '');
  if (A.kind === 'grace') st += ` · ещё ${A.left} дн.`;
  const us = u.usage || {};
  const useLine = us.k ? `Треков с ${us.k.split('-').reverse().slice(0, 2).join('.')}: <b>${nf(us.n || 0)}</b>${us.lim ? ' из ' + nf(us.lim) : ''}` : '';
  const h = Array.isArray(u.subscription && u.subscription.history) ? u.subscription.history.slice(-1)[0] : null;
  const lines = [
    `<b>${esc(u.email)}</b>${u.name ? ' · ' + esc(u.name) : ''}`,
    `Статус: <b>${st}</b>`,
    A.end ? `${A.from === 'sub' ? 'Подписка до' : 'Тест до'}: <b>${d(A.end)}</b>${A.kind === 'sub' || A.kind === 'trial' ? ` (${A.left} дн.)` : ''}` : '',
    useLine,
    `Регистрация: ${d(u.created)}`,
    `Закупок: ${stats.length} · позиций: ${items.toLocaleString('ru-RU')}`,
    h ? `Последняя оплата: ${d(h.at)} · ${PLANS[h.plan] || ''}, ${h.months === 12 ? 'год' : 'месяц'} · ${h.gift || h.method === 'gift' ? 'подарок' : h.amount > 0 ? nf(h.amount) + ' ' + esc(h.cur) : 'продлено'}` : ''
  ].filter(Boolean);
  return [lines.join('\n'), cardKb(u)];
}

// С какой даты начинается оплаченный срок (05.11.2026, как pkPaidStart в js/init.js):
// действующая подписка → от её окончания; идёт пробный период / пилот (подписки не было) → от его конца; иначе — сегодня.
function paidStart(u) {
  const now = new Date(), prev = u.subscription || null;
  if (prev && prev.endDate instanceof Date && prev.endDate > now) return prev.endDate;
  if (!(prev && prev.endDate instanceof Date)) {
    const created = u.created instanceof Date ? u.created : now;
    const trialEnd = new Date(created.getTime() + (u.founder ? PILOT_TRIAL_DAYS : TRIAL_DAYS) * DAY);
    if (trialEnd > now) return trialEnd;
  }
  return now;
}
// ---------- Действия ----------
async function extend(u, months, plan, gift) {
  plan = PLANS[plan] ? plan : curPlan(u); gift = !!gift;
  const prev = u.subscription || null;
  const now = new Date(), cur = paidStart(u);
  const end = new Date(cur); end.setMonth(end.getMonth() + months);
  const history = (prev && Array.isArray(prev.history) ? prev.history : []).concat([{ at: now, plan, period: months === 12 ? 'y' : 'm', months, amount: 0, cur: '', method: gift ? 'gift' : 'bot', gift, end, by: 'bot' }]).slice(-40);
  const next = Object.assign({}, prev || {}, { endDate: end, months, activatedAt: now, by: 'bot', plan, history });
  await patchUser(u.id, { subscription: next });
  const logId = await log('extend', u, prev, next);
  return send(`✅ ${esc(u.email)}: «${PLANS[plan]}» на ${months} мес.${gift ? ' (подарок)' : ''} — до <b>${d(end)}</b>`, [[{ text: 'Отменить', callback_data: `z:${logId}` }]]);
}
async function setPilot(u, on) {
  await patchUser(u.id, { founder: on ? true : undefined });
  await log('pilot', u, !!u.founder, on);
  const nu = await getUser(u.id); const [t, kb] = card(nu);
  return send(`${on ? '✅ Пилот включён' : 'Пилот снят'}\n\n${t}`, kb);
}
async function setBlocked(u, on) {
  await patchUser(u.id, { blocked: on });
  await log(on ? 'block' : 'unblock', u, !!u.blocked, on);
  return send(on ? `⛔ ${esc(u.email)} заблокирован. Данные только для просмотра.` : `✅ ${esc(u.email)} разблокирован.`,
    [[on ? { text: 'Разблокировать', callback_data: `u:${u.id}` } : { text: 'Открыть карточку', callback_data: `c:${u.id}` }]]);
}
async function undo(logId) {
  const L = docObj(await fs('/adminLog/' + encodeURIComponent(logId)));
  if (L.action !== 'extend' && L.action !== 'pay') return send('Это действие нельзя отменить.');
  const u = await getUser(L.uid);
  const cur = u.subscription && u.subscription.endDate, was = L.next && L.next.endDate;
  if (!cur || !was || +cur !== +was) return send('Подписка уже менялась после этого — отменять нечего.');
  await patchUser(u.id, { subscription: L.prev || undefined });
  await log('undo-extend', u, L.next, L.prev);
  return send(`↩️ ${esc(u.email)}: продление отменено. ${L.prev && L.prev.endDate ? 'Подписка снова до ' + d(L.prev.endDate) : 'Подписки нет'}.`);
}

// ---------- Оплата тарифа из приложения ----------
const PLANS = { start: 'Старт', main: 'Основной', pro: 'Профи' };
const METHODS = { bnb: 'ЕРИП · БНБ-Банк', tbank: 'Карта Т-Банка', alipay: 'Alipay', trc20: 'USDT TRC20', bep20: 'USDT BEP20' };
const nf = n => Number(n).toLocaleString('ru-RU');
async function payIn(req, res) {
  const b = req.body || {};
  const look = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: String(b.idToken || '') }) }).then(r => r.json()).catch(() => ({}));
  const acc = look.users && look.users[0];
  if (!acc || !acc.localId) return res.status(401).json({ ok: false, error: 'нужно войти заново' });
  const plan = String(b.plan || ''), period = b.period === 'm' ? 'm' : 'y', method = String(b.method || '');
  const amount = Number(b.amount), cur = String(b.cur || '').slice(0, 6), img = String(b.img || '');
  if (!PLANS[plan] || !METHODS[method] || !(amount > 0 && amount < 1e7) || !cur) return res.status(400).json({ ok: false, error: 'неверные данные' });
  if (b.offer !== true) return res.status(400).json({ ok: false, error: 'нужно согласие с офертой' });
  const m = img.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > 4.2e6) return res.status(400).json({ ok: false, error: 'нужен скрин оплаты' });
  const u = await getUser(acc.localId);
  if ((u.role || 'user') !== 'user') return res.status(400).json({ ok: false, error: 'оплата с админского аккаунта не нужна' });
  const prev = u.subscription || null, p0 = prev && prev.pending;
  if (p0 && p0.at instanceof Date && Date.now() - p0.at.getTime() < 60e3) return res.status(429).json({ ok: false, error: 'подождите минуту' });
  const pending = { plan, period, months: period === 'y' ? 12 : 1, method, amount, cur, at: new Date(), offerAcceptedAt: new Date() };
  // (10.11.2026) цена в белорусской основе (для будущего зачёта) и переход на тариф выше: с сегодня, с зачётом неиспользованных дней
  const byn = Number(b.byn); if (byn > 0 && byn < 1e5) pending.byn = Math.round(byn * 100) / 100;
  const RANK = { start: 1, main: 2, pro: 3 }, up0 = b.up && typeof b.up === 'object' ? b.up : null, curPl = curPlan(u);
  if (up0 && PLANS[up0.from] && up0.from === curPl && RANK[plan] > RANK[up0.from] && access(u).kind === 'sub')
    pending.up = { from: up0.from, credit: Math.max(0, Math.round(Number(up0.credit) || 0)), ccur: String(up0.ccur || '').slice(0, 6), days: Math.max(0, Math.round(Number(up0.days) || 0)), full: Math.max(0, Math.round(Number(up0.full) || 0)) };
  await patchUser(u.id, { subscription: Object.assign({}, prev || {}, { pending }) });
  const A = access(u);
  const P = pending.up;
  const caption = [P ? `⬆️ <b>Переход на тариф выше</b>` : `💳 <b>Новая оплата</b>`, esc(u.email || acc.email || '') + (u.founder ? ' · пилот −30%' : ''),
    P ? `«${PLANS[P.from]}» → «${PLANS[plan]}» · ${period === 'y' ? 'год' : 'месяц'} · <b>${nf(amount)} ${esc(cur)}</b>` : `«${PLANS[plan]}» · ${period === 'y' ? 'год' : 'месяц'} · <b>${nf(amount)} ${esc(cur)}</b>`,
    P ? `${nf(P.full)} ${esc(P.ccur)} − зачёт ${nf(P.credit)} ${esc(P.ccur)} за ${P.days} дн. · с сегодня` : '',
    `${METHODS[method]} · ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    `Сейчас: ${STATUS[A.kind] || A.kind}${A.end ? ' до ' + d(A.end) : ''}`].filter(Boolean).join('\n');
  const fd = new FormData();
  fd.append('chat_id', String(ADMIN_TG_ID)); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
  fd.append('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: '✅ Подтвердить', callback_data: `po:${u.id}` }, { text: '❌ Отклонить', callback_data: `pn:${u.id}` }]] }));
  fd.append('photo', new Blob([Buffer.from(m[2], 'base64')], { type: 'image/' + m[1] }), 'pay.' + (m[1] === 'jpeg' ? 'jpg' : m[1]));
  const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/sendPhoto`, { method: 'POST', body: fd }).then(x => x.json()).catch(e => ({ ok: false, description: e.message }));
  if (!r.ok) { await send(caption + '\n\n(скрин не дошёл: ' + esc(r.description || '') + ')', [[{ text: '✅ Подтвердить', callback_data: `po:${u.id}` }, { text: '❌ Отклонить', callback_data: `pn:${u.id}` }]]); }
  return res.status(200).json({ ok: true });
}
async function payOk(u) {
  const prev = u.subscription || {}, p = prev.pending;
  if (!p) return send(`${esc(u.email)}: оплата уже обработана.`);
  // (10.11.2026) переход на тариф выше — новый срок с сегодня (неиспользованные дни уже засчитаны в сумму)
  const now = new Date(), cur = p.up ? now : paidStart(u);
  const end = new Date(cur); end.setMonth(end.getMonth() + (p.months || 1));
  const h = { at: now, plan: p.plan, period: p.period, months: p.months, amount: p.amount, cur: p.cur, method: p.method, end };
  if (p.byn) h.byn = p.byn;
  if (p.up) Object.assign(h, { upgrade: true, from: p.up.from, credit: p.up.credit, ccur: p.up.ccur });
  const history = (Array.isArray(prev.history) ? prev.history : []).concat([h]).slice(-40);
  const next = Object.assign({}, prev, { endDate: end, months: p.months, activatedAt: now, by: 'pay', plan: p.plan, history });
  delete next.pending; delete next.rejected;
  await patchUser(u.id, { subscription: next });
  const logId = await log('pay', u, prev, next);
  return send(`✅ ${esc(u.email)}: ${p.up ? 'переход на ' : ''}«${PLANS[p.plan] || p.plan}» ${p.up ? 'с сегодня ' : ''}до <b>${d(end)}</b> · ${nf(p.amount)} ${esc(p.cur)}. Клиент увидит это в приложении.`, [[{ text: 'Отменить', callback_data: `z:${logId}` }]]);
}
async function payNo(u) {
  const prev = u.subscription || {}, p = prev.pending;
  if (!p) return send(`${esc(u.email)}: оплата уже обработана.`);
  const next = Object.assign({}, prev, { rejected: Object.assign({}, p, { rejectedAt: new Date() }) });
  delete next.pending;
  if (!next.endDate) delete next.endDate;
  await patchUser(u.id, { subscription: next });
  await log('pay-reject', u, p, null);
  return send(`❌ ${esc(u.email)}: оплата отклонена. В приложении клиент увидит «не подтверждена — напишите в поддержку».`);
}

const HELP = `<b>Piksta Admin</b> — что я умею:
• <code>nika@mail.ru</code> или часть адреса — карточка пользователя с кнопками
• <code>продли nika@mail.ru 12 основной</code> — продлить на 1 или 12 мес.; тариф: старт, основной, профи (без тарифа — текущий); добавьте <code>подарок</code>, если бесплатно
• <code>блок nika@mail.ru</code> — заблокировать (спрошу подтверждение)
• <code>разблок nika@mail.ru</code> — разблокировать
• <code>неоплатили</code> — 5 дней на оплату и только просмотр
• <code>скоро</code> — у кого доступ кончается за 7 дней
Другие фразы командами не считаются.`;

async function findOne(q) {
  const all = await users(); q = q.toLowerCase();
  const exact = all.find(u => String(u.email || '').toLowerCase() === q);
  if (exact) return { one: exact };
  return { many: all.filter(u => String(u.email || '').toLowerCase().includes(q) || String(u.name || '').toLowerCase().includes(q)) };
}
async function pick(q, then) {
  const r = await findOne(q);
  if (r.one) return then(r.one);
  if (!r.many.length) return send(`Не нашёл пользователя «${esc(q)}».`);
  if (r.many.length === 1) return then(r.many[0]);
  return send(`Нашёл несколько — выберите:`, r.many.slice(0, 10).map(u => [{ text: u.email, callback_data: `c:${u.id}` }]));
}
async function list(kind) {
  const all = await users();
  const rows = all.map(u => [u, access(u)]).filter(([u, A]) => kind === 'unpaid' ? (A.kind === 'grace' || A.kind === 'readonly') : ((A.kind === 'trial' || A.kind === 'sub') && A.left <= 7));
  if (!rows.length) return send(kind === 'unpaid' ? 'Неоплативших нет.' : 'Ни у кого доступ не кончается в ближайшие 7 дней.');
  return send((kind === 'unpaid' ? '<b>Не оплатили</b>' : '<b>Скоро конец</b>') + '\n' + rows.map(([u, A]) => `• ${esc(u.email)} — ${STATUS[A.kind]}, ${d(A.end)}`).join('\n'),
    rows.slice(0, 10).map(([u]) => [{ text: u.email, callback_data: `c:${u.id}` }]));
}

async function onText(text) {
  const t = text.trim(), low = t.toLowerCase();
  const email = (t.match(/[^\s@]+@[^\s@]+\.[^\s@]+/) || [])[0];
  if (/^\/(start|help)\b|^помощь$/.test(low)) return send(HELP);
  if (/^не\s*оплатили$/.test(low)) return list('unpaid');
  if (/^скоро$/.test(low)) return list('soon');
  let m;
  if ((m = low.match(/^продли(?:ть)?\s+(\S+)(.*)$/))) {
    const rest = m[2] || '', n = rest.match(/\b(\d{1,2})\b/), months = n ? parseInt(n[1], 10) : 1;
    if (months !== 1 && months !== 12) return send('Срок — 1 или 12 месяцев.');
    const plan = /старт/.test(rest) ? 'start' : /основн/.test(rest) ? 'main' : /профи/.test(rest) ? 'pro' : null;
    const gift = /подар|промо/.test(rest);
    return pick(email || m[1], u => extend(u, months, plan, gift));
  }
  if ((m = low.match(/^разблок\S*\s+(\S+)/))) return pick(email || m[1], u => setBlocked(u, false));
  if ((m = low.match(/^(?:за)?блок\S*\s+(\S+)/))) return pick(email || m[1], u => send(`Точно заблокировать <b>${esc(u.email)}</b>? Пользователь сможет только смотреть свои данные.`,
    [[{ text: 'Да, заблокировать', callback_data: `by:${u.id}` }, { text: 'Отмена', callback_data: 'x' }]]));
  if (email || (/^[\w.+-]{3,}$/.test(t) && !/^\d+$/.test(t))) return pick(email || t, u => { const [x, kb] = card(u); return send(x, kb); });
  return send('Не понял.\n\n' + HELP);
}

async function onCallback(data, msg) {
  if (data === 'x') return send('Отменено.');
  const [op, a, b, c, g] = data.split(':');
  if (op === 'z') return undo(a);
  const u = await getUser(a);
  if ((u.role || 'user') !== 'user') return send('Этим аккаунтом бот не управляет.');
  if (op === 'c') { const [x, kb] = card(u); return send(x, kb); }
  if (op === 'e') return extend(u, parseInt(b, 10), c, g === '1');
  if (op === 'k') {
    if (msg && msg.message_id) return tg('editMessageReplyMarkup', { chat_id: ADMIN_TG_ID, message_id: msg.message_id, reply_markup: { inline_keyboard: cardKb(u, b, c === '1') } });
    const [x] = card(u); return send(x, cardKb(u, b, c === '1'));
  }
  if (op === 'p') return setPilot(u, b === '1');
  if (op === 'b') return send(`Точно заблокировать <b>${esc(u.email)}</b>? Пользователь сможет только смотреть свои данные.`,
    [[{ text: 'Да, заблокировать', callback_data: `by:${u.id}` }, { text: 'Отмена', callback_data: 'x' }]]);
  if (op === 'by') return setBlocked(u, true);
  if (op === 'u') return setBlocked(u, false);
  if (op === 'po' || op === 'pn') {
    if (msg && msg.message_id) await tg('editMessageReplyMarkup', { chat_id: ADMIN_TG_ID, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    return op === 'po' ? payOk(u) : payNo(u);
  }
}

module.exports = async (req, res) => {
  try {
    // Подключение вебхука: GET /api/tg-admin?setup=1 (безвредно — привязывает бота к этому же адресу)
    if (req.method === 'POST' && req.query && req.query.pay) {
      try { return await payIn(req, res); } catch (e) { return res.status(500).json({ ok: false, error: 'сервер: ' + e.message }); }
    }
    if (req.method === 'GET') {
      if (req.query && req.query.setup && TOKEN()) {
        const r = await tg('setWebhook', { url: req.query.setup === 'apex' ? 'https://piksta.online/api/tg-admin' : HOOK_URL, secret_token: SECRET(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
        const info = await tg('getWebhookInfo', {});
        return res.status(200).json({ ok: !!r.ok, description: r.description || '', url: info.result && info.result.url, lastError: info.result && info.result.last_error_message });
      }
      return res.status(200).send('ok');
    }
    if (!TOKEN() || req.headers['x-telegram-bot-api-secret-token'] !== SECRET()) return res.status(200).send('ok');
    const upd = req.body || {};
    const from = (upd.message && upd.message.from) || (upd.callback_query && upd.callback_query.from) || {};
    console.log('tg-from', from.id, from.username || '', from.id === ADMIN_TG_ID ? 'admin' : 'ignored');  // журнал обращений (видно в логах Vercel)
    if (!ADMIN_TG_ID || from.id !== ADMIN_TG_ID) return res.status(200).send('ok');   // чужим — молчим
    if (upd.callback_query) {
      await tg('answerCallbackQuery', { callback_query_id: upd.callback_query.id });
      await onCallback(String(upd.callback_query.data || ''), upd.callback_query.message);
    } else if (upd.message && typeof upd.message.text === 'string') {
      await onText(upd.message.text);
    }
  } catch (e) {
    try { await send('Ошибка: ' + esc(e.message)); } catch (_) {}
  }
  return res.status(200).send('ok');
};
