// Piksta Поддержка — Telegram-бот поддержки клиентов (Vercel Function).
// Клиент пишет боту в личку → бот создаёт ему отдельную тему в закрытой группе «Piksta · Обращения»
// и копирует туда его сообщения. Егор (или участник группы) пишет в теме → бот отправляет это клиенту от имени бота.
// Личные аккаунты команды клиенту не видны. С базой Piksta бот работает только в разделе support/
// (какая тема какого клиента) от имени служебного аккаунта bot@piksta.online; закупки и пользователей не трогает.
// Пока группа не подключена — запасной режим: обращения приходят Егору в личку с меткой #u…, ответ — реплаем.
// Защита: запросы без секретного заголовка Telegram отбрасываются; отвечать клиентам можно только из подключённой
// группы (её подключает только Егор командой /bind) или Егору реплаем в личке.
// Секреты (Vercel → Settings → Environment Variables): TG_SUPPORT_TOKEN, BOT_PASSWORD (тот же, что у админ-бота).
const crypto = require('crypto');

const ADMIN_TG_ID = 147491542;                          // Егор
const HOOK_URL = 'https://www.piksta.online/api/tg-support';
const WELCOME_IMG = 'https://www.piksta.online/icons/icon-512x512.png';   // логотип Piksta
const BOT_EMAIL = 'bot@piksta.online';
const FB_KEY = 'AIzaSyASHE3yqM0wOC3QHVbL4UVSHVq2rEzA5ss';   // публичный ключ веб-приложения (тот же, что в init.js)
const FS = 'https://firestore.googleapis.com/v1/projects/parcel-scanner-90427/databases/(default)/documents';
const ACK_EVERY_MS = 6 * 3600e3;                        // «Сообщение получено» — не чаще раза в 6 часов
const SITE = 'https://www.piksta.online';

const TOKEN = () => process.env.TG_SUPPORT_TOKEN || '';
const SECRET = () => crypto.createHash('sha256').update('piksta-support:' + TOKEN()).digest('hex').slice(0, 48);

// ---------- Telegram ----------
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const fullName = u => [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Клиент';

// ---------- Firestore (только раздел support/) ----------
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
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error((j.error && j.error.status) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return j;
}
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  return null;
}
function enc(v) {
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
async function getDoc(id) {
  const d = await fs('/support/' + id);
  if (!d) return null;
  const o = {}; for (const k in (d.fields || {})) o[k] = dec(d.fields[k]); return o;
}
// mustBeNew: true — записать только если документа ещё нет (защита от двойной темы)
async function setDoc(id, fields, mustBeNew) {
  const mask = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  const body = {}; for (const k in fields) body[k] = enc(fields[k]);
  await fs(`/support/${id}?${mask}${mustBeNew ? '&currentDocument.exists=false' : ''}`, { method: 'PATCH', body: JSON.stringify({ fields: body }) });
}
let GROUP = null;   // кешируем только найденную группу: «не подключена» перепроверяем каждый раз
async function groupId() {
  if (GROUP) return GROUP;
  try { const c = await getDoc('config'); GROUP = (c && c.groupId) || null; } catch (e) { GROUP = null; }
  return GROUP;
}

// ---------- Тексты ----------
const greeting = u =>
  `Здравствуйте, ${esc(u.first_name || 'друг')}! 👋\n\n` +
  'Спасибо, что пользуетесь <b>Piksta</b> — сервисом для организаторов совместных покупок и закупок из Китая.\n\n' +
  'Мы на связи и готовы помочь в любой ситуации: импорт заказов, сканирование посылок, клиенты, расчёты, тариф и оплата.\n\n' +
  '✍️ Просто напишите вопрос сюда — можно приложить скриншот, файл или голосовое. Ответим в этом чате, обычно в течение дня.\n\n' +
  'Если вопрос про ваш аккаунт — укажите e-mail, с которым входите в Piksta.';
const MENU = { inline_keyboard: [
  [{ text: '🚀 Открыть Piksta', url: SITE + '/app' }, { text: '📖 Как это работает', url: SITE + '/#how' }],
  [{ text: '💳 Тарифы', url: SITE + '/#price' }, { text: '❓ Частые вопросы', url: SITE + '/#faq' }]
] };
const ACK = 'Спасибо! Сообщение получено 🙌\nОтветим здесь же, обычно в течение дня.';
const ADMIN_HELP =
  'Это бот поддержки Piksta.\n\n' +
  '<b>Как работает:</b> у каждого клиента своя тема в группе «Piksta · Обращения». Откройте тему и просто пишите — ' +
  'текст, фото, файлы и голосовые уходят клиенту от имени бота. Доставленное отмечается 👍.\n\n' +
  '• <code>// текст</code> — заметка для себя, клиенту не уходит\n' +
  '• <code>/close</code> в теме — закрыть обращение (клиент напишет снова — тема откроется сама)\n' +
  '• <code>/test текст</code> мне в личку — придёт как обращение от вас самих\n' +
  '• <code>/bind</code> в группе — подключить группу (делается один раз)';
const ICONS = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F];

// ---------- Клиент → тема ----------
async function openTopic(gid, u, fresh) {
  const name = (fullName(u) + (u.username ? ' @' + u.username : '')).slice(0, 120);
  const t = await tg('createForumTopic', { chat_id: gid, name, icon_color: ICONS[u.id % ICONS.length] });
  if (!t.ok) throw new Error('не удалось создать тему: ' + (t.description || ''));
  const tid = t.result.message_thread_id;
  try {
    await setDoc('u' + u.id, { topicId: tid, name, created: new Date() }, fresh);
  } catch (e) {
    if (fresh && (e.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS/.test(e.message))) {   // тему уже создал параллельный запрос
      await tg('deleteForumTopic', { chat_id: gid, message_thread_id: tid });
      const d = await getDoc('u' + u.id); return d.topicId;
    }
    throw e;
  }
  await setDoc('t' + tid, { uid: u.id });
  await say(gid,
    `👤 <a href="tg://user?id=${u.id}">${esc(fullName(u))}</a>` + (u.username ? ` · @${esc(u.username)}` : '') +
    `\nTelegram id ${u.id}` + (u.language_code ? ` · язык ${esc(u.language_code)}` : '') +
    `\nНовое обращение: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}\n\n` +
    'Пишите в эту тему — ответ уйдёт клиенту. <code>//</code> в начале — заметка. <code>/close</code> — закрыть.',
    { message_thread_id: tid });
  return tid;
}

async function toTopic(gid, tid, m, text) {
  return text != null
    ? say(gid, esc(text), { message_thread_id: tid })
    : tg('copyMessage', { chat_id: gid, message_thread_id: tid, from_chat_id: m.chat.id, message_id: m.message_id });
}

// text != null — отправить этот текст вместо копии сообщения (для /test)
async function clientToGroup(gid, m, u, text) {
  let d = await getDoc('u' + u.id);
  let tid = d && d.topicId;
  if (!tid) tid = await openTopic(gid, u, true);
  let r = await toTopic(gid, tid, m, text);
  if (!r.ok && /TOPIC_CLOSED/i.test(r.description || '')) {
    await tg('reopenForumTopic', { chat_id: gid, message_thread_id: tid });
    r = await toTopic(gid, tid, m, text);
  }
  if (!r.ok && /thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test(r.description || '')) {   // тему удалили — заводим новую
    tid = await openTopic(gid, u, false);
    r = await toTopic(gid, tid, m, text);
  }
  if (!r.ok) throw new Error('не удалось переслать в группу: ' + (r.description || ''));
  const last = d && d.lastAck instanceof Date ? d.lastAck.getTime() : 0;
  if (Date.now() - last > ACK_EVERY_MS) {
    await say(m.chat.id, ACK);
    await setDoc('u' + u.id, { lastAck: new Date() });
  }
}

// ---------- Запасной режим: всё Егору в личку с меткой #u… ----------
function header(u) {
  return `💬 <a href="tg://user?id=${u.id}">${esc(fullName(u))}</a>` + (u.username ? ` · @${esc(u.username)}` : '') + ` · #u${u.id}`;
}
const CAPTIONED = ['photo', 'video', 'document', 'audio', 'voice', 'animation'];
// Есть ли в сообщении что пересылать (служебные «тема закрыта», «закреплено» и т. п. — пропускаем)
const CONTENT = ['text', ...CAPTIONED, 'video_note', 'sticker', 'contact', 'location', 'venue', 'poll', 'dice'];
const hasContent = m => CONTENT.some(k => m[k] != null);
async function clientToAdminDM(m, u, text) {
  const h = header(u);
  if (text != null || typeof m.text === 'string') {
    const t = text != null ? text : m.text;
    for (let i = 0; i < t.length || i === 0; i += 3000) await say(ADMIN_TG_ID, h + '\n\n' + esc(t.slice(i, i + 3000)));
    return;
  }
  const kind = CAPTIONED.find(k => m[k]);
  const cap = kind ? h + (m.caption ? '\n\n' + esc(m.caption) : '') : '';
  if (kind && cap.length <= 1000) {
    await tg('copyMessage', { chat_id: ADMIN_TG_ID, from_chat_id: m.chat.id, message_id: m.message_id, caption: cap, parse_mode: 'HTML' });
    return;
  }
  const hm = await say(ADMIN_TG_ID, h + '\n\nприслал(а) вложение 👇 (отвечайте на это сообщение)' + (m.caption ? '\n\n' + esc(m.caption).slice(0, 3000) : ''));
  const reply = hm.ok ? { reply_parameters: { message_id: hm.result.message_id, allow_sending_without_reply: true } } : {};
  await tg('copyMessage', { chat_id: ADMIN_TG_ID, from_chat_id: m.chat.id, message_id: m.message_id, ...reply });
}

async function fromClient(m, u, text) {
  const gid = await groupId();
  if (gid) {
    try { return await clientToGroup(gid, m, u, text); }
    catch (e) { console.log('support-group-fail', e.message); await say(ADMIN_TG_ID, '⚠️ Бот поддержки: ' + esc(e.message) + '\nОбращение переслано сюда.'); }
  }
  await clientToAdminDM(m, u, text);
}

// ---------- Ответ команды → клиенту ----------
async function deliver(to, m) {
  const res = await tg('copyMessage', { chat_id: to, from_chat_id: m.chat.id, message_id: m.message_id });
  if (res.ok) { await tg('setMessageReaction', { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }); return; }
  const why = /blocked|deactivated/i.test(res.description || '') ? '\nКлиент остановил бота или удалил аккаунт.' : '';
  await say(m.chat.id, 'Не доставлено: ' + esc(res.description || 'ошибка Telegram') + why,
    { reply_parameters: { message_id: m.message_id }, ...(m.message_thread_id ? { message_thread_id: m.message_thread_id } : {}) });
}

async function fromGroup(m, gid) {
  const text = typeof m.text === 'string' ? m.text : null;
  if (!m.is_topic_message || !m.message_thread_id) {                       // общий чат группы
    if (text && /^\/help\b/.test(text)) await say(gid, ADMIN_HELP);
    return;
  }
  if (text && text.startsWith('//')) return;                                // заметка
  const tid = m.message_thread_id;
  if (text && /^\/close\b/.test(text)) { await tg('closeForumTopic', { chat_id: gid, message_thread_id: tid }); return; }
  if (text && /^\/help\b/.test(text)) { await say(gid, ADMIN_HELP, { message_thread_id: tid }); return; }
  const link = await getDoc('t' + tid);
  if (!link || !link.uid) { await say(gid, 'Эта тема не связана с клиентом — сообщение никуда не отправлено.', { message_thread_id: tid }); return; }
  await deliver(link.uid, m);
}

async function sendGreeting(chat, u) {
  const p = await tg('sendPhoto', { chat_id: chat, photo: WELCOME_IMG, caption: greeting(u), parse_mode: 'HTML', reply_markup: MENU });
  if (!p.ok) await say(chat, greeting(u), { reply_markup: MENU });
}

async function fromAdminDM(m) {
  const text = typeof m.text === 'string' ? m.text : null;
  if (text && /^\/start\b/.test(text)) { await sendGreeting(m.chat.id, m.from); return say(ADMIN_TG_ID, ADMIN_HELP); }
  if (text && /^\/help\b/.test(text)) return say(ADMIN_TG_ID, ADMIN_HELP);
  if (text && /^\/test\b/.test(text)) return fromClient(m, m.from, text.replace(/^\/test\s*/, '') || 'Проверка связи');
  const r = m.reply_to_message;
  const tag = r && String(r.text || r.caption || '').match(/#u(\d{3,15})\b/);
  if (tag) return deliver(Number(tag[1]), m);
  const gid = await groupId();
  return say(ADMIN_TG_ID, gid
    ? 'Отвечайте клиентам в группе «Piksta · Обращения» — в теме нужного клиента.'
    : 'Не понял, кому ответить. Сделайте <b>«Ответить»</b> на сообщение клиента с пометкой <code>#u…</code>.');
}

async function bind(m) {
  const chat = await tg('getChat', { chat_id: m.chat.id });
  if (!chat.ok || !chat.result.is_forum) return say(m.chat.id, 'Включите в настройках группы «Темы» и отправьте /bind ещё раз.');
  const me = await tg('getMe', {});
  const mem = await tg('getChatMember', { chat_id: m.chat.id, user_id: me.result.id });
  if (!mem.ok || mem.result.status !== 'administrator' || !mem.result.can_manage_topics)
    return say(m.chat.id, 'Сделайте бота администратором с правом «Управление темами» и отправьте /bind ещё раз.');
  await setDoc('config', { groupId: m.chat.id, boundAt: new Date() });
  GROUP = m.chat.id;
  await say(m.chat.id, '✅ Группа подключена. Новые обращения клиентов будут появляться здесь отдельными темами.\n\n' + ADMIN_HELP);
}

module.exports = async (req, res) => {
  try {
    // Подключение вебхука и описания бота: GET /api/tg-support?setup=1
    if (req.method === 'GET') {
      if (req.query && req.query.setup && TOKEN()) {
        const r = await tg('setWebhook', { url: HOOK_URL, secret_token: SECRET(), allowed_updates: ['message'], drop_pending_updates: true });
        await tg('setMyDescription', { description: 'Поддержка Piksta — сервиса для организаторов совместных покупок и закупок из Китая.\n\nСпасибо, что вы с нами! Поможем в любой ситуации: импорт заказов, сканирование, клиенты, расчёты, тариф и оплата.\n\nНажмите «Старт» и напишите вопрос — ответим здесь.' });
        await tg('setMyShortDescription', { short_description: 'Поддержка Piksta · поможем в любой ситуации · piksta.online' });
        await tg('setMyCommands', { commands: [{ command: 'start', description: 'Начать' }] });
        const info = await tg('getWebhookInfo', {});
        const me = await tg('getMe', {});
        let storage = 'ok';
        try { await getDoc('config'); } catch (e) { storage = e.message; }
        return res.status(200).json({ ok: !!r.ok, description: r.description || '', bot: me.result && me.result.username, url: info.result && info.result.url, lastError: info.result && info.result.last_error_message, group: await groupId(), storage });
      }
      return res.status(200).send('ok');
    }
    if (!TOKEN() || req.headers['x-telegram-bot-api-secret-token'] !== SECRET()) return res.status(200).send('ok');
    const m = (req.body || {}).message;
    if (!m || !m.from || !m.chat || m.from.is_bot || !hasContent(m)) return res.status(200).send('ok');
    const u = m.from;
    const text = typeof m.text === 'string' ? m.text : null;
    if (m.chat.type === 'private') {
      console.log('support-from', u.id, u.username || '', u.id === ADMIN_TG_ID ? 'admin' : 'client');
      if (u.id === ADMIN_TG_ID) await fromAdminDM(m);
      else if (text && /^\/start\b/.test(text)) {
        await sendGreeting(m.chat.id, u);
      } else await fromClient(m, u);
    } else {
      console.log('support-group', m.chat.type, m.chat.id, u.id, (text || '').slice(0, 20));
      if (text && /^\/bind\b/.test(text)) { if (u.id === ADMIN_TG_ID) await bind(m); return res.status(200).send('ok'); }
      const gid = await groupId();
      if (gid && m.chat.id === gid) await fromGroup(m, gid);
    }
  } catch (e) {
    console.log('support-error', e && e.message);
    try { await say(ADMIN_TG_ID, '⚠️ Бот поддержки: ' + esc(e && e.message)); } catch (_) {}
  }
  return res.status(200).send('ok');
};
