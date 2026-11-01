// Piksta Поддержка — Telegram-бот поддержки клиентов (Vercel Function).
// Клиент пишет боту → бот пересылает Егору с пометкой #u<номер клиента>.
// Егор отвечает реплаем на это сообщение → бот копирует ответ клиенту от имени бота.
// Личный аккаунт Егора клиенту не виден. Бот ничего не знает о базе Piksta и ничего в ней не меняет.
// Защита: запросы без секретного заголовка Telegram отбрасываются; отвечать клиентам может только ADMIN_TG_ID.
// Секрет (Vercel → Settings → Environment Variables): TG_SUPPORT_TOKEN.
const crypto = require('crypto');

const ADMIN_TG_ID = 147491542;                          // Егор — сюда приходят обращения, только он может отвечать
const HOOK_URL = 'https://www.piksta.online/api/tg-support';

const TOKEN = () => process.env.TG_SUPPORT_TOKEN || '';
const SECRET = () => crypto.createHash('sha256').update('piksta-support:' + TOKEN()).digest('hex').slice(0, 48);

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

const GREETING = 'Здравствуйте! Это поддержка <b>Piksta</b>.\n\n' +
  'Напишите вопрос одним или несколькими сообщениями — можно приложить скриншот, файл или голосовое. ' +
  'Ответим здесь же, обычно в течение дня.\n\n' +
  'Если вопрос по вашему аккаунту — укажите e-mail, с которым входите в Piksta.';
const ADMIN_HELP = 'Это бот поддержки Piksta.\n\n' +
  '• Обращения клиентов приходят сюда с пометкой <code>#u…</code>.\n' +
  '• Чтобы ответить — сделайте <b>«Ответить»</b> (свайп влево) на сообщение клиента с пометкой и напишите текст, ' +
  'можно фото или файл. Доставленный ответ отмечается 👍.\n' +
  '• Проверить, как видит клиент: <code>/test ваш текст</code> — придёт как обращение от вас самих.';

// Подпись клиента: имя (ссылка на профиль), @ник, служебная метка #u<номер> — по ней бот находит, кому отвечать
function header(u) {
  const name = esc([u.first_name, u.last_name].filter(Boolean).join(' ') || 'Клиент');
  return `💬 <a href="tg://user?id=${u.id}">${name}</a>` + (u.username ? ` · @${esc(u.username)}` : '') + ` · #u${u.id}`;
}
const CAPTIONED = ['photo', 'video', 'document', 'audio', 'voice', 'animation'];

// Обращение клиента → Егору
async function fromClient(m, u) {
  const h = header(u);
  if (typeof m.text === 'string') {
    const room = 3000;   // делим исходный текст, экранируем каждую часть отдельно (лимит Telegram 4096)
    for (let i = 0; i < m.text.length || i === 0; i += room) await say(ADMIN_TG_ID, h + '\n\n' + esc(m.text.slice(i, i + room)));
    return;
  }
  const kind = CAPTIONED.find(k => m[k]);
  const cap = kind ? h + (m.caption ? '\n\n' + esc(m.caption) : '') : '';
  if (kind && cap.length <= 1000) {
    await tg('copyMessage', { chat_id: ADMIN_TG_ID, from_chat_id: m.chat.id, message_id: m.message_id, caption: cap, parse_mode: 'HTML' });
    return;
  }
  // Стикер, кружок, контакт, геоточка или длинная подпись: сначала строка с меткой, вложение — ответом на неё
  const what = m.sticker ? 'стикер' : m.video_note ? 'видеосообщение' : m.contact ? 'контакт' : m.location ? 'геоточку' : 'вложение';
  const hm = await say(ADMIN_TG_ID, h + `\n\nприслал(а) ${what} 👇 (отвечайте на это сообщение)` + (m.caption ? '\n\n' + esc(m.caption).slice(0, 3000) : ''));
  const reply = hm.ok ? { reply_parameters: { message_id: hm.result.message_id, allow_sending_without_reply: true } } : {};
  await tg('copyMessage', { chat_id: ADMIN_TG_ID, from_chat_id: m.chat.id, message_id: m.message_id, ...reply });
}

// Ответ Егора → клиенту
async function fromAdmin(m) {
  if (typeof m.text === 'string' && /^\/start\b|^\/help\b/.test(m.text)) return say(ADMIN_TG_ID, ADMIN_HELP);
  if (typeof m.text === 'string' && /^\/test\b/.test(m.text)) {
    const t = m.text.replace(/^\/test\s*/, '') || 'Проверка связи';
    return say(ADMIN_TG_ID, header(m.from) + '\n\n' + esc(t));
  }
  const r = m.reply_to_message;
  const tag = r && String(r.text || r.caption || '').match(/#u(\d{3,15})\b/);
  if (!tag) return say(ADMIN_TG_ID, 'Не понял, кому ответить. Сделайте <b>«Ответить»</b> на сообщение клиента с пометкой <code>#u…</code>.');
  const to = Number(tag[1]);
  const res = await tg('copyMessage', { chat_id: to, from_chat_id: m.chat.id, message_id: m.message_id });
  if (res.ok) await tg('setMessageReaction', { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] });
  else await say(ADMIN_TG_ID, 'Не доставлено: ' + esc(res.description || 'ошибка Telegram') + (/blocked|deactivated/i.test(res.description || '') ? '\nКлиент остановил бота или удалил аккаунт.' : ''), { reply_parameters: { message_id: m.message_id } });
}

module.exports = async (req, res) => {
  try {
    // Подключение вебхука и описания бота: GET /api/tg-support?setup=1
    if (req.method === 'GET') {
      if (req.query && req.query.setup && TOKEN()) {
        const r = await tg('setWebhook', { url: HOOK_URL, secret_token: SECRET(), allowed_updates: ['message'], drop_pending_updates: true });
        await tg('setMyDescription', { description: 'Поддержка Piksta — сервиса для организаторов совместных покупок и закупок из Китая. Нажмите «Старт» и напишите вопрос — ответим здесь.' });
        await tg('setMyShortDescription', { short_description: 'Поддержка Piksta · piksta.online' });
        await tg('setMyCommands', { commands: [{ command: 'start', description: 'Начать' }] });
        const info = await tg('getWebhookInfo', {});
        const me = await tg('getMe', {});
        return res.status(200).json({ ok: !!r.ok, description: r.description || '', bot: me.result && me.result.username, url: info.result && info.result.url, lastError: info.result && info.result.last_error_message });
      }
      return res.status(200).send('ok');
    }
    if (!TOKEN() || req.headers['x-telegram-bot-api-secret-token'] !== SECRET()) return res.status(200).send('ok');
    const m = (req.body || {}).message;
    if (!m || !m.from || !m.chat || m.chat.type !== 'private') return res.status(200).send('ok');   // группы и прочее — игнор
    const u = m.from;
    console.log('support-from', u.id, u.username || '', u.id === ADMIN_TG_ID ? 'admin' : 'client');
    if (u.id === ADMIN_TG_ID) await fromAdmin(m);
    else if (typeof m.text === 'string' && /^\/start\b/.test(m.text)) await say(m.chat.id, GREETING);
    else await fromClient(m, u);
  } catch (e) {
    console.log('support-error', e && e.message);
  }
  return res.status(200).send('ok');
};
