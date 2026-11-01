// Piksta — мобильная версия (сканер + карманный Кабинет). Работает поверх app.js и cabinet.js, их логику не меняет.
// Вкладки: Сканер · Закупки · Клиенты · Деньги · Ещё. Скины: compact (по умолчанию), lenta, bottom.
let pkTab = 'ships';   // по умолчанию — Закупки (01.11)
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
  top.innerHTML = `<div class="pk-brand"><img src="/icons/icon-72x72.png" alt="">Piksta</div><div class="pk-top-r"><button type="button" class="pk-cab" onclick="pkToCabinet()" title="Перейти в Кабинет (версия для компьютера)"><i class="ti ti-device-desktop" aria-hidden="true"></i>Кабинет</button><button class="pk-ava" id="pkAva" onclick="pkGo('more')" aria-label="Ещё"></button></div>`;
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
  tabs.innerHTML = '<div class="in">' + [['ships', 'ti-package', 'Закупки'], ['clients', 'ti-users', 'Клиенты'], ['scan', 'ti-scan', 'Сканер'], ['money', 'ti-wallet', 'Деньги'], ['more', 'ti-layout-grid', 'Ещё']]
    .map(([k, ic, l]) => `<button type="button" id="pkT-${k}" data-t="${k}"${k === 'scan' ? ' class="pk-c"' : ''} onclick="pkGo('${k}')"><i class="ti ${ic}" aria-hidden="true"></i>${l}</button>`).join('') + '</div>';
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
      ${row && row[6] ? `<div class="pnm">${pkEsc(row[6])}</div>` : ''}
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
let pkShipQuery = '';
function pkShipSearch() {
  const box = document.getElementById('pkShipRes'); if (!box || typeof cabFindTracks !== 'function') return;
  cabShipmentsCache = allShipments || [];
  const R = cabFindTracks(pkShipQuery);
  if (R.q.length < 3) { box.innerHTML = R.q ? '<div class="pk-empty">Введите хотя бы 3 символа</div>' : ''; return; }
  if (!R.list.length) { box.innerHTML = `<div class="pk-card pk-empty">Не нашли «${pkEsc(R.q)}» в закупках. Архив не проверяем.</div>`; return; }
  const show = R.list.slice(0, 30);
  box.innerHTML = `<div class="pk-lbl">${R.fuzzy ? 'Точно такого нет · похожие' : 'Найдено'}: ${R.list.length}${R.list.length > show.length ? ' · уточните запрос' : ''}</div>
    <div class="pk-list">${show.map(x => {
      const st = pkSt(x.ship.status || 'forming'), q = parseInt(x.r[5]) || 1;
      return `<div class="pk-li" onclick="pkShipSheet('${x.ship.id}')"><span class="ph" ${x.r[2] ? `style="background-image:url('${pkEsc(x.r[2])}')"` : ''}></span><div><b style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${cabTrackMark(x.r[0], R.fuzzy ? '' : R.q)}${q > 1 ? ' ×' + q : ''}</b><small>${pkEsc(x.ship.name)} · <span style="color:${st.text}">${st.label}</span></small></div><span class="r" style="color:var(--pk-acc);font-weight:700;max-width:40vw;overflow:hidden;text-overflow:ellipsis">${pkEsc((x.r[1] || '').trim() || '—')}</span></div>`;
    }).join('')}</div>`;
}
function pkRenderShips() {
  const hadFocus = document.activeElement && document.activeElement.id === 'pkShipQ';
  const all = allShipments || [];
  const grp = { forming: ['forming'], road: ['transit', 'delayed'], wh: ['warehouse'], done: ['sorted', 'done'] };
  const cnt = k => all.filter(s => grp[k].includes(s.status || 'forming')).length;
  const list = pkShipFilter === 'all' ? all : all.filter(s => grp[pkShipFilter].includes(s.status || 'forming'));
  const chip = (k, l, c) => `<button type="button" class="${pkShipFilter === k ? 'on' : ''}" onclick="pkShipFilter='${k}';pkRender()">${c ? `<i class="d" style="background:${c}"></i>` : ''}${l}</button>`;
  document.getElementById('pkPane-ships').innerHTML = `
    <div class="pk-row"><h1 class="pk-h1">Закупки</h1><button class="pk-btn sm" onclick="pkNewShip()"><i class="ti ti-plus" aria-hidden="true"></i> Новая</button></div>
    <label class="pk-search"><i class="ti ti-search" aria-hidden="true"></i><input id="pkShipQ" type="search" autocomplete="off" spellcheck="false" placeholder="Найти посылку по трек-коду" value="${pkEsc(pkShipQuery)}" oninput="pkShipQuery=this.value;pkShipSearch()"></label>
    <div id="pkShipRes"></div>
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
      if (typeof cabShipPayState === 'function') { cabShipmentsCache = allShipments || []; const ps = cabShipPayState(s); if (ps.text) line += ` · <b style="color:${ps.kind === 'ok' ? 'var(--pk-ok)' : ps.kind === 'due' ? 'var(--pk-due)' : 'var(--pk-acc)'}">${ps.text}</b>`; }
      return `<div class="pk-ship ${cur ? 'cur' : ''}" onclick="pkShipSheet('${s.id}')"><span class="pk-pill" style="background:${st.color}22;color:${st.text}">● ${st.label}${cur && (s.status || 'forming') !== 'forming' ? ' · сканирую' : ''}</span><div class="nm">${pkEsc(s.name)}</div><div class="ln"><span>${line}</span><i class="ti ti-chevron-right" aria-hidden="true"></i></div>${extra}</div>`;
    }).join('') || '<div class="pk-card pk-empty">Закупок пока нет. Новые закупки появляются после импорта заказов в расширении на компьютере.</div>'}`;
  pkShipSearch();
  if (hadFocus) { const i = document.getElementById('pkShipQ'); if (i) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (e) {} } }
}
// Телефон или компьютер: расширение Chrome ставится только на компьютере
function pkIsPhone() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
function pkNewShip() {
  const phone = pkIsPhone();
  const opt = (ic, t, sub, fn) => `<button onclick="${fn}"><i class="ti ${ic}" aria-hidden="true"></i><span><b style="display:block;font-weight:600">${t}</b><small class="pk-muted" style="display:block;font-size:13px;font-weight:400;line-height:1.35;margin-top:2px">${sub}</small></span></button>`;
  pkSheet(`<h3>Новая закупка</h3>
    <p class="pk-muted" style="font-size:14px;line-height:1.5;margin:10px 0 14px">Обычно закупка появляется сама — после импорта заказов в расширении Piksta на компьютере: треки, фото и цены приходят одной кнопкой.</p>
    <div class="pk-menu">
      ${phone
        ? opt('ti-file-type-pdf', 'Через расширение Piksta в Chrome', 'Ставится только на компьютер. Откроется инструкция PDF и ссылка для компьютера', "pkSheetClose();location.href='/extension'")
        : opt('ti-puzzle', 'Через расширение Piksta в Chrome', 'Откроется страница с инструкцией и последней версией расширения', "pkSheetClose();window.open('/extension','_blank')")}
      ${opt('ti-upload', 'Загрузить таблицу с треками', 'Файл Excel или CSV от карго', 'pkSheetClose();openUploadModal()')}
      ${opt('ti-pencil-plus', 'Создать вручную', 'Название закупки, треки добавите сами', 'pkSheetClose();pkNewManual()')}
    </div>`);
}
const PK_ST_HINT = { forming: 'собираете заказы, сканер выключен', transit: 'карго везёт посылки', delayed: 'посылки задерживаются в пути', warehouse: 'приехало — сканируете и раскладываете', sorted: 'всё разложено по клиентам, ждём оплаты', done: 'закрыта: выдано и оплачено' };
function pkShipSheet(id) {
  const s = (allShipments || []).find(x => x.id === id); if (!s) return;
  const cur = s.status || 'forming';
  const n = (s.data || []).length;
  const cl = new Set();
  for (const row of (s.data || [])) { const w = Array.isArray(row) ? row[1] : row.w; for (const p of (typeof splitWarehouses === 'function' ? splitWarehouses(w || '') : [w])) if (p && p.trim()) cl.add(p.trim().toLowerCase()); }
  const order = ['forming', 'transit', 'warehouse', 'sorted', 'done'];
  if (cur === 'delayed') order.splice(2, 0, 'delayed');
  let off = 0; try { off = +localStorage.getItem('pk_off_' + id) || 0; } catch (e) {}
  const act = (fn) => `pkSheetClose();loadForAction('${id}').then(()=>${fn})`;
  const st = pkSt(cur);
  pkSheet(`<div class="pk-row" style="align-items:flex-start"><div style="min-width:0"><h3>${pkEsc(s.name)}</h3><div class="pk-muted" style="font-size:14px">${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')} · ${cl.size} ${pkPl(cl.size, 'клиент', 'клиента', 'клиентов')}</div></div><button class="pk-btn ghost sm" onclick="pkSheetClose();renameShipment('${id}')" aria-label="Переименовать закупку"><i class="ti ti-pencil" aria-hidden="true"></i></button></div>
    <button type="button" class="pk-stsel" id="pkStSel" onclick="this.classList.toggle('open')" aria-haspopup="listbox"><span class="l">Статус</span><span class="v"><i class="d" style="background:${st.color}"></i>${pkEsc(st.label)}</span><i class="ti ti-chevron-down cv" aria-hidden="true"></i></button>
    <div class="pk-stlist" role="listbox">${order.map(k => `<button type="button" role="option" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}" onclick="pkSetStatus('${id}','${k}')"><i class="d" style="background:${pkSt(k).color}"></i><span><b>${pkSt(k).label}</b><small>${PK_ST_HINT[k] || ''}</small></span>${k === cur ? '<i class="ti ti-check ck" aria-hidden="true"></i>' : ''}</button>`).join('')}</div>
    ${cur !== 'forming'
      ? `<button class="pk-btn" style="width:100%" onclick="pkScanShip('${id}')"><i class="ti ti-scan" aria-hidden="true"></i> ${id === activeShipmentId ? 'Сканирую эту закупку' : 'Сканировать эту закупку'}</button>`
      : `<button class="pk-btn ghost" style="width:100%" onclick="pkSetStatus('${id}','transit')"><i class="ti ti-truck" aria-hidden="true"></i> Закупка отправлена → «В дороге»</button>`}
    <button type="button" class="pk-main-act" onclick="${act('openPriceEditor()')}"><span class="ic"><i class="ti ti-list-details" aria-hidden="true"></i></span><span><b>Позиции закупки</b><small>треки, названия, клиенты, цены</small></span><i class="ti ti-chevron-right ch" aria-hidden="true"></i></button>
    <div class="pk-tiles2">
      <button onclick="${act('openWeighing()')}"><i class="ti ti-scale" aria-hidden="true"></i>Взвешивание</button>
      <button onclick="${act('openCalc()')}"><i class="ti ti-calculator" aria-hidden="true"></i>Расчёт по клиентам</button>
    </div>
    <div class="pk-menu">
      <button onclick="pkSheetClose();openCargoCompare('${id}')"><i class="ti ti-arrows-diff" aria-hidden="true"></i><span>Сверка с карго</span></button>
      <button onclick="${act(`cacheShipmentImages('${id}')`)}"><i class="ti ${off ? 'ti-cloud-check' : 'ti-cloud-download'}" aria-hidden="true"></i><span>${off ? 'Фото скачаны · обновить' : 'Скачать фото для работы без интернета'}</span>${off ? `<small>${off}</small>` : ''}</button>
      <button onclick="pkSheetClose();exportForInventory('${id}')"><i class="ti ti-file-export" aria-hidden="true"></i><span>Выгрузить для описи</span></button>
      <button onclick="${act(`openRatesModal('${id}')`)}"><i class="ti ti-adjustments" aria-hidden="true"></i><span>Курсы закупки<small class="pk-muted" style="display:block;font-size:12.5px">настройки этой закупки</small></span></button>
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
      const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1', row.n || ''];
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
    <div class="pk-list">${items.map(({ r, ship }) => `<div class="pk-li"><span class="ph" ${r[2] ? `style="background-image:url('${pkEsc(r[2])}')"` : ''}></span><div><b style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${pkEsc(r[0])}</b><small>${r[6] ? pkEsc(r[6]) + ' · ' : ''}${pkEsc(ship.name)} · ${pkSt(ship.status || 'forming').label}</small></div><span class="r">${(parseInt(r[5] || '1', 10) || 1) > 1 ? '×' + r[5] : ''}</span></div>`).join('') || '<div class="pk-empty">Сейчас ничего не заказано</div>'}</div>
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
      <button onclick="if(pkIsPhone())location.href='/extension';else window.open('/extension','_blank')"><i class="ti ti-puzzle" aria-hidden="true"></i><span>Расширение Piksta для Chrome<br><small>скачать и инструкция · ставится на компьютер</small></span></button>
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

// ---------- Закупка вручную (01.11.2026) ----------
// «+ Новая» → «Создать вручную» → название → экран «Позиции закупки»: трек (обязательно), фото, название 1–3 слова, клиент, выкуп ¥.
// Фото сжимаются до 240 px и хранятся прямо в закупке (data:URL) — Storage не нужен. Черновик держим в localStorage.
let pkMan = null, pkManScan = null;
const PK_MAN_KEY = 'pk_manual_draft';
function pkManSaveDraft() { try { if (pkMan && pkMan.items.length) localStorage.setItem(PK_MAN_KEY, JSON.stringify(pkMan)); else localStorage.removeItem(PK_MAN_KEY); } catch (e) {} }
function pkManDraft() { try { const d = JSON.parse(localStorage.getItem(PK_MAN_KEY) || 'null'); return d && d.items && d.items.length ? d : null; } catch (e) { return null; } }
function pkNewManual() {
  const dr = pkManDraft();
  const def = 'Отправка ' + new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  pkSheet(`<h3>Новая закупка вручную</h3>
    ${dr ? `<div class="pk-card" style="margin:12px 0 0;background:var(--pk-warn-soft);border-color:transparent;font-size:14px;line-height:1.45">Есть несохранённый черновик «${pkEsc(dr.name)}» — ${dr.items.length} ${pkPl(dr.items.length, 'позиция', 'позиции', 'позиций')}.<button class="pk-btn sm" style="margin-top:8px;width:100%" onclick="pkSheetClose();pkManOpen(null,true)">Продолжить черновик</button></div>` : ''}
    <label class="pk-man-l" for="pkManName" style="margin-top:14px">Название</label>
    <input id="pkManName" class="pk-man-i" value="${pkEsc(def)}" autocomplete="off" onkeydown="if(event.key==='Enter')pkManStart()">
    <div class="pk-muted" style="font-size:13px;margin:6px 0 14px">Можно оставить как есть — дата подставляется сама.</div>
    <button class="pk-btn" style="width:100%" onclick="pkManStart()">Дальше — добавить товары <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
    <button class="pk-btn ghost" style="width:100%;margin-top:8px" onclick="pkSheetClose()">Отмена</button>`);
  setTimeout(() => { const i = document.getElementById('pkManName'); if (i) { i.focus(); i.select(); } }, 250);
}
function pkManStart() {
  const v = (document.getElementById('pkManName') || {}).value || '';
  pkSheetClose();
  pkManOpen(v.trim() || ('Отправка ' + new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })), false);
}
function pkManOpen(name, fromDraft) {
  pkMan = fromDraft ? pkManDraft() : { name, items: [] };
  if (!pkMan) return;
  pkMan.edit = null; pkMan.img = '';
  if (fromDraft) try { localStorage.removeItem(PK_MAN_KEY); } catch (e) {}
  let el = document.getElementById('pkMan');
  if (!el) { el = document.createElement('div'); el.id = 'pkMan'; el.className = 'pk-man'; el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
  el.innerHTML = `
    <div class="pk-man-top"><button type="button" class="pk-man-bk" onclick="pkManBack()" aria-label="Назад"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
      <div class="tt"><b>${pkEsc(pkMan.name)}</b><span id="pkManCnt"></span></div></div>
    <div class="pk-man-body">
      <div class="pk-card pk-man-form" id="pkManForm">
        <div><label class="pk-man-l" for="pkManT">Трек-номер <span style="color:#ea580c">*</span></label>
          <div class="pk-man-tr"><input id="pkManT" class="pk-man-i mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Введите или отсканируйте" onkeydown="if(event.key==='Enter'){event.preventDefault();pkManNext('pkManP')}">
          <button type="button" class="pk-man-sc" onclick="pkManScanStart()" aria-label="Сканировать штрих-код"><i class="ti ti-scan" aria-hidden="true"></i></button></div>
          <div id="pkManCam" class="pk-man-cam" style="display:none"><div id="pkManReader"></div><button type="button" class="pk-btn ghost sm" onclick="pkManScanStop()">Закрыть камеру</button></div>
          <div class="pk-man-err" id="pkManErr"></div></div>
        <div class="pk-man-row">
          <label class="pk-man-ph" id="pkManPh"><input type="file" accept="image/*" onchange="pkManPhoto(this)" hidden><span id="pkManPhIn"></span></label>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px">
            <div><label class="pk-man-l" for="pkManN">Название <span class="pk-muted" style="font-weight:400">· 1–3 слова, по желанию</span></label><input id="pkManN" class="pk-man-i sm" maxlength="40" autocomplete="off" placeholder="напр. платье синее" onkeydown="if(event.key==='Enter'){event.preventDefault();pkManNext('pkManP')}"></div>
            <div><label class="pk-man-l" for="pkManP">Выкуп ¥</label><input id="pkManP" class="pk-man-i sm b" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" onkeydown="if(event.key==='Enter'){event.preventDefault();pkManNext('pkManW')}"></div>
          </div></div>
        <div><label class="pk-man-l" for="pkManW">Клиент</label><input id="pkManW" class="pk-man-i" autocomplete="off" placeholder="Кому этот товар" oninput="pkManHints()" onkeydown="if(event.key==='Enter'){event.preventDefault();pkManAdd()}">
          <div class="pk-man-chips" id="pkManChips"></div></div>
        <button type="button" class="pk-btn" id="pkManAddB" onclick="pkManAdd()"></button>
        <button type="button" class="pk-btn ghost" id="pkManDelB" style="display:none;color:var(--pk-bad)" onclick="pkManDel()"><i class="ti ti-trash" aria-hidden="true"></i> Удалить позицию</button>
      </div>
      <div class="pk-man-lh"><span id="pkManLh"></span><span id="pkManSumTop"></span></div>
      <div class="pk-man-list" id="pkManList"></div>
    </div>
    <div class="pk-man-foot"><div class="sum"><span id="pkManSumL"></span><b id="pkManSumR"></b></div>
      <button type="button" class="pk-btn ok" id="pkManSave" onclick="pkManSave()"><i class="ti ti-check" aria-hidden="true"></i> Сохранить закупку</button></div>`;
  document.body.classList.add('pk-man-on');
  requestAnimationFrame(() => el.classList.add('on'));
  pkManForm(); pkManRender();
  setTimeout(() => { const t = document.getElementById('pkManT'); if (t && !('ontouchstart' in window)) t.focus(); }, 250);
}
function pkManNext(id) { const i = document.getElementById(id); if (i) i.focus(); }
// клиенты из всех закупок — по частоте
function pkManClients() {
  const cnt = {};
  for (const s of (allShipments || [])) for (const r of (s.data || [])) { const w = String((Array.isArray(r) ? r[1] : r.w) || '').trim(); if (w) cnt[w] = (cnt[w] || 0) + 1; }
  for (const it of (pkMan ? pkMan.items : [])) if (it.w) cnt[it.w] = (cnt[it.w] || 0) + 3;
  return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
}
function pkManHints() {
  const box = document.getElementById('pkManChips'); if (!box) return;
  const q = (document.getElementById('pkManW').value || '').trim().toLowerCase();
  const all = pkManClients();
  const list = (q ? all.filter(n => n.toLowerCase().includes(q) && n.toLowerCase() !== q) : all).slice(0, 6);
  box.innerHTML = list.map(n => `<button type="button" onclick="pkManPick(decodeURIComponent('${encodeURIComponent(n).replace(/'/g, '%27')}'))">${pkEsc(n)}</button>`).join('');
}
function pkManPick(n) { const i = document.getElementById('pkManW'); i.value = n; pkManHints(); }
function pkManPhoto(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const M = 240, k = Math.min(1, M / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    pkMan.img = c.toDataURL('image/jpeg', 0.62); URL.revokeObjectURL(url); inp.value = ''; pkManPhView();
  };
  img.onerror = () => { URL.revokeObjectURL(url); showToast('Не удалось открыть фото'); };
  img.src = url;
}
function pkManPhView() {
  const box = document.getElementById('pkManPhIn'), ph = document.getElementById('pkManPh');
  if (pkMan.img) { ph.style.backgroundImage = `url('${pkMan.img}')`; ph.classList.add('has'); box.innerHTML = `<button type="button" class="x" onclick="event.preventDefault();event.stopPropagation();pkMan.img='';pkManPhView()" aria-label="Убрать фото"><i class="ti ti-x" aria-hidden="true"></i></button>`; }
  else { ph.style.backgroundImage = ''; ph.classList.remove('has'); box.innerHTML = '<i class="ti ti-camera-plus" aria-hidden="true"></i>Фото<small>по желанию</small>'; }
}
// заполнить форму (новая позиция или правка)
function pkManForm() {
  const it = pkMan.edit != null ? pkMan.items[pkMan.edit] : null;
  document.getElementById('pkManT').value = it ? it.t : '';
  document.getElementById('pkManN').value = it ? (it.n || '') : '';
  document.getElementById('pkManP').value = it ? (it.p || '') : '';
  document.getElementById('pkManW').value = it ? (it.w || '') : '';
  pkMan.img = it ? (it.img || '') : '';
  document.getElementById('pkManErr').textContent = '';
  document.getElementById('pkManAddB').innerHTML = it ? '<i class="ti ti-check" aria-hidden="true"></i> Сохранить изменения' : '<i class="ti ti-plus" aria-hidden="true"></i> Добавить позицию';
  document.getElementById('pkManDelB').style.display = it ? '' : 'none';
  document.getElementById('pkManForm').classList.toggle('edit', !!it);
  pkManPhView(); pkManHints();
}
function pkManNorm(t) { return String(t || '').toLowerCase().replace(/\s+/g, ''); }
function pkManAdd() {
  const t = (document.getElementById('pkManT').value || '').replace(/\s+/g, '').trim();
  const err = document.getElementById('pkManErr');
  if (!t) { err.textContent = 'Впишите трек-номер — без него товар не найти при сканировании'; document.getElementById('pkManT').focus(); return; }
  const dup = pkMan.items.findIndex((x, i) => i !== pkMan.edit && pkManNorm(x.t) === pkManNorm(t));
  if (dup >= 0) { err.textContent = 'Такой трек уже есть в этой закупке'; document.getElementById('pkManT').focus(); return; }
  const p = String(document.getElementById('pkManP').value || '').replace(',', '.').trim();
  const it = { t, n: (document.getElementById('pkManN').value || '').trim(), p: p && !isNaN(+p) ? String(+p) : '', w: (document.getElementById('pkManW').value || '').trim(), img: pkMan.img || '' };
  const size = JSON.stringify(pkMan.items).length + JSON.stringify(it).length;
  if (size > 850000) { err.textContent = 'Закупка слишком большая: уберите фото у части товаров или создайте ещё одну закупку'; return; }
  if (pkMan.edit != null) { pkMan.items[pkMan.edit] = it; pkMan.edit = null; showToast('Изменения сохранены'); }
  else pkMan.items.unshift(it);
  pkManSaveDraft(); pkManForm(); pkManRender();
  document.getElementById('pkManT').focus();
}
function pkManEdit(i) { pkMan.edit = i; pkManForm(); document.querySelector('#pkMan .pk-man-body').scrollTo({ top: 0, behavior: 'smooth' }); }
function pkManDel() {
  if (pkMan.edit == null) return;
  pkMan.items.splice(pkMan.edit, 1); pkMan.edit = null;
  pkManSaveDraft(); pkManForm(); pkManRender(); showToast('Позиция удалена');
}
function pkManRender() {
  const its = pkMan.items, n = its.length;
  const sum = its.reduce((a, x) => a + (+x.p || 0), 0), cl = new Set(its.map(x => x.w).filter(Boolean)).size;
  const fy = v => '¥ ' + (Math.round(v * 100) / 100).toLocaleString('ru-RU');
  document.getElementById('pkManCnt').textContent = 'Позиции закупки · ' + n;
  document.getElementById('pkManLh').textContent = n ? 'Добавлено · ' + n : '';
  document.getElementById('pkManSumTop').textContent = n ? fy(sum) : '';
  document.getElementById('pkManSumL').textContent = `${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')} · ${cl} ${pkPl(cl, 'клиент', 'клиента', 'клиентов')}`;
  document.getElementById('pkManSumR').textContent = 'Выкуп ' + fy(sum);
  document.getElementById('pkManSave').disabled = !n;
  document.getElementById('pkManList').innerHTML = n ? its.map((x, i) => `
    <button type="button" class="pk-man-it ${x.w ? '' : 'nocl'} ${pkMan.edit === i ? 'on' : ''}" onclick="pkManEdit(${i})">
      <span class="th" ${x.img ? `style="background-image:url('${x.img}')"` : ''}>${x.img ? '' : '<i class="ti ti-photo-off" aria-hidden="true"></i>'}</span>
      <span class="m"><b>${pkEsc(x.t)}</b>${x.n ? `<span class="nm">${pkEsc(x.n)}</span>` : ''}${x.w ? `<span class="cl">${pkEsc(x.w)}</span>` : '<span class="nm" style="color:var(--pk-warn)">нет клиента</span>'}</span>
      <span class="pr">${x.p ? fy(+x.p) : '—'}</span></button>`).join('')
    : '<div class="pk-card pk-empty" style="font-size:14px">Товаров пока нет. Впишите трек и нажмите «Добавить позицию» — форма очистится для следующего.</div>';
}
function pkManBack() {
  if (pkMan && pkMan.items.length) {
    pkSheet(`<h3>Выйти без сохранения?</h3><p class="pk-muted" style="font-size:14px;line-height:1.5;margin:10px 0 14px">Добавлено ${pkMan.items.length} ${pkPl(pkMan.items.length, 'позиция', 'позиции', 'позиций')}. Черновик останется — продолжить можно через «+ Новая» → «Создать вручную».</p>
      <button class="pk-btn ok" style="width:100%" onclick="pkSheetClose();pkManSave()"><i class="ti ti-check" aria-hidden="true"></i> Сохранить закупку</button>
      <button class="pk-btn ghost" style="width:100%;margin-top:8px" onclick="pkSheetClose();pkManClose(true)">Выйти, оставить черновик</button>
      <button class="pk-btn ghost" style="width:100%;margin-top:8px" onclick="pkSheetClose()">Остаться</button>`);
    return;
  }
  pkManClose(false);
}
function pkManClose(keep) {
  pkManScanStop();
  if (keep) pkManSaveDraft(); else try { localStorage.removeItem(PK_MAN_KEY); } catch (e) {}
  const el = document.getElementById('pkMan'); if (el) el.classList.remove('on');
  document.body.classList.remove('pk-man-on');
  pkMan = null;
}
async function pkManSave() {
  if (!pkMan || !pkMan.items.length) return;
  const b = document.getElementById('pkManSave'); b.disabled = true; b.textContent = 'Сохраняю…';
  try {
    let rates = { ...DEFAULT_RATES };
    if (userProfile && userProfile.baseRates) rates = { ...DEFAULT_RATES, ...userProfile.baseRates };
    else try { const l = await shipmentsRef().orderBy('created', 'desc').limit(1).get(); if (!l.empty && l.docs[0].data().rates) rates = { ...DEFAULT_RATES, ...l.docs[0].data().rates }; } catch (e) {}
    const data = pkMan.items.slice().reverse().map(x => {
      const o = { t: x.t, w: x.w || '', img: x.img || '', p: x.p || '', pc: '', q: '1' };
      if (x.n) o.n = x.n;
      return o;
    });
    const ref = await shipmentsRef().add({ name: pkMan.name, data, rates, status: 'forming', src: 'manual', created: firebase.firestore.FieldValue.serverTimestamp() });
    const n = data.length;
    pkManClose(false);
    activeShipmentId = ref.id;
    await loadShipments();
    try { await updateShipmentStats(); } catch (e) {}
    pkGo('ships');
    showToast(`Закупка создана · ${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')}`);
  } catch (e) {
    b.disabled = false; b.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Сохранить закупку';
    showToast('Не сохранилось: ' + (e.message || e) + '. Черновик на месте — попробуйте ещё раз');
  }
}
// камера для трека — та же библиотека, что и в сканере
async function pkManScanStart() {
  if (typeof Html5Qrcode === 'undefined') { showToast('Камера недоступна — впишите трек руками'); return; }
  try { if (typeof scanning !== 'undefined' && scanning) stopScanner(); } catch (e) {}
  if (pkManScan) return;
  document.getElementById('pkManCam').style.display = '';
  pkManScan = new Html5Qrcode('pkManReader');
  try {
    await pkManScan.start({ facingMode: 'environment' },
      { fps: 20, disableFlip: true, qrbox: (w, h) => ({ width: Math.round(w * 0.9), height: Math.round(Math.min(h, w) * 0.45) }), formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.CODE_93, Html5QrcodeSupportedFormats.ITF, Html5QrcodeSupportedFormats.QR_CODE] },
      c => { const t = String(c || '').trim(); if (!t) return; document.getElementById('pkManT').value = t; try { beep(); vibrate(); } catch (e) {} pkManScanStop(); pkManNext('pkManN'); }, () => {});
  } catch (e) { showToast('Нет доступа к камере — впишите трек руками'); pkManScanStop(); }
}
function pkManScanStop() {
  const box = document.getElementById('pkManCam'); if (box) box.style.display = 'none';
  if (pkManScan) { const s = pkManScan; pkManScan = null; s.stop().catch(() => {}).then(() => { try { s.clear(); } catch (e) {} }); }
}

// ---------- шторка ----------
let pkSheetRaf = 0;
function pkSheet(html) {
  const sh = document.getElementById('pkSheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  document.getElementById('pkSheetBg').classList.add('on');
  cancelAnimationFrame(pkSheetRaf); pkSheetRaf = requestAnimationFrame(() => sh.classList.add('on'));
}
function pkSheetClose() {
  cancelAnimationFrame(pkSheetRaf);
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

// в узком Кабинете (телефон) боковая панель с кнопкой «Мобильная версия» скрыта — добавляем её в верхнюю ленту разделов
(function () {
  const first = document.querySelector('#cabinetScreen .cab-nav-item');
  if (!first || document.getElementById('pkBackM')) return;
  const b = document.createElement('button');
  b.id = 'pkBackM'; b.type = 'button'; b.className = 'cab-nav-item pk-back-m';
  b.innerHTML = '<i class="ti ti-device-mobile" aria-hidden="true"></i> Мобильная';
  b.onclick = () => {
    try { if (typeof cabShipId !== 'undefined' && cabShipId) { cabShipId = null; restoreActiveEditing(); } } catch (e) {}
    document.getElementById('cabinetScreen').classList.remove('show');
    enterMode('scanner');
    window.scrollTo(0, 0);
  };
  first.parentNode.insertBefore(b, first);
})();

// если приложение уже открыто в режиме сканера к моменту загрузки этого файла
if (document.getElementById('appScreen') && !document.getElementById('appScreen').classList.contains('hide')) pkActivate();
