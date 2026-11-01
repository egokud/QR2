// Piksta — ежедневная резервная копия базы в приватный репозиторий GitHub egokud/piksta-backup (Vercel Function + Cron).
// Читает базу от имени служебного аккаунта bot@piksta.online (правила Firestore разрешают ему только ЧТЕНИЕ закупок),
// раскладывает по файлам: users/<uid>.json (профиль + закупки + сканы + история), adminLog.json, support.json, meta.json
// и делает один коммит. История коммитов = копии по дням. Если ничего не изменилось — коммит не создаётся.
// Секреты (Vercel → Settings → Environment Variables): BOT_PASSWORD (уже есть), GH_BACKUP_TOKEN (токен только на этот репозиторий).
// Запуск: Vercel Cron раз в сутки (vercel.json → crons) или вручную GET /api/backup?run=1.

const BOT_EMAIL = 'bot@piksta.online';
const FB_KEY = 'AIzaSyASHE3yqM0wOC3QHVbL4UVSHVq2rEzA5ss';   // публичный ключ веб-приложения (тот же, что в init.js)
const FS = 'https://firestore.googleapis.com/v1/projects/parcel-scanner-90427/databases/(default)/documents';
const REPO = 'egokud/piksta-backup';
const SUBS = ['shipments', 'scanned', 'history'];

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
async function fsGet(path) {
  if (!ID_TOKEN) await login();
  const r = await fetch(FS + path, { headers: { authorization: 'Bearer ' + ID_TOKEN } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore ${path}: ${(j.error && j.error.status) || r.status}`);
  return j;
}
// Значение Firestore → обычный JSON (даты — ISO-строки, ссылки и гео — как есть)
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return { $ts: v.timestampValue };
  if ('nullValue' in v) return null;
  if ('mapValue' in v) { const o = {}; for (const k of Object.keys(v.mapValue.fields || {}).sort()) o[k] = dec(v.mapValue.fields[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('referenceValue' in v) return { $ref: v.referenceValue };
  if ('geoPointValue' in v) return { $geo: v.geoPointValue };
  if ('bytesValue' in v) return { $bytes: v.bytesValue };
  return null;
}
const docObj = d => { const o = { _id: d.name.split('/').pop() }; for (const k of Object.keys(d.fields || {}).sort()) o[k] = dec(d.fields[k]); return o; };
// Все документы коллекции (постранично)
async function list(path) {
  const out = []; let token = '';
  do {
    const j = await fsGet(`${path}?pageSize=300${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
    if (!j) break;
    for (const d of (j.documents || [])) out.push(docObj(d));
    token = j.nextPageToken || '';
  } while (token);
  return out.sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
}

// ---------- GitHub (Git Data API: один коммит на все файлы) ----------
async function gh(path, opt = {}) {
  const r = await fetch('https://api.github.com/repos/' + REPO + path, {
    ...opt,
    headers: { authorization: 'Bearer ' + (process.env.GH_BACKUP_TOKEN || '').trim(), accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'piksta-backup' }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${path}: ${r.status} ${j.message || ''}`);
  return j;
}
async function commitFiles(files, message) {
  const ref = await gh('/git/ref/heads/main');
  const head = await gh('/git/commits/' + ref.object.sha);
  const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({
    base_tree: head.tree.sha,
    tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content }))
  }) });
  if (tree.sha === head.tree.sha) return { changed: false };
  const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
  await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  return { changed: true, commit: c.sha };
}

async function backup() {
  const t0 = Date.now();
  const users = await list('/users');
  const files = {}; let docs = users.length;
  for (const u of users) {
    const rec = { profile: u };
    for (const s of SUBS) { rec[s] = await list(`/users/${encodeURIComponent(u._id)}/${s}`); docs += rec[s].length; }
    files[`users/${u._id}.json`] = JSON.stringify(rec, null, 1) + '\n';
  }
  const adminLog = await list('/adminLog'); docs += adminLog.length;
  const support = await list('/support'); docs += support.length;
  files['adminLog.json'] = JSON.stringify(adminLog, null, 1) + '\n';
  files['support.json'] = JSON.stringify(support, null, 1) + '\n';
  const bytes = Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0);
  // meta.json меняется только вместе с данными, чтобы пустые дни не плодили коммиты
  const sum = require('crypto').createHash('sha1').update(Object.keys(files).sort().map(k => k + files[k]).join('')).digest('hex');
  files['meta.json'] = JSON.stringify({ users: users.length, docs, bytes, dataSha1: sum }, null, 1) + '\n';
  const day = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' });
  const res = await commitFiles(files, `Копия ${day}: ${users.length} польз., ${docs} док., ${(bytes / 1024).toFixed(0)} КБ`);
  return { ...res, users: users.length, docs, kb: Math.round(bytes / 1024), sec: (Date.now() - t0) / 1000 };
}

module.exports = async (req, res) => {
  const cron = /vercel-cron/i.test(req.headers['user-agent'] || '');
  if (!cron && !(req.query && req.query.run)) return res.status(200).send('ok');
  try {
    if (!process.env.GH_BACKUP_TOKEN) throw new Error('нет GH_BACKUP_TOKEN');
    const r = await backup();
    console.log('backup-ok', JSON.stringify(r));
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.log('backup-error', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
