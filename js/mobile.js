// Piksta — мобильная версия (сканер + карманный Кабинет). Работает поверх app.js и cabinet.js, их логику не меняет.
// Вкладки: Сканер · Закупки · Клиенты · Деньги · Ещё. Скины: compact (по умолчанию), lenta, bottom.
let pkTab = 'scan';
let pkShipFilter = 'all';
let pkClientFilter = 'all';
let pkClientQuery = '';
let pkClientOpen = null;
let pkLastOk = null;
let pkPrevKeys = null, pkNewIdx = null;   // { track } — для «Отменить отметку»
const PK_SKINS = [['compact', 'Компактный'], ['lenta', 'Лента'], ['bottom', 'Сканер снизу']];

const pkEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkPl = (n, a, b, c) => { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
const pkFmt = v => (typeof cabFmt === 'function' ? cabFmt(v || 0) : String(Math.round(v || 0)));
const pkCur = () => (userProfile && userProfile.currency) || 'BYN';
const pkSt = k => (typeof SHIP_STATUSES !== 'undefined' && SHIP_STATUSES[k]) || { label: 'Формируется', color: '#4a90d9', text: '#2563a8' };
const pkActive = () => (allShipments || []).find(s => s.id === activeShipmentId) || null;
const pkIsOn = () => document.body.classList.contains('pk-m');
function pkLocked() { const s = pkActive(); return !!s && (s.status || 'forming') === 'forming'; }
function pkSkin() { try { return localStorage.getItem('pk_skin') || 'compact'; } catch (e) { return 'compact'; } }
function pkSetSkin(k) {
  try { localStorage.setItem('pk_skin', k); } catch (e) {}
  document.body.classList.remove('pk-skin-compact', 'pk-skin-lenta', 'pk-skin-bottom');
  document.body.classList.add('pk-skin-' + k);
  pkRender();
}

// ---------- каркас ----------
function pkBuild() {
  if (document.getElementById('pkTabs')) return;
  const app = document.getElementById('appScreen');
  const top = document.createElement('div');
  top.className = 'pk-top'; top.id = 'pkTop';
  top.innerHTML = `<div class="pk-brand"><img src="/icons/icon-72x72.png" alt="">Piksta</div><button class="pk-ava" id="pkAva" onclick="pkGo('more')" aria-label="Ещё"></button>`;
  app.insertBefore(top, app.firstChild);

  const scan = document.createElement('div');
  scan.className = 'pk-pane on'; scan.id = 'pkPane-scan';
  scan.innerHTML = `
    <div class="pk-strip" id="pkStrip"></div>
    <button class="pk-pick" id="pkPick" onclick="pkPickSheet()"></button>
    <div class="pk-card pk-count" id="pkCount" onclick="toggleRemainingList()"></div>
    <div id="pkScanBox"></div>
    <div class="pk-lbl pk-recent-l">Последние отметки</div>
    <div class="pk-list" id="pkRecent"></div>`;
  const trial = document.getElementById('trialBanner');
  app.insertBefore(scan, trial ? trial.nextSibling : top.nextSibling);
  // переносим живые узлы сканера (обработчики сохраняются)
  const box = scan.querySelector('#pkScanBox');
  const sc = document.createElement('div'); sc.className = 'pk-scan'; sc.id = 'pkScan';
  sc.innerHTML = `<div class="st"><i class="dot"></i><span>Сканер готов</span></div>`;
  sc.appendChild(document.querySelector('.gun-section'));
  box.appendChild(sc);
  const lock = document.createElement('div'); lock.className = 'pk-lock'; lock.id = 'pkLock'; lock.style.display = 'none';
  box.appendChild(lock);
  box.appendChild(document.getElementById('resultBlock'));
  box.appendChild(document.getElementById('cameraSection'));
  scan.appendChild(document.querySelector('#appScreen > .bottom-section'));

  for (const k of ['ships', 'clients', 'money', 'more']) {
    const p = document.createElement('div'); p.className = 'pk-pane'; p.id = 'pkPane-' + k; app.appendChild(p);
  }
  const tabs = document.createElement('nav');
  tabs.className = 'pk-tabs'; tabs.id = 'pkTabs'; tabs.setAttribute('aria-label', 'Разделы');
  tabs.innerHTML = '<div class="in">' + [['scan', 'ti-scan', 'Сканер'], ['ships', 'ti-package', 'Закупки'], ['clients', 'ti-users', 'Клиенты'], ['money', 'ti-wallet', 'Деньги'], ['more', 'ti-layout-grid', 'Ещё']]
    .map(([k, ic, l]) => `<button type="button" id="pkT-${k}" data-t="${k}" onclick="pkGo('${k}')"><i class="ti ${ic}" aria-hidden="true"></i>${l}</button>`).join('') + '</div>';
  document.body.appendChild(tabs);

  const bg = document.createElement('div'); bg.className = 'pk-sheet-bg'; bg.id = 'pkSheetBg'; bg.onclick = pkSheetClose;
  const sh = document.createElement('div'); sh.className = 'pk-sheet'; sh.id = 'pkSheet'; sh.setAttribute('role', 'dialog');
  document.body.appendChild(bg); document.body.appendChild(sh);
  const rf = document.createElement('div'); rf.className = 'pk-res-full'; rf.id = 'pkResFull'; rf.setAttribute('role', 'dialog');
  document.body.appendChild(rf);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { pkSheetClose(); if (document.getElementById('pkResFull').classList.contains('on')) pkResOk(); } });
}

function pkActivate() {
  if (userProfile && userProfile.blocked) return;
  pkBuild();
  document.body.classList.add('pk-m');
  pkSetSkin(pkSkin());
  pkGo(pkTab);
}
function pkDeactivate() {
  document.body.classList.remove('pk-m');
  pkSheetClose();
}

function pkGo(t) {
  pkTab = t;
  document.querySelectorAll('.pk-pane').forEach(p => p.classList.toggle('on', p.id === 'pkPane-' + t));
  document.querySelectorAll('#pkTabs button').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  document.body.classList.toggle('pk-on-scan', t === 'scan');
  if (t !== 'clients') pkClientOpen = null;
  pkRender();
  window.scrollTo(0, 0);
  if (t === 'scan' && !pkLocked()) setTimeout(() => { const i = document.getElementById('manualInput'); if (i && !('ontouchstart' in window)) i.focus(); }, 150);
}

function pkRender() {
  if (!pkIsOn()) return;
  const ava = document.getElementById('pkAva');
  if (ava) ava.textContent = String((userProfile && userProfile.name) || (currentUser && currentUser.email) || 'P').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  try {
    if (pkTab === 'scan') pkRenderScan();
    else if (pkTab === 'ships') pkRenderShips();
    else if (pkTab === 'clients') pkRenderClients();
    else if (pkTab === 'money') pkRenderMoney();
    else if (pkTab === 'more') pkRenderMore();
  } catch (e) { console.warn('pkRender', e); }
}

// ---------- Сканер ----------
function pkRenderScan() {
  const s = pkActive();
  const st = pkSt(s ? (s.status || 'forming') : 'forming');
  const pick = document.getElementById('pkPick');
  pick.innerHTML = s
    ? `<span><small>Сканирую закупку</small><b>${pkEsc(s.name)}</b> <span style="color:${st.text};font-weight:600">· ${st.label}</span></span><i class="ti ti-chevron-down" aria-hidden="true" style="font-size:20px;color:var(--pk-muted)"></i>`
    : `<span><small>Закупок пока нет</small><b>Импортируйте заказы с компьютера</b></span>`;
  // лента (скин «Лента»)
  document.getElementById('pkStrip').innerHTML = (allShipments || []).filter(x => x.status !== 'done').map(x => {
    const xs = pkSt(x.status || 'forming');
    return `<button type="button" class="pk-chip ${x.id === activeShipmentId ? 'on' : ''}" onclick="pkScanShip('${x.id}')"><b>${pkEsc(x.name)}</b><small style="color:${xs.text}">● ${xs.label}</small> <small>· ${(x.data || []).length}</small></button>`;
  }).join('');
  // счётчик
  const t = TABLE.length, d = Object.keys(scanned).length;
  const locked = pkLocked();
  document.getElementById('pkCount').innerHTML = locked
    ? `<div class="pk-row"><span class="pk-pill" style="background:${st.color}22;color:${st.text}">● ${st.label}</span></div><div class="n">${t} <small>${pkPl(t, 'позиция', 'позиции', 'позиций')} в заказе</small></div><div class="pk-muted" style="font-size:14px">Заказ ещё собирается. Сканировать можно, когда посылки приедут к вам.</div>`
    : `<div class="pk-row"><div class="n">${d} <small>/ ${t}</small></div><span class="pk-muted" style="font-size:14px">осталось <b style="color:var(--pk-ink)">${t - d}</b></span></div><div class="pk-bar"><span style="width:${t ? Math.round(d / t * 100) : 0}%"></span></div>`;
  // сканер или замок
  const sc = document.getElementById('pkScan'), lock = document.getElementById('pkLock');
  const inp = document.getElementById('manualInput');
  if (locked) {
    sc.style.display = 'none'; lock.style.display = 'flex';
    if (inp) inp.disabled = true;
    if (typeof scanning !== 'undefined' && scanning && typeof stopScanner === 'function') stopScanner();
    const other = (allShipments || []).find(x => x.id !== activeShipmentId && ['transit', 'delayed', 'warehouse'].includes(x.status));
    lock.innerHTML = `<div class="t"><i class="ti ti-lock" aria-hidden="true"></i> Сканер выключен для этой закупки</div>
      <p>Закупка ещё собирается. Когда карго заберёт посылки — отметьте отправку, и сканер включится, как только посылки приедут.</p>
      <div class="btns"><button class="pk-btn ghost" onclick="pkSetStatus('${s.id}','transit')"><i class="ti ti-truck" aria-hidden="true"></i> Закупка отправлена → «В дороге»</button>
      ${other ? `<button class="pk-btn" onclick="pkScanShip('${other.id}')">Сканировать ${pkEsc(other.name)}</button>` : ''}</div>`;
  } else {
    sc.style.display = 'flex'; lock.style.display = 'none';
    if (inp) inp.disabled = !s;
  }
  // последние отметки
  const rec = (typeof scanHistory !== 'undefined' ? scanHistory : []).slice(0, 6);
  document.getElementById('pkRecent').innerHTML = rec.length ? rec.map(h => {
    const row = TABLE.find(r => r[0] === h.track);
    const img = row && row[2] ? `style="background-image:url('${pkEsc(row[2])}')"` : '';
    return `<div class="pk-li"><span class="ph" ${img}>${img ? '' : pkEsc(String(h.wh || '?').trim().charAt(0).toUpperCase())}</span><div><b>${pkEsc(h.wh || 'Без клиента')}</b><small>${pkEsc(h.track)}</small></div><span class="r">${pkEsc(h.time || '')}</span></div>`;
  }).join('') : '<div class="pk-empty">Здесь появятся посылки, которые вы отметили</div>';
}

async function pkScanShip(id) {
  pkSheetClose();
  if (id !== activeShipmentId) await pickShipment(id);
  pkGo('scan');
}
function pkPickSheet() {
  const list = (allShipments || []).filter(x => x.status !== 'done');
  pkSheet(`<h3>Какую закупку сканируем</h3>
    <div class="pk-list" style="margin-top:12px">${list.map(x => {
      const xs = pkSt(x.status || 'forming');
      return `<div class="pk-li" style="grid-template-columns:minmax(0,1fr) auto" onclick="pkScanShip('${x.id}')"><div><b>${pkEsc(x.name)}</b><small style="color:${xs.text}">● ${xs.label} · ${(x.data || []).length} ${pkPl((x.data || []).length, 'позиция', 'позиции', 'позиций')}</small></div><span class="r">${x.id === activeShipmentId ? '<i class="ti ti-check" style="color:var(--pk-acc);font-size:20px"></i>' : ''}</span></div>`;
    }).join('') || '<div class="pk-empty">Закупок нет</div>'}</div>`);
}
async function pkSetStatus(id, key) {
  await setStatus(id, key);
  pkSheetClose();
  pkRender();
}

// результат скана — на весь экран, без эмодзи
function pkShowScanResult(type, track, wh, tracks, fMsg) {
  if (typeof scanner !== 'undefined' && scanner) try { scanner.pause(true); } catch (e) {}
  const s = pkActive();
  const t = TABLE.length, d = Object.keys(scanned).length;
  const row = TABLE.find(r => r[0] === track);
  const img = row && row[2] ? row[2] : '';
  const q = row ? parseInt(row[5] || '1', 10) || 1 : 1;
  const el = document.getElementById('pkResFull');
  let body;
  if (type === 'success') {
    pkLastOk = { track, idx: pkNewIdx };
    const parts = [...new Set(String(wh || '').split(/\s(?:и|\+)\s/).map(x => x.trim()).filter(Boolean))];
    const many = parts.length > 1;
    const who = pkEsc(parts.join(' и ') || 'Без клиента');
    body = `<div class="card">
      <div class="img ${img ? '' : 'no'}" style="${img ? `background-image:url('${pkEsc(img)}')` : ''}">${img ? '' : '<span><i class="ti ti-photo-off" style="font-size:22px;vertical-align:-5px;margin-right:6px"></i>фото товара нет</span>'}</div>
      <div class="pk-row" style="justify-content:flex-start"><span class="pk-pill" style="background:var(--pk-ok-soft);color:var(--pk-ok)"><i class="ti ti-check" aria-hidden="true"></i> Отмечено</span><span class="pk-muted" style="font-size:13px">кладите в пакет клиента</span></div>
      <div class="who ${who.length > 22 ? 'long' : ''}">${who}</div>
      ${q > 1 ? `<div class="warn">×${q} — под этим треком ${q} ${pkPl(q, 'вещь', 'вещи', 'вещей')}, проверьте, что все в пакете</div>` : ''}
      ${many ? `<div class="warn">В посылке товары для нескольких клиентов — разложите по пакетам</div>` : ''}
      <div class="trk">${pkEsc(track)}</div>
    </div>
    <button class="pk-btn" style="width:100%" onclick="pkResOk()">Следующая посылка</button>
    <button class="undo" onclick="pkUndo()">Отменить отметку</button>`;
  } else {
    body = `<div class="card" style="border-color:var(--pk-acc)">
      <div class="pk-row" style="justify-content:flex-start;gap:8px"><i class="ti ti-search" style="font-size:24px;color:var(--pk-acc)" aria-hidden="true"></i><b style="font-size:17px">${pkEsc(fMsg || 'Несколько вариантов')}</b></div>
      <div class="trk">Считано: ${pkEsc(track)}</div>
      <div class="pk-res" style="padding:0"><div class="ch" style="width:100%">${(tracks || []).map(x => `<button onclick="pkResOk(true);lookup('${pkEsc(x)}')">${pkEsc(x)}</button>`).join('')}</div></div>
    </div>
    <button class="pk-btn ghost" style="width:100%" onclick="pkResOk()">Закрыть</button>`;
  }
  el.innerHTML = `<div class="hd"><span>${pkEsc(s ? s.name : '')}</span><small>${d} / ${t}</small></div>${body}`;
  el.classList.add('on');
  // фокус остаётся в поле сканера: следующий скан пистолетом сразу заменит этот экран
}
function pkResOk(silent) {
  document.getElementById('pkResFull').classList.remove('on');
  if (silent) return;
  if (typeof overlayOk === 'function') overlayOk();   // фокус сканера, предложение взвесить
  pkRender();
}
function pkUndo() {
  if (!pkLastOk) return pkResOk();
  let i = pkLastOk.idx;
  if (i == null || !scanned[i]) { const idx = TABLE.map((r, k) => r[0] === pkLastOk.track && scanned[k] ? k : -1).filter(k => k >= 0); i = idx.length ? idx[idx.length - 1] : null; }
  if (i != null) { delete scanned[i]; saveScanned(); updateStats(); }
  if (typeof scanHistory !== 'undefined' && scanHistory[0] && scanHistory[0].track === pkLastOk.track) { scanHistory.shift(); saveHistory(); renderHistory(); }
  pkLastOk = null;
  document.getElementById('pkResFull').classList.remove('on');
  if (typeof scanner !== 'undefined' && scanner) try { scanner.resume(); } catch (e) {}
  if (typeof showToast === 'function') showToast('Отметка отменена');
  pkRender();
}
function pkResultCard(type, track, wh, msg, tracks, fMsg) {
  const b = document.getElementById('resultBlock');
  if (type === 'already') b.innerHTML = `<div class="pk-res al"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><b>Уже отмечено · ${pkEsc(wh || '')}</b><small>${pkEsc(track)} — повторный скан, ничего не менялось</small></div></div>`;
  else if (type === 'error') b.innerHTML = `<div class="pk-res er"><i class="ti ti-circle-x" aria-hidden="true"></i><div><b>Нет в этой закупке</b><small>${pkEsc(track)} — проверьте другие закупки или код</small></div></div>`;
  else if (type === 'success') b.innerHTML = `<div class="pk-res ok"><i class="ti ti-circle-check" aria-hidden="true"></i><div><b>${pkEsc(wh || '')}</b><small>${pkEsc(track)} — отмечено</small></div></div>`;
  else b.innerHTML = '';
}

// ---------- Закупки ----------
function pkRenderShips() {
  const all = allShipments || [];
  const grp = { forming: ['forming'], road: ['transit', 'delayed'], wh: ['warehouse'], done: ['sorted', 'done'] };
  const cnt = k => all.filter(s => grp[k].includes(s.status || 'forming')).length;
  const list = pkShipFilter === 'all' ? all : all.filter(s => grp[pkShipFilter].includes(s.status || 'forming'));
  const chip = (k, l, c) => `<button type="button" class="${pkShipFilter === k ? 'on' : ''}" onclick="pkShipFilter='${k}';pkRender()">${c ? `<i class="d" style="background:${c}"></i>` : ''}${l}</button>`;
  document.getElementById('pkPane-ships').innerHTML = `
    <div class="pk-row"><h1 class="pk-h1">Закупки</h1><button class="pk-btn sm" onclick="pkNewShip()"><i class="ti ti-plus" aria-hidden="true"></i> Новая</button></div>
    <div class="pk-chips">${chip('all', 'Все ' + all.length)}${chip('forming', 'Собираются ' + cnt('forming'), '#4a90d9')}${chip('road', 'В дороге ' + cnt('road'), '#f5c518')}${chip('wh', 'На складе ' + cnt('wh'), '#3cb371')}${chip('done', 'Готовы ' + cnt('done'), '#8b7fd4')}</div>
    ${list.map(s => {
      const st = pkSt(s.status || 'forming'), n = (s.data || []).length, cur = s.id === activeShipmentId;
      let line = `${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')}`;
      let extra = '';
      if (cur && (s.status || 'forming') !== 'forming') {
        const d = Object.keys(scanned).length;
        extra = `<div class="ln"><span>сканирую · ${d} / ${TABLE.length}</span></div><div class="pk-bar"><span style="width:${TABLE.length ? Math.round(d / TABLE.length * 100) : 0}%"></span></div>`;
      }
      if ((s.status || 'forming') === 'forming') extra = `<button class="pk-btn ghost sm" onclick="event.stopPropagation();pkSetStatus('${s.id}','transit')">Закупка отправлена → «В дороге»</button>`;
      return `<div class="pk-ship ${cur ? 'cur' : ''}" onclick="pkShipSheet('${s.id}')"><span class="pk-pill" style="background:${st.color}22;color:${st.text}">● ${st.label}${cur && (s.status || 'forming') !== 'forming' ? ' · сканирую' : ''}</span><div class="nm">${pkEsc(s.name)}</div><div class="ln"><span>${line}</span><i class="ti ti-chevron-right" aria-hidden="true"></i></div>${extra}</div>`;
    }).join('') || '<div class="pk-card pk-empty">Закупок пока нет. Новые закупки появляются после импорта заказов в расширении на компьютере.</div>'}`;
}
function pkNewShip() {
  pkSheet(`<h3>Новая закупка</h3>
    <p class="pk-muted" style="font-size:14px;line-height:1.5;margin:10px 0 14px">Обычно закупка появляется сама — после импорта заказов в расширении Piksta на компьютере: треки, фото и цены приходят одной кнопкой.</p>
    <div class="pk-menu"><button onclick="pkSheetClose();openUploadModal()"><i class="ti ti-upload" aria-hidden="true"></i><span>Загрузить таблицу с треками</span></button></div>`);
}
function pkShipSheet(id) {
  const s = (allShipments || []).find(x => x.id === id); if (!s) return;
  const cur = s.status || 'forming';
  const n = (s.data || []).length;
  const order = ['forming', 'transit', 'warehouse', 'sorted', 'done'];
  let off = 0; try { off = +localStorage.getItem('pk_off_' + id) || 0; } catch (e) {}
  const act = (fn) => `pkSheetClose();loadForAction('${id}').then(()=>${fn})`;
  pkSheet(`<div class="pk-row"><div><h3>${pkEsc(s.name)}</h3><div class="pk-muted" style="font-size:14px">${pkSt(cur).label} · ${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')}</div></div><button class="pk-btn ghost sm" onclick="pkSheetClose();renameShipment('${id}')" aria-label="Переименовать"><i class="ti ti-pencil" aria-hidden="true"></i></button></div>
    <div class="pk-stat" style="margin:12px 0">${order.map(k => `<button type="button" class="${k === cur ? 'on' : ''}" onclick="pkSetStatus('${id}','${k}')">${pkSt(k).label}</button>`).join('')}</div>
    ${cur !== 'forming' ? `<button class="pk-btn" style="width:100%;margin-bottom:10px" onclick="pkScanShip('${id}')"><i class="ti ti-scan" aria-hidden="true"></i> ${id === activeShipmentId ? 'Сканирую эту закупку' : 'Сканировать эту закупку'}</button>` : ''}
    <div class="pk-tiles">
      <button onclick="${act('openWeighing()')}"><i class="ti ti-scale" aria-hidden="true"></i>Взвешивание</button>
      <button onclick="${act('openCalc()')}"><i class="ti ti-calculator" aria-hidden="true"></i>Расчёт по клиентам</button>
      <button onclick="${act('openPriceEditor()')}"><i class="ti ti-currency-yuan" aria-hidden="true"></i>Редактор цен</button>
      <button onclick="${act(`openRatesModal('${id}')`)}"><i class="ti ti-adjustments" aria-hidden="true"></i>Курсы закупки</button>
    </div>
    <div class="pk-menu" style="margin-top:10px">
      <button onclick="${act(`cacheShipmentImages('${id}')`)}"><i class="ti ${off ? 'ti-cloud-check' : 'ti-cloud-download'}" aria-hidden="true"></i><span>${off ? 'Фото скачаны · обновить' : 'Скачать фото для работы без интернета'}</span>${off ? `<small>${off}</small>` : ''}</button>
      <button onclick="pkSheetClose();exportForInventory('${id}')"><i class="ti ti-file-export" aria-hidden="true"></i><span>Выгрузить для описи</span></button>
      <button onclick="pkSheetClose();openCargoCompare('${id}')"><i class="ti ti-arrows-diff" aria-hidden="true"></i><span>Сверка с карго</span></button>
      <button onclick="${act('resetAll()')}.then(restoreActiveEditing)"><i class="ti ti-refresh" aria-hidden="true"></i><span>Сбросить отметки сканирования</span></button>
      <button class="danger" onclick="${act('deleteShipment()')}"><i class="ti ti-trash" aria-hidden="true"></i><span>Удалить закупку</span></button>
    </div>`);
}

// ---------- Клиенты ----------
function pkData() {
  if (typeof cabClientsSummary !== 'function') return null;
  cabShipmentsCache = allShipments || [];
  return cabClientsSummary();
}
function pkRenderClients() {
  const pane = document.getElementById('pkPane-clients');
  if (pkClientOpen) { pkRenderClientCard(pane, pkClientOpen); return; }
  const S = pkData();
  if (!S) { pane.innerHTML = '<div class="pk-card pk-empty">Клиенты появятся после первой закупки</div>'; return; }
  const all = S.list.filter(c => !c.isOwner).sort((a, b) => b.unpaidDue - a.unpaidDue || a.name.localeCompare(b.name, 'ru'));
  const debt = all.filter(c => c.unpaidDue > 0.005);
  const forg = all.filter(c => c.status === 'forgotten');
  let list = pkClientFilter === 'debt' ? debt : pkClientFilter === 'forg' ? forg : pkClientFilter === 'new' ? all.filter(c => c.status === 'new') : all;
  if (pkClientQuery) { const q = pkClientQuery.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(q)); }
  const chip = (k, l) => `<button type="button" class="${pkClientFilter === k ? 'on' : ''}" onclick="pkClientFilter='${k}';pkRender()">${l}</button>`;
  const stl = c => (typeof CAB_CLIENT_STATUS !== 'undefined' && CAB_CLIENT_STATUS[c.status]) ? CAB_CLIENT_STATUS[c.status].label : '';
  pane.innerHTML = `<h1 class="pk-h1">Клиенты</h1>
    <label class="pk-search"><i class="ti ti-search" aria-hidden="true"></i><input id="pkClientQ" type="search" placeholder="Имя клиента" value="${pkEsc(pkClientQuery)}" oninput="pkClientQuery=this.value;pkRenderClientsList()"></label>
    <div class="pk-chips">${chip('all', 'Все ' + all.length)}${chip('debt', 'Должны ' + debt.length)}${chip('forg', 'Забытые ' + forg.length)}${chip('new', 'Новые ' + all.filter(c => c.status === 'new').length)}</div>
    <div class="pk-list" id="pkClientList"></div>`;
  pkClientListCache = { list, stl };
  pkRenderClientsList();
}
let pkClientListCache = null;
function pkRenderClientsList() {
  if (!pkClientListCache) return;
  let { list, stl } = pkClientListCache;
  if (pkClientQuery) { const q = pkClientQuery.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(q)); }
  const el = document.getElementById('pkClientList'); if (!el) return;
  el.innerHTML = list.slice(0, 200).map(c => `<div class="pk-li pk-cl" onclick="pkOpenClient('${encodeURIComponent(c.name)}')"><span class="pk-av">${pkEsc(c.name.trim().charAt(0).toUpperCase())}</span><div><b>${pkEsc(c.name)}</b><small>${pkEsc(stl(c))} · ${c.ships.length} ${pkPl(c.ships.length, 'закупка', 'закупки', 'закупок')}</small></div><span class="r ${c.unpaidDue > 0.005 ? 'due' : 'okk'}">${c.unpaidDue > 0.005 ? pkFmt(c.unpaidDue) + ' ' + pkCur() : 'оплачено'}</span></div>`).join('') || '<div class="pk-empty">Никого не нашли</div>';
}
function pkOpenClient(enc) { pkClientOpen = decodeURIComponent(enc); pkRender(); window.scrollTo(0, 0); }
function pkRenderClientCard(pane, name) {
  const S = pkData(); const c = S && S.list.find(x => x.name === name);
  if (!c) { pkClientOpen = null; pkRenderClients(); return; }
  const stl = (typeof CAB_CLIENT_STATUS !== 'undefined' && CAB_CLIENT_STATUS[c.status]) ? CAB_CLIENT_STATUS[c.status].label : '';
  const debts = c.ships.filter(x => cabIsBilled(x.ship) && x.c.payRest > 0.005);
  const encN = encodeURIComponent(name);
  // что заказала сейчас: позиции из незакрытых закупок
  const items = [];
  for (const x of c.ships) {
    if (x.ship.status === 'done') continue;
    for (const row of (x.ship.data || [])) {
      const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
      if (splitWarehouses(r[1] || '').some(p => p.toLowerCase() === name.toLowerCase())) items.push({ r, ship: x.ship });
      if (items.length >= 30) break;
    }
  }
  const totalBought = c.totalDue;
  pane.innerHTML = `<button class="pk-btn ghost sm" style="align-self:flex-start" onclick="pkClientOpen=null;pkRender()"><i class="ti ti-chevron-left" aria-hidden="true"></i> Клиенты</button>
    <div class="pk-me"><span class="pk-av" style="width:52px;height:52px;border-radius:26px;font-size:20px">${pkEsc(name.trim().charAt(0).toUpperCase())}</span><div><h1 class="pk-h1" style="font-size:22px">${pkEsc(name)}</h1><div class="pk-muted" style="font-size:14px">${pkEsc(stl)} · ${c.ships.length} ${pkPl(c.ships.length, 'закупка', 'закупки', 'закупок')}</div></div></div>
    ${debts.map(x => `<div class="pk-card" style="border-color:var(--pk-due);background:var(--pk-due-soft)"><div class="pk-row" style="align-items:flex-end"><span style="min-width:0"><small class="pk-muted" style="display:block;font-size:13px">Долг за закупку</small><b>${pkEsc(x.ship.name)}</b></span><b style="font-size:22px;color:var(--pk-due);white-space:nowrap">${pkFmt(x.c.payRest)} ${pkCur()}</b></div>
      <div class="pk-row" style="margin-top:10px;gap:8px"><button class="pk-btn ok" style="flex:1" onclick="pkMarkPaid('${x.ship.id}','${encN}',${x.c.due})"><i class="ti ti-check" aria-hidden="true"></i> Оплатила</button><button class="pk-btn ghost" style="flex:1" onclick="pkRemind('${encN}',${Math.round(x.c.payRest * 100) / 100},'${encodeURIComponent(x.ship.name)}')"><i class="ti ti-copy" aria-hidden="true"></i> Напомнить</button></div>
      <div class="pk-muted" style="font-size:12px;margin-top:8px">«Напомнить» копирует вежливое сообщение — вставьте в переписку</div></div>`).join('')}
    ${!debts.length ? `<div class="pk-card pk-row"><span>Долгов нет</span><b style="color:var(--pk-ok)">оплачено</b></div>` : ''}
    <div class="pk-lbl">Что заказала сейчас</div>
    <div class="pk-list">${items.map(({ r, ship }) => `<div class="pk-li"><span class="ph" ${r[2] ? `style="background-image:url('${pkEsc(r[2])}')"` : ''}></span><div><b style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${pkEsc(r[0])}</b><small>${pkEsc(ship.name)} · ${pkSt(ship.status || 'forming').label}</small></div><span class="r">${(parseInt(r[5] || '1', 10) || 1) > 1 ? '×' + r[5] : ''}</span></div>`).join('') || '<div class="pk-empty">Сейчас ничего не заказано</div>'}</div>
    <div class="pk-2"><div class="pk-card"><small>Всего купила</small><b>${pkFmt(totalBought)} ${pkCur()}</b></div><div class="pk-card"><small>Позиций</small><b>${c.totalItems}</b></div></div>`;
}
async function pkMarkPaid(shipId, enc, due) {
  try { await cabCardSetPaid(shipId, enc, String(due)); } catch (e) { alert('Не удалось сохранить: ' + e.message); return; }
  if (typeof showToast === 'function') showToast('Оплата отмечена');
  pkRender();
}
function pkRemind(enc, sum, encShip) {
  const name = decodeURIComponent(enc).split(/[\s(]/)[0];
  const txt = `${name}, здравствуйте! Напоминаю про оплату за ${decodeURIComponent(encShip)}: ${pkFmt(sum)} ${pkCur()}. Если уже оплатили — спасибо, напишите, я отмечу.`;
  const done = () => { if (typeof showToast === 'function') showToast('Сообщение скопировано'); };
  try { navigator.clipboard.writeText(txt).then(done, () => prompt('Скопируйте сообщение:', txt)); } catch (e) { prompt('Скопируйте сообщение:', txt); }
}

// ---------- Деньги ----------
function pkRenderMoney() {
  const pane = document.getElementById('pkPane-money');
  const S = pkData();
  if (!S) { pane.innerHTML = '<div class="pk-card pk-empty">Нет данных</div>'; return; }
  const all = S.list.filter(c => !c.isOwner);
  const debtors = all.filter(c => c.unpaidDue > 0.005).sort((a, b) => b.unpaidDue - a.unpaidDue);
  const unpaid = debtors.reduce((n, c) => n + c.unpaidDue, 0);
  let dueB = 0, paidB = 0;
  for (const s of (allShipments || [])) { if (!cabIsBilled(s)) continue; const { clients } = cabGetClientsFromShipment(s); for (const c of clients) { if (c.isOwner) continue; dueB += c.due; paidB += Math.min(c.due, c.payPaid || 0); } }
  const pct = dueB > 0 ? Math.round(paidB / dueB * 100) : 0;
  const M = typeof cabMoney === 'function' ? cabMoney(allShipments || []) : { frozen: 0, realized: 0, nShips: 0 };
  pane.innerHTML = `<h1 class="pk-h1">Деньги</h1>
    <div class="pk-money"><span style="font-size:14px;opacity:.85">Должны вам · ${debtors.length} ${pkPl(debtors.length, 'клиент', 'клиента', 'клиентов')}</span><div class="v">${pkFmt(unpaid)} <small>${pkCur()}</small></div><div class="pk-bar"><span style="width:${pct}%"></span></div><span style="font-size:13px;opacity:.85">Собрано ${pct}% по рассортированным закупкам</span></div>
    <div class="pk-2"><div class="pk-card"><small>Вложено в товар</small><b>${pkFmt(M.frozen)} ${pkCur()}</b><small>ждёт оплаты клиентов</small></div><div class="pk-card"><small>Получено прибыли</small><b style="color:var(--pk-ok)">${pkFmt(M.realized)} ${pkCur()}</b><small>уже заплатили</small></div></div>
    <div class="pk-row"><span class="pk-lbl">Кто должен</span><span class="pk-muted" style="font-size:12px">по сумме</span></div>
    <div class="pk-list">${debtors.slice(0, 50).map(c => {
      const x = c.ships.filter(y => cabIsBilled(y.ship) && y.c.payRest > 0.005).sort((a, b) => b.c.payRest - a.c.payRest)[0];
      const enc = encodeURIComponent(c.name);
      return `<div class="pk-li pk-cl" onclick="pkGo('clients');pkOpenClient('${enc}')"><span class="pk-av">${pkEsc(c.name.trim().charAt(0).toUpperCase())}</span><div><b>${pkEsc(c.name)}</b><small>${x ? pkEsc(x.ship.name) : ''}</small></div><span class="r due">${pkFmt(c.unpaidDue)} ${pkCur()}</span></div>`;
    }).join('') || '<div class="pk-empty">Все оплатили</div>'}</div>
    <p class="pk-muted" style="font-size:13px;text-align:center;margin:4px 0 0">Графики и аналитика — в Кабинете на компьютере</p>`;
}

// ---------- Ещё ----------
function pkRenderMore() {
  const name = (userProfile && userProfile.name) || (currentUser && currentUser.email) || '';
  const isAdmin = userProfile && userProfile.role === 'admin';
  const skin = pkSkin();
  const pv = { compact: '<i></i><i class="a"></i><i></i>', lenta: '<i class="a" style="height:8px;width:60%"></i><i></i><i></i><i></i>', bottom: '<i></i><i></i><i style="flex:1;background:none"></i><i class="a"></i>' };
  let off = 0; try { off = +localStorage.getItem('pk_off_' + activeShipmentId) || 0; } catch (e) {}
  document.getElementById('pkPane-more').innerHTML = `<h1 class="pk-h1">Ещё</h1>
    <div class="pk-card pk-me" onclick="openProfile()" style="cursor:pointer"><span class="pk-av" style="width:48px;height:48px;border-radius:24px">${pkEsc(document.getElementById('pkAva').textContent)}</span><div style="flex:1;min-width:0"><b style="display:block">${pkEsc(name)}</b><small class="pk-muted">${isAdmin ? 'Администратор' : 'Профиль, пароль, валюта'}</small></div><i class="ti ti-chevron-right" aria-hidden="true"></i></div>
    <div class="pk-lbl">Вид сканера</div>
    <div class="pk-skins">${PK_SKINS.map(([k, l]) => `<button type="button" class="pk-skin ${skin === k ? 'on' : ''}" onclick="pkSetSkin('${k}')" aria-pressed="${skin === k}"><span class="pv">${pv[k]}</span><span>${l}</span></button>`).join('')}</div>
    <div class="pk-menu">
      <button onclick="${activeShipmentId ? `cacheShipmentImages('${activeShipmentId}')` : ''}"><i class="ti ${off ? 'ti-cloud-check' : 'ti-cloud-download'}" aria-hidden="true"></i><span>Фото для работы без интернета</span><small>${off ? 'скачаны · ' + off : 'текущая закупка'}</small></button>
      <button onclick="pkTheme()"><i class="ti ti-moon" aria-hidden="true"></i><span>Тёмная тема</span><small>${document.body.classList.contains('dark') ? 'вкл' : 'выкл'}</small></button>
      <button onclick="pkToCabinet('tariff')"><i class="ti ti-receipt" aria-hidden="true"></i><span>Тариф и оплата</span></button>
      <button onclick="pkHelp()"><i class="ti ti-help-circle" aria-hidden="true"></i><span>Помощь и связь</span></button>
      <button onclick="pkToCabinet()"><i class="ti ti-device-desktop" aria-hidden="true"></i><span>Полный Кабинет<br><small>цены, взвешивание, аналитика — удобнее на компьютере</small></span></button>
      ${isAdmin ? `<button onclick="pkToCabinet('admin')"><i class="ti ti-shield" aria-hidden="true"></i><span>Админ</span></button>` : ''}
    </div>
    <button class="pk-btn ghost" style="color:var(--pk-bad)" onclick="doLogout()">Выйти</button>`;
}
function pkTheme() {
  const cb = document.getElementById('themeToggle');
  if (cb) { cb.checked = !document.body.classList.contains('dark'); try { toggleTheme(); } catch (e) { document.body.classList.toggle('dark', cb.checked); } }
  else document.body.classList.toggle('dark');
  pkRender();
}
function pkToCabinet(section) {
  document.getElementById('appScreen').classList.add('hide');
  enterMode('cabinet');
  if (section) setTimeout(() => { try { cabNav(section); } catch (e) {} }, 400);
}
function pkHelp() {
  const cb = document.querySelector('.contact-banner');
  pkSheet(`<h3>Помощь и связь</h3><div style="margin-top:12px">${cb ? cb.innerHTML : ''}</div>`);
}

// ---------- шторка ----------
function pkSheet(html) {
  const sh = document.getElementById('pkSheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  document.getElementById('pkSheetBg').classList.add('on');
  requestAnimationFrame(() => sh.classList.add('on'));
}
function pkSheetClose() {
  const sh = document.getElementById('pkSheet'), bg = document.getElementById('pkSheetBg');
  if (sh) sh.classList.remove('on'); if (bg) bg.classList.remove('on');
}

// ---------- подключение к app.js ----------
(function () {
  const wrap = (name, after, before) => {
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function () {
      if (before) { const r = before.apply(this, arguments); if (r === false) return; }
      const res = orig.apply(this, arguments);
      if (after) { if (res && typeof res.then === 'function') res.then(() => after.apply(this, arguments)); else after.apply(this, arguments); }
      return res;
    };
  };
  wrap('enterMode', (mode) => { if (mode === 'scanner') pkActivate(); else pkDeactivate(); });
  wrap('renderShipmentCards', () => pkRender());
  wrap('updateStats', () => { if (pkTab === 'scan') pkRender(); });
  wrap('renderHistory', () => { if (pkTab === 'scan') pkRender(); });
  // замок: у собирающейся закупки сканирование выключено
  wrap('lookup', null, () => {
    if (pkIsOn() && pkLocked()) { if (typeof showToast === 'function') showToast('Закупка ещё собирается — сканировать можно, когда посылки приедут'); return false; }
    pkPrevKeys = new Set(Object.keys(scanned));
  });
  // результат скана — новый экран без эмодзи
  const origOverlay = window.showOverlay;
  window.showOverlay = function (type, track, wh, tracks, fMsg) {
    if (!pkIsOn()) return origOverlay.apply(this, arguments);
    pkShowScanResult(type, track, wh, tracks, fMsg);
  };
  const origResult = window.showResult;
  window.showResult = function (type, track, wh, msg, tracks, fMsg) {
    if (!pkIsOn()) return origResult.apply(this, arguments);
    if (type === 'success') { pkNewIdx = null; for (const k of Object.keys(scanned)) if (!pkPrevKeys || !pkPrevKeys.has(k)) pkNewIdx = +k; }
    if (type === 'success' || type === 'multi' || type === 'fuzzy') pkShowScanResult(type, track, wh, tracks, fMsg);
    else { const rf = document.getElementById('pkResFull'); if (rf && rf.classList.contains('on')) { rf.classList.remove('on'); if (scanner) try { scanner.resume(); } catch (e) {} } }
    pkResultCard(type, track, wh, msg, tracks, fMsg);
  };
})();

// если приложение уже открыто в режиме сканера к моменту загрузки этого файла
if (document.getElementById('appScreen') && !document.getElementById('appScreen').classList.contains('hide')) pkActivate();
