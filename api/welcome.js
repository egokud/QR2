// Приветственное письмо после подтверждения e-mail (03.11.2026).
// Клиент (js/verify.js → pkVSync) шлёт POST {idToken}. Проверяем токен в Firebase, берём только подтверждённую почту
// и свежую регистрацию (до 7 дней), один раз на пользователя (отметка support/w<uid>), и отправляем письмо
// через Gmail SMTP от имени Piksta <support@piksta.online> (адрес добавлен в Gmail как «Отправлять письма как»).
// Секреты (Vercel → Environment Variables): GMAIL_USER, GMAIL_APP_PASSWORD (пароль приложения Google), BOT_PASSWORD.
// Админ может проверить письмо: POST {idToken, test:true} — уйдёт ему самому, без отметки и проверки возраста.
const tls = require('tls');
const crypto = require('crypto');

const FB_KEY = 'AIzaSyASHE3yqM0wOC3QHVbL4UVSHVq2rEzA5ss';
const FS = 'https://firestore.googleapis.com/v1/projects/parcel-scanner-90427/databases/(default)/documents';
const ADMIN_EMAIL = 'egokud@gmail.com';
const FROM = 'support@piksta.online';
const FROM_NAME = 'Piksta';
const MAX_AGE_MS = 7 * 24 * 3600e3;

// ---------- Firebase ----------
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
// создать отметку support/w<uid>, только если её ещё нет; false — уже отправляли
async function markOnce(uid, email) {
  if (!BOT_TOKEN) await botLogin();
  const body = { fields: { welcomeAt: { timestampValue: new Date().toISOString() }, email: { stringValue: email } } };
  const r = await fetch(`${FS}/support/w${uid}?currentDocument.exists=false`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + BOT_TOKEN }, body: JSON.stringify(body)
  });
  if (r.ok) return true;
  const j = await r.json().catch(() => ({}));
  if (r.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS/.test(JSON.stringify(j))) return false;
  throw new Error('mark failed: ' + r.status);
}
async function unmark(uid) {
  try { await fetch(`${FS}/support/w${uid}`, { method: 'DELETE', headers: { authorization: 'Bearer ' + BOT_TOKEN } }); } catch (e) {}
}

// ---------- письмо ----------
const SITE = 'https://piksta.online';
function html() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f1f8;font-family:Arial,Helvetica,sans-serif;color:#17142a">
<div style="display:none;max-height:0;overflow:hidden">Почта подтверждена — можно начинать. 30 дней всё бесплатно.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="background:#6C4DB8;background-image:linear-gradient(135deg,#8b6fe0,#6C4DB8);padding:26px 28px 28px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle"><img src="https://www.piksta.online/icons/icon-192x192.png" width="40" height="40" alt="" style="display:block;border-radius:10px"></td>
    <td style="vertical-align:middle;padding-left:10px;color:#ffffff;font-size:19px;font-weight:bold">Piksta</td>
  </tr></table>
  <div style="color:#ffffff;font-size:26px;line-height:1.2;font-weight:bold;margin-top:18px">Добро пожаловать!</div>
  <div style="color:#ece6ff;font-size:15px;line-height:1.5;margin-top:6px">Почта подтверждена, можно начинать.</div>
</td></tr>
<tr><td style="padding:26px 28px 6px;font-size:15px;line-height:1.6">
  <p style="margin:0 0 12px">Здравствуйте!</p>
  <p style="margin:0 0 12px">Спасибо, что выбрали Piksta. Первые <b>30 дней</b> всё доступно бесплатно, без ограничений.</p>
  <p style="margin:0 0 12px">С чего начать, подскажет сам Кабинет: создайте закупку, там будет короткая инструкция под ваш способ работы, с Пиндуодуо или с любых площадок.</p>
  <p style="margin:0">Если что-то непонятно, просто ответьте на это письмо или напишите в поддержку в Telegram. Отвечаем быстро.</p>
</td></tr>
<tr><td align="center" style="padding:22px 28px 8px">
  <a href="${SITE}/app" style="display:inline-block;background:#6C4DB8;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;border-radius:12px;padding:13px 30px">Открыть Piksta</a>
</td></tr>
<tr><td style="padding:18px 28px 6px;font-size:15px;line-height:1.6"><p style="margin:0">Хорошей закупки!</p></td></tr>
<tr><td style="padding:14px 28px 26px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif"><tr>
    <td style="vertical-align:top;padding-right:12px"><img src="https://www.piksta.online/icons/icon-96x96.png" width="40" height="40" alt="Piksta" style="display:block;border-radius:10px"></td>
    <td style="vertical-align:top">
      <div style="font-size:14px;font-weight:bold;color:#17142a">Поддержка Piksta</div>
      <div style="font-size:12.5px;color:#5f5a74;margin-top:2px">Telegram: <a href="https://t.me/piksta_support_bot" style="color:#6C4DB8;text-decoration:none;font-weight:bold">@piksta_support_bot</a> · support@piksta.online</div>
      <div style="font-size:12.5px;margin-top:2px"><a href="${SITE}" style="color:#6C4DB8;text-decoration:none;font-weight:bold">piksta.online</a></div>
    </td></tr></table>
</td></tr>
</table></td></tr></table></body></html>`;
}
const TEXT = `Здравствуйте!

Почта подтверждена, можно начинать. Спасибо, что выбрали Piksta. Первые 30 дней всё доступно бесплатно, без ограничений.

С чего начать, подскажет сам Кабинет: создайте закупку, там будет короткая инструкция под ваш способ работы, с Пиндуодуо или с любых площадок.

Если что-то непонятно, просто ответьте на это письмо или напишите в поддержку в Telegram: @piksta_support_bot. Отвечаем быстро.

Открыть Piksta: ${SITE}/app

Хорошей закупки!
Поддержка Piksta
piksta.online`;
const SUBJECT = 'Добро пожаловать в Piksta 👋';

const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const encH = s => '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
function mime(to) {
  const bd = 'pk' + crypto.randomBytes(12).toString('hex');
  return [
    `From: ${encH(FROM_NAME)} <${FROM}>`,
    `To: <${to}>`,
    `Reply-To: ${FROM}`,
    `Subject: ${encH(SUBJECT)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@piksta.online>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${bd}"`,
    '',
    `--${bd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(TEXT),
    `--${bd}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html()),
    `--${bd}--`, ''
  ].join('\r\n');
}

// ---------- SMTP (smtp.gmail.com:465) ----------
function smtpSend(to, data) {
  const user = process.env.GMAIL_USER || '', pass = process.env.GMAIL_APP_PASSWORD || '';
  if (!user || !pass) return Promise.reject(new Error('no smtp credentials'));
  return new Promise((resolve, reject) => {
    const s = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' });
    let buf = '', step = 0;
    const steps = [
      ['220', () => 'EHLO piksta.online'],
      ['250', () => 'AUTH PLAIN ' + Buffer.from('\0' + user + '\0' + pass).toString('base64')],
      ['235', () => `MAIL FROM:<${FROM}>`],
      ['250', () => `RCPT TO:<${to}>`],
      ['250', () => 'DATA'],
      ['354', () => data.replace(/^\./gm, '..') + '\r\n.'],
      ['250', () => 'QUIT']
    ];
    const t = setTimeout(() => { s.destroy(); reject(new Error('smtp timeout at step ' + step)); }, 20000);
    s.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\r\n'); if (lines[lines.length - 1] !== '') return;
      const last = lines.filter(Boolean).pop() || ''; if (/^\d{3}-/.test(last)) return;   // многострочный ответ ещё идёт
      buf = '';
      const [code, next] = steps[step] || [];
      if (!code) { clearTimeout(t); s.end(); return resolve(true); }
      if (!last.startsWith(code)) { clearTimeout(t); s.destroy(); return reject(new Error('smtp ' + last.slice(0, 120))); }
      step++;
      s.write(next() + '\r\n');
      if (step === steps.length) { clearTimeout(t); setTimeout(() => s.end(), 200); resolve(true); }
    });
    s.on('error', e => { clearTimeout(t); reject(e); });
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  try {
    const { idToken, test } = req.body || {};
    if (!idToken) return res.status(400).json({ ok: false, error: 'no token' });
    const u = await lookup(idToken);
    if (!u || !u.email) return res.status(401).json({ ok: false, error: 'bad token' });
    if (test) {
      if (u.email !== ADMIN_EMAIL) return res.status(403).json({ ok: false });
      await smtpSend(u.email, mime(u.email));
      return res.status(200).json({ ok: true, test: true });
    }
    if (!u.emailVerified) return res.status(200).json({ ok: false, skip: 'not verified' });
    if (Date.now() - Number(u.createdAt || 0) > MAX_AGE_MS) return res.status(200).json({ ok: false, skip: 'old account' });
    const first = await markOnce(u.localId, u.email);
    if (!first) return res.status(200).json({ ok: true, skip: 'already sent' });
    try { await smtpSend(u.email, mime(u.email)); }
    catch (e) { await unmark(u.localId); throw e; }
    console.log('welcome-sent', u.localId);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.log('welcome-error', e && e.message);
    return res.status(500).json({ ok: false, error: 'send failed' });
  }
};
