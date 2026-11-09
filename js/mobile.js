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
    <div class="pk-list" id="pkRecent"></div>
    <button type="button" class="pk-btn ghost pk-reset" id="pkResetBtn" style="display:none" onclick="pkResetMarks()"><i class="ti ti-eraser" aria-hidden="true"></i> Стереть все отметки</button>`;
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
  box.appendChild(document.getElementById('cameraSection'));   // 06.11.2026: камера выше карточки результата
  box.appendChild(document.getElementById('resultBlock'));
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
  // «Обновить» в браузере — остаёмся на той же вкладке
  try { const nav = performance.getEntriesByType('navigation')[0], t = sessionStorage.getItem('pk_m_tab');
    if (!window.__pkTabUsed && nav && nav.type === 'reload' && t && document.getElementById('pkPane-' + t)) pkTab = t; } catch (e) {}
  window.__pkTabUsed = 1;
  pkGo(pkTab);
}
function pkDeactivate() {
  document.body.classList.remove('pk-m');
  pkSheetClose();
}

function pkGo(t) {
  pkTab = t;
  try { sessionStorage.setItem('pk_m_tab', t); } catch (e) {}
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
  try { if (pkCC) pkCCRender(); } catch (e) { console.warn('pkCCRender', e); }
}

// ---------- Сканер ----------
function pkRenderScan() {
  const s = pkActive();
  const st = pkSt(s ? (s.status || 'forming') : 'forming');
  const pick = document.getElementById('pkPick');
  pick.innerHTML = s
    ? `<span><small>Сканирую закупку</small><b>${pkEsc(s.name)}</b> <span style="color:${st.text};font-weight:600">· ${st.label}</span></span><i class="ti ti-chevron-down" aria-hidden="true" style="font-size:20px;color:var(--pk-muted)"></i>`
    : `<span><small>Закупок пока нет</small><b>Создайте первую закупку</b></span>`;
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
    : `<div class="pk-row"><div class="n">${d} <small>/ ${t}</small></div><span class="pk-muted" style="font-size:14px">осталось <b style="color:var(--pk-ink)">${t - d}</b></span></div><div class="pk-bar"><span style="width:${t ? Math.round(d / t * 100) : 0}%"></span></div>`
      + (d > 0 && t - d > 0 ? `<button type="button" class="pk-btn ghost pk-fin" onclick="event.stopPropagation();pkFinishScan()"><i class="ti ti-flag-check" aria-hidden="true"></i> Сканирование окончено</button>` : '');
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
  // «Стереть все отметки» — только для этой закупки и только когда есть что стирать
  const rb = document.getElementById('pkResetBtn');
  if (rb) rb.style.display = s && (Object.keys(scanned || {}).length || rec.length) ? 'flex' : 'none';
}
// Стереть все отметки активной закупки (05.11.2026): отметки + «Последние отметки», другие закупки не трогаем
async function pkResetMarks() {
  const s = pkActive(); if (!s) return;
  if (!confirm(`Стереть все отметки в «${s.name}»?\nПосылки снова станут неотсканированными.`)) return;
  editingShipmentId = activeShipmentId;
  const ok = await resetAll(true);
  if (ok && typeof showToast === 'function') showToast('Отметки стёрты');
}

// «Сканирование окончено» (05.11.2026): неотсканированные треки — в новую или существующую закупку
function pkFinishScan(mode) {
  const s = pkActive(); if (!s) return;
  const t = TABLE.length, d = Object.keys(scanned).length, left = t - d;
  if (left <= 0) return;
  const again = TABLE.filter((r, i) => !scanned[i] && (parseInt(r[7]) || 0) >= 1).length;
  const others = (allShipments || []).filter(x => x.id !== s.id && x.status !== 'done');
  mode = mode || 'new';
  const dt = new Date(); dt.setDate(dt.getDate() + 1);
  pkSheet(`<h3>Сканирование окончено?</h3>
    <p class="pk-muted" style="margin:6px 0 12px;font-size:14.5px;line-height:1.45">Не отсканировано <b style="color:var(--pk-ink)">${left} ${pkPl(left, 'трек', 'трека', 'треков')}</b> — они не приехали в этом грузе. Перенесём их вместе с клиентами, фото и ценами, а в «${pkEsc(s.name)}» останутся только приехавшие.</p>
    ${again ? `<div class="pk-fin-warn"><i class="ti ti-alert-triangle"></i><span><b>${again} ${pkPl(again, 'трек', 'трека', 'треков')}</b> ${again === 1 ? 'не приезжает уже второй раз — после переноса он будет отмечен' : 'не приезжают уже второй раз — после переноса они будут отмечены'} красным. Стоит написать в карго.</span></div>` : ''}
    <div class="pk-seg" style="margin:4px 0 12px"><button type="button" class="${mode === 'new' ? 'on' : ''}" onclick="pkFinishScan('new')">В новую закупку</button><button type="button" class="${mode === 'old' ? 'on' : ''}" ${others.length ? '' : 'disabled'} onclick="pkFinishScan('old')">В существующую</button></div>
    ${mode === 'new'
      ? `<label class="pk-muted" style="font-size:13px">Название новой закупки</label><input id="pkFinName" class="pk-inp" value="Отправка ${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}" style="width:100%;margin-top:4px">`
      : `<label class="pk-muted" style="font-size:13px">Куда перенести</label><select id="pkFinTo" class="pk-inp" style="width:100%;margin-top:4px">${others.map(x => `<option value="${x.id}">${pkEsc(x.name)} · ${pkSt(x.status || 'forming').label}</option>`).join('')}</select>`}
    <button type="button" class="pk-btn" id="pkFinGo" style="width:100%;margin-top:14px" onclick="pkFinishGo('${mode}')"><i class="ti ti-arrow-forward-up"></i> Перенести ${left} ${pkPl(left, 'трек', 'трека', 'треков')}</button>
    <button type="button" class="pk-btn ghost" style="width:100%;margin-top:8px" onclick="pkSheetClose()">Продолжить сканирование</button>`);
}
async function pkFinishGo(mode) {
  const b = document.getElementById('pkFinGo'); if (b) { b.disabled = true; b.textContent = 'Переношу…'; }
  try {
    const target = mode === 'old' ? { id: (document.getElementById('pkFinTo') || {}).value } : { newName: (document.getElementById('pkFinName') || {}).value };
    const r = await pkMoveUnscanned(target);
    pkSheetClose(); pkRender();
    if (typeof showToast === 'function') showToast(`Перенесли ${r.moved} ${pkPl(r.moved, 'трек', 'трека', 'треков')} в «${r.toName}»`);
    setTimeout(() => { const w = document.getElementById('weighPrompt'); if (w && TABLE.length && Object.keys(scanned).length >= TABLE.length) w.classList.add('show'); }, 600);
  } catch (e) {
    alert('Не получилось перенести: ' + (e && e.message || e));
    if (b) { b.disabled = false; b.textContent = 'Попробовать ещё раз'; }
  }
}
// Пометка трека, который уже переносили как «не пришёл»: 1 раз — серая строка, 2+ — красная (обратиться в карго)
function pkMvNote(r) {
  const mv = parseInt(r && r[7]) || 0; if (!mv) return '';
  return mv >= 2
    ? `<div class="pk-mv bad"><i class="ti ti-alert-triangle"></i> Не пришёл ${mv} раза — обратитесь в карго, возможно, посылка потерялась</div>`
    : `<div class="pk-mv"><i class="ti ti-arrow-forward-up"></i> Перенесён из «${pkEsc(r[8] || 'прошлой закупки')}» — в том грузе не пришёл</div>`;
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
    }).join('') || '<div class="pk-empty">Активных закупок нет</div>'}</div>
    <button type="button" class="pk-btn ghost" style="width:100%;margin-top:12px" onclick="pkSheetClose();pkNewShip()"><i class="ti ti-plus"></i> Новая закупка</button>`);
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
  if (typeof pkCamIntoView === 'function') setTimeout(pkCamIntoView, 200);
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
      return `<div class="pk-li" onclick="pkShipSheet('${x.ship.id}')"><span class="ph" ${x.r[2] ? `style="background-image:url('${pkEsc(pkImg(x.r[2]))}')"` : ''}></span><div><b style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${cabTrackMark(x.r[0], R.fuzzy ? '' : R.q)}${q > 1 ? ' ×' + q : ''}</b><small>${pkEsc(x.ship.name)} · <span style="color:${st.text}">${st.label}</span></small></div><span class="r" style="color:var(--pk-acc);font-weight:700;max-width:40vw;overflow:hidden;text-overflow:ellipsis">${pkEsc((x.r[1] || '').trim() || '—')}</span></div>`;
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
    ${typeof pkLimitBanner === 'function' ? pkLimitBanner() : ''}
    <label class="pk-search"><i class="ti ti-search" aria-hidden="true"></i><input id="pkShipQ" type="search" autocomplete="off" spellcheck="false" placeholder="Найти посылку по трек-коду" value="${pkEsc(pkShipQuery)}" oninput="pkShipQuery=this.value;pkShipSearch()"></label>
    <div id="pkShipRes"></div>
    ${typeof pkBnStrip === 'function' ? pkBnStrip() : ''}
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
      // 07.11.2026: строку про оплаты («27 не оплатили», «внёс предоплату») убрали — долги видны в «Деньгах» и у клиентов
      // 07.11.2026: компактная карточка — название и строка слева, статус и стрелка справа (было 3–4 строки)
      return `<div class="pk-ship c ${cur ? 'cur' : ''}" onclick="pkShipSheet('${s.id}')"><div class="pk-ship-r"><div class="mid"><div class="nm">${pkEsc(s.name)}</div><div class="ln">${line}</div>${typeof pkOffPill === 'function' ? pkOffPill(s) : ''}</div><span class="pk-stp st-${pkEsc(s.status || 'forming')}">${st.label}</span><i class="ti ti-chevron-right pk-chev" aria-hidden="true"></i></div>${extra}</div>`;
    }).join('') || '<div class="pk-card pk-empty">Закупок пока нет.<br>Создайте первую: вручную — прямо здесь, или импортом с Pinduoduo, Taobao и 1688 через расширение на компьютере.<button type="button" class="pk-btn" style="width:100%;margin-top:12px" onclick="pkNewShip()"><i class="ti ti-plus"></i> Создать закупку</button></div>'}`;
  pkShipSearch();
  if (hadFocus) { const i = document.getElementById('pkShipQ'); if (i) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (e) {} } }
}
// Узкий баннер над фильтрами «Закупок». Маршрутизация: список баннеров, порядок, автосмена и крестик — общие с Кабинетом
// (PK_BANNERS, pkBnList, pkBnOff в js/cabinet.js). Здесь — только короткий текст для телефона.
function pkBnStrip() {
  if (typeof pkBnList !== 'function') return '';
  const L = pkBnList(); if (!L.length) return '';
  if (pkBnIdx >= L.length) pkBnIdx = 0;
  const one = (b, on) => {
    const x = `<button type="button" class="xx" onclick="event.stopPropagation();pkBnOff('${b.id}')" aria-label="Скрыть баннер"><i class="ti ti-x"></i></button>`;
    if (b.kind === 'idea') return `<div class="pk-bn idea ${on ? 'on' : ''}" data-bn><span class="ic">💡</span><span class="tx"><b>Не хватает функции?</b>Напишите нам — сделаем</span><a class="go" href="${PK_SUPPORT_TG}" target="_blank" rel="noopener">Написать</a>${x}</div>`;
    return `<div class="pk-bn mk3 ${on ? 'on' : ''}" data-bn><span class="ic box"><img src="/icons/icon-192x192.png" alt=""></span><span class="tx"><b>Импорт с 3 площадок</b>PDD, Taobao, 1688 — с&nbsp;компьютера</span><a class="go" href="/extension" onclick="if(!pkIsPhone()){event.preventDefault();window.open('/extension','_blank')}">Подробнее</a>${x}</div>`;
  };
  return `<div class="pk-bnw" ${pkBnAttrs(PK_BN_SEC.phone)}>${L.map((b, k) => one(b, k === pkBnIdx)).join('')}${pkBnDots(L.length)}</div>`;
}
// Телефон или компьютер: расширение Chrome ставится только на компьютере
function pkIsPhone() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
function pkNewShip() {
  const phone = pkIsPhone();
  const cab = typeof cabInCabinet === 'function' && cabInCabinet();   // из Кабинета — его версии загрузки и ручной закупки (обновят Кабинет после)
  const opt = (ic, t, sub, fn) => `<button onclick="${fn}"><i class="ti ${ic}" aria-hidden="true"></i><span><b style="display:block;font-weight:600">${t}</b><small class="pk-muted" style="display:block;font-size:13px;font-weight:400;line-height:1.35;margin-top:2px">${sub}</small></span></button>`;
  pkSheet(`<h3>Новая закупка</h3>
    <p class="pk-muted" style="font-size:14px;line-height:1.5;margin:10px 0 14px">Обычно закупка появляется сама — после импорта заказов в расширении Piksta на компьютере: треки, фото и цены приходят одной кнопкой.</p>
    <div class="pk-menu">
      ${phone
        ? opt('ti-file-type-pdf', 'Через расширение Piksta в Chrome', 'Ставится только на компьютер. Откроется инструкция PDF и ссылка для компьютера', "pkSheetClose();location.href='/extension'")
        : opt('ti-puzzle', 'Через расширение Piksta в Chrome', 'Откроется страница с инструкцией и последней версией расширения', "pkSheetClose();window.open('/extension','_blank')")}
      ${opt('ti-upload', 'Загрузить таблицу с треками', 'Файл Excel или CSV от карго', cab ? 'pkSheetClose();cabUploadOpen()' : 'pkSheetClose();openUploadModal()')}
      ${opt('ti-pencil-plus', 'Создать вручную', 'Название закупки, треки добавите сами', cab ? 'pkSheetClose();cabManualOpen()' : 'pkSheetClose();pkNewManual()')}
    </div>`);
}
const PK_ST_HINT = { forming: 'собираете заказы, сканер выключен', transit: 'карго везёт посылки', delayed: 'посылки задерживаются в пути', warehouse: 'приехало — сканируете и раскладываете', sorted: 'всё разложено по клиентам, ждём оплаты', done: 'закрыта: выдано и оплачено' };
function pkShipSheet(id) {
  const s = (allShipments || []).find(x => x.id === id); if (!s) return;
  const cur = s.status || 'forming';
  const n = (s.data || []).length;
  const cl = new Set();
  for (const row of (s.data || [])) { const w = Array.isArray(row) ? row[1] : row.w; for (const p of (typeof splitWarehouses === 'function' ? splitWarehouses(w || '') : [w])) if (p && p.trim()) cl.add(p.trim().toLowerCase()); }
  const order = ['forming', 'transit', 'delayed', 'warehouse', 'sorted', 'done'];   // 07.11.2026: «Задерживается» — всегда в списке (как в Кабинете)
  const offSt = typeof pkOffState === 'function' ? pkOffState(s) : '';   // «Подготовить к складу» — js/pkoff.js
  const act = (fn) => `pkSheetClose();loadForAction('${id}').then(()=>${fn})`;
  const st = pkSt(cur);
  pkSheet(`<div class="pk-row" style="align-items:flex-start"><div style="min-width:0"><h3>${pkEsc(s.name)}</h3><div class="pk-muted" style="font-size:14px">${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')} · ${cl.size} ${pkPl(cl.size, 'клиент', 'клиента', 'клиентов')}</div></div><button class="pk-btn ghost sm" onclick="pkSheetClose();renameShipment('${id}')" aria-label="Переименовать закупку"><i class="ti ti-pencil" aria-hidden="true"></i></button></div>
    <button type="button" class="pk-stsel" id="pkStSel" onclick="this.classList.toggle('open')" aria-haspopup="listbox"><span class="l">Статус</span><span class="v"><i class="d" style="background:${st.color}"></i>${pkEsc(st.label)}</span><i class="ti ti-chevron-down cv" aria-hidden="true"></i></button>
    <div class="pk-stlist" role="listbox">${order.map(k => `<button type="button" role="option" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}" onclick="pkSetStatus('${id}','${k}')"><i class="d" style="background:${pkSt(k).color}"></i><span><b>${pkSt(k).label}</b><small>${PK_ST_HINT[k] || ''}</small></span>${k === cur ? '<i class="ti ti-check ck" aria-hidden="true"></i>' : ''}</button>`).join('')}</div>
    ${cur !== 'forming'
      ? `<button class="pk-btn" style="width:100%" onclick="pkScanShip('${id}')"><i class="ti ti-scan" aria-hidden="true"></i> ${id === activeShipmentId ? 'Сканирую эту закупку' : 'Сканировать эту закупку'}</button>`
      : `<button class="pk-btn ghost" style="width:100%" onclick="pkSetStatus('${id}','transit')"><i class="ti ti-truck" aria-hidden="true"></i> Закупка отправлена → «В дороге»</button>`}
    <button type="button" class="pk-main-act" onclick="${act('openPriceEditor()')}"><span class="ic"><i class="ti ti-list-details" aria-hidden="true"></i></span><span><b>Позиции закупки</b><small>треки, названия, клиенты, цены</small></span><i class="ti ti-chevron-right ch" aria-hidden="true"></i></button>
    <button class="pk-btn ghost" style="width:100%;margin:2px 0 2px" onclick="pkSheetClose();pkAddItems('${id}')"><i class="ti ti-plus" aria-hidden="true"></i> Добавить позицию</button>
    <div class="pk-tiles2">
      <button onclick="${act('openWeighing()')}"><i class="ti ti-scale" aria-hidden="true"></i>Взвешивание</button>
      <button onclick="pkSheetClose();pkCCOpen('${id}')"><i class="ti ti-cash" aria-hidden="true"></i><span>Расчёт с клиентами${pkCCTileSub(s)}</span></button>
    </div>
    <div class="pk-menu">
      <button onclick="pkSheetClose();openCargoCompare('${id}')"><i class="ti ti-arrows-diff" aria-hidden="true"></i><span>Сверка с карго</span></button>
      <button onclick="pkSheetClose();pkPrepOffline('${id}')"><i class="ti ${offSt === 'ok' ? 'ti-cloud-check' : 'ti-cloud-download'}" aria-hidden="true"${offSt === 'ok' ? ' style="color:var(--pk-ok)"' : ''}></i><span>${offSt === 'ok' ? 'Готова без интернета · обновить' : offSt === 'stale' ? 'Обновить для работы без интернета' : 'Подготовить к складу без интернета'}<small class="pk-muted" style="display:block;font-size:12.5px">приложение, позиции, клиенты и фото — на телефон</small></span></button>
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
  if (pkClientQuery) list = list.filter(c => pkClientHit(c, pkClientQuery));
  const chip = (k, l) => `<button type="button" class="${pkClientFilter === k ? 'on' : ''}" onclick="pkClientFilter='${k}';pkRender()">${l}</button>`;
  const stl = c => (typeof CAB_CLIENT_STATUS !== 'undefined' && CAB_CLIENT_STATUS[c.status]) ? CAB_CLIENT_STATUS[c.status].label : '';
  pane.innerHTML = `<h1 class="pk-h1">Клиенты</h1>
    <label class="pk-search"><i class="ti ti-search" aria-hidden="true"></i><input id="pkClientQ" type="search" placeholder="Имя, телефон или @логин" value="${pkEsc(pkClientQuery)}" oninput="pkClientQuery=this.value;pkRenderClientsList()"></label>
    <div class="pk-chips">${chip('all', 'Все ' + all.length)}${chip('debt', 'Должны ' + debt.length)}${chip('forg', 'Забытые ' + forg.length)}${chip('new', 'Новые ' + all.filter(c => c.status === 'new').length)}</div>
    <div class="pk-list" id="pkClientList"></div>`;
  pkClientListCache = { list, stl };
  pkRenderClientsList();
}
let pkClientListCache = null;
function pkRenderClientsList() {
  if (!pkClientListCache) return;
  let { list, stl } = pkClientListCache;
  if (pkClientQuery) list = list.filter(c => pkClientHit(c, pkClientQuery));
  const el = document.getElementById('pkClientList'); if (!el) return;
  el.innerHTML = list.slice(0, 200).map(c => `<div class="pk-li pk-cl" onclick="pkOpenClient('${encodeURIComponent(c.name)}')"><span class="pk-av">${pkEsc(c.name.trim().charAt(0).toUpperCase())}</span><div><b>${pkEsc(pkFullName(c.name))}${pkClientTags(c.name)}</b><small>${pkEsc(stl(c))} · ${c.ships.length} ${pkPl(c.ships.length, 'закупка', 'закупки', 'закупок')}</small></div><span class="r ${c.unpaidDue > 0.005 ? 'due' : 'okk'}">${c.unpaidDue > 0.005 ? pkFmt(c.unpaidDue) + ' ' + pkCur() : 'оплачено'}</span></div>`).join('') || '<div class="pk-empty">Никого не нашли</div>';
}
// данные клиента (02.11.2026): фамилия, Telegram, телефон, папка, заметка — хранение и запись в cabinet.js (cabClientInfo / cabSaveClientInfo)
const pkCInfo = n => (typeof cabClientInfo === 'function' ? cabClientInfo(n) : {});
const pkFullName = n => (typeof cabFullName === 'function' ? cabFullName(n) : n);
function pkClientHit(c, q) {
  q = String(q || '').toLowerCase().trim(); if (!q) return true;
  const I = pkCInfo(c.name), qd = q.replace(/[^\d]/g, '');
  return c.name.toLowerCase().includes(q) || (I.ln || '').toLowerCase().includes(q) || (I.tg || '').toLowerCase().includes(q.replace(/^@/, '')) || (I.note || '').toLowerCase().includes(q)
    || (qd.length >= 3 && String(I.ph || '').replace(/[^\d]/g, '').includes(qd));
}
function pkClientTags(name) {
  const I = pkCInfo(name), fd = typeof cabFolderOf === 'function' ? cabFolderOf(name) : '';
  return (fd ? `<span class="pk-fold">${pkEsc(fd)}</span>` : '') + (I.tg || I.ph ? `<span class="pk-cic">${I.tg ? '<i class="ti ti-brand-telegram tg" aria-label="есть Telegram"></i>' : ''}${I.ph ? '<i class="ti ti-phone ph" aria-label="есть телефон"></i>' : ''}</span>` : '');
}
function pkClientContacts(name) {
  const I = pkCInfo(name), enc = encodeURIComponent(name), fd = typeof cabFolderOf === 'function' ? cabFolderOf(name) : '';
  const tg = typeof cabTgUser === 'function' ? cabTgUser(I.tg) : '', ph = typeof cabTel === 'function' ? cabTel(I.ph) : '';
  if (!tg && !ph && !fd && !I.note && !I.ln) return `<button type="button" class="pk-cadd" onclick="pkClientEdit('${enc}')"><i class="ti ti-user-plus" aria-hidden="true"></i> Добавить контакты и заметку</button>`;
  const ln = (ic, v, l) => `<div class="pk-cln"><i class="ti ${ic}" aria-hidden="true"></i><div>${v}<small>${l}</small></div></div>`;
  return `<div class="pk-card pk-cct">
    <div class="pk-chd">Контакты<button type="button" onclick="pkClientEdit('${enc}')"><i class="ti ti-pencil" aria-hidden="true"></i>Изменить</button></div>
    ${tg ? ln('ti-brand-telegram', '@' + pkEsc(tg), 'Telegram') : ''}${I.ph ? ln('ti-phone', pkEsc(I.ph), 'Телефон') : ''}${fd ? ln('ti-folder', pkEsc(fd), 'Папка') : ''}
    ${I.note ? `<div class="pk-cnote"><i class="ti ti-note" aria-hidden="true"></i><span>${pkEsc(I.note)}</span></div>` : ''}
    ${tg || ph ? `<div class="pk-row" style="gap:8px">${tg ? `<a class="pk-btn tgb" style="flex:1" href="https://t.me/${tg}" target="_blank" rel="noopener"><i class="ti ti-brand-telegram" aria-hidden="true"></i> Написать</a>` : ''}${ph ? `<a class="pk-btn ghost" style="flex:1" href="tel:${ph}"><i class="ti ti-phone" aria-hidden="true"></i> Позвонить</a>` : ''}</div>` : ''}
  </div>`;
}
let pkCEdit = null;
function pkClientEdit(enc) {
  const name = decodeURIComponent(enc), I = pkCInfo(name);
  const F = typeof cabFolders === 'function' ? cabFolders() : { list: [], map: {} };
  pkCEdit = { name, fd: (typeof cabFolderOf === 'function' ? cabFolderOf(name) : '') || '' };
  const chips = ['', ...F.list].map(fd => `<button type="button" class="${pkCEdit.fd === fd ? 'on' : ''}" onclick="pkCEdit.fd=this.dataset.f;document.querySelectorAll('#pkCFd button').forEach(b=>b.classList.toggle('on',b===this))" data-f="${pkEsc(fd)}">${fd ? pkEsc(fd) : 'Без папки'}</button>`).join('');
  pkSheet(`<h3>Данные клиента</h3>
    <div class="pk-cform">
      <div class="pk-row" style="gap:8px;align-items:flex-start"><label style="flex:1"><span>Имя <b>*</b></span><input id="pkCName" class="pk-man-i" value="${pkEsc(name)}" autocomplete="off"></label><label style="flex:1"><span>Фамилия</span><input id="pkCLn" class="pk-man-i" value="${pkEsc(I.ln || '')}" placeholder="по желанию" autocomplete="off"></label></div>
      <div class="pk-muted" style="font-size:12.5px;margin-top:-2px">Имя — как клиент записан в закупках. Поменяете — поменяется везде.</div>
      <label><span>Telegram</span><input id="pkCTg" class="pk-man-i" value="${I.tg ? '@' + pkEsc(I.tg) : ''}" placeholder="@логин" autocomplete="off" autocapitalize="off"></label>
      <label><span>Телефон</span><input id="pkCPh" class="pk-man-i" type="tel" value="${pkEsc(I.ph || '')}" placeholder="+375 …" autocomplete="off"></label>
      <div><span class="pk-cl2">Папка</span><div class="pk-man-chips" id="pkCFd">${chips}</div><input id="pkCNewFd" class="pk-man-i" style="margin-top:6px" placeholder="или новая папка — впишите название" autocomplete="off"></div>
      <label><span>Заметка</span><textarea id="pkCNote" class="pk-man-i" rows="2" placeholder="Например: берёт только детское">${pkEsc(I.note || '')}</textarea></label>
      <button class="pk-btn" style="width:100%" id="pkCSave" onclick="pkClientSave()"><i class="ti ti-check" aria-hidden="true"></i> Сохранить</button>
    </div>`);
}
async function pkClientSave() {
  if (!pkCEdit) return;
  const v = id => (document.getElementById(id) || {}).value || '';
  const old = pkCEdit.name, nn = v('pkCName').trim().replace(/\s+/g, ' ');
  if (!nn) return showToast('Имя обязательно');
  const b = document.getElementById('pkCSave'); b.disabled = true; b.textContent = 'Сохраняю…';
  try {
    await cabSaveClientInfo(old, { ln: v('pkCLn'), tg: v('pkCTg'), ph: v('pkCPh'), note: v('pkCNote') });
    const newFd = v('pkCNewFd').trim().slice(0, 40), F = cabFolders(), k = old.toLowerCase();
    let fd = newFd || pkCEdit.fd;
    if (newFd && !F.list.includes(newFd)) F.list.push(newFd);
    if (fd) F.map[k] = fd; else delete F.map[k];
    userProfile.clientFolders = F;
    await db.collection('users').doc(savedUid).update({ clientFolders: F });
    let name = old;
    if (nn !== old) { cabShipmentsCache = allShipments || []; if (await cabRenameClient(old, nn)) { name = nn; await loadShipments(); } }
    pkSheetClose(); pkCEdit = null;
    pkClientOpen = name; pkRender();
    showToast('Сохранено');
  } catch (e) { b.disabled = false; b.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Сохранить'; showToast('Не сохранилось: ' + (e.message || e)); }
}
function pkOpenClient(enc) { pkClientOpen = decodeURIComponent(enc); pkRender(); window.scrollTo(0, 0); }
function pkRenderClientCard(pane, name) {
  const S = pkData(); const c = S && S.list.find(x => x.name === name);
  if (!c) { pkClientOpen = null; pkRenderClients(); return; }
  const stl = (typeof CAB_CLIENT_STATUS !== 'undefined' && CAB_CLIENT_STATUS[c.status]) ? CAB_CLIENT_STATUS[c.status].label : '';
  const debts = c.ships.filter(x => cabIsBilled(x.ship) && x.c.payRest > 0.005);
  const encN = encodeURIComponent(name);
  const shipsHtml = pkCliShipsHtml(c, name);
  const totalBought = c.totalDue;
  pane.innerHTML = `<button class="pk-btn ghost sm" style="align-self:flex-start" onclick="pkClientOpen=null;pkRender()"><i class="ti ti-chevron-left" aria-hidden="true"></i> Клиенты</button>
    <div class="pk-me"><span class="pk-av" style="width:52px;height:52px;border-radius:26px;font-size:20px">${pkEsc(name.trim().charAt(0).toUpperCase())}</span><div><h1 class="pk-h1" style="font-size:22px">${pkEsc(pkFullName(name))}</h1><div class="pk-muted" style="font-size:14px">${pkEsc(stl)} · ${c.ships.length} ${pkPl(c.ships.length, 'закупка', 'закупки', 'закупок')}</div></div></div>
    ${pkClientContacts(name)}
    ${c.isOwner || typeof pkBalBlock !== 'function' ? '' : pkBalBlock(name)}
    ${debts.length >= 2 ? pkDebtsAllHtml(c, encN) : debts.map(x => { const due0 = Math.round((x.c.settle ? x.c.dueBeforeSettle : x.c.due) * 100) / 100, pd = x.c.payPaid || 0, pct = due0 > 0 ? Math.min(100, Math.round(pd / due0 * 100)) : 0; const at = (((x.ship.payments || {})[x.c.name] || {}).at || '').slice(0, 10); const atS = at ? ' · ' + at.slice(8, 10) + '.' + at.slice(5, 7) : '';
      return `<div class="pk-card pk-debt"><div class="pk-row" style="align-items:flex-end"><span style="min-width:0"><small class="pk-muted" style="display:block;font-size:13px">Долг за закупку</small><b>${pkEsc(x.ship.name)}</b></span><b style="font-size:22px;color:var(--pk-due);white-space:nowrap">${pkF2(x.c.payRest)} ${pkCur()}</b></div>
      ${pd > 0.004 ? `<div class="pk-pbar"><span style="width:${pct}%"></span></div><div class="pk-muted" style="font-size:13px">Оплачено <b style="color:var(--pk-ok)">${pkF2(pd)}</b> из ${pkF2(due0)} ${pkCur()}${atS}</div>` : ''}
      <div class="pk-row" style="margin-top:10px;gap:8px"><button class="pk-btn ok" style="flex:1" onclick="pkPayOpen('${x.ship.id}','${encN}')"><i class="ti ti-cash" aria-hidden="true"></i> Оплата</button><button class="pk-btn ghost" style="flex:1" onclick="pkRemind('${encN}',${Math.round(x.c.payRest * 100) / 100},'${encodeURIComponent(x.ship.name)}')"><i class="ti ti-copy" aria-hidden="true"></i> Напомнить</button></div>
      <div class="pk-muted" style="font-size:12px;margin-top:8px">«Напомнить» копирует вежливое сообщение — вставьте в переписку</div></div>`; }).join('')}
    ${!debts.length ? `<div class="pk-card pk-row"><span>Долгов нет</span><b style="color:var(--pk-ok)">оплачено</b></div>` : ''}
    <div class="pk-lbl">Закупки · ${c.ships.length}</div>
    ${shipsHtml}
    <div class="pk-2"><div class="pk-card"><small>Всего купила</small><b>${pkFmt(totalBought)} ${pkCur()}</b></div><div class="pk-card"><small>Позиций</small><b>${c.totalItems}</b></div></div>`;
}
// ---------- закупки в карточке клиента (09.11.2026, как в Кабинете) ----------
// Каждая закупка клиента — строка (статус, позиций, сумма/долг); нажали — раскрылись его позиции и «+ Добавить позицию».
// Маршруты «Добавить позицию» (одна форма pkAddItems): Кабинет — закупка → «Товары и цены» и клиент → закупка;
// телефон — шторка закупки и ЭТОТ: Клиенты → клиент → закупка → «+ Добавить позицию» (клиент уже вписан).
let pkCliOpen = new Set(), pkCliOpenFor = '';
function pkCliShips(c) {   // незавершённые сверху (новые выше), потом архив
  const t = s => (s.created && s.created.seconds) || (s.created instanceof Date ? s.created / 1000 : 0);
  return c.ships.slice().sort((a, b) => (a.ship.status === 'done') - (b.ship.status === 'done') || t(b.ship) - t(a.ship));
}
function pkCliShipsHtml(c, name) {
  const list = pkCliShips(c), low = name.toLowerCase(), enc = encodeURIComponent(name);
  if (pkCliOpenFor !== name) {   // открыли другого клиента — раскрыта верхняя незавершённая
    pkCliOpenFor = name; pkCliOpen = new Set();
    const first = list.find(x => x.ship.status !== 'done'); if (first) pkCliOpen.add(first.ship.id);
  }
  if (!list.length) return '<div class="pk-card pk-empty">Закупок пока нет</div>';
  return `<div class="pk-csl">${list.map(({ ship, c: cc }) => {
    const open = pkCliOpen.has(ship.id), done = ship.status === 'done', st = pkSt(ship.status || 'forming');
    const rows = (ship.data || []).map(r => Array.isArray(r) ? r : [r.t, r.w, r.img || '', r.p || '', r.pc || '', r.q || '1', r.n || ''])
      .filter(r => splitWarehouses(r[1] || '').some(p => p.toLowerCase() === low));
    const billed = cabIsBilled(ship);
    const sum = cc.isOwner ? '<small>свой склад</small>' : !billed ? '<small>не рассчитана</small>'
      : `<b>${pkF2(cc.due)} ${pkCur()}</b>${cc.payRest > 0.004 ? `<small class="due">долг ${pkF2(cc.payRest)}</small>` : '<small class="okk">оплачено</small>'}`;
    const items = !open ? '' : rows.map(r => {
      const pr = parseFloat(r[4]) || parseFloat(r[3]) || 0, q = parseInt(r[5] || '1', 10) || 1, im = r[2] ? pkImg(r[2]) : '';
      return `<div class="pk-li"><span class="ph" ${im ? `style="background-image:url('${pkEsc(im)}')" onclick="event.stopPropagation();if(typeof cabZoomImg==='function')cabZoomImg('${pkEsc(im)}')"` : ''}></span><div><b style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${pkEsc(r[0])}</b><small>${r[6] ? pkEsc(r[6]) : '—'}</small></div><span class="r">${pr ? pkF2(pr) + ' ¥' : '—'}${q > 1 ? ' ×' + q : ''}</span></div>`;
    }).join('');
    return `<div class="pk-cs${open ? ' open' : ''}">
      <button type="button" class="pk-cs-hd" onclick="pkCliShipToggle('${ship.id}')" aria-expanded="${open}"><i class="ti ti-chevron-right ch" aria-hidden="true"></i>
        <span class="t"><b>${pkEsc(ship.name || 'Закупка')}</b><span class="ln"><span class="pk-stp st-${ship.status || 'forming'}">${st.label}</span><small>${rows.length} ${pkPl(rows.length, 'позиция', 'позиции', 'позиций')}</small></span></span>
        <span class="sum">${sum}</span></button>
      ${open ? `<div class="pk-cs-body"><div class="pk-cs-meta"><span>Вес клиента: <b>${cc.weight > 0 ? cc.weight.toFixed(2) + ' кг' : 'не взвешен'}</b></span><span>Цена клиента</span></div>
        <div>${items || '<div class="pk-empty" style="padding:12px 14px">Нет позиций</div>'}</div>
        ${done ? '<div class="pk-cs-note">Закупка завершена — добавлять нельзя</div>' : `<button type="button" class="pk-cs-add" onclick="pkCliAddItem('${ship.id}','${enc}')"><i class="ti ti-plus" aria-hidden="true"></i> Добавить позицию</button>`}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function pkCliShipToggle(id) { if (pkCliOpen.has(id)) pkCliOpen.delete(id); else pkCliOpen.add(id); pkRender(); }
function pkCliAddItem(id, enc) {
  pkAddItems(id, () => { pkCliOpen.add(id); pkRender(); }, decodeURIComponent(enc));
}
// Несколько долгов: сверху общий, одна кнопка «Внести оплату» (гасит от старой закупки к новой), ниже — по закупкам (03.11.2026)
function pkDebtsAllHtml(c, encN) {
  const D = cabClientDebts(c), tot = D.reduce((n, d) => n + d.rest, 0);
  return `<div class="pk-tot"><span class="l">Должна всего</span><span class="v">${pkF2(tot)} ${pkCur()}</span><span class="s">по ${D.length} ${pkPl(D.length, 'закупке', 'закупкам', 'закупкам')} · самая старая — ${pkEsc(D[0].ship.name || 'Закупка')}</span>
      <div class="pk-row" style="gap:8px;margin-top:6px"><button class="pk-btn ok" style="flex:1" onclick="pkPayAllOpen('${encN}')"><i class="ti ti-cash" aria-hidden="true"></i> Внести оплату</button><button class="pk-btn ghost" style="flex:1" onclick="pkRemind('${encN}',${Math.round(tot * 100) / 100},'${encodeURIComponent(D.length + ' ' + pkPl(D.length, 'закупку', 'закупки', 'закупок'))}')"><i class="ti ti-copy" aria-hidden="true"></i> Напомнить</button></div></div>
    <div class="pk-lbl">По закупкам</div>
    ${D.map(d => `<div class="pk-dmini"><span><small>${pkEsc(d.ship.name || 'Закупка')}</small>оплачено ${pkF2(d.paid)} из ${pkF2(d.due)}</span><span style="display:flex;align-items:center"><b>${pkF2(d.rest)}</b><button type="button" onclick="pkPayOpen('${d.ship.id}','${encN}')">Оплата</button></span></div>`).join('')}`;
}
let pkPayAll = null;
function pkPayAllOpen(enc) {
  const S = pkData(); const m = S && S.list.find(x => x.name === decodeURIComponent(enc)); if (!m) return;
  const debts = cabClientDebts(m); if (!debts.length) return;
  const total = Math.round(debts.reduce((n, d) => n + d.rest, 0) * 100) / 100;
  pkPayAll = { name: m.name, debts, total };
  pkSheet(`<h3>Оплата · ${pkEsc(pkFullName(m.name))}</h3><div class="pk-muted" style="font-size:14px;margin-top:2px">Общий долг по ${debts.length} ${pkPl(debts.length, 'закупке', 'закупкам', 'закупкам')}</div>
    <div class="pk-pay3"><div><small>Должна</small><b>${pkF2(total)}</b></div><div><small>Дала сейчас</small><b id="pkPAa" style="color:var(--pk-ok)"></b></div><div><small>Останется</small><b id="pkPAl" style="color:var(--pk-due)"></b></div></div>
    <label class="pk-lbl" for="pkPAin" style="display:block;margin-top:14px">Сколько дала сейчас</label>
    <div class="pk-pay-amt"><input id="pkPAin" type="text" inputmode="decimal" autocomplete="off" value="${total}" oninput="pkPayAllHint()"><span>${pkCur()}</span></div>
    <div class="pk-man-chips" style="margin-top:8px"><button type="button" onclick="pkPayAllSet(${total})">Весь долг · ${pkF2(total)}</button><button type="button" onclick="pkPayAllSet(${debts[0].rest})">Самую старую · ${pkF2(debts[0].rest)}</button></div>
    <div class="pk-dist" id="pkPAdist"></div>
    <button type="button" class="pk-btn ok" id="pkPAbtn" style="width:100%;margin-top:12px" onclick="pkPayAllSave()"></button>
    <div class="pk-muted" style="font-size:12.5px;margin-top:8px;text-align:center">Нужна одна закупка — кнопка «Оплата» у неё в списке</div>`);
  pkPayAllHint();
}
const pkPayAllVal = () => { const v = parseFloat(String((document.getElementById('pkPAin') || {}).value || '').replace(',', '.').replace(/\s/g, '')); return isNaN(v) || v < 0 ? 0 : Math.round(v * 100) / 100; };
function pkPayAllSet(v) { document.getElementById('pkPAin').value = v; pkPayAllHint(); }
function pkPayAllHint() {
  if (!pkPayAll) return;
  const a = pkPayAllVal(), left = Math.max(0, Math.round((pkPayAll.total - a) * 100) / 100);
  document.getElementById('pkPAa').textContent = pkF2(a);
  document.getElementById('pkPAl').textContent = pkF2(left);
  document.getElementById('pkPAdist').innerHTML = a > 0 ? cabFifoRowsHtml(pkPayAll.debts, a, pkF2) : '';
  const b = document.getElementById('pkPAbtn'); b.disabled = !(a > 0);
  b.innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> Записать${a > 0 ? ' ' + pkF2(a) + ' ' + pkCur() : ''}`;
}
async function pkPayAllSave() {
  if (!pkPayAll) return;
  const a = pkPayAllVal(); if (!(a > 0)) return;
  const extra = cabFifoPlan(pkPayAll.debts, a).extra;
  if (extra > 0.004 && !confirm(`Общий долг ${pkF2(pkPayAll.total)} ${pkCur()}, вы вносите ${pkF2(a)}.\n\nЗасчитать переплату ${pkF2(extra)} в прибыль по последней закупке?`)) return;
  const b = document.getElementById('pkPAbtn'); b.disabled = true; b.textContent = 'Сохраняю…';
  cabShipmentsCache = allShipments || [];
  let res;
  try { res = await cabFifoApply(pkPayAll.debts, a); } catch (e) { b.disabled = false; pkPayAllHint(); showToast('Не сохранилось: ' + (e.message || e)); return; }
  const left = Math.max(0, Math.round((pkPayAll.total - a) * 100) / 100);
  pkPayAll = null; pkSheetClose(); pkRender();
  pkUndoToast(left > 0.004 ? `Оплата записана · осталось ${pkF2(left)} ${pkCur()}` : 'Оплата записана · долг закрыт', async () => { try { await cabFifoUndo(res.prev); pkRender(); } catch (e) { showToast('Не получилось отменить: ' + (e.message || e)); } });
}
// Оплата клиента по закупке (01.11.2026): вносится сумма «сейчас», копится в ship.payments[имя].paid (как в Кабинете).
// Меньше долга — остаётся долг (можно «простить остаток» = закрыть расчёт); больше — переплата в прибыль (как в Кабинете).
let pkPay = null;
function pkPayOpen(shipId, enc, ext) {
  const ship = (allShipments || []).find(s => s.id === shipId); if (!ship) return;
  cabShipmentsCache = allShipments || [];
  const key = cabClientKey(ship, decodeURIComponent(enc));
  const c = cabGetClientsFromShipment(ship).clients.find(x => x.name === key); if (!c) return;
  const due = Math.round((c.settle ? c.dueBeforeSettle : c.due) * 100) / 100;
  const pi = cabPayInfo(ship.payments, ship.paid, key, due, c.isOwner);
  const paid = Math.round((pi.paid || 0) * 100) / 100, rest = Math.max(0, Math.round((due - paid) * 100) / 100);
  pkPay = { shipId, key, due, paid, rest };
  const cur = pkCur(), r2 = v => Math.round(v * 100) / 100;
  c.due0 = due;
  const head = ext ? `<h3>${pkEsc(key)}</h3><div class="pk-muted" style="font-size:14px;margin-top:2px">${pkEsc(ship.name)} · ${c.items} ${pkPl(c.items, 'позиция', 'позиции', 'позиций')}</div>${pkCCBreak(ship, c)}`
    : `<h3>Оплата · ${pkEsc(key)}</h3><div class="pk-muted" style="font-size:14px;margin-top:2px">${pkEsc(ship.name)}</div>`;
  pkSheet(`${head}
    ${!c.isOwner && typeof pkBalChip === 'function' ? pkBalChip(ship, key, rest) : ''}
    <div class="pk-pay3"><div><small>К оплате</small><b>${pkF2(due)}</b></div><div><small>Уже оплачено</small><b style="color:var(--pk-ok)">${pkF2(paid)}</b></div><div><small>Долг</small><b style="color:var(--pk-due)">${pkF2(rest)}</b></div></div>
    <label class="pk-lbl" for="pkPayAmt" style="display:block;margin-top:14px">Сколько заплатила сейчас</label>
    <div class="pk-pay-amt"><input id="pkPayAmt" type="text" inputmode="decimal" autocomplete="off" value="${rest > 0 ? r2(rest) : ''}" oninput="pkPayHint()"><span>${cur}</span></div>
    ${rest > 0 ? `<div class="pk-man-chips" style="margin-top:8px"><button type="button" onclick="pkPaySet(${r2(rest)})">Весь долг · ${pkF2(rest)}</button>${rest >= 2 ? `<button type="button" onclick="pkPaySet(${r2(rest / 2)})">Половина · ${pkF2(rest / 2)}</button>` : ''}</div>` : ''}
    <div id="pkPayHint"></div>
    <button type="button" class="pk-btn ok" id="pkPayBtn" style="width:100%;margin-top:12px" onclick="pkPaySave()"></button>${ext ? pkCCExtra(ship, c, paid) : ''}`);
  pkPayHint();
  if (!ext) setTimeout(() => { const i = document.getElementById('pkPayAmt'); if (i) { i.focus(); i.select(); } }, 300);
}
function pkPaySet(v) { const i = document.getElementById('pkPayAmt'); i.value = v; pkPayHint(); }
function pkPayVal() { const v = parseFloat(String((document.getElementById('pkPayAmt') || {}).value || '').replace(',', '.').replace(/\s/g, '')); return isNaN(v) ? 0 : Math.round(v * 100) / 100; }
function pkPayHint() {
  if (!pkPay) return;
  const a = pkPayVal(), cur = pkCur(), box = document.getElementById('pkPayHint'), b = document.getElementById('pkPayBtn');
  const left = Math.round((pkPay.rest - a) * 100) / 100;
  const keepFg = document.getElementById('pkPayForgive') && document.getElementById('pkPayForgive').checked;
  let h = '';
  if (a <= 0) h = '';
  else if (left > 0.004) h = `<div class="pk-pay-hint w"><i class="ti ti-clock" aria-hidden="true"></i><span>Останется долг <b>${pkF2(left)} ${cur}</b> — он будет виден в «Деньгах»</span></div>
      <label class="pk-pay-fg"><input type="checkbox" id="pkPayForgive" ${keepFg ? 'checked' : ''}><span>Простить остаток ${pkF2(left)} ${cur}<small>закрыть расчёт, прибыль станет меньше</small></span></label>`;
  else if (left < -0.004) h = `<div class="pk-pay-hint p"><i class="ti ti-trending-up" aria-hidden="true"></i><span>Долг закрыт. Переплата <b>${pkF2(-left)} ${cur}</b> — засчитаем в прибыль по этой закупке</span></div>`;
  else h = `<div class="pk-pay-hint ok"><i class="ti ti-circle-check" aria-hidden="true"></i><span>Долг будет закрыт полностью</span></div>`;
  box.innerHTML = h;
  b.disabled = !(a > 0);
  b.innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> Записать оплату${a > 0 ? ' ' + pkF2(a) + ' ' + cur : ''}`;
}
async function pkPaySave() {
  if (!pkPay) return;
  const a = pkPayVal(); if (!(a > 0)) return;
  const fg = document.getElementById('pkPayForgive') && document.getElementById('pkPayForgive').checked;
  const total = Math.round((pkPay.paid + a) * 100) / 100;
  const b = document.getElementById('pkPayBtn'); b.disabled = true; b.textContent = 'Сохраняю…';
  try {
    if (fg && total < pkPay.due - 0.004) await cabTxMapField(pkPay.shipId, 'payments', pkPay.key, { paid: total, at: new Date().toISOString(), closed: true });
    else await cabSavePayment(pkPay.shipId, pkPay.key, total);
  } catch (e) { b.disabled = false; pkPayHint(); showToast('Не сохранилось: ' + (e.message || e)); return; }
  const left = Math.round((pkPay.due - total) * 100) / 100;
  pkPay = null; pkSheetClose();
  showToast(left > 0.004 && !fg ? `Оплата записана · осталось ${pkF2(left)} ${pkCur()}` : 'Оплата записана · долг закрыт');
  pkRender();
}
function pkRemind(enc, sum, encShip) {
  const name = decodeURIComponent(enc).split(/[\s(]/)[0];
  const txt = `${name}, здравствуйте! Напоминаю про оплату за ${decodeURIComponent(encShip)}: ${pkFmt(sum)} ${pkCur()}. Если уже оплатили — спасибо, напишите, я отмечу.`;
  const done = () => { if (typeof showToast === 'function') showToast('Сообщение скопировано'); };
  try { navigator.clipboard.writeText(txt).then(done, () => prompt('Скопируйте сообщение:', txt)); } catch (e) { prompt('Скопируйте сообщение:', txt); }
}

// ---------- Закупка → «Расчёт с клиентами» (03.11.2026) ----------
// Рабочий экран как в Кабинете: собрано / осталось, поиск, фильтры, кружок «Оплачено» одним касанием (с «Отменить»),
// касание строки — шторка оплаты (из чего сумма, частичная оплата, переплата, условия клиента). Те же данные ship.payments.
let pkCC = null;   // { id, q, f, order: [имена в порядке на момент открытия] }
const pkF2 = v => { v = Math.round((v || 0) * 100) / 100; return Math.abs(v - Math.round(v)) < 0.005 ? cabFmt(v) : cabFmt2(v); };
function pkCCData(ship) {
  cabShipmentsCache = allShipments || [];
  const { clients } = cabGetClientsFromShipment(ship);
  const inclW = ship.priceInclWeight || {};
  const anyW = clients.some(c => c.weight > 0);
  for (const c of clients) {
    c.due0 = Math.round((c.settle ? c.dueBeforeSettle : c.due) * 100) / 100;
    c.over = !c.isOwner && (c.payPaid || 0) > c.due0 + 0.004 ? Math.round(((c.payPaid || 0) - c.due0) * 100) / 100 : 0;
    c.noW = anyW && !c.isOwner && !(c.weight > 0) && !inclW[c.name];
  }
  let due = 0, paid = 0, rest = 0, nPay = 0, nFull = 0;
  for (const c of clients) { if (c.isOwner) continue; nPay++; due += c.due; paid += c.payPaid || 0; rest += c.payRest || 0; if (c.payStatus === 'full') nFull++; }
  return { clients, due, paid, rest, nPay, nFull };
}
function pkCCTileSub(ship) {
  try {
    if (!cabIsBilled(ship)) return '';
    const D = pkCCData(ship); if (!D.nPay) return '';
    return D.rest > 0.5 ? `<small style="display:block;font-size:12px;font-weight:500;color:var(--pk-due);margin-top:1px">осталось ${pkFmt(D.rest)}</small>`
      : `<small style="display:block;font-size:12px;font-weight:600;color:var(--pk-ok);margin-top:1px">все оплатили</small>`;
  } catch (e) { return ''; }
}
function pkCCOpen(id) {
  const ship = (allShipments || []).find(s => s.id === id); if (!ship) return;
  if (!(ship.data || []).length) { showToast('В закупке пока нет позиций'); return; }
  pkCC = { id, q: '', f: 'all', order: null };
  pkScr('Расчёт с клиентами', '<div id="pkCCBody" style="display:flex;flex-direction:column;gap:10px"></div>', () => { pkCC = null; pkScrClose(); });
  const top = document.querySelector('#pkScr .pk-man-top');
  if (top) {
    const tt = top.querySelector('.tt'); if (tt) tt.insertAdjacentHTML('beforeend', `<span id="pkCCName">${pkEsc(ship.name || '')}</span>`);
    top.insertAdjacentHTML('beforeend', `<button type="button" class="pk-cc-pdf" onclick="pkCCPdf()" aria-label="Скачать расчёт в PDF"><i class="ti ti-download" aria-hidden="true"></i>PDF</button>`);
  }
  pkCCRender(true);
}
function pkCCPdf() { if (!pkCC) return; const id = pkCC.id; loadForAction(id).then(() => exportCalcPDF()).catch(e => showToast('Не получилось: ' + (e.message || e))); }
function pkCCSt(c) { return c.isOwner ? 'own' : c.payStatus === 'full' ? 'full' : c.payStatus === 'part' ? 'part' : 'none'; }
function pkCCRender(full) {
  const body = document.getElementById('pkCCBody');
  if (!pkCC || !body) { pkCC = null; return; }
  const ship = (allShipments || []).find(s => s.id === pkCC.id); if (!ship) { pkCC = null; pkScrClose(); return; }
  const D = pkCCData(ship), cur = pkCur();
  // порядок строк замораживаем при открытии (кто должен — сверху), чтобы строка не «убегала» после галочки
  const rank = { none: 0, part: 0, full: 1, own: 2 };
  if (!pkCC.order) pkCC.order = D.clients.slice().sort((a, b) => rank[pkCCSt(a)] - rank[pkCCSt(b)] || a.name.localeCompare(b.name, 'ru')).map(c => c.name);
  const pos = n => { const i = pkCC.order.indexOf(n); return i < 0 ? 1e6 : i; };
  const list = D.clients.slice().sort((a, b) => pos(a.name) - pos(b.name) || a.name.localeCompare(b.name, 'ru'));
  const cnt = { all: D.clients.length, none: 0, part: 0, full: 0 };
  for (const c of D.clients) { const st = pkCCSt(c); if (cnt[st] !== undefined) cnt[st]++; }
  const q = pkCC.q.trim().toLowerCase();
  const shown = list.filter(c => (pkCC.f === 'all' || pkCCSt(c) === pkCC.f) && (!q || c.name.toLowerCase().includes(q) || pkFullName(c.name).toLowerCase().includes(q)));
  const pct = D.due > 0 ? Math.min(100, Math.round(D.paid / D.due * 100)) : 0;
  const sum = `<div class="pk-cc-sum"><div class="l">Собрано с клиентов</div><div class="v">${pkF2(D.paid)} <small>из ${pkF2(D.due)} ${cur}</small></div><div class="pk-bar"><span style="width:${pct}%"></span></div>
    <div class="s"><span>${D.rest > 0.004 ? `Осталось собрать <b>${pkF2(D.rest)} ${cur}</b>` : '<em style="font-style:normal;color:var(--pk-ok);font-weight:700"><i class="ti ti-check"></i> Все оплатили</em>'}</span><span>${D.nFull} из ${D.nPay} оплатили</span></div>
    ${cabIsBilled(ship) ? '' : '<div class="pk-cc-warn"><i class="ti ti-info-circle" aria-hidden="true"></i>Закупка ещё не рассортирована — суммы могут измениться после взвешивания</div>'}</div>`;
  const chip = (k, l, dot) => `<button type="button" class="${pkCC.f === k ? 'on' : ''}" onclick="pkCC.f='${k}';pkCCRender()">${dot ? `<i class="d" style="background:${dot}"></i>` : ''}${l} ${cnt[k]}</button>`;
  const rows = shown.map(c => {
    const st = pkCCSt(c), enc = encodeURIComponent(c.name);
    let sm, ck;
    if (st === 'own') { sm = `<span class="sm own"><b>не платит</b></span>`; ck = `<span class="ck no" aria-hidden="true"></span>`; }
    else {
      if (st === 'full') {
        const at = (((ship.payments || {})[c.name] || {}).at || '').slice(0, 10);
        sm = c.over > 0.004 ? `<span class="sm ok"><b>+${pkF2(c.over)}</b><small>переплата</small></span>`
          : c.settle === 'off' ? `<span class="sm ok"><b>закрыто</b><small>списано ${pkF2(-c.settleDiff)}</small></span>`
          : `<span class="sm ok"><b>оплачено</b><small>${at ? at.slice(8, 10) + '.' + at.slice(5, 7) : ''}</small></span>`;
      } else if (st === 'part') sm = `<span class="sm part"><b>${pkF2(c.payRest)}</b><small>оплачено ${pkF2(c.payPaid)}</small></span>`;
      else sm = `<span class="sm due"><b>${pkF2(c.payRest)}</b><small>не оплачено</small></span>`;
      ck = `<button type="button" class="ck ${st === 'full' ? 'on' : st === 'part' ? 'part' : ''}" onclick="event.stopPropagation();pkCCTick('${enc}')" aria-label="${st === 'full' ? 'Снять отметку «Оплачено»' : 'Отметить «Оплачено»'}: ${pkEsc(c.name)}"><i class="ti ${st === 'part' ? 'ti-clock' : 'ti-check'}" aria-hidden="true"></i></button>`;
    }
    const sub = `${c.items} ${pkPl(c.items, 'поз.', 'поз.', 'поз.')}${st === 'full' || st === 'own' ? ' · ' + pkF2(st === 'own' ? c.goodsCost + c.shipCo : c.due0) : ''}${c.noW ? ' · <span class="pk-nw">не взвешена</span>' : ''}${c.dueEdited ? ' · <i class="ti ti-pencil" style="color:var(--pk-warn)" title="Сумма исправлена вручную"></i>' : ''}`;
    return `<div class="pk-cc ${pkCC.flash === c.name ? 'flash' : ''}" role="button" tabindex="0" onclick="pkCCSheet('${enc}')"><span class="nm"><b>${pkEsc(pkFullName(c.name))}</b><small>${sub}</small></span>${sm}${ck}</div>`;
  }).join('');
  const listHtml = `<div class="pk-cc-list" id="pkCCList">${rows || `<div class="pk-empty" style="padding:18px">${q ? 'Никого не нашли' : 'Здесь пусто'}</div>`}</div>`;
  if (full || !document.getElementById('pkCCList')) {
    body.innerHTML = `<div id="pkCCSum">${sum}</div>
      <label class="pk-search"><i class="ti ti-search" aria-hidden="true"></i><input id="pkCCQ" type="search" autocomplete="off" spellcheck="false" placeholder="Найти клиента" value="${pkEsc(pkCC.q)}" oninput="pkCC.q=this.value;pkCCRender()"></label>
      <div class="pk-chips" id="pkCCChips"></div><div id="pkCCWrap"></div>
      ${D.nPay - D.nFull > 1 ? `<button type="button" class="pk-btn ghost" id="pkCCAll" onclick="pkCCAllPaid()"><i class="ti ti-checks" aria-hidden="true"></i> Отметить всех оплатившими</button>` : ''}`;
  } else {
    document.getElementById('pkCCSum').innerHTML = sum;
    const all = document.getElementById('pkCCAll'); if (all) all.style.display = D.nPay - D.nFull > 1 ? '' : 'none';
  }
  document.getElementById('pkCCChips').innerHTML = chip('all', 'Все') + chip('none', 'Должны', 'var(--pk-due)') + chip('part', 'Частично', '#f59e0b') + chip('full', 'Оплачено', 'var(--pk-ok)');
  document.getElementById('pkCCWrap').innerHTML = listHtml;
}
// кружок справа: пусто → оплачено полностью; частично → спросить и закрыть со списанием; оплачено → снять. Везде «Отменить».
async function pkCCTick(enc) {
  if (!pkCC) return;
  const id = pkCC.id, ship = (allShipments || []).find(s => s.id === id); if (!ship) return;
  const c = pkCCData(ship).clients.find(x => x.name === decodeURIComponent(enc)); if (!c || c.isOwner) return;
  const key = c.name, prev = (ship.payments || {})[key] ? { ...(ship.payments || {})[key] } : null;
  const paid = c.payPaid || 0, st = pkCCSt(c), now = new Date().toISOString();
  let val, msg;
  if (st === 'none') { val = { paid: c.due0, at: now }; msg = `${pkFullName(key)} — оплачено ${pkF2(c.due0)}`; }
  else if (st === 'part') {
    if (!confirm(`«${pkFullName(key)}» заплатил(а) ${pkF2(paid)} из ${pkF2(c.due0)} ${pkCur()}.\n\nЗакрыть расчёт и списать остаток ${pkF2(c.due0 - paid)}? Прибыль станет меньше на эту сумму.\n\nЕсли клиент ещё доплатит — нажмите «Отмена» и внесите оплату, нажав на строку.`)) return;
    val = { paid: Math.round(paid * 100) / 100, at: now, closed: true }; msg = `${pkFullName(key)} — расчёт закрыт`;
  } else {
    val = prev && prev.closed ? { paid: paid, at: now } : { paid: 0, at: now };
    msg = `${pkFullName(key)} — отметка снята`;
  }
  try { await cabTxMapField(id, 'payments', key, val); } catch (e) { showToast('Не сохранилось: ' + (e.message || e)); return; }
  pkCC.flash = st === 'none' ? key : null; pkCCRender();
  setTimeout(() => { if (pkCC && pkCC.flash === key) { pkCC.flash = null; pkCCRender(); } }, 1600);
  pkUndoToast(msg, async () => { try { await cabTxMapField(id, 'payments', key, prev); pkRender(); } catch (e) { showToast('Не получилось отменить: ' + (e.message || e)); } });
}
async function pkCCAllPaid() {
  if (!pkCC) return;
  const id = pkCC.id, ship = (allShipments || []).find(s => s.id === id); if (!ship) return;
  const left = pkCCData(ship).clients.filter(c => !c.isOwner && c.payStatus !== 'full');
  if (!left.length) return;
  const sum = left.reduce((n, c) => n + (c.payRest || 0), 0);
  if (!confirm(`Отметить оплатившими полностью ${left.length} ${pkPl(left.length, 'клиента', 'клиентов', 'клиентов')}?\nОстаток к оплате: ${pkF2(sum)} ${pkCur()}.${cabIsBilled(ship) ? '' : '\n\nЗакупка ещё не рассортирована — суммы могут измениться после взвешивания.'}`)) return;
  const prev = left.map(c => [c.name, (ship.payments || {})[c.name] ? { ...(ship.payments || {})[c.name] } : null]);
  try { for (const c of left) await cabSavePayment(id, c.name, c.due0); } catch (e) { showToast('Не сохранилось: ' + (e.message || e)); }
  pkRender();
  pkUndoToast(`Отмечено: ${left.length} ${pkPl(left.length, 'клиент', 'клиента', 'клиентов')}`, async () => { try { for (const [k, v] of prev) await cabTxMapField(id, 'payments', k, v); pkRender(); } catch (e) { showToast('Не получилось отменить: ' + (e.message || e)); } });
}
function pkUndoToast(msg, undo) {
  let t = document.getElementById('pkUndo');
  if (!t) { t = document.createElement('div'); t.id = 'pkUndo'; t.className = 'pk-undo'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = `<i class="ti ti-circle-check" aria-hidden="true"></i><span>${pkEsc(msg)}</span><button type="button">Отменить</button>`;
  t.querySelector('button').onclick = () => { t.classList.remove('on'); clearTimeout(window.__pkUndoT); undo(); };
  t.classList.add('on'); clearTimeout(window.__pkUndoT); window.__pkUndoT = setTimeout(() => t.classList.remove('on'), 5000);
}
// касание строки: шторка оплаты (для «это я» — только условия)
function pkCCSheet(enc) {
  if (!pkCC) return;
  const id = pkCC.id, ship = (allShipments || []).find(s => s.id === id); if (!ship) return;
  const c = pkCCData(ship).clients.find(x => x.name === decodeURIComponent(enc)); if (!c) return;
  if (!c.isOwner) { pkPayOpen(id, enc, true); return; }
  pkSheet(`<h3>${pkEsc(pkFullName(c.name))}</h3><div class="pk-muted" style="font-size:14px;margin-top:2px">${pkEsc(ship.name)} · ${c.items} ${pkPl(c.items, 'позиция', 'позиции', 'позиций')}</div>
    <div class="pk-cc-br"><div><span>Товар по себестоимости</span><b>${pkF2(c.goodsCost)}</b></div><div><span>Доставка · ${cabFmt2(c.shipWeight)} кг с тарой</span><b>${pkF2(c.shipCo)}</b></div><div class="t"><span>Мои затраты</span><b>${pkF2(c.goodsCost + c.shipCo)} ${pkCur()}</b></div></div>
    <div class="pk-pay-hint p"><i class="ti ti-user" aria-hidden="true"></i><span>Это вы: покупка для себя — в долги и доход не входит</span></div>${pkCCExtra(ship, c, 0)}`);
}
function pkCCBreak(ship, c) {
  const inclW = (ship.priceInclWeight || {})[c.name] && !c.costShipOn;
  const goods = c.costGoodsOn ? c.goodsCost : c.goodsClient, shipS = c.costShipOn ? c.shipCo : c.shipCli;
  const enc = encodeURIComponent(c.name);
  return `<div class="pk-cc-br"><div><span>Товар (¥ ${cabFmt2(c.clientYuan)})${c.costGoodsOn ? ' · по себест.' : ''}</span><b>${pkF2(goods)}</b></div>
    <div><span>Доставка · ${c.weight > 0 ? cabFmt2(c.shipWeight) + ' кг с тарой' : 'вес не указан'}${c.costShipOn ? ' · по себест.' : ''}</span><b>${inclW ? 'в цене' : pkF2(shipS)}</b></div>
    ${c.dueEdited ? `<div><span>Исправлено вручную (по расчёту ${pkF2(c.dueCalc)})</span><b></b></div>` : ''}
    <div class="t"><span>Итого к оплате</span><a href="#" onclick="pkCCEditDue('${enc}');return false" title="Исправить сумму">${pkF2(c.due0)} ${pkCur()} <i class="ti ti-pencil" aria-hidden="true"></i></a></div></div>`;
}
function pkCCExtra(ship, c, paid) {
  const enc = encodeURIComponent(c.name);
  const cb = (kind, on, l) => `<label><input type="checkbox" ${on ? 'checked' : ''} onchange="pkCCCond('${enc}','${kind}',this.checked)">${l}</label>`;
  return `<div class="pk-cc-cond">${cb('owners', c.isOwner, 'Это я')}${c.isOwner ? '' : cb('costGoods', c.costGoodsOn, 'Товар по себестоимости') + cb('costShip', c.costShipOn, 'Доставка по себест.')}</div>
    <div class="pk-cc-links"><a href="#" onclick="pkCCClient('${enc}');return false"><i class="ti ti-user" aria-hidden="true"></i> Карточка клиента</a>${paid > 0.004 ? `<a href="#" class="r" onclick="pkCCReset('${enc}');return false"><i class="ti ti-rotate" aria-hidden="true"></i> Сбросить оплату</a>` : ''}</div>`;
}
async function pkCCCond(enc, field, on) {
  if (!pkCC) return;
  const id = pkCC.id, name = decodeURIComponent(enc);
  try { await cabTxMapField(id, field, name, !!on); } catch (e) { showToast('Не сохранилось: ' + (e.message || e)); return; }
  // если эта закупка сейчас загружена в редактор — держим её карты в актуальном виде
  if (id === (editingShipmentId || activeShipmentId)) { const m = field === 'owners' ? currentOwners : field === 'costGoods' ? currentCostGoods : currentCostShip; m[name] = !!on; }
  pkRender(); pkCCSheet(enc);
}
async function pkCCEditDue(enc) {
  if (!pkCC) return;
  const id = pkCC.id, ship = (allShipments || []).find(s => s.id === id); if (!ship) return;
  const c = pkCCData(ship).clients.find(x => x.name === decodeURIComponent(enc)); if (!c) return;
  const v = prompt(`Сколько должен(на) «${pkFullName(c.name)}», ${pkCur()}?\nПо расчёту: ${cabFmt2(c.dueCalc)}. Оставьте пустым, чтобы вернуть расчётную сумму.`, c.dueEdited ? c.due.toFixed(2) : '');
  if (v === null) return;
  const t = String(v).trim().replace(',', '.').replace(/\s/g, '');
  let val = null;
  if (t !== '') { val = parseFloat(t); if (isNaN(val) || val < 0) { showToast('Введите сумму числом'); return; } val = Math.round(val * 100) / 100; }
  try { await cabTxMapField(id, 'dueOverride', c.name, val); } catch (e) { showToast('Не сохранилось: ' + (e.message || e)); return; }
  pkRender(); pkCCSheet(enc);
}
async function pkCCReset(enc) {
  if (!pkCC) return;
  const id = pkCC.id, ship = (allShipments || []).find(s => s.id === id); if (!ship) return;
  const name = decodeURIComponent(enc), prev = (ship.payments || {})[name] ? { ...(ship.payments || {})[name] } : null;
  if (!confirm(`Сбросить оплату «${pkFullName(name)}»? Отметка «оплачено» и внесённые суммы по этой закупке обнулятся.`)) return;
  try { await cabSavePayment(id, name, 0); } catch (e) { showToast('Не сохранилось: ' + (e.message || e)); return; }
  pkSheetClose(); pkRender();
  pkUndoToast(`${pkFullName(name)} — оплата сброшена`, async () => { try { await cabTxMapField(id, 'payments', name, prev); pkRender(); } catch (e) {} });
}
function pkCCClient(enc) { pkSheetClose(); pkCC = null; pkScrClose(); pkGo('clients'); pkOpenClient(enc); }

// ---------- Деньги ----------
// Сверху — долг клиентов сейчас; «Товар в пути» — закупки до раскладки (деньги в товаре);
// «Итоги по закупкам» за период (по дате закупки); «Долги по закупкам» — по закупкам, люди — во вкладке «Клиенты».
let pkMoneyPer = 'm0', pkMoneyOpen = {};
const PK_MON_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
function pkShipWhen(s) {
  const d = typeof cabShipDate === 'function' ? cabShipDate(s) : null;
  if (d) return d;
  const c = s && s.created; const x = c ? (c.toDate ? c.toDate() : new Date(c)) : null;
  return x && !isNaN(x) ? x : null;
}
function pkMoneyRange(k) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const cap = d => { const t = d.toLocaleDateString('ru-RU', { month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  if (k === 'm1') return { a: new Date(y, m - 1, 1), b: new Date(y, m, 1), l: cap(new Date(y, m - 1, 1)), t: 'отправленные в ' + PK_MON_IN[(m + 11) % 12] };
  if (k === 'q') return { a: new Date(y, m - 2, 1), b: new Date(y, m + 1, 1), l: '3 месяца', t: 'за последние 3 месяца' };
  if (k === 'y') return { a: new Date(y, 0, 1), b: new Date(y + 1, 0, 1), l: 'Год', t: 'за ' + y + ' год' };
  return { a: new Date(y, m, 1), b: new Date(y, m + 1, 1), l: cap(n), t: 'отправленные в ' + PK_MON_IN[m] };
}
function pkRenderMoney() {
  const pane = document.getElementById('pkPane-money');
  const S = pkData();
  if (!S) { pane.innerHTML = '<div class="pk-card pk-empty">Нет данных</div>'; return; }
  const cur = pkCur(), ships = allShipments || [];
  const debtors = S.list.filter(c => !c.isOwner && c.unpaidDue > 0.005);
  const unpaid = debtors.reduce((n, c) => n + c.unpaidDue, 0);
  let dueB = 0, paidB = 0, nB = 0;
  const way = [], debts = [];
  for (const s of ships) {
    const st = s.status || 'forming';
    if (st === 'done' && !cabIsBilled(s)) continue;
    const { clients, rates } = cabGetClientsFromShipment(s);
    const cl = clients.filter(c => !c.isOwner);
    if (cabIsBilled(s)) {
      nB++;
      let due = 0, paid = 0; const who = [];
      for (const c of cl) { due += c.due; paid += Math.min(c.due, c.payPaid || 0); if (c.payRest > 0.005) who.push(c); }
      dueB += due; paidB += paid;
      if (who.length) debts.push({ s, due, paid, rest: who.reduce((n, c) => n + c.payRest, 0), who: who.sort((a, b) => b.payRest - a.payRest), n: cl.length });
    } else {
      const cost = cl.reduce((n, c) => n + (c.buyYuan > 0 ? c.goodsCost : c.clientYuan * (rates.buyRate || 0)), 0);
      if (cost > 0.5) way.push({ s, cost });
    }
  }
  const ORD = { forming: 0, transit: 1, delayed: 1, warehouse: 2 };
  way.sort((a, b) => (ORD[a.s.status || 'forming'] - ORD[b.s.status || 'forming']) || b.cost - a.cost);
  debts.sort((a, b) => b.rest - a.rest);
  const waySum = way.reduce((n, x) => n + x.cost, 0);
  const pct = dueB > 0 ? Math.round(paidB / dueB * 100) : 0;
  // итоги за период
  const R = pkMoneyRange(pkMoneyPer);
  let turn = 0, prof = 0, nP = 0;
  for (const s of ships) {
    const d = pkShipWhen(s); if (!d || d < R.a || d >= R.b) continue;
    nP++;
    for (const c of cabGetClientsFromShipment(s).clients) { if (c.isOwner) continue; turn += c.due; prof += c.profit; }
  }
  const enc = n => encodeURIComponent(n);
  pane.innerHTML = `<h1 class="pk-h1">Деньги</h1>${typeof pkBalMoney === 'function' ? pkBalMoney() : ''}
    <div class="pk-money"><span style="font-size:14px;opacity:.9">Вам должны сейчас · ${debtors.length} ${pkPl(debtors.length, 'клиент', 'клиента', 'клиентов')}</span><div class="v">${pkFmt(unpaid)} <small>${cur}</small></div>
      ${nB ? `<div class="pk-bar"><span style="width:${pct}%"></span></div><span class="s">Собрано <b>${pkFmt(paidB)}</b> из ${pkFmt(dueB)} ${cur} · ${pct}%</span><span style="font-size:12.5px;opacity:.85;margin-top:-4px">по ${nB} ${pkPl(nB, 'рассортированной закупке', 'рассортированным закупкам', 'рассортированным закупкам')}</span>` : '<span class="s" style="opacity:.85">Долги появятся, когда закупка будет рассортирована</span>'}</div>
    ${way.length ? `<div class="pk-way"><div class="hd"><b>Товар в пути</b><span>${pkFmt(waySum)} ${cur}</span></div><div class="sub">Вы уже заплатили за товар, клиенты будут должны после раскладки</div>
      ${way.map(x => { const st = pkSt(x.s.status || 'forming'), n = (x.s.data || []).length; return `<div class="row" onclick="pkShipSheet('${x.s.id}')" role="button" tabindex="0"><i class="dot" style="background:${st.color}"></i><span>${pkEsc(x.s.name)}<small>${st.label} · ${n} ${pkPl(n, 'трек', 'трека', 'треков')}</small></span><b>${pkFmt(x.cost)}</b><i class="ti ti-chevron-right" aria-hidden="true"></i></div>`; }).join('')}</div>` : ''}
    <div class="pk-lbl" style="margin-top:4px">Итоги по закупкам</div>
    <div class="pk-chips">${['m0', 'm1', 'q', 'y'].map(k => `<button type="button" class="${pkMoneyPer === k ? 'on' : ''}" onclick="pkMoneyPer='${k}';pkRenderMoney()">${pkMoneyRange(k).l}</button>`).join('')}</div>
    <div class="pk-t3"><div><small>Оборот</small><b>${pkFmt(turn)}</b></div><div><small>Прибыль</small><b style="color:var(--pk-ok)">${pkFmt(prof)}</b></div><div><small>Закупок</small><b>${nP}</b></div></div>
    <p class="pk-muted" style="font-size:12.5px;margin:-2px 0 0;line-height:1.45">Закупки ${R.t}, ${cur}. Оборот — сколько должны все клиенты, прибыль — ваша наценка. До взвешивания доставка не учтена.</p>
    ${debts.length ? `<div class="pk-lbl" style="margin-top:6px">Долги по закупкам</div>
    ${debts.map(x => { const st = pkSt(x.s.status), p = x.due > 0 ? Math.round(x.paid / x.due * 100) : 0, open = pkMoneyOpen[x.s.id], list = open ? x.who : x.who.slice(0, 3);
      return `<div class="pk-dsh"><div class="r" onclick="pkShipSheet('${x.s.id}')"><div><b>${pkEsc(x.s.name)}</b><br><span class="pk-pill" style="background:${st.color}22;color:${st.text}">● ${st.label}</span></div><span class="sum">${pkFmt(x.rest)} ${cur}</span></div>
        <div class="pb"><span style="width:${p}%"></span></div><span class="m">Должны ${x.who.length} из ${x.n} ${pkPl(x.n, 'клиента', 'клиентов', 'клиентов')} · собрано ${p}%</span>
        <div class="who">${list.map(c => `<button type="button" onclick="pkGo('clients');pkOpenClient('${enc(c.name)}')"><span>${pkEsc(c.name)}</span><b>${pkFmt(c.payRest)}</b></button>`).join('')}${x.who.length > 3 ? `<button type="button" class="more" onclick="pkMoneyOpen['${x.s.id}']=${open ? 'false' : 'true'};pkRenderMoney()">${open ? 'свернуть' : 'ещё ' + (x.who.length - 3) + ' →'}</button>` : ''}</div></div>`; }).join('')}
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:0">Кто должен по людям — «Клиенты» → «Должны»</p>` : ''}`;
}

// ---------- Ещё ----------
function pkRenderMore() {
  const name = (userProfile && userProfile.name) || (currentUser && currentUser.email) || '';
  const isAdmin = userProfile && userProfile.role === 'admin';
  const skin = pkSkin();
  const pv = { compact: '<i></i><i class="a"></i><i></i>', lenta: '<i class="a" style="height:8px;width:60%"></i><i></i><i></i><i></i>', bottom: '<i></i><i></i><i style="flex:1;background:none"></i><i class="a"></i>' };
  // дублирующий вход: то же «Подготовить к складу», что в меню закупки (js/pkoff.js), — для текущей закупки
  const offSt = typeof pkOffState === 'function' ? pkOffState((allShipments || []).find(x => x.id === activeShipmentId)) : '';
  document.getElementById('pkPane-more').innerHTML = `<h1 class="pk-h1">Ещё</h1>
    <div class="pk-card pk-me" onclick="openProfile()" style="cursor:pointer"><span class="pk-av" style="width:48px;height:48px;border-radius:24px">${pkEsc(document.getElementById('pkAva').textContent)}</span><div style="flex:1;min-width:0"><b style="display:block">${pkEsc(name)}</b><small class="pk-muted">${isAdmin ? 'Администратор' : 'Профиль, пароль, валюта'}</small></div><i class="ti ti-chevron-right" aria-hidden="true"></i></div>
    <div class="pk-lbl">Вид сканера</div>
    <div class="pk-skins">${PK_SKINS.map(([k, l]) => `<button type="button" class="pk-skin ${skin === k ? 'on' : ''}" onclick="pkSetSkin('${k}')" aria-pressed="${skin === k}"><span class="pv">${pv[k]}</span><span>${l}</span></button>`).join('')}</div>
    <div class="pk-menu">
      <button onclick="if(pkIsPhone())location.href='/extension';else window.open('/extension','_blank')"><i class="ti ti-puzzle" aria-hidden="true"></i><span>Расширение Piksta для Chrome<br><small>скачать и инструкция · ставится на компьютер</small></span></button>
      <button onclick="${activeShipmentId ? `pkPrepOffline('${activeShipmentId}')` : ''}"><i class="ti ${offSt === 'ok' ? 'ti-cloud-check' : 'ti-cloud-download'}" aria-hidden="true"></i><span>Работа без интернета</span><small>${offSt === 'ok' ? 'готова · обновить' : 'подготовить текущую закупку'}</small></button>
      <button onclick="pkTheme()"><i class="ti ti-moon" aria-hidden="true"></i><span>Тёмная тема</span><small>${document.body.classList.contains('dark') ? 'вкл' : 'выкл'}</small></button>
      <button onclick="pkTariffs()"><i class="ti ti-receipt" aria-hidden="true"></i><span>Тариф и оплата</span>${pkTariffLine()}</button>
      ${typeof pkTourMenuOn === 'function' && pkTourMenuOn() ? `<button onclick="pkTourStart('m')"><i class="ti ti-route" aria-hidden="true"></i><span>Подсказки по интерфейсу</span><small>пройти обучение заново</small></button>` : ''}
      <button class="soon" disabled aria-disabled="true"><i class="ti ti-book" aria-hidden="true"></i><span>Инструкция<br><small>скоро появится — обновляем под новые функции</small></span></button>
      <button onclick="pkHelp()"><i class="ti ti-help-circle" aria-hidden="true"></i><span>Помощь и связь</span></button>
      <button onclick="pkToCabinet()"><i class="ti ti-device-desktop" aria-hidden="true"></i><span>Полный Кабинет<br><small>цены, взвешивание, аналитика — удобнее на компьютере</small></span></button>
      ${isAdmin ? `<button onclick="pkToCabinet('admin')"><i class="ti ti-shield" aria-hidden="true"></i><span>Админ</span></button>` : ''}
    </div>
    <button class="pk-btn ghost" style="color:var(--pk-bad)" onclick="doLogout()">Выйти</button>`;
}
function pkTariffLine() {
  if (typeof pkPlanNow !== 'function') return '';
  const { A, sub, plan } = pkPlanNow();
  if (sub.pending) return '<small style="color:var(--pk-warn)">оплата на проверке</small>';
  if (A.kind === 'sub') return `<small>${PK_PLANS[plan].n} · до ${A.end.toLocaleDateString('ru-RU')}</small>`;
  if (A.kind === 'trial') return `<small>пробный · ${A.left} дн.</small>`;
  if (A.kind === 'grace' || A.kind === 'readonly') return '<small style="color:var(--pk-bad)">нужно оплатить</small>';
  return '';
}
function pkTheme() {
  const cb = document.getElementById('themeToggle');
  if (cb) { cb.checked = !document.body.classList.contains('dark'); try { toggleTheme(); } catch (e) { document.body.classList.toggle('dark', cb.checked); } }
  else document.body.classList.toggle('dark');
  pkRender();
}
function pkToCabinet(section) {
  if (typeof pkCabinetGate === 'function' && pkCabinetGate(section)) return;
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
function pkManSaveDraft() { try { if (pkMan && pkMan.addTo) return; if (pkMan && pkMan.items.length) localStorage.setItem(PK_MAN_KEY, JSON.stringify(pkMan)); else localStorage.removeItem(PK_MAN_KEY); } catch (e) {} }
function pkManDraft() { try { const d = JSON.parse(localStorage.getItem(PK_MAN_KEY) || 'null'); return d && d.items && d.items.length ? d : null; } catch (e) { return null; } }
function pkNewManual() {
  if (typeof pkLimitCheck === 'function' && !pkLimitCheck(1)) return;
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
// «Добавить позицию» в уже созданную закупку (06.11.2026): та же форма, но «Сохранить» дописывает товары в эту закупку.
// Маршрутизация: открывают Кабинет (закупка → «Товары и цены» → «+ Добавить позицию») и телефон (шторка закупки).
// client — имя клиента, если открыли из карточки клиента (Кабинет → Клиенты → клиент → закупка): поле «Клиент» уже заполнено
function pkAddItems(id, onDone, client) {
  const s = (allShipments || []).find(x => x.id === id) || (typeof cabShipmentsCache !== 'undefined' ? cabShipmentsCache.find(x => x.id === id) : null);
  if (!s) { showToast('Закупка не найдена — обновите страницу'); return; }
  const tracks = new Set((s.data || []).map(r => pkManNorm(Array.isArray(r) ? r[0] : r.t)));
  pkManOpen(s.name || 'Закупка', false, { id, tracks, onDone, client: client || '' });
}
function pkManOpen(name, fromDraft, addTo) {
  pkMan = fromDraft ? pkManDraft() : { name, items: [] };
  if (!pkMan) return;
  pkMan.addTo = addTo || null;
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
      <button type="button" class="pk-btn ok" id="pkManSave" onclick="pkManSave()"><i class="ti ti-check" aria-hidden="true"></i> ${pkMan.addTo ? 'Добавить в закупку' : 'Сохранить закупку'}</button></div>`;
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
  // клиенты, добавленные в Кабинете заранее (ещё без закупок)
  const ci = (userProfile && userProfile.clientInfo) || {}, low = new Set(Object.keys(cnt).map(x => x.toLowerCase()));
  for (const k in ci) if (ci[k] && ci[k].pre && ci[k].n && !low.has(k)) cnt[ci[k].n] = 0.5;
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
  document.getElementById('pkManW').value = it ? (it.w || '') : ((pkMan.addTo && pkMan.addTo.client) || '');
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
  if (dup >= 0 || (pkMan.addTo && pkMan.addTo.tracks.has(pkManNorm(t)))) { err.textContent = 'Такой трек уже есть в этой закупке'; document.getElementById('pkManT').focus(); return; }
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
      <button class="pk-btn ok" style="width:100%" onclick="pkSheetClose();pkManSave()"><i class="ti ti-check" aria-hidden="true"></i> ${pkMan.addTo ? 'Добавить в закупку' : 'Сохранить закупку'}</button>
      <button class="pk-btn ghost" style="width:100%;margin-top:8px" onclick="pkSheetClose();pkManClose(${pkMan.addTo ? 'false' : 'true'})">${pkMan.addTo ? 'Выйти без добавления' : 'Выйти, оставить черновик'}</button>
      <button class="pk-btn ghost" style="width:100%;margin-top:8px" onclick="pkSheetClose()">Остаться</button>`);
    return;
  }
  pkManClose(false);
}
function pkManClose(keep) {
  pkManScanStop();
  if (!(pkMan && pkMan.addTo)) { if (keep) pkManSaveDraft(); else try { localStorage.removeItem(PK_MAN_KEY); } catch (e) {} }   // черновик «новой закупки» не трогаем при добавлении в существующую
  const el = document.getElementById('pkMan'); if (el) el.classList.remove('on');
  document.body.classList.remove('pk-man-on');
  pkMan = null;
}
async function pkManSave() {
  if (!pkMan || !pkMan.items.length) return;
  if (typeof pkLimitCheck === 'function' && !pkLimitCheck(pkMan.items.length)) return;
  const b = document.getElementById('pkManSave'); b.disabled = true; b.textContent = 'Сохраняю…';
  if (pkMan.addTo) {   // дописываем в существующую закупку
    const A = pkMan.addTo;
    try {
      const add = pkMan.items.slice().reverse().map(x => { const o = { t: x.t, w: x.w || '', img: x.img || '', p: x.p || '', pc: '', q: '1' }; if (x.n) o.n = x.n; return o; });
      const ref = shipmentsRef().doc(A.id);
      await db.runTransaction(async tr => {
        const doc = await tr.get(ref); if (!doc.exists) throw new Error('закупка не найдена');
        const data = (doc.data().data || []).concat(add);
        if (JSON.stringify(data).length > 900000) throw new Error('закупка слишком большая — уберите фото у части товаров');
        tr.update(ref, { data });
      });
      const n = add.length;
      pkManClose(false);
      try { await loadShipments(); } catch (e) {}
      if (A.id === activeShipmentId) { try { await loadShipmentData(A.id, true); } catch (e) {} }
      showToast(`Добавлено в закупку · ${n} ${pkPl(n, 'позиция', 'позиции', 'позиций')}`);
      if (typeof A.onDone === 'function') A.onDone(n);
    } catch (e) {
      b.disabled = false; b.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Добавить в закупку';
      showToast('Не сохранилось: ' + (e.message || e));
    }
    return;
  }
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
// 09.11.2026: пока открыта шторка, страница позади не прокручивается (на iPhone фон «ездил» под пальцем).
// Фиксируем body на текущей прокрутке, при закрытии возвращаем на то же место. Только телефон/планшет.
let pkSheetY = null;
function pkScrollLock(on) {
  const b = document.body;
  if (on) {
    if (pkSheetY !== null || !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) return;
    pkSheetY = window.scrollY || 0;
    Object.assign(b.style, { position: 'fixed', top: -pkSheetY + 'px', left: '0', right: '0', width: '100%' });
  } else {
    if (pkSheetY === null) return;
    const y = pkSheetY; pkSheetY = null;
    Object.assign(b.style, { position: '', top: '', left: '', right: '', width: '' });
    window.scrollTo(0, y);
  }
}
function pkSheet(html) {
  const sh = document.getElementById('pkSheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  sh.scrollTop = 0;
  pkSheetSwipe(sh);
  pkScrollLock(true);
  document.getElementById('pkSheetBg').classList.add('on');
  cancelAnimationFrame(pkSheetRaf); pkSheetRaf = requestAnimationFrame(() => sh.classList.add('on'));
}
function pkSheetClose() {
  cancelAnimationFrame(pkSheetRaf);
  const sh = document.getElementById('pkSheet'), bg = document.getElementById('pkSheetBg');
  if (sh) sh.classList.remove('on'); if (bg) bg.classList.remove('on');
  pkScrollLock(false);
}
// 09.11.2026: шторку можно смахнуть вниз пальцем (как в iOS). Тянется, только если её содержимое
// прокручено до верха и жест вертикальный вниз; отпустили ниже 100 px (или резко) — закрываем, иначе возвращаем.
function pkSheetSwipe(sh) {
  if (sh._pkSw) return; sh._pkSw = true;
  let st = null;
  sh.addEventListener('touchstart', e => {
    st = (e.touches.length === 1 && sh.classList.contains('on')) ? { y: e.touches[0].clientY, x: e.touches[0].clientX, t: Date.now(), dy: 0, drag: false } : null;
  }, { passive: true });
  sh.addEventListener('touchmove', e => {
    if (!st) return;
    const dy = e.touches[0].clientY - st.y, dx = e.touches[0].clientX - st.x;
    if (!st.drag) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      if (dy > 0 && dy > Math.abs(dx) && sh.scrollTop <= 0) { st.drag = true; st.y += dy; st.t = Date.now(); sh.style.transition = 'none'; }
      else { st = null; return; }
    }
    e.preventDefault();
    st.dy = Math.max(0, e.touches[0].clientY - st.y);
    sh.style.transform = 'translateY(' + st.dy + 'px)';
  }, { passive: false });
  const end = () => {
    if (!st || !st.drag) { st = null; return; }
    const v = st.dy / Math.max(1, Date.now() - st.t);
    sh.style.transition = ''; sh.style.transform = '';
    if (st.dy > 100 || (st.dy > 40 && v > 0.5)) pkSheetClose();
    st = null;
  };
  sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
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

// ============ СТРАНА ПОЛЬЗОВАТЕЛЯ (04.11.2026) ============
// После входа (почта подтверждена): сервер ставит страну по IP; если IP не BY/RU/KZ — один раз спрашиваем.
let pkCtyAsked = false;
async function pkCountryCheck() {
  try {
    if (pkCtyAsked || !currentUser || !currentUser.emailVerified || !userProfile || userProfile.country || userProfile.role === 'admin') return;
    pkCtyAsked = true;
    const t = await currentUser.getIdToken();
    const j = await fetch('/api/country', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: t }) }).then(r => r.json());
    if (j && j.c) { userProfile.country = j.c; return; }
    if (j && j.ask) setTimeout(pkCountryAsk, 1200);
  } catch (e) {}
}
// Ненавязчиво: полоска внизу каждой страницы, висит, пока человек не ответит (без окон и лишних шагов)
function pkCountryAsk(step) {
  let b = document.getElementById('pkCtyBar');
  if (!b) { b = document.createElement('div'); b.id = 'pkCtyBar'; document.body.appendChild(b); }
  const ch = (on, t) => `<button type="button" onclick="${on}">${t}</button>`;
  b.innerHTML = step === 'other'
    ? `<span class="q"><i class="ti ti-currency-dollar"></i>В какой валюте показывать цены?</span><span class="c">${ch("pkCountryPick('OT','RUB')", '₽ Рубли РФ')}${ch("pkCountryPick('OT','BYN')", 'BYN')}${ch("pkCountryPick('OT','KZT')", '₸ Тенге')}${ch('pkCountryAsk()', '<i class="ti ti-arrow-left"></i>')}</span>`
    : `<span class="q"><i class="ti ti-world"></i>В какой стране вы работаете?</span><span class="c">${ch("pkCountryPick('BY')", 'Беларусь')}${ch("pkCountryPick('RU')", 'Россия')}${ch("pkCountryPick('KZ')", 'Казахстан')}${ch("pkCountryAsk('other')", 'Другая')}</span>`;
  b.style.display = 'flex';
}
// Нажал страну/валюту → полоска 10 с показывает «Вы выбрали …» с кнопкой «Изменить» (защита от случайного нажатия),
// без лишнего подтверждения: не нажал «Изменить» — сохраняем сами, полоска тихо уходит.
const PK_CTY_NAME = { BY: 'Беларусь', RU: 'Россия', KZ: 'Казахстан', OT: 'Другая страна' };
const PK_CTY_CUR = { BY: 'BYN', RU: 'RUB', KZ: 'KZT' };
const PK_CUR_TXT = { BYN: 'бел. рублях', RUB: 'рос. рублях', KZT: 'тенге' };
let pkCtyTimer = null;
function pkCountryPick(k, cur) {
  const b = document.getElementById('pkCtyBar'); if (!b) return;
  const c = k === 'OT' ? (cur || 'RUB') : PK_CTY_CUR[k];
  clearTimeout(pkCtyTimer);
  b.innerHTML = `<span class="q ok"><i class="ti ti-circle-check"></i><span>Вы выбрали: <b>${PK_CTY_NAME[k]}</b><small>Цены тарифов — в ${PK_CUR_TXT[c]}. Можно работать дальше.</small></span></span><span class="c"><button type="button" onclick="pkCountryUndo()">Изменить</button></span><i class="pr"></i>`;
  b.classList.add('done');
  pkCtyTimer = setTimeout(() => pkCountrySave(k, cur), 10000);
}
function pkCountryUndo() { clearTimeout(pkCtyTimer); const b = document.getElementById('pkCtyBar'); if (b) b.classList.remove('done'); pkCountryAsk(); }
async function pkCountrySave(k, cur) {
  const body = { pick: k };
  if (k === 'OT') body.cur = cur || 'RUB';
  const bar = document.getElementById('pkCtyBar');
  try {
    body.idToken = await currentUser.getIdToken();
    const j = await fetch('/api/country', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    if (j && j.c) {
      userProfile.country = j.c;
      if (j.cur) { userProfile.countryCur = j.cur; try { localStorage.setItem('pk_cur', j.cur); } catch (e) {} }
      if (bar) { bar.classList.add('out'); setTimeout(() => bar.remove(), 350); }
      return;
    }
  } catch (e) {}
  if (bar) bar.classList.remove('done');
  pkCountryAsk(); if (typeof showToast === 'function') showToast('Не сохранилось, попробуйте ещё раз');
}
