// ============ РАБОТА БЕЗ ИНТЕРНЕТА — ВЕСЬ СКЛАД (07.11.2026) ============
// Что здесь:
//  1. Копия данных на телефоне: каждое чтение из базы (fsGet / fsList, init.js) сохраняется в IndexedDB.
//     Нет связи — отдаём сохранённую копию (поверх неё — то, что ещё не отправлено).
//  2. Очередь отправки (outbox): отметки сканирования, история, вес, тара, статус, клиент и цена позиции
//     сначала пишутся на телефон, потом отправляются в базу. Нет связи — копятся и уходят сами, когда связь появится,
//     даже если приложение закрывали.
//  3. Полоса сверху (только мобильная версия): жёлтая — нет интернета, синяя — отправляем, зелёная — всё сохранено.
//  4. «Подготовить к складу» в меню закупки: приложение, позиции, клиенты и фото — на телефон одной кнопкой.
// Маршрутизация: файлы приложения и фото без интернета отдаёт sw.js (кэши piksta-app-v2 и piksta-images-v1).
// Старая кнопка «Скачать фото» (cacheShipmentImages в app.js) теперь вызывается изнутри pkPrepOffline — отдельного входа больше нет.

// ---------- 0. Новая версия сайта (09.11.2026) ----------
// sw.js сообщает pk-upd, когда страница открылась из сохранённой копии, а на сервере уже новая версия.
// Только что открыли и ничего не вводили — перезагружаемся сами (не чаще раза в минуту); иначе — полоска «Обновить».
const PK_T0 = Date.now();
function pkUpdGot() {
  let last = 0; try { last = +sessionStorage.getItem('pk_upd_rl') || 0; } catch (e) {}
  const busy = document.querySelector('.cab-ovl, #pkMan[style*="block"], .pk-sheet.open') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.value);
  if (Date.now() - PK_T0 < 20000 && Date.now() - last > 60000 && !busy && !(typeof pkOut !== 'undefined' && pkOut.length)) {
    try { sessionStorage.setItem('pk_upd_rl', String(Date.now())); } catch (e) {}
    setTimeout(() => location.reload(), 300);
    return;
  }
  if (document.getElementById('pkUpdBar')) return;
  const b = document.createElement('div'); b.id = 'pkUpdBar';
  b.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:3000;background:#17142a;color:#fff;border-radius:12px;padding:10px 10px 10px 16px;display:flex;align-items:center;gap:12px;font:600 14px/1.3 Inter,system-ui,sans-serif;box-shadow:0 10px 28px rgba(23,20,42,.3);max-width:calc(100vw - 24px)';
  b.innerHTML = '<span>Вышло обновление Piksta</span><button type="button" style="background:#6C4DB8;color:#fff;border:none;border-radius:8px;padding:8px 14px;font:700 13.5px Inter,system-ui,sans-serif;cursor:pointer" onclick="location.reload()">Обновить</button>';
  document.body.appendChild(b);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'pk-upd') pkUpdGot(); });

// ---------- IndexedDB: маленькое хранилище ключ → значение ----------
const pkIdb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('piksta-off', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('kv', mode), st = t.objectStore('kv'); let out;
    const q = fn(st); if (q) q.onsuccess = () => { out = q.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  return {
    get: k => tx('readonly', st => st.get(k)).catch(() => undefined),
    set: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => {}),
  };
})();

// ---------- Состояние сети ----------
const pkNet = { down: false, fromSnap: false, wasDown: false, acts: 0, sent: 0, flushing: false, okT: null };
// wasDown — был ли период без связи: синяя и зелёная полосы — только после него (в обычной работе с интернетом полосы нет)
function pkIsNetErr(e) {
  const m = String((e && (e.code || e.message)) || e || '');
  return e instanceof TypeError || /timeout|network|offline|unavailable|Failed to fetch|Load failed|deadline/i.test(m);
}
function pkTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
function pkOnline() { return navigator.onLine !== false && !pkNet.down; }

// ---------- 1. Копия данных: обёртки fsGet / fsList из init.js ----------
async function pkToken() {
  if (savedToken) return savedToken;
  try { return auth.currentUser ? await pkTimeout(auth.currentUser.getIdToken(), 6000) : ''; } catch (e) { return ''; }
}
async function pkRest(path, list) {
  if (navigator.onLine === false) throw new TypeError('offline');
  const go = tk => pkTimeout(fetch(FS_BASE + '/' + path + (list ? '?pageSize=300' : ''), { headers: tk ? { 'Authorization': 'Bearer ' + tk } : {} }), 15000);
  let r = await go(await pkToken());
  if (r.status === 401 && auth.currentUser) {   // токен устарел (живёт час) — берём свежий и повторяем
    try { savedToken = await pkTimeout(auth.currentUser.getIdToken(true), 8000); r = await go(savedToken); } catch (e) {}
  }
  if (!list && r.status === 404) return { missing: true };
  if (!r.ok) { const e = new Error((list ? 'fsList ' : 'fsGet ') + r.status); e.http = r.status; throw e; }
  return r.json();
}
const pkSnapKey = p => 'snap:' + p;
fsGet = async function (path) {
  let raw;
  try {
    raw = await pkRest(path, false);
    pkIdb.set(pkSnapKey(path), raw);
    if (pkNet.down && !pkNet.flushing) { pkNet.down = false; pkOutFlush(); }
  } catch (e) {
    if (e.http || !pkIsNetErr(e)) throw e;        // 401/403/500 — не прячем за старой копией
    raw = await pkIdb.get(pkSnapKey(path));
    if (!raw) throw e;
    pkNet.down = true; pkNet.fromSnap = true; pkNetPaint();
  }
  if (raw.missing) {
    const o = pkOverlay(path, null);
    return o ? { exists: true, data: () => o, id: path.split('/').pop() } : { exists: false };
  }
  const obj = pkOverlay(path, fsDocToObj(raw));
  return { exists: true, data: () => obj, id: (raw.name || '').split('/').pop() };
};
fsList = async function (path) {
  let raw;
  try {
    raw = await pkRest(path, true);
    pkIdb.set(pkSnapKey(path + '/*'), raw);
  } catch (e) {
    if (e.http || !pkIsNetErr(e)) throw e;
    raw = await pkIdb.get(pkSnapKey(path + '/*'));
    if (!raw) throw e;
    pkNet.down = true; pkNet.fromSnap = true; pkNetPaint();
  }
  return (raw.documents || []).map(doc => {
    const id = (doc.name || '').split('/').pop(), obj = pkOverlay(path + '/' + id, fsDocToObj(doc));
    return { id, data: () => obj };
  });
};

// ---------- 2. Очередь отправки ----------
// Операция: { id, uid, path, kind: 'update' | 'set' | 'row', data, key, t }
//  update — обновить поля документа; set — записать документ целиком; row — поменять одну позицию закупки по трек-коду.
// Одинаковые операции (тот же документ и те же поля / та же позиция) склеиваются — в базу уходит последнее значение.
let pkOut = [], pkOutLoaded = false;
const pkOutReady = pkIdb.get('outbox').then(v => { pkOut = Array.isArray(v) ? v : []; pkOutLoaded = true; pkNetPaint(); });
function pkOutMine() { return pkOut.filter(o => o.uid === savedUid); }
function pkOutSave() { return pkIdb.set('outbox', pkOut); }
function pkClone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

async function pkWrite(path, kind, data, key, quiet) {
  await pkOutReady;
  const op = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), uid: savedUid, path, kind, data: pkClone(data), t: Date.now(),
    key: key || (path + '|' + kind + '|' + (kind === 'set' ? '' : Object.keys(data || {}).sort().join(','))) };
  const i = pkOut.findIndex(o => o.key === op.key && o.uid === op.uid);
  if (i >= 0) pkOut.splice(i, 1);
  pkOut.push(op);
  if (!quiet) pkNet.acts++;
  await pkOutSave();
  pkNetPaint();
  pkOutFlush();
}
// Позиция закупки (клиент, цены, название) — по трек-коду, idx — подсказка
function pkRowWrite(shipId, idx) {
  const r = TABLE[idx]; if (!r) return;
  const nm = String(r[6] || '').trim();
  return pkWrite('users/' + savedUid + '/shipments/' + shipId, 'row',
    { track: String(r[0]), idx, w: String(r[1] || ''), p: String(r[3] || ''), pc: String(r[4] || ''), n: nm },
    'users/' + savedUid + '/shipments/' + shipId + '|row|' + r[0] + '|' + idx);
}
function pkApplyRow(arr, d) {
  if (!Array.isArray(arr)) return false;
  let i = arr[d.idx] && (Array.isArray(arr[d.idx]) ? arr[d.idx][0] : arr[d.idx].t) === d.track ? d.idx : -1;
  if (i < 0) i = arr.findIndex(x => (Array.isArray(x) ? x[0] : x && x.t) === d.track);
  if (i < 0) return false;
  let x = arr[i];
  if (Array.isArray(x) && d.n) x = arr[i] = { t: x[0], w: x[1] || '', img: x[2] || '', p: x[3] || '', pc: x[4] || '', q: x[5] || '1' };
  if (Array.isArray(x)) { x[1] = d.w; x[3] = d.p; x[4] = d.pc; }
  else { x.w = d.w; x.p = d.p; x.pc = d.pc; if (d.n) x.n = d.n; else delete x.n; }
  return true;
}
// Наложить неотправленное на прочитанный документ
function pkOverlay(path, obj) {
  if (!pkOut.length) return obj;
  for (const o of pkOut) {
    if (o.uid !== savedUid || o.path !== path) continue;
    if (o.kind === 'set') obj = pkClone(o.data);
    else if (o.kind === 'update') obj = Object.assign(obj || {}, pkClone(o.data));
    else if (o.kind === 'row' && obj && obj.data) pkApplyRow(obj.data, o.data);
  }
  return obj;
}
function pkDocRef(path) { return db.doc(path); }
async function pkExec(o) {
  const ref = pkDocRef(o.path);
  if (o.kind === 'set') return ref.set(o.data);
  if (o.kind === 'update') return ref.update(o.data);
  if (o.kind === 'row') return db.runTransaction(async t => {
    const doc = await t.get(ref); if (!doc.exists) return;
    const data = doc.data().data; if (!pkApplyRow(data, o.data)) return;
    t.update(ref, { data });
  });
}
async function pkOutFlush() {
  await pkOutReady;
  if (pkNet.flushing || !savedUid || !pkOutMine().length) { pkNetPaint(); return; }
  if (navigator.onLine === false) { pkNet.down = true; pkNetPaint(); return; }
  pkNet.flushing = true; pkNetPaint();
  try {
    while (true) {
      const o = pkOutMine()[0]; if (!o) break;
      try {
        await pkTimeout(pkExec(o), 15000);
        pkNet.down = false;
      } catch (e) {
        const code = String((e && e.code) || '');
        const fatal = /permission-denied|not-found|invalid-argument/.test(code);
        if (!fatal && (pkIsNetErr(e) || (o.tries = (o.tries || 0) + 1) < 8)) { if (pkIsNetErr(e)) pkNet.down = true; await pkOutSave(); break; }   // связь — ждём; непонятная ошибка — ещё попробуем
        console.warn('Piksta: не удалось отправить, пропускаем', o.path, code || (e && e.message));   // нет доступа / закупку удалили — не держим очередь
      }
      const i = pkOut.indexOf(o); if (i >= 0) pkOut.splice(i, 1);
      pkNet.sent++;
      await pkOutSave();
      pkNetPaint();
    }
  } finally { pkNet.flushing = false; }
  if (!pkOutMine().length) { if (pkNet.sent && pkNet.wasDown) pkNetDone(); else { pkNet.sent = 0; pkNet.acts = 0; } }
  pkNetPaint();
}
window.addEventListener('online', () => { pkNet.down = false; pkOutFlush(); });
window.addEventListener('offline', () => { pkNet.down = true; pkNetPaint(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) pkOutFlush(); });
setInterval(() => { if (savedUid && pkOutMine().length) pkOutFlush(); }, 20000);

// ---------- 3. Полоса сверху ----------
let pkNetOk = 0;
function pkNetDone() {
  pkNetOk = Math.max(pkNet.sent, pkNet.acts); pkNet.sent = 0; pkNet.acts = 0; pkNet.fromSnap = false; pkNet.wasDown = false;
  clearTimeout(pkNet.okT); pkNet.okT = setTimeout(() => { pkNetOk = 0; pkNetPaint(); }, 6000);
}
function pkActsWord(n) { return n % 10 === 1 && n % 100 !== 11 ? 'действие' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'действия' : 'действий'); }
function pkNetPaint() {
  const app = document.getElementById('appScreen'); if (!app || !savedUid) return;
  const inCab = document.getElementById('cabinetScreen') && document.getElementById('cabinetScreen').classList.contains('show');
  let el = document.getElementById('pkNet');
  const n = pkOutMine().length, acts = Math.max(pkNet.acts, n), off = navigator.onLine === false || pkNet.down;
  if (off || (n && pkNet.fromSnap)) pkNet.wasDown = true;
  let kind = '', html = '';
  if (off) {
    kind = 'off';
    html = `<i class="ti ti-wifi-off" aria-hidden="true"></i><span><b>Нет интернета — работаем на телефоне.</b> ${n
      ? `Сохранено на телефоне: ${acts} ${pkActsWord(acts)}. Отправим сами, когда появится связь.`
      : 'Всё, что сделаете, сохранится на телефоне и отправится само.'}</span>`;
  } else if (n && pkNet.wasDown) {
    kind = 'sync';
    html = `<i class="ti ti-cloud-upload" aria-hidden="true"></i><span><b>Отправляем со склада: ${acts} ${pkActsWord(acts)}…</b> Не закрывайте приложение пару секунд.</span>`;
  } else if (pkNetOk) {
    kind = 'ok';
    html = `<i class="ti ti-circle-check" aria-hidden="true"></i><span><b>Интернет есть — всё сохранено в базе.</b> Отправлено со склада: ${pkNetOk} ${pkActsWord(pkNetOk)}.</span>`;
  }
  if (inCab) kind = '';   // в Кабинете на компьютере полоса не нужна
  if (!kind) { if (el) el.remove(); document.body.classList.remove('pk-net-on'); document.body.style.removeProperty('--pk-net-h'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'pkNet'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'pk-net ' + kind; el.innerHTML = html;
  document.body.classList.add('pk-net-on');
  document.body.style.setProperty('--pk-net-h', el.offsetHeight + 'px');
}

// ---------- 4. «Подготовить к складу» ----------
const PK_APP_CACHE = 'piksta-app-v2';
function pkOffRec(id) { try { return JSON.parse(localStorage.getItem('pk_offr_' + id) || 'null'); } catch (e) { return null; } }
// Готова ли закупка к работе без интернета: 'ok' | 'stale' (после подготовки поменялись позиции) | ''
function pkOffState(s) {
  const r = s && pkOffRec(s.id); if (!r) return '';
  return r.rows === (s.data || []).length ? 'ok' : 'stale';
}
function pkOffPill(s) {
  const st = pkOffState(s);
  return st === 'ok' ? '<span class="pk-offpill"><i class="ti ti-cloud-check" aria-hidden="true"></i>Готова без интернета</span>'
    : st === 'stale' ? '<span class="pk-offpill stale"><i class="ti ti-cloud" aria-hidden="true"></i>Обновите перед складом</span>' : '';
}
// Файлы самого приложения — на телефон (страница, скрипты, стили, иконки, шрифты, сканер)
async function pkCacheShell(onStep) {
  if (!('caches' in window)) throw new Error('Браузер не умеет работать без интернета');
  const c = await caches.open(PK_APP_CACHE);
  const urls = new Set(['/app', '/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png', '/js/zxing_reader.wasm']);
  document.querySelectorAll('script[src]').forEach(s => urls.add(s.src));
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(l => urls.add(l.href));
  try { performance.getEntriesByType('resource').forEach(e => { if (/\.(woff2?|ttf|css|js|wasm|png|svg)(\?|$)/.test(e.name)) urls.add(e.name); }); } catch (e) {}
  const ok = u => { try { const x = new URL(u, location.href); return x.origin === location.origin ? !/^\/api\//.test(x.pathname) : /^(www\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(x.hostname) && !/googleapis\.com\/(identitytoolkit|securetoken)/.test(u); } catch (e) { return false; } };
  const list = [...urls].filter(ok);
  let done = 0, failed = 0;
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async u => {
      try {
        const x = new URL(u, location.href), same = x.origin === location.origin;
        // весь файл целиком (запрос + запись на телефон) — не дольше 25 секунд: зависший не останавливает подготовку
        await pkTimeout((async () => {
          const r = await fetch(x.href, same ? { cache: 'reload' } : { mode: 'cors', credentials: 'omit', cache: 'reload' });
          if (!r.ok) throw new Error(r.status);
          await c.put(same && x.pathname === '/app' ? location.origin + '/app' : x.href, r);
        })(), 25000);
      } catch (e) { failed++; }
      done++; onStep && onStep(done, list.length);
    }));
  }
  if (failed > Math.max(2, list.length * 0.1)) throw new Error('не все файлы приложения скачались');
  return list.length;
}
let pkPrepBusy = false;
async function pkPrepOffline(id) {
  if (pkPrepBusy) return;
  const s = (allShipments || []).find(x => x.id === id); if (!s) return;
  if (navigator.onLine === false) { showToast('Нет интернета. Подготовьте закупку, когда будет Wi-Fi'); return; }
  pkPrepBusy = true;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}   // просим браузер не стирать сохранённое
  const step = (k, st, sub, pct) => {
    const el = document.getElementById('pkPrep-' + k); if (!el) return;
    el.className = 'ck ' + st;
    el.querySelector('i').className = 'ti ' + (st === 'ok' ? 'ti-check' : st === 'bad' ? 'ti-alert-triangle' : 'ti-loader-2');
    if (sub != null) el.querySelector('small').textContent = sub;
    if (pct != null) { const b = document.getElementById('pkPrepBar-' + k); if (b) b.style.width = pct + '%'; }
  };
  const row = (k, t) => `<div class="ck run" id="pkPrep-${k}"><i class="ti ti-loader-2" aria-hidden="true"></i><span>${t}</span><small>ждём</small></div><div class="pk-prepbar"><span id="pkPrepBar-${k}"></span></div>`;
  try { pkSheet(`<h3>${pkEsc(s.name)} — на склад без интернета</h3>
    <p class="pk-muted" style="font-size:14px;line-height:1.45;margin:6px 0 12px">Делайте дома, пока есть Wi-Fi. На складе Piksta откроется и без связи: сканер, клиенты и взвешивание работают, всё отправится само, когда появится интернет.</p>
    <div class="pk-prep">${row('app', 'Приложение')}${row('data', 'Позиции и клиенты')}${row('img', 'Фото товаров')}</div>
    <div id="pkPrepRes" style="margin-top:12px"></div>`); } catch (e) {}   // окно — только в мобильной версии; без него подготовка всё равно идёт и не «залипает»
  let bad = '', miss = 0;
  try {
    // 1. приложение
    try { const n = await pkCacheShell((d, t) => step('app', 'run', `${d} из ${t}`, Math.round(d / t * 100))); step('app', 'ok', 'готово', 100); }
    catch (e) { step('app', 'bad', 'не всё скачалось'); bad = 'app'; }
    // 2. данные: закупка, отметки, история, список закупок, профиль — копии сохраняются сами (fsGet / fsList)
    step('data', 'run', 'скачиваю', 30);
    await loadForAction(id);
    await Promise.all([
      fsGet('users/' + savedUid),
      fsList('users/' + savedUid + '/shipments'),
      fsGet('users/' + savedUid + '/scanned/' + id),
      fsGet('users/' + savedUid + '/history/' + id).catch(() => {}),
    ]);
    const cl = new Set(); TABLE.forEach(r => (typeof splitWarehouses === 'function' ? splitWarehouses(r[1] || '') : [r[1]]).forEach(p => { if (p && p.trim()) cl.add(p.trim().toLowerCase()); }));
    step('data', 'ok', `${TABLE.length} · ${cl.size}`, 100);
    // 3. фото — общая функция скачивания (app.js), прогресс сюда
    const urls = [...new Set(TABLE.map(r => r[2]).filter(u => u && !/^data:/.test(u)))];   // фото, добавленные вручную, уже внутри закупки
    let got = urls.length;
    if (urls.length) {
      window.__pkPrepImg = (d, t) => step('img', 'run', `${d} из ${t}`, Math.round(d / t * 100));
      try { await cacheShipmentImages(id); } finally { window.__pkPrepImg = null; }
      got = await countCachedForShipment(urls);
      step('img', got >= urls.length ? 'ok' : 'bad', `${got} из ${urls.length}`, Math.round(got / urls.length * 100));
      if (got < urls.length) miss = urls.length - got;   // без части фото работать можно — сканер покажет клиента, просто без картинки
    } else step('img', 'ok', 'фото нет', 100);
    // готово
    try {
      Object.keys(localStorage).filter(k => k.startsWith('pk_offr_')).forEach(k => localStorage.removeItem(k));   // фото на телефоне — только одной закупки
      if (!bad) localStorage.setItem('pk_offr_' + id, JSON.stringify({ rows: TABLE.length, imgs: got, at: Date.now() }));
    } catch (e) {}
    const res = document.getElementById('pkPrepRes');
    if (res) res.innerHTML = !bad
      ? `<div class="pk-prepdone"><i class="ti ti-circle-check" aria-hidden="true"></i>${miss ? `Можно ехать на склад. Не скачалось фото: ${miss} — у этих посылок будет только клиент, без картинки` : 'Можно ехать на склад: всё скачано на телефон'}</div>${miss ? `<button class="pk-btn ghost" style="width:100%;margin-top:10px" onclick="pkPrepOffline('${id}')">Докачать фото</button>` : ''}<button class="pk-btn" style="width:100%;margin-top:10px" onclick="pkSheetClose()">Готово</button>`
      : `<div class="pk-prepdone bad"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Не всё скачалось. Проверьте интернет и нажмите ещё раз.</div><button class="pk-btn" style="width:100%;margin-top:10px" onclick="pkPrepOffline('${id}')">Ещё раз</button>`;
  } catch (e) {
    const res = document.getElementById('pkPrepRes');
    if (res) res.innerHTML = `<div class="pk-prepdone bad"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Не получилось: ${pkEsc(e.message || 'нет связи')}. Нажмите ещё раз.</div><button class="pk-btn" style="width:100%;margin-top:10px" onclick="pkPrepOffline('${id}')">Ещё раз</button>`;
  } finally {
    pkPrepBusy = false;
    try { await restoreActiveEditing(); } catch (e) {}
    if (typeof pkRender === 'function') try { pkRender(); } catch (e) {}
  }
}

// Выход из аккаунта: неотправленное не теряем без спроса; копии данных с телефона стираем (чужой человек на этом устройстве их не увидит)
async function pkLogoutCheck() {
  await pkOutReady;
  const n = pkOutMine().length;
  if (n && !confirm('На телефоне есть неотправленные действия со склада (' + n + '). Если выйти сейчас, они пропадут.\n\nВыйти всё равно?')) return false;
  pkOut = pkOut.filter(o => o.uid !== savedUid); await pkOutSave();
  try { const db = await indexedDB.open('piksta-off'); db.onsuccess = () => { try { const t = db.result.transaction('kv', 'readwrite'); const st = t.objectStore('kv'); const r = st.getAllKeys(); r.onsuccess = () => r.result.forEach(k => { if (String(k).startsWith('snap:')) st.delete(k); }); } catch (e) {} }; } catch (e) {}
  try { Object.keys(localStorage).filter(k => /^pk_(offr|active)_/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  return true;
}
