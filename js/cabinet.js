// ============ CABINET ============
let cabCurrentSection = 'overview';
let cabShipmentsCache = []; // кэш приходов для кабинета

function exitCabinet() {
  if (cabShipId) { cabShipId = null; restoreActiveEditing(); }
  document.getElementById('cabinetScreen').classList.remove('show');
  localStorage.removeItem('piksta_mode');
  document.getElementById('modeSelectScreen').classList.remove('hide');
  const hi = document.getElementById('modeSelectHi');
  if (hi) hi.textContent = 'Куда переходим, ' + (userProfile.name ? userProfile.name.split(' ')[0] : '') + '?';
}

async function openCabinet() {
  const isAdmin = userProfile && userProfile.role === 'admin';
  document.getElementById('cabAdminBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('cabAdminDivider').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('cabUserName').textContent = userProfile.name || currentUser.email;
  document.getElementById('cabUserRole').textContent = isAdmin ? 'Администратор' : 'Пользователь';
  // Клик по логотипу — на экран выбора режима (мобильный / десктопный)
  const logo = document.querySelector('.cab-sidebar-logo');
  if (logo) { logo.style.cursor = 'pointer'; logo.title = 'Выбор режима'; logo.onclick = exitCabinet; }
  await loadCabinetData();
  cabNav('overview');
}

async function loadCabinetData() {
  try {
    const docs = await fsList('users/' + savedUid + '/shipments');
    cabShipmentsCache = docs.map(d => ({ id: d.id, ...d.data() }));
    cabShipmentsCache.sort((a, b) => {
      const ta = a.created ? new Date(a.created).getTime() : 0;
      const tb = b.created ? new Date(b.created).getTime() : 0;
      return tb - ta;
    });
  } catch (e) { cabShipmentsCache = []; }
}

function cabNav(section) {
  if (cabShipId) { cabShipId = null; restoreActiveEditing(); }
  cabClientOpen = null;
  cabCurrentSection = section;
  document.querySelectorAll('#cabNav .cab-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
  const main = document.getElementById('cabMain');
  const renderers = {
    overview: renderCabOverview,
    shipments: renderCabShipments,
    clients: renderCabClients,
    prices: renderCabPrices,
    calc: renderCabCalc,
    analytics: renderCabAnalytics,
    settings: renderCabSettings,
    admin: renderCabAdmin
  };
  (renderers[section] || renderCabStub)(main, section);
}

// ============ УТИЛИТЫ ============
// ОПЛАТЫ клиента по приходу: ship.payments[имя] = { paid: сумма, at: дата }. Итог к оплате = due (с учётом ручной правки dueOverride).
// Старая отметка ship.paid[имя] = true считается полной оплатой.
const CAB_PAY_ST = {
  none: { label: 'Не оплачено', color: '#dc2626', bg: '#fee2e2' },
  part: { label: 'Частично',    color: '#b45309', bg: '#fef3c7' },
  full: { label: 'Оплачено',    color: '#16a34a', bg: '#dcfce7' }
};
function cabPayInfo(payments, legacyPaid, name, due, isOwner) {
  const p = (payments || {})[name];
  const paid = p && typeof p.paid === 'number' ? p.paid : ((legacyPaid || {})[name] ? due : 0);
  const rest = Math.max(0, Math.round((due - paid) * 100) / 100);
  const status = isOwner ? 'owner' : (due <= 0.004 || paid >= due - 0.004) ? 'full' : paid > 0.004 ? 'part' : 'none';
  return { paid, rest, status };
}
function cabPayBadge(st) {
  const x = CAB_PAY_ST[st];
  return x ? `<span style="font-size:13px;background:${x.bg};color:${x.color};padding:3px 8px;border-radius:5px;font-weight:600;white-space:nowrap">${x.label}</span>` : '';
}
// Атомарная запись одного поля-карты по имени клиента (транзакция + FieldPath: правки других клиентов и с других устройств не затираются)
async function cabTxMapField(shipId, field, name, value) {
  const ref = shipmentsRef().doc(shipId);
  const fp = new firebase.firestore.FieldPath(field, name);
  await db.runTransaction(async t => {
    const doc = await t.get(ref);
    if (!doc.exists) throw new Error('приход не найден');
    t.update(ref, fp, value === null ? firebase.firestore.FieldValue.delete() : value);
  });
  const ship = cabShipmentsCache.find(x => x.id === shipId);
  if (ship) {
    const m = { ...(ship[field] || {}) };
    if (value === null) delete m[name]; else m[name] = value;
    ship[field] = m;
  }
  if (shipId === (editingShipmentId || activeShipmentId) && field === 'dueOverride' && typeof currentDueOverride !== 'undefined') {
    if (value === null) delete currentDueOverride[name]; else currentDueOverride[name] = value;
  }
}
async function cabSavePayment(shipId, name, amount) {
  await cabTxMapField(shipId, 'payments', name, { paid: Math.round(amount * 100) / 100, at: new Date().toISOString() });
}
// Перерисовать текущий экран кабинета (для живой синхронизации), не сбрасывая открытую карточку клиента
function cabRerender() {
  const main = document.getElementById('cabMain');
  if (!main) return;
  if (cabShipId) { cabRenderShip(); return; }
  const r = { overview: renderCabOverview, shipments: renderCabShipments, clients: renderCabClients, prices: renderCabPrices, calc: renderCabCalc, analytics: renderCabAnalytics }[cabCurrentSection];
  if (r) r(main);
}
// Дата отправки из названия прихода: «Отправка 21-22.09.26» → 21.09.2026. Нет даты → null
function cabShipDate(ship) {
  const m = String((ship && ship.name) || '').match(/(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (!m) return null;
  const d = parseInt(m[1]), mo = parseInt(m[2]) - 1;
  if (d < 1 || d > 31 || mo < 0 || mo > 11) return null;
  let y = m[3] ? parseInt(m[3]) : new Date().getFullYear();
  if (y < 100) y += 2000;
  let dt = new Date(y, mo, d);
  if (!m[3] && dt > new Date()) dt = new Date(y - 1, mo, d);  // без года и «в будущем» — значит прошлый год
  return dt;
}
function cabShipDateStr(ship) {
  const d = cabShipDate(ship) || (ship && ship.created ? new Date(ship.created) : null);
  return d && !isNaN(d) ? d.toLocaleDateString('ru-RU') : '';
}
// Флаг клиента в приходе: явное значение в приходе, иначе правило из карточки клиента (clientRule в app.js)
function cabFlag(map, kind, name) {
  if (map && Object.prototype.hasOwnProperty.call(map, name)) return !!map[name];
  return typeof clientRule === 'function' ? !!clientRule(kind, name) : false;
}
const cabFmt = (v) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const cabFmt2 = (v) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function cabGetClientsFromShipment(ship) {
  const data = ship.data || [];
  const rates = ship.rates ? { ...DEFAULT_RATES, ...ship.rates } : { ...DEFAULT_RATES };
  const weights = ship.weights || {};
  const owners = ship.owners || {};
  const priceInclWeight = ship.priceInclWeight || {};
  const costGoods = ship.costGoods || {};
  const costShip = ship.costShip || {};
  const tare = ship.tare || 0;
  const cargoWeight = ship.cargoWeight || 0;

  const clientsSet = new Set();
  const buyYuan = {}, clientYuanMap = {}, itemCount = {};
  const canonName = {};
  for (const row of data) {
    const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
    // Делим склад так же, как мобильная версия: только по союзу « и » между словами.
    // Раньше делилось по любой букве «и» внутри имени — отсюда фейковые клиенты из одной-двух букв.
    const parts = splitWarehouses(r[1] || '');
    if (parts.length) {
      for (const p of parts) {
        const low = p.toLowerCase();
        if (!(low in canonName)) canonName[low] = p;  // первое написание — каноническое (как в мобильной)
        const name = canonName[low];
        if (name) {
          clientsSet.add(name);
          const buy = parseFloat(r[3]) || 0;
          const cli = parseFloat(r[4]) || buy;
          buyYuan[name] = (buyYuan[name] || 0) + buy / parts.length;
          clientYuanMap[name] = (clientYuanMap[name] || 0) + cli / parts.length;
          itemCount[name] = (itemCount[name] || 0) + 1;
        }
      }
    }
  }

  let totalW = 0;
  const cNames = Array.from(clientsSet);
  for (const n of cNames) totalW += (weights[n] || 0);
  const effectiveTare = Math.max(tare || 0, (cargoWeight || 0) - totalW);

  const result = [];
  for (const name of cNames) {
    const w = weights[name] || 0;
    const tareShare = totalW > 0 ? (w / totalW) * effectiveTare : 0;
    const shipWeight = w > 0 ? Math.ceil((w + tareShare) * 20) / 20 : 0;
    const goodsClient = (clientYuanMap[name] || 0) * rates.clientRate;
    const goodsCost = (buyYuan[name] || 0) * rates.buyRate;
    const shipCli = shipWeight * rates.shipClient;
    const shipCo = shipWeight * rates.shipCargo;
    const isOwner = cabFlag(owners, 'owner', name);
    const inclW = !!priceInclWeight[name];
    const cGoods = cabFlag(costGoods, 'costGoods', name);
    const cShip = cabFlag(costShip, 'costShip', name);
    let due, profit;
    if (isOwner) { due = 0; profit = -(goodsCost + shipCo); }
    else if (cGoods || cShip) {
      const gp = cGoods ? goodsCost : goodsClient;
      const sp = cShip ? shipCo : shipCli;
      due = gp + sp;
      profit = (cGoods ? 0 : goodsClient - goodsCost) + (cShip ? 0 : shipCli - shipCo);
    } else if (inclW) { due = goodsClient; profit = (goodsClient - goodsCost) - shipCo; }
    else { due = goodsClient + shipCli; profit = (goodsClient - goodsCost) + (shipCli - shipCo); }
    const ov = (ship.dueOverride || {})[name];
    const dueCalc = due;
    const dueEdited = !isOwner && ov !== undefined && ov !== null;
    if (dueEdited) { profit += ov - due; due = ov; }
    result.push({
      name, items: itemCount[name] || 0, weight: w, shipWeight,
      buyYuan: buyYuan[name] || 0, clientYuan: clientYuanMap[name] || 0,
      due, profit, isOwner, dueCalc, dueEdited, costGoodsOn: cGoods, costShipOn: cShip,
      ...(() => { const pi = cabPayInfo(ship.payments, ship.paid, name, due, isOwner); return { payPaid: pi.paid, payRest: pi.rest, payStatus: pi.status, paid: pi.status === 'full' }; })(),
      goodsClient, goodsCost, shipCli, shipCo
    });
  }
  return { clients: result, rates, totalW, effectiveTare };
}

// ============ ЗАГЛУШКА ============
function renderCabStub(container, section) {
  const names = {
    shipments: 'Приходы', clients: 'Клиенты', prices: 'Цены',
    calc: 'Расчёты', analytics: 'Аналитика', settings: 'Настройки', admin: 'Администрирование'
  };
  const icons = {
    shipments: 'ti-package', clients: 'ti-users', prices: 'ti-currency-yuan',
    calc: 'ti-calculator', analytics: 'ti-chart-bar', settings: 'ti-settings', admin: 'ti-shield-lock'
  };
  container.innerHTML = `
    <div class="cab-stub">
      <i class="ti ${icons[section] || 'ti-dots'}"></i>
      <div class="cab-stub-title">${names[section] || section}</div>
      <div class="cab-stub-text">Скоро</div>
    </div>`;
}

// Вес привезённого (рассортирован + архив): вес клиентов + тара, но не меньше веса от карго
function cabShipTotalKg(ship) {
  const { totalW, effectiveTare } = cabGetClientsFromShipment(ship);
  return Math.max(totalW + effectiveTare, ship.cargoWeight || 0);
}
function cabDeliveredKg(ships) {
  return ships.filter(s => s.status === 'sorted' || s.status === 'done').reduce((n, s) => n + cabShipTotalKg(s), 0);
}

// ============ ОБЗОР ============
function renderCabOverview(container) {
  const ships = cabShipmentsCache;
  const activeShips = ships.filter(s => s.status !== 'done').length;
  const totalClients = new Set();
  let grandDue = 0, grandProfit = 0;
  const shipSummaries = [];

  for (const ship of ships) {
    const { clients } = cabGetClientsFromShipment(ship);
    let shipDue = 0, shipProfit = 0;
    for (const c of clients) {
      totalClients.add(c.name);
      shipDue += c.due;
      shipProfit += c.profit;
    }
    grandDue += shipDue;
    grandProfit += shipProfit;
    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    shipSummaries.push({
      name: ship.name || 'Без названия',
      count: (ship.data || []).length,
      clients: clients.length,
      status: st.label, statusColor: st.color,
      due: shipDue, profit: shipProfit,
      isDone: ship.status === 'done'
    });
  }

  // Топ должников (не-done приходы)
  const clientDebt = {};
  for (const ship of ships) {
    if (ship.status === 'done') continue;
    const { clients } = cabGetClientsFromShipment(ship);
    for (const c of clients) {
      if (!c.isOwner) clientDebt[c.name] = (clientDebt[c.name] || 0) + c.due;
    }
  }
  const topDebtors = Object.entries(clientDebt).sort((a, b) => b[1] - a[1]).slice(0, 5);

  container.innerHTML = `
    <div class="cab-main-title">Обзор</div>
    <div class="cab-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="cab-stat-card">
        <div class="cab-stat-val">${ships.length}</div>
        <div class="cab-stat-label">Всего приходов</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${ships.filter(s=>s.status==='sorted'||s.status==='done').reduce((n,s)=>n+(s.data||[]).length,0)}</div>
        <div class="cab-stat-label">Привезено всего товаров</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${cabFmt2(cabDeliveredKg(ships))}</div>
        <div class="cab-stat-label">Привезено всего, кг</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${totalClients.size}</div>
        <div class="cab-stat-label">Всего клиентов</div>
      </div>
    </div>

    <div class="cab-table-wrap">
      <div class="cab-table-title">Приходы</div>
      <table class="cab-table">
        <thead><tr><th>Название</th><th>Позиций</th><th>Клиентов</th><th>Статус</th><th>Должны BYN</th><th>Прибыль BYN</th></tr></thead>
        <tbody>
          ${shipSummaries.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:20px">Нет приходов</td></tr>' :
            shipSummaries.map(s => `<tr style="${s.isDone ? 'opacity:0.55' : ''}">
              <td style="font-weight:500">${s.name}</td>
              <td>${s.count}</td>
              <td>${s.clients}</td>
              <td><span class="status-dot" style="background:${s.statusColor}"></span>${s.status}</td>
              <td class="val-purple">${cabFmt(s.due)}</td>
              <td class="${s.profit >= 0 ? 'val-green' : 'val-red'}">${s.profit >= 0 ? '+' : ''}${cabFmt(s.profit)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

  `;
}

// ============ ПРИХОДЫ ============
function renderCabShipments(container) {
  const ships = cabShipmentsCache;
  // Фильтры
  const filterHtml = `
    <div class="cab-filter-row">
      <button class="cab-filter-btn active" data-f="all" onclick="cabFilterShipments('all',this)">Все (${ships.length})</button>
      <button class="cab-filter-btn" data-f="active" onclick="cabFilterShipments('active',this)">Активные (${ships.filter(s=>s.status!=='done').length})</button>
      <button class="cab-filter-btn" data-f="done" onclick="cabFilterShipments('done',this)">Архив (${ships.filter(s=>s.status==='done').length})</button>
    </div>`;

  const rows = ships.map(ship => {
    const { clients } = cabGetClientsFromShipment(ship);
    let due = 0, profit = 0;
    for (const c of clients) { due += c.due; profit += c.profit; }
    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const date = ship.created ? new Date(ship.created).toLocaleDateString('ru-RU') : '—';
    const isDone = ship.status === 'done';
    const departed = (ship.departed && ship.status !== 'sorted' && ship.status !== 'done') ? '<i class="ti ti-truck" style="color:#3cb371;font-size:14px" title="Выехала"></i>' : '';
    return `<tr class="cab-ship-row" data-status="${isDone ? 'done' : 'active'}" style="${isDone ? 'opacity:0.55' : ''}">
      <td style="font-weight:500">${isDone ? (ship.name || 'Без названия') : `<a href="#" onclick="cabOpenShip('${ship.id}');return false" style="color:#6C4DB8;text-decoration:none">${ship.name || 'Без названия'}</a>`}</td>
      <td>${date}</td>
      <td>${(ship.data || []).length}</td>
      <td>${clients.length}</td>
      <td><span class="status-dot" style="background:${st.color}"></span>${st.label} ${departed}</td>
      <td class="val-purple">${cabFmt(due)}</td>
      <td class="${profit >= 0 ? 'val-green' : 'val-red'}">${profit >= 0 ? '+' : ''}${cabFmt(profit)}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="cab-main-title">Приходы</div>
    ${filterHtml}
    <div class="cab-table-wrap">
      <table class="cab-table" id="cabShipmentsTable">
        <thead><tr><th>Название</th><th>Дата</th><th>Позиций</th><th>Клиентов</th><th>Статус</th><th>Должны</th><th>Прибыль</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px">Нет приходов</td></tr>'}</tbody>
      </table>
    </div>`;
}

function cabFilterShipments(filter, btn) {
  document.querySelectorAll('.cab-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.cab-ship-row').forEach(row => {
    const st = row.dataset.status;
    row.style.display = (filter === 'all' || filter === st) ? '' : 'none';
  });
}

// ============ ПРИХОД: ОТКРЫТИЕ В КАБИНЕТЕ ============
let cabShipId = null;
let cabShipTab = 'items';
const cabInp = 'padding:6px 8px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;box-sizing:border-box';

async function cabOpenShip(id) {
  if (!activeShipmentId) activeShipmentId = id;
  cabShipId = id;
  cabShipTab = 'items';
  document.getElementById('cabMain').innerHTML = '<div class="cab-main-title">Загрузка…</div>';
  await loadShipmentData(id, true);
  cabRenderShip();
}

async function cabCloseShip() {
  cabShipId = null;
  await restoreActiveEditing();
  await loadCabinetData();
  cabNav('shipments');
}

function cabShipTabSet(t) { cabShipTab = t; cabRenderShip(); }

function cabRenderShip() {
  const ship = cabShipmentsCache.find(s => s.id === cabShipId) || {};
  const calc = computeClientCalc();
  const order = ['forming','transit','warehouse','sorted','done'];
  const opts = order.map(k => `<option value="${k}" ${(ship.status || 'forming') === k ? 'selected' : ''}>${SHIP_STATUSES[k].label}</option>`).join('');
  const tabs = [['items','Товары и цены'],['weigh','Взвешивание'],['calc','Расчёт'],['rates','Курсы']]
    .map(([k, l]) => `<button class="cab-filter-btn ${cabShipTab === k ? 'active' : ''}" onclick="cabShipTabSet('${k}')">${l}</button>`).join('');
  let body = '';
  if (cabShipTab === 'items') body = cabShipItemsHtml();
  else if (cabShipTab === 'weigh') body = cabShipWeighHtml();
  else if (cabShipTab === 'calc') body = cabShipCalcHtml(calc);
  else body = cabShipRatesHtml();
  document.getElementById('cabMain').innerHTML = `
    <a href="#" onclick="cabCloseShip();return false" style="display:inline-flex;align-items:center;gap:4px;color:#6C4DB8;text-decoration:none;font-size:14px;margin-bottom:10px"><i class="ti ti-arrow-left"></i> Все приходы</a>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:nowrap;margin-bottom:14px">
      <div class="cab-main-title" style="margin:0">${ship.name || 'Без названия'}</div>
      <button onclick="cabRenameShip()" title="Переименовать" style="border:none;background:none;color:#6b7280;cursor:pointer;font-size:16px"><i class="ti ti-pencil"></i></button>
      <select onchange="cabSetStatus(this.value)" style="${cabInp};margin-left:auto">${opts}</select>
    </div>
    <div class="cab-stats" style="grid-template-columns:repeat(5,1fr)">
      <div class="cab-stat-card"><div class="cab-stat-val">${TABLE.length}</div><div class="cab-stat-label">Позиций</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${calc.clients.length}</div><div class="cab-stat-label">Клиентов</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt2(calc.ourWeight)}</div><div class="cab-stat-label">Вес клиентов, кг</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#6C4DB8">${cabFmt(calc.grandDue)}</div><div class="cab-stat-label">Должны, BYN</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val ${calc.grandProfit >= 0 ? 'green' : ''}">${calc.grandProfit >= 0 ? '+' : ''}${cabFmt(calc.grandProfit)}</div><div class="cab-stat-label">Прибыль, BYN</div></div>
    </div>
    <div class="cab-filter-row">${tabs}</div>
    ${body}`;
}

async function cabSetStatus(key) {
  const ship = cabShipmentsCache.find(s => s.id === cabShipId);
  if (ship) ship.status = key;
  const s2 = (typeof allShipments !== 'undefined') ? allShipments.find(s => s.id === cabShipId) : null;
  if (s2) s2.status = key;
  try { await shipmentsRef().doc(cabShipId).update({ status: key }); } catch (e) { alert('Не удалось сохранить статус'); }
  if (typeof renderShipmentCards === 'function') renderShipmentCards();
}

async function cabRenameShip() {
  await renameShipment(cabShipId);
  await loadCabinetData();
  cabRenderShip();
}

// ---- Товары и цены ----
let cabItemSort = 'track';  // 'track' — как в приходе (по трек-кодам), 'wh' — по складам

function cabSetItemSort(m) { cabItemSort = m; cabRenderShip(); }

function cabShipItemsHtml() {
  let order = TABLE.map((r, i) => i);
  if (cabItemSort === 'wh') {
    const key = i => (TABLE[i][1] || '').trim().toLowerCase();
    order.sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (!ka && kb) return 1;
      if (ka && !kb) return -1;
      return ka.localeCompare(kb, 'ru') || a - b;
    });
  }
  const whCount = {};
  for (const r of TABLE) { const k = (r[1] || '').trim().toLowerCase(); whCount[k] = (whCount[k] || 0) + 1; }
  let lastWh = null;
  const rows = order.map(i => {
    const r = TABLE[i];
    let head = '';
    if (cabItemSort === 'wh') {
      const k = (r[1] || '').trim().toLowerCase();
      if (k !== lastWh) {
        lastWh = k;
        head = `<tr class="cab-item-grp"><td colspan="5" style="background:#f0ecf9;color:#6C4DB8;font-weight:600;padding:8px 10px">${(r[1] || '').trim() || 'Без склада'} <span style="font-weight:400;color:#6b7280">· ${whCount[k]}</span></td></tr>`;
      }
    }
    const qty = parseInt(r[5]) || 1;
    const img = r[2] ? `<img src="${r[2]}" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block">` : '<div style="width:44px;height:44px;border-radius:6px;background:#f3f4f6"></div>';
    return head + `<tr class="cab-item-row" data-q="${((r[0] || '') + ' ' + (r[1] || '')).toLowerCase()}">
      <td style="width:52px">${img}</td>
      <td style="font-family:monospace;font-size:13px;color:#4a5260">${r[0] || ''}${qty > 1 ? ` <span style="background:#f59e0b;color:#fff;border-radius:4px;padding:1px 5px;font-size:12px;font-weight:700">×${qty}</span>` : ''}</td>
      <td><input data-idx="${i}" value="${(r[1] || '').replace(/"/g, '&quot;')}" onchange="cabEditCell(this,1)" placeholder="клиент" style="${cabInp};width:100%;color:#6C4DB8"></td>
      <td><input data-idx="${i}" value="${r[3] || ''}" onchange="cabEditCell(this,3)" inputmode="decimal" placeholder="—" style="${cabInp};width:80px"></td>
      <td><input data-idx="${i}" value="${r[4] || ''}" onchange="cabEditCell(this,4)" inputmode="decimal" placeholder="${r[3] || '—'}" style="${cabInp};width:80px;color:#6C4DB8"></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <div style="display:flex;gap:10px;flex-wrap:nowrap;align-items:center;margin-bottom:12px">
      <input oninput="cabFilterItems(this.value)" placeholder="Поиск по треку или клиенту" style="${cabInp};width:100%;max-width:340px">
      <div style="display:flex;gap:6px;margin-left:auto">
        <button class="cab-filter-btn ${cabItemSort === 'track' ? 'active' : ''}" onclick="cabSetItemSort('track')">По трек-кодам</button>
        <button class="cab-filter-btn ${cabItemSort === 'wh' ? 'active' : ''}" onclick="cabSetItemSort('wh')">По складам</button>
      </div>
    </div>
    <table class="cab-table">
      <thead><tr><th></th><th>Трек</th><th>Клиент</th><th>Закупка ¥</th><th>Клиент ¥</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:20px">Нет товаров</td></tr>'}</tbody>
    </table>
  </div>`;
}

function cabFilterItems(q) {
  const s = q.trim().toLowerCase();
  document.querySelectorAll('.cab-item-row').forEach(tr => {
    tr.style.display = (!s || tr.dataset.q.includes(s)) ? '' : 'none';
  });
  document.querySelectorAll('.cab-item-grp').forEach(tr => { tr.style.display = s ? 'none' : ''; });
}

async function cabEditCell(inp, col) {
  const idx = parseInt(inp.dataset.idx);
  if (!TABLE[idx]) return;
  let v = inp.value.trim();
  if (col === 1) { v = resolveClientName(v); inp.value = v; }
  TABLE[idx][col] = v;
  try {
    const ref = shipmentsRef().doc(cabShipId);
    await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const data = doc.data().data;
      if (!data || !data[idx]) return;
      if (Array.isArray(data[idx])) data[idx][col] = String(v);
      else data[idx][col === 1 ? 'w' : col === 3 ? 'p' : 'pc'] = String(v);
      t.update(ref, { data });
    });
    inp.style.borderColor = '#3cb371';
    setTimeout(() => { inp.style.borderColor = '#d5d8dd'; }, 800);
  } catch (e) { alert('Не удалось сохранить: ' + e.message); }
}

// ---- Взвешивание ----
function cabShipWeighHtml() {
  const { names, counts } = getClientsInShipment();
  const rows = names.map(n => {
    const enc = encodeURIComponent(n);
    const g = currentWeights[n] ? Math.round(currentWeights[n] * 1000) : '';
    const incl = !!currentPriceInclWeight[n];
    return `<tr>
      <td style="font-weight:500">${n}</td>
      <td>${counts[n]}</td>
      <td><input data-name="${enc}" value="${g}" onchange="cabSetWeight(this)" inputmode="numeric" placeholder="граммы" ${incl ? 'disabled' : ''} style="${cabInp};width:110px"></td>
      <td><label style="font-size:13px;color:#5f6470;display:flex;align-items:center;gap:6px"><input type="checkbox" data-name="${enc}" ${incl ? 'checked' : ''} onchange="cabSetIncl(this)"> вес в цене</label></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <div style="display:flex;gap:16px;flex-wrap:nowrap;align-items:flex-end;margin-bottom:16px">
      <label style="font-size:13px;color:#5f6470">Вес от карго, г<br><input value="${currentCargoWeight ? Math.round(currentCargoWeight * 1000) : ''}" onchange="cabSetCargo(this)" inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:13px;color:#5f6470">Вес тары, г<br><input value="${currentTare ? Math.round(currentTare * 1000) : ''}" onchange="cabSetTare(this)" inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:14px;color:#1a1a2e;display:flex;align-items:center;gap:6px;padding-bottom:6px"><input type="checkbox" ${shipmentDeparted ? 'checked' : ''} onchange="cabSetDeparted(this)"> Отправка выехала в карго</label>
    </div>
    <table class="cab-table">
      <thead><tr><th>Клиент</th><th>Позиций</th><th>Вес, г</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
    </table>
  </div>`;
}

function cabSetWeight(inp) {
  const n = decodeURIComponent(inp.dataset.name);
  const kg = (parseFloat(inp.value) || 0) / 1000;
  if (kg > 0) currentWeights[n] = kg; else delete currentWeights[n];
  saveWeights();
}

function cabSetIncl(inp) {
  const n = decodeURIComponent(inp.dataset.name);
  if (inp.checked) currentPriceInclWeight[n] = true; else delete currentPriceInclWeight[n];
  saveWeights();
  cabRenderShip();
}

function cabSetTare(inp) {
  currentTare = (parseFloat(inp.value) || 0) / 1000;
  saveWeights();
}

function cabSetCargo(inp) {
  currentCargoWeight = (parseFloat(inp.value) || 0) / 1000;
  shipmentsRef().doc(cabShipId).update({ cargoWeight: currentCargoWeight });
}

async function cabSetDeparted(inp) {
  shipmentDeparted = inp.checked;
  const key = shipmentDeparted ? 'transit' : 'forming';
  await shipmentsRef().doc(cabShipId).update({ departed: shipmentDeparted });
  await cabSetStatus(key);
  cabRenderShip();
}

// ---- Расчёт ----
function cabShipCalcHtml(calc) {
  const chk = (field, c, label) => `<label style="font-size:14px;color:#4a5260;display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer"><input type="checkbox" ${field[c.name] ? 'checked' : ''} data-name="${encodeURIComponent(c.name)}" onchange="cabToggleCost(this,'${field === currentCostGoods ? 'goods' : 'ship'}')"> ${label}</label>`;
  const shipC = cabShipmentsCache.find(s => s.id === cabShipId) || {};
  const pinp = 'padding:5px 7px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;width:86px;box-sizing:border-box';
  const rows = calc.clients.map(c => {
    const pi = cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, c.isOwner);
    const payCells = c.isOwner ? '<td>—</td><td>—</td><td></td>'
      : `<td style="font-weight:600;white-space:nowrap;color:${pi.rest > 0.004 ? '#dc2626' : '#16a34a'}">${cabFmt2(pi.rest)}</td>
         <td><input value="${pi.paid ? pi.paid.toFixed(2) : ''}" placeholder="0" onchange="cabCardSetPaid('${cabShipId}','${encodeURIComponent(c.name)}',this.value)" inputmode="decimal" style="${pinp}"></td>
         <td><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" title="Полностью оплачено" ${pi.status === 'full' ? 'checked' : ''} onchange="cabCardSetPaid('${cabShipId}','${encodeURIComponent(c.name)}', this.checked ? '${c.due.toFixed(2)}' : '0')">${cabPayBadge(pi.status)}</label></td>`;
    const dueCell = c.isOwner ? '—'
      : `<a href="#" onclick="cabEditDue('${encodeURIComponent(c.name)}');return false" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + cabFmt2(c.dueCalc) + '. Нажмите, чтобы изменить' : 'Нажмите, чтобы изменить задолженность'}" style="color:#6C4DB8;text-decoration:none;border-bottom:1px dashed #b9a8e3">${cabFmt2(c.due)}</a>${c.dueEdited ? ' <i class="ti ti-pencil" style="font-size:14px;color:#f59e0b" title="Исправлено вручную"></i>' : ''}`;
    return `<tr style="${c.isOwner ? 'background:#fef2f2' : ''}">
      <td style="font-weight:500">${c.name}${c.noWeight ? ' <span title="Вес не указан" style="color:#f59e0b">⚠</span>' : ''}</td>
      <td style="white-space:nowrap">${c.count}</td>
      <td style="white-space:nowrap">${cabFmt2(c.shipWeight)}</td>
      <td style="white-space:nowrap">${cabFmt2(c.goodsClient)}</td>
      <td style="white-space:nowrap">${cabFmt2(c.shipClient)}</td>
      <td class="val-purple" style="white-space:nowrap">${dueCell}</td>
      <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}" style="white-space:nowrap">${c.profit >= 0 ? '+' : ''}${cabFmt2(c.profit)}</td>
      ${payCells}
      <td><div style="display:flex;flex-direction:column;gap:3px">${chk(currentCostGoods, c, 'Товар по себест.')}${chk(currentCostShip, c, 'Доставка по себест.')}</div></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button onclick="cabShipPDF()" style="background:#6C4DB8;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:500;cursor:pointer"><i class="ti ti-download"></i> PDF</button>
    </div>
    <div style="overflow-x:auto;margin:0 -4px;padding:0 4px">
    <table class="cab-table" style="background:#fff">
      <thead><tr><th>Клиент</th><th>Поз.</th><th>Вес с тарой, кг</th><th>Товар BYN</th><th>Доставка BYN</th><th>Должен BYN</th><th>Прибыль BYN</th><th>Остаток</th><th>Оплачено</th><th>Оплата</th><th>По себестоимости</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="11" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:600"><td>Итого</td><td colspan="4" style="white-space:nowrap">Тара: ${cabFmt2(calc.tareTotal)} кг</td><td class="val-purple" style="white-space:nowrap">${cabFmt2(calc.grandDue)}</td><td class="${calc.grandProfit >= 0 ? 'val-green' : 'val-red'}" style="white-space:nowrap">${calc.grandProfit >= 0 ? '+' : ''}${cabFmt2(calc.grandProfit)}</td><td style="color:#dc2626;white-space:nowrap">${cabFmt2(calc.clients.reduce((n, c) => n + (c.isOwner ? 0 : cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, false).rest), 0))}</td><td></td><td></td><td></td></tr></tfoot>
    </table>
    </div>
  </div>`;
}

function cabToggleCost(inp, kind) {
  const n = decodeURIComponent(inp.dataset.name);
  const map = kind === 'goods' ? currentCostGoods : currentCostShip;
  map[n] = inp.checked;  // явное значение только для этого прихода
  saveOwners();
  cabRenderShip();
}

async function cabEditDue(encName) {
  const n = decodeURIComponent(encName);
  if (!confirm('Вы точно хотите изменить задолженность клиента «' + n + '»?')) return;
  const c = computeClientCalc().clients.find(x => x.name === n);
  const cur = c ? c.due.toFixed(2) : '';
  const v = prompt('Новая сумма задолженности, BYN' + (c ? ' (по расчёту: ' + c.dueCalc.toFixed(2) + ')' : '') + '.\nОставьте пустым, чтобы вернуть расчётную.', cur);
  if (v === null) return;
  const t = v.trim().replace(',', '.');
  let val = null;
  if (t !== '') {
    const num = parseFloat(t);
    if (isNaN(num) || num < 0) { alert('Введите сумму числом'); return; }
    val = Math.round(num * 100) / 100;
  }
  try { await cabTxMapField(cabShipId, 'dueOverride', n, val); } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  cabRenderShip();
}

function cabShipPDF() {
  const sel = document.getElementById('shipmentSelect');
  const old = sel ? sel.value : null;
  if (sel) sel.value = cabShipId;
  exportCalcPDF();
  if (sel) sel.value = old;
}

// ---- Курсы ----
function cabShipRatesHtml() {
  const f = [['clientRate','Курс клиента, BYN за ¥'],['buyRate','Курс закупки, BYN за ¥'],['shipClient','Доставка клиенту, BYN/кг'],['shipCargo','Доставка карго, BYN/кг']];
  return `<div class="cab-table-wrap" style="max-width:520px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${f.map(([k, l]) => `<label style="font-size:13px;color:#5f6470">${l}<br><input value="${currentRates[k]}" onchange="cabSetRate('${k}',this)" inputmode="decimal" style="${cabInp};width:100%;margin-top:4px"></label>`).join('')}
    </div>
  </div>`;
}

function cabSetRate(key, inp) {
  currentRates[key] = parseFloat(String(inp.value).replace(',', '.')) || 0;
  saveRates();
}

// ============ КЛИЕНТЫ ============
let cabClientOpen = null;            // имя клиента, чья карточка открыта
let cabClientFilter = 'all';         // фильтр списка: all / new / active / regular / forgotten
const cabClientShipOpen = new Set(); // развёрнутые приходы в карточке клиента
const CAB_CLIENT_STATUS = {
  new:       { label: 'Новый',    bg: '#ede9fe', color: '#6C4DB8' },
  active:    { label: 'Активный', bg: '#dcfce7', color: '#16a34a' },
  regular:   { label: 'Обычный',  bg: '#f3f4f6', color: '#4a5260' },
  forgotten: { label: 'Забытый',  bg: '#fef3c7', color: '#b45309' }
};

// Сводка по всем клиентам и всем приходам (единый расчёт для счётчиков, таблицы и карточки)
function cabClientsSummary() {
  const ships = cabShipmentsCache;            // свежие сверху
  const latestIds = ships.slice(0, 2).map(s => s.id);
  const map = {};
  let totalItemsDb = 0, noClientItems = 0, sharedItems = 0, sharedExtra = 0;
  for (const ship of ships) {
    for (const row of (ship.data || [])) {
      const r = Array.isArray(row) ? row : [row.t, row.w];
      totalItemsDb++;
      const parts = splitWarehouses(r[1] || '');
      if (!parts.length) noClientItems++;
      else if (parts.length > 1) { sharedItems++; sharedExtra += parts.length - 1; }
    }
    const { clients } = cabGetClientsFromShipment(ship);
    for (const c of clients) {
      const key = c.name.toLowerCase();
      if (!map[key]) map[key] = { name: c.name, ships: [], totalItems: 0, totalDue: 0, totalProfit: 0, totalWeight: 0, unpaidDue: 0, isOwner: false };
      const m = map[key];
      m.ships.push({ ship, c });
      m.totalItems += c.items;
      m.totalDue += c.due;
      m.totalProfit += c.profit;
      m.totalWeight += c.weight;
      if (c.isOwner) m.isOwner = true;
      if (!c.isOwner) m.unpaidDue += c.payRest;
    }
  }
  const list = Object.values(map);
  for (const m of list) {
    const ids = m.ships.map(x => x.ship.id);
    const inLatest = latestIds.length > 0 && ids.includes(latestIds[0]);
    const inBoth = latestIds.length === 2 && latestIds.every(id => ids.includes(id));
    if (ids.length === 1 && inLatest) m.status = 'new';                          // впервые в самом свежем приходе
    else if (inBoth) m.status = 'active';                                        // в двух последних приходах
    else if (ids.length === 1 && !latestIds.includes(ids[0])) m.status = 'forgotten'; // один приход и он не из двух последних
    else m.status = 'regular';
  }
  const clientItemsSum = list.reduce((n, m) => n + m.totalItems, 0);
  return { list, totalItemsDb, noClientItems, sharedItems, sharedExtra, clientItemsSum };
}

function cabSetClientFilter(f) { cabClientFilter = f; renderCabClients(document.getElementById('cabMain')); }

function renderCabClients(container) {
  if (cabClientOpen) { cabRenderClientCard(container, cabClientOpen); return; }
  const S = cabClientsSummary();
  const all = S.list.sort((a, b) => b.unpaidDue - a.unpaidDue || a.name.localeCompare(b.name, 'ru'));
  const cnt = k => all.filter(c => c.status === k).length;
  const totalUnpaid = all.reduce((n, m) => n + m.unpaidDue, 0);
  const debtors = all.filter(m => m.unpaidDue > 0.005).length;
  const okSum = S.clientItemsSum - S.sharedExtra + S.noClientItems === S.totalItemsDb;
  const list = cabClientFilter === 'all' ? all : all.filter(c => c.status === cabClientFilter);

  const rows = list.map(c => {
    const st = CAB_CLIENT_STATUS[c.status];
    const ownerBadge = c.isOwner ? ' <span style="font-size:12px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-weight:600">свой</span>' : '';
    return `<tr>
      <td style="font-weight:500"><a href="#" onclick="cabOpenClient('${encodeURIComponent(c.name)}');return false" style="color:#6C4DB8;text-decoration:none">${c.name}</a>${ownerBadge}</td>
      <td><span style="font-size:13px;background:${st.bg};color:${st.color};padding:3px 8px;border-radius:5px;font-weight:600">${st.label}</span></td>
      <td>${c.ships.length}</td>
      <td>${c.totalItems}</td>
      <td>${c.totalWeight > 0 ? c.totalWeight.toFixed(2) + ' кг' : '—'}</td>
      <td class="val-purple">${c.unpaidDue > 0.005 ? cabFmt(c.unpaidDue) : '<span style="color:#16a34a">0</span>'}</td>
      <td>${cabFmt(c.totalDue)}</td>
      <td class="${c.totalProfit >= 0 ? 'val-green' : 'val-red'}">${c.totalProfit >= 0 ? '+' : ''}${cabFmt(c.totalProfit)}</td>
    </tr>`;
  }).join('');

  const fbtn = (k, l) => `<button onclick="cabSetClientFilter('${k}')" style="border:none;background:${cabClientFilter === k ? '#f0ecf9' : 'none'};color:${cabClientFilter === k ? '#6C4DB8' : '#6b7280'};font-weight:${cabClientFilter === k ? 600 : 500};font-size:14px;padding:5px 10px;border-radius:6px;cursor:pointer">${l}</button>`;

  container.innerHTML = `
    <div class="cab-main-title">Клиенты</div>
    <div class="cab-stats" style="grid-template-columns:repeat(6,1fr)">
      <div class="cab-stat-card"><div class="cab-stat-val">${all.length}</div><div class="cab-stat-label">Всего клиентов</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#6C4DB8">${cnt('new')}</div><div class="cab-stat-label">Новых клиентов</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#16a34a">${cnt('active')}</div><div class="cab-stat-label">Активных клиентов</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#b45309">${cnt('forgotten')}</div><div class="cab-stat-label">Забытых клиентов</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#6C4DB8">${cabFmt(totalUnpaid)}</div><div class="cab-stat-label">Текущая задолженность, BYN</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${debtors}</div><div class="cab-stat-label">Должников</div></div>
    </div>
    <div style="font-size:13px;color:${okSum ? '#4a5260' : '#dc2626'};margin:-14px 0 16px">
      Сверка позиций: в базе ${S.totalItemsDb} = у клиентов ${S.clientItemsSum}${S.sharedExtra ? ' − повторы общих ' + S.sharedExtra : ''}${S.noClientItems ? ' + без клиента ' + S.noClientItems : ''} ${okSum ? '✓' : '— не сходится'}
    </div>
    <div class="cab-table-wrap">
      <div style="display:flex;gap:2px;flex-wrap:nowrap;margin-bottom:10px">
        ${fbtn('all', 'Все')}${fbtn('new', 'Новые')}${fbtn('active', 'Активные')}${fbtn('regular', 'Обычные')}${fbtn('forgotten', 'Забытые')}
      </div>
      <table class="cab-table">
        <thead><tr><th>Клиент</th><th>Статус</th><th>Приходов</th><th>Позиций</th><th>Вес</th><th>Долг (не оплачено)</th><th>Всего BYN</th><th>Прибыль</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
      </table>
    </div>`;
}

function cabOpenClient(encName) {
  cabClientOpen = decodeURIComponent(encName);
  cabClientShipOpen.clear();
  renderCabClients(document.getElementById('cabMain'));
}
function cabCloseClient() {
  cabClientOpen = null;
  renderCabClients(document.getElementById('cabMain'));
}
function cabToggleClientShip(id) {
  if (cabClientShipOpen.has(id)) cabClientShipOpen.delete(id); else cabClientShipOpen.add(id);
  renderCabClients(document.getElementById('cabMain'));
}

// Увеличение картинки товара по клику
function cabZoomImg(src) {
  let ov = document.getElementById('cabImgZoom');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'cabImgZoom';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,0.75);z-index:200;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    ov.onclick = () => { ov.style.display = 'none'; };
    ov.innerHTML = '<img style="max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.4);background:#fff">';
    document.body.appendChild(ov);
  }
  ov.querySelector('img').src = src;
  ov.style.display = 'flex';
}

function cabRenderClientCard(container, name) {
  const S = cabClientsSummary();
  const m = S.list.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!m) { cabClientOpen = null; renderCabClients(container); return; }
  const low = name.toLowerCase();
  const enc = encodeURIComponent(m.name);
  const st = CAB_CLIENT_STATUS[m.status];
  const rule = k => !!clientRule(k, m.name);
  const ruleChk = (k, label) => `<label style="display:flex;align-items:center;gap:7px;font-size:15px;cursor:pointer;color:#1a1a2e"><input type="checkbox" ${rule(k) ? 'checked' : ''} onchange="cabSetClientRule('${enc}','${k}',this.checked)"> ${label}</label>`;

  const shipsHtml = m.ships.map(({ ship, c }) => {
    const open = cabClientShipOpen.has(ship.id);
    const date = cabShipDateStr(ship);
    const sst = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const inp = 'padding:5px 7px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;width:92px;box-sizing:border-box';
    const paidHtml = c.isOwner ? '<span style="font-size:13px;color:#dc2626">свой склад</span>'
      : `<div onclick="event.stopPropagation()" style="display:flex;align-items:flex-end;gap:14px;flex-wrap:nowrap;cursor:default">
          <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#6b7280">Итого<input value="${c.due.toFixed(2)}" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + c.dueCalc.toFixed(2) + '. Пусто — вернуть расчётную' : 'Можно исправить сумму. Пусто — вернуть расчётную'}" onchange="cabCardSetDue('${ship.id}','${enc}',this.value)" inputmode="decimal" style="${inp};color:#6C4DB8;font-weight:600${c.dueEdited ? ';border-color:#f59e0b' : ''}"></label>
          <label style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#6b7280">Оплачено<input value="${c.payPaid ? c.payPaid.toFixed(2) : ''}" placeholder="0" onchange="cabCardSetPaid('${ship.id}','${enc}',this.value)" inputmode="decimal" style="${inp}"></label>
          <div style="display:flex;flex-direction:column;gap:3px;font-size:12px;color:#6b7280;min-width:70px">Остаток<b style="font-size:14px;line-height:30px;white-space:nowrap;color:${c.payRest > 0.004 ? '#dc2626' : '#16a34a'}">${cabFmt2(c.payRest)}</b></div>
          <label style="padding-bottom:5px;display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" title="Отметить полностью оплаченным" ${c.payStatus === 'full' ? 'checked' : ''} onchange="cabCardSetPaid('${ship.id}','${enc}', this.checked ? '${c.due.toFixed(2)}' : '0')" style="width:16px;height:16px;cursor:pointer">${cabPayBadge(c.payStatus)}</label>
        </div>`;
    let items = '';
    if (open) {
      const rows = (ship.data || []).map(row => Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'])
        .filter(r => splitWarehouses(r[1] || '').some(p => p.toLowerCase() === low))
        .map(r => {
          const parts = splitWarehouses(r[1] || '');
          const shared = parts.length > 1 ? ` <span style="font-size:12px;color:#6b7280">(общий: ${r[1]})</span>` : '';
          const price = parseFloat(r[4]) || parseFloat(r[3]) || 0;
          const img = r[2] ? `<img src="${r[2]}" loading="lazy" onclick="cabZoomImg(this.src)" title="Увеличить" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block;cursor:zoom-in">` : '<div style="width:44px;height:44px;border-radius:6px;background:#f3f4f6"></div>';
          return `<tr><td style="width:52px">${img}</td><td style="font-family:monospace;font-size:13px;color:#4a5260">${r[0] || ''}${shared}</td><td>${price ? cabFmt2(price) + ' ¥' : '—'}${(parseInt(r[5]) || 1) > 1 ? ' ×' + r[5] : ''}</td></tr>`;
        }).join('');
      items = `<div style="padding:4px 0 6px">
        <div style="font-size:13px;color:#6b7280;margin:6px 0 8px">Вес клиента в приходе: <b style="color:#1a1a2e">${c.weight > 0 ? c.weight.toFixed(2) + ' кг' : 'не взвешен'}</b>${c.shipWeight > 0 ? ' · с тарой ' + c.shipWeight.toFixed(2) + ' кг' : ''} (вес вводится на клиента целиком, не по товарам)</div>
        <table class="cab-table"><thead><tr><th></th><th>Трек-код</th><th>Цена клиента</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="color:#6b7280">Нет товаров</td></tr>'}</tbody></table>
      </div>`;
    }
    return `<div style="border:1px solid #dfe2e7;border-radius:10px;margin-bottom:10px;background:#fff">
      <div onclick="cabToggleClientShip('${ship.id}')" style="display:flex;align-items:center;gap:14px;padding:12px 14px;cursor:pointer;flex-wrap:nowrap">
        <i class="ti ti-chevron-${open ? 'down' : 'right'}" style="color:#6b7280"></i>
        <div style="font-weight:600;min-width:180px">${ship.name || 'Без названия'}${date ? ` <span style="font-weight:400;color:#6b7280;font-size:13px">· ${date}</span>` : ''}</div>
        <span style="font-size:13px;color:#4a5260"><span class="status-dot" style="background:${sst.color}"></span>${sst.label}</span>
        <span style="font-size:14px">${c.items} поз.</span>
        <div style="flex-basis:100%;padding-left:28px">${paidHtml}</div>
      </div>
      ${open ? `<div style="padding:0 14px 10px;overflow-x:auto">${items}</div>` : ''}
    </div>`;
  }).join('');

  container.innerHTML = `
    <a href="#" onclick="cabCloseClient();return false" style="display:inline-flex;align-items:center;gap:4px;color:#6C4DB8;text-decoration:none;font-size:14px;margin-bottom:10px"><i class="ti ti-arrow-left"></i> Все клиенты</a>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div class="cab-main-title" style="margin:0">${m.name}</div>
      <span style="font-size:13px;background:${st.bg};color:${st.color};padding:3px 8px;border-radius:5px;font-weight:600">${st.label}</span>
      ${m.isOwner ? '<span style="font-size:13px;background:#fee2e2;color:#dc2626;padding:3px 8px;border-radius:5px">свой</span>' : ''}
    </div>
    <div class="cab-table-wrap" style="padding:14px 18px">
      <div style="display:flex;gap:24px;flex-wrap:nowrap">
        ${ruleChk('owner', 'Это я')}${ruleChk('costGoods', 'Товар по себестоимости')}${ruleChk('costShip', 'Доставка по себестоимости')}
      </div>
      <div style="font-size:13px;color:#6b7280;margin-top:8px">Действуют начиная со следующего формирующегося прихода. Для уже созданных приходов — галочки во вкладке «Расчёт» конкретного прихода.</div>
    </div>
    <div class="cab-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="cab-stat-card"><div class="cab-stat-val">${m.totalItems}</div><div class="cab-stat-label">Позиций всего</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${m.ships.length}</div><div class="cab-stat-label">Приходов</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#6C4DB8">${cabFmt2(m.unpaidDue)}</div><div class="cab-stat-label">Не оплачено, BYN</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt2(m.totalDue)}</div><div class="cab-stat-label">Всего за всё время, BYN</div></div>
    </div>
    <div class="cab-table-title">Приходы клиента</div>
    ${shipsHtml}`;
}

// Правило клиента на будущее: сначала «замораживаем» текущие значения во ВСЕХ существующих приходах,
// затем сохраняем правило в профиль — оно действует только на приходы, созданные после этого.
async function cabSetClientRule(encName, kind, on) {
  const name = decodeURIComponent(encName);
  const low = name.toLowerCase();
  const field = kind === 'owner' ? 'owners' : kind;
  try {
    for (const ship of cabShipmentsCache) {
      const { clients } = cabGetClientsFromShipment(ship);
      const c = clients.find(x => x.name.toLowerCase() === low);
      if (!c) continue;
      const map = { ...(ship[field] || {}) };
      if (Object.prototype.hasOwnProperty.call(map, c.name)) continue;  // уже есть явное значение
      map[c.name] = kind === 'owner' ? c.isOwner : kind === 'costGoods' ? c.costGoodsOn : c.costShipOn;
      await shipmentsRef().doc(ship.id).update({ [field]: map });
      ship[field] = map;
    }
    const rules = { ...((userProfile && userProfile.clientRules) || {}) };
    rules[low] = { ...(rules[low] || {}), [kind]: !!on };
    await db.collection('users').doc(savedUid).update({ clientRules: rules });
    userProfile.clientRules = rules;
    // Если сейчас загружен приход в память — подтянем замороженные значения
    const cur = cabShipmentsCache.find(s => s.id === (editingShipmentId || activeShipmentId));
    if (cur) {
      if (cur.owners) currentOwners = { ...cur.owners };
      if (cur.costGoods) currentCostGoods = { ...cur.costGoods };
      if (cur.costShip) currentCostShip = { ...cur.costShip };
    }
    alert('Данное условие будет действовать начиная со следующего формирующегося прихода. Если вы хотите изменить условия в уже сформированных отправках, зайдите в конкретную отправку и проставьте эти условия во вкладке «Расчёт».');
  } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  renderCabClients(document.getElementById('cabMain'));
}

// Карточка клиента: инлайн-правка итога и внесение оплаты (частичной или полной)
function cabClientKey(ship, name) {
  const c = cabGetClientsFromShipment(ship).clients.find(x => x.name.toLowerCase() === name.toLowerCase());
  return c ? c.name : name;
}
async function cabCardSetDue(shipId, encName, val) {
  const ship = cabShipmentsCache.find(s => s.id === shipId); if (!ship) return;
  const key = cabClientKey(ship, decodeURIComponent(encName));
  const t = String(val).trim().replace(',', '.');
  let v = null;
  if (t !== '') { v = parseFloat(t); if (isNaN(v) || v < 0) { alert('Введите сумму числом'); return; } v = Math.round(v * 100) / 100; }
  try { await cabTxMapField(shipId, 'dueOverride', key, v); } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  cabRerender();
}
async function cabCardSetPaid(shipId, encName, val) {
  const ship = cabShipmentsCache.find(s => s.id === shipId); if (!ship) return;
  const key = cabClientKey(ship, decodeURIComponent(encName));
  const t = String(val).trim().replace(',', '.');
  const v = t === '' ? 0 : parseFloat(t);
  if (isNaN(v) || v < 0) { alert('Введите сумму числом'); return; }
  try { await cabSavePayment(shipId, key, v); } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  cabRerender();
}

// ============ ЦЕНЫ ============
// Рентабельность (продаж) = прибыль / оборот × 100. Оборот = сколько должны клиенты
function cabShipTotals(ship) {
  const { clients } = cabGetClientsFromShipment(ship);
  let due = 0, profit = 0, yuan = 0, weight = 0;
  for (const c of clients) { due += c.due; profit += c.profit; yuan += c.clientYuan; weight += c.weight; }
  return { clients, due, profit, yuan, weight, cost: due - profit, rent: due > 0 ? profit / due * 100 : null };
}
const cabPct = v => (v === null || !isFinite(v)) ? '—' : v.toFixed(1) + '%';

function renderCabPrices(container) {
  const rents = [];
  const rows = cabShipmentsCache.map(ship => {
    const rates = ship.rates ? { ...DEFAULT_RATES, ...ship.rates } : { ...DEFAULT_RATES };
    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const isDone = ship.status === 'done';
    const mRate = rates.clientRate > 0 ? (rates.clientRate - rates.buyRate) / rates.clientRate * 100 : null;
    const mShip = rates.shipClient > 0 ? (rates.shipClient - rates.shipCargo) / rates.shipClient * 100 : null;
    const t = cabShipTotals(ship);
    if (t.rent !== null) rents.push(t.rent);
    return `<tr style="${isDone ? 'opacity:0.55' : ''}">
      <td style="font-weight:500">${ship.name || 'Без названия'}</td>
      <td><span class="status-dot" style="background:${st.color}"></span>${st.label}</td>
      <td>${rates.clientRate.toFixed(2)}</td>
      <td>${rates.buyRate.toFixed(2)}</td>
      <td>${rates.shipClient}</td>
      <td>${rates.shipCargo}</td>
      <td style="color:#6C4DB8;font-weight:600">${cabPct(mRate)}</td>
      <td style="color:#16a34a;font-weight:600">${cabPct(mShip)}</td>
      <td style="font-weight:600;color:${t.rent === null ? '#6b7280' : t.rent >= 0 ? '#16a34a' : '#dc2626'}">${cabPct(t.rent)}</td>
    </tr>`;
  }).join('');
  const avgRent = rents.length ? rents.reduce((a, b) => a + b, 0) / rents.length : null;

  const lastShip = cabShipmentsCache.find(s => s.status !== 'done') || cabShipmentsCache[0];
  const curRates = lastShip && lastShip.rates ? { ...DEFAULT_RATES, ...lastShip.rates } : { ...DEFAULT_RATES };

  container.innerHTML = `
    <div class="cab-main-title">Цены и курсы</div>
    <div class="cab-stats" style="grid-template-columns:repeat(5,1fr)">
      <div class="cab-stat-card"><div class="cab-stat-val" style="font-size:22px">${curRates.clientRate.toFixed(2)} ₽/¥</div><div class="cab-stat-label">Курс клиента</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="font-size:22px">${curRates.buyRate.toFixed(2)} ₽/¥</div><div class="cab-stat-label">Курс закупки</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="font-size:22px">${curRates.shipClient} ₽/кг</div><div class="cab-stat-label">Доставка клиенту</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="font-size:22px">${curRates.shipCargo} ₽/кг</div><div class="cab-stat-label">Доставка карго</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="font-size:22px;color:#16a34a">${cabPct(avgRent)}</div><div class="cab-stat-label">Средняя рентабельность</div></div>
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title">Курсы по приходам</div>
      <table class="cab-table">
        <thead><tr><th>Приход</th><th>Статус</th><th>Клиент ₽/¥</th><th>Закупка ₽/¥</th><th>Дост. клиент</th><th>Дост. карго</th><th>Маржа курс</th><th>Маржа дост.</th><th>Рентабельность</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:20px">Нет данных</td></tr>'}</tbody>
      </table>
      <div style="font-size:13px;color:#6b7280;margin-top:12px">Маржа = наценка в % от цены для клиента. Рентабельность = прибыль ÷ оборот (сколько должны клиенты) × 100%.</div>
    </div>`;
}

// ============ РАСЧЁТЫ ============
const cabCalcOpen = new Set();
function cabCalcToggle(id) {
  if (cabCalcOpen.has(id)) cabCalcOpen.delete(id); else cabCalcOpen.add(id);
  renderCabCalc(document.getElementById('cabMain'));
}
function cabCalcAll(open) {
  cabCalcOpen.clear();
  if (open) cabShipmentsCache.forEach(s => cabCalcOpen.add(s.id));
  renderCabCalc(document.getElementById('cabMain'));
}

function renderCabCalc(container) {
  const blocks = [];
  for (const ship of cabShipmentsCache) {
    const { clients } = cabGetClientsFromShipment(ship);
    if (clients.length === 0) continue;
    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const isDone = ship.status === 'done';
    const open = cabCalcOpen.has(ship.id);
    let totalDue = 0, totalProfit = 0;
    for (const c of clients) { totalDue += c.due; totalProfit += c.profit; }
    const date = cabShipDateStr(ship);

    let table = '';
    if (open) {
      const clientRows = clients.slice().sort((a, b) => b.due - a.due).map(c => {
        const ownerBadge = c.isOwner ? ' <span style="font-size:12px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px">свой</span>' : '';
        return `<tr>
          <td style="font-weight:500">${c.name}${ownerBadge}</td>
          <td>${c.items}</td>
          <td>${cabFmt2(c.clientYuan)} ¥</td>
          <td>${c.weight > 0 ? c.weight.toFixed(2) : '—'}</td>
          <td>${cabFmt2(c.goodsClient)}</td>
          <td>${cabFmt2(c.shipCli)}</td>
          <td class="val-purple" style="font-weight:600">${c.isOwner ? '—' : `<a href="#" onclick="cabEditTotal('${ship.id}','${encodeURIComponent(c.name)}');return false" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + cabFmt2(c.dueCalc) : 'Нажмите, чтобы изменить итоговую сумму'}" style="color:#6C4DB8;text-decoration:none;border-bottom:1px dashed #b9a8e3">${cabFmt2(c.due)}</a>${c.dueEdited ? ' <i class="ti ti-pencil" style="font-size:13px;color:#f59e0b"></i>' : ''}`}</td>
          <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}">${c.profit >= 0 ? '+' : ''}${cabFmt(c.profit)}</td>
        </tr>`;
      }).join('');
      table = `<table class="cab-table" style="margin-top:12px">
          <thead><tr><th>Клиент</th><th>Поз.</th><th>Юани</th><th>Вес</th><th>Товар BYN</th><th>Дост. BYN</th><th>Итого</th><th>Прибыль</th></tr></thead>
          <tbody>${clientRows}</tbody>
        </table>`;
    }

    blocks.push(`
      <div class="cab-table-wrap" style="${isDone ? 'opacity:0.55;' : ''}padding:14px 18px">
        <div onclick="cabCalcToggle('${ship.id}')" style="display:flex;align-items:center;gap:14px;cursor:pointer;flex-wrap:nowrap">
          <i class="ti ti-chevron-${open ? 'down' : 'right'}" style="color:#6b7280"></i>
          <span class="status-dot" style="background:${st.color}"></span>
          <span style="font-weight:600;font-size:16px">${ship.name || 'Без названия'}</span>
          <span style="font-size:13px;color:#6b7280">${date ? date + ' · ' : ''}${(ship.data || []).length} поз. · ${clients.length} кл. · <span style="color:${st.text || '#4a5260'};font-weight:600">${st.label}</span></span>
          <span style="margin-left:auto;font-size:14px;color:#4a5260">Должны: <strong style="color:#6C4DB8">${cabFmt(totalDue)} BYN</strong></span>
          <span style="font-size:14px;color:#4a5260">Прибыль: <strong style="color:${totalProfit >= 0 ? '#16a34a' : '#dc2626'}">${totalProfit >= 0 ? '+' : ''}${cabFmt(totalProfit)} BYN</strong></span>
        </div>
        ${table}
      </div>`);
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;margin-bottom:16px">
      <div class="cab-main-title" style="margin:0">Расчёты по приходам</div>
      <button class="cab-filter-btn" style="margin-left:auto" onclick="cabCalcAll(true)"><i class="ti ti-arrows-maximize"></i> Развернуть все</button>
      <button class="cab-filter-btn" onclick="cabCalcAll(false)"><i class="ti ti-arrows-minimize"></i> Свернуть все</button>
    </div>
    ${blocks.length > 0 ? blocks.join('') : '<div class="cab-stub"><i class="ti ti-calculator"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">Создайте приход в Сканере</div></div>'}
  `;
}

// Ручная правка «Итого» клиента в приходе (раздел Расчёты) — та же корректировка, что во вкладке «Расчёт» прихода
async function cabEditTotal(shipId, encName) {
  const ship = cabShipmentsCache.find(s => s.id === shipId);
  if (!ship) return;
  const name = decodeURIComponent(encName);
  const c = cabGetClientsFromShipment(ship).clients.find(x => x.name === name);
  if (!c) return;
  if (!confirm('Вы точно хотите изменить итоговую сумму клиента «' + name + '»?')) return;
  const v = prompt('Новая итоговая сумма, BYN (по расчёту: ' + c.dueCalc.toFixed(2) + ').\nОставьте пустым, чтобы вернуть расчётную.', c.due.toFixed(2));
  if (v === null) return;
  const t = v.trim().replace(',', '.');
  let val = null;
  if (t !== '') {
    const num = parseFloat(t);
    if (isNaN(num) || num < 0) { alert('Введите сумму числом'); return; }
    val = Math.round(num * 100) / 100;
  }
  try { await cabTxMapField(shipId, 'dueOverride', name, val); } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  renderCabCalc(document.getElementById('cabMain'));
}

// ============ АНАЛИТИКА ============
let cabAnPeriod = 'all';
const CAB_PERIODS = [['month', 'Месяц', 1], ['quarter', 'Квартал', 3], ['half', 'Полугодие', 6], ['year', 'Год', 12], ['all', 'Всё время', 0]];
function cabSetAnPeriod(p) { cabAnPeriod = p; renderCabAnalytics(document.getElementById('cabMain')); }

function renderCabAnalytics(container) {
  const per = CAB_PERIODS.find(p => p[0] === cabAnPeriod) || CAB_PERIODS[4];
  let from = null;
  if (per[2]) { from = new Date(); from.setMonth(from.getMonth() - per[2]); }
  // Период — по дате отправки из названия прихода. Приходы без даты попадают только во «Всё время»
  const ships = cabShipmentsCache.filter(s => { if (!from) return true; const d = cabShipDate(s); return !!d && d >= from; });
  const periodBtns = CAB_PERIODS.map(p => `<button class="cab-filter-btn ${cabAnPeriod === p[0] ? 'active' : ''}" onclick="cabSetAnPeriod('${p[0]}')">${p[1]}</button>`).join('');
  const head = `<div class="cab-main-title">Аналитика</div><div class="cab-filter-row">${periodBtns}</div>`;
  if (ships.length === 0) {
    container.innerHTML = head + `<div class="cab-stub"><i class="ti ti-chart-bar"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">За выбранный период приходов нет</div></div>`;
    return;
  }

  let totalItems = 0, totalYuan = 0, totalWeight = 0, totalDue = 0, totalProfit = 0;
  const profitByShip = [];
  const clientFreq = {};
  for (const ship of ships) {
    const t = cabShipTotals(ship);
    totalItems += (ship.data || []).length;
    totalDue += t.due; totalProfit += t.profit; totalYuan += t.yuan; totalWeight += t.weight;
    for (const c of t.clients) clientFreq[c.name] = (clientFreq[c.name] || 0) + 1;
    profitByShip.push({ name: ship.name || 'Без названия', profit: t.profit });
  }
  const totalCost = totalDue - totalProfit;
  const avgProfit = totalProfit / ships.length;
  const rent = totalDue > 0 ? totalProfit / totalDue * 100 : null;
  const topClients = Object.entries(clientFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const maxProfit = Math.max(...profitByShip.map(p => Math.abs(p.profit)), 1);
  const barsHtml = profitByShip.map(p => {
    const pct = Math.abs(p.profit) / maxProfit * 100;
    const color = p.profit >= 0 ? '#16a34a' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:140px;font-size:14px;font-weight:500;color:#1a1a2e;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;flex-shrink:0">${p.name}</div>
      <div style="flex:1;background:#f3f4f6;border-radius:4px;height:22px;position:relative;overflow:hidden">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:4px;transition:width 0.3s"></div>
      </div>
      <div style="width:80px;text-align:right;font-size:14px;font-weight:600;color:${color}">${p.profit >= 0 ? '+' : ''}${cabFmt(p.profit)}</div>
    </div>`;
  }).join('');
  const arrow = '<div style="display:flex;align-items:center;justify-content:center;color:#b0b4bb;font-size:22px"><i class="ti ti-arrow-right"></i></div>';

  container.innerHTML = head + `
    <div class="cab-stats" style="grid-template-columns:1fr 1fr auto 1fr auto 1fr;align-items:stretch">
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt(totalYuan)} ¥</div><div class="cab-stat-label">Оборот в юанях</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt(totalDue)} BYN</div><div class="cab-stat-label">Оборот в рублях</div></div>
      ${arrow}
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt(totalCost)} BYN</div><div class="cab-stat-label">Общие затраты</div></div>
      ${arrow}
      <div class="cab-stat-card"><div class="cab-stat-val green">${cabFmt(totalProfit)} BYN</div><div class="cab-stat-label">Общая прибыль</div></div>
    </div>
    <div class="cab-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#6C4DB8">${cabPct(rent)}</div><div class="cab-stat-label">Рентабельность</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${totalItems}</div><div class="cab-stat-label">Всего позиций</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${totalWeight.toFixed(1)} кг</div><div class="cab-stat-label">Общий вес</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt(avgProfit)} BYN</div><div class="cab-stat-label">Средняя прибыль / приход</div></div>
    </div>

    <div class="cab-table-wrap">
      <div class="cab-table-title">Прибыль по приходам</div>
      ${barsHtml}
    </div>

    ${topClients.length > 0 ? `
    <div class="cab-table-wrap">
      <div class="cab-table-title">Частые клиенты</div>
      <table class="cab-table">
        <thead><tr><th>Клиент</th><th>Участвовал в приходах</th></tr></thead>
        <tbody>
          ${topClients.map(([name, cnt]) => `<tr><td style="font-weight:500">${name}</td><td>${cnt}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;
}

// ============ НАСТРОЙКИ ============
function renderCabSettings(container) {
  const isAdmin = userProfile && userProfile.role === 'admin';
  const currency = (userProfile && userProfile.currency) || 'BYN';
  const name = (userProfile && userProfile.name) || '';
  const email = currentUser ? currentUser.email : '';
  const emailVerified = currentUser ? currentUser.emailVerified : false;

  container.innerHTML = `
    <div class="cab-main-title">Настройки</div>
    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-user" style="margin-right:6px"></i>Профиль</div>
      <div class="cab-settings-grid">
        <div class="cab-settings-row"><span class="cab-settings-label">Имя</span><span class="cab-settings-value">${name || '—'}</span></div>
        <div class="cab-settings-row"><span class="cab-settings-label">Email</span><span class="cab-settings-value">${email} ${emailVerified ? '<i class="ti ti-circle-check" style="color:#16a34a;font-size:15px" title="Подтверждён"></i>' : '<span style="color:#f59e0b;font-size:14px">(не подтверждён)</span>'}</span></div>
        <div class="cab-settings-row"><span class="cab-settings-label">Валюта</span><span class="cab-settings-value">${currency}</span></div>
      </div>
    </div>
    ${isAdmin ? '<div id="cabAdminBox"><div style="text-align:center;padding:30px;color:#6b7280">Загрузка пользователей…</div></div>' : ''}`;
  if (isAdmin) cabLoadAdminUsers(document.getElementById('cabAdminBox'));
}

// ============ АДМИНИСТРИРОВАНИЕ (пользователи Piksta, как в мобильной) ============
function cabToDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (typeof v === 'object' && v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

async function cabLoadAdminUsers(box) {
  if (!box) return;
  try {
    let docs;
    try {
      const snap = await Promise.race([db.collection('users').get(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
      docs = snap.docs;
    } catch (e) { docs = await fsList('users'); }
    const users = docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.role !== 'admin');
    const now = new Date();
    const rows = [];
    let active = 0, trial = 0, blocked = 0;
    for (const u of users) {
      const created = cabToDate(u.created) || now;
      const trialEnd = new Date(created.getTime() + 90 * 24 * 60 * 60 * 1000);
      const subEnd = u.subscription ? cabToDate(u.subscription.endDate) : null;
      const accessEnd = subEnd && subEnd > trialEnd ? subEnd : trialEnd;
      const daysLeft = Math.ceil((accessEnd - now) / (24 * 60 * 60 * 1000));
      const isBlocked = !!u.blocked;
      if (isBlocked) blocked++;
      else if (subEnd && subEnd > now) active++;
      else if (daysLeft > 0) trial++;
      let shipCount = '—';
      try { const ss = await db.collection('users').doc(u.id).collection('shipments').get(); shipCount = ss.size; } catch (e) {}
      const status = isBlocked ? '<span style="color:#dc2626;font-weight:600">Заблокирован</span>'
        : daysLeft <= 0 ? '<span style="color:#dc2626">Доступ истёк</span>'
        : subEnd && subEnd > now ? '<span style="color:#16a34a">Подписка</span>' : '<span style="color:#f59e0b">Пробный</span>';
      const safeName = String(u.name || u.email || '').replace(/['"<>]/g, '');
      rows.push(`<tr>
        <td style="font-weight:500">${u.name || '—'}</td>
        <td>${u.email || u.id}</td>
        <td>${created.toLocaleDateString('ru-RU')}</td>
        <td>${shipCount}</td>
        <td>${accessEnd.toLocaleDateString('ru-RU')} <span style="color:${daysLeft > 7 ? '#16a34a' : '#dc2626'};font-size:13px">(${daysLeft > 0 ? daysLeft + ' дн.' : 'истёк'})</span></td>
        <td>${status}</td>
        <td style="white-space:nowrap">
          <button class="cab-filter-btn" style="padding:6px 12px;color:#16a34a;border-color:#86efac" onclick="cabAdminSub('${u.id}','${safeName}')">Продлить</button>
          ${isBlocked
            ? `<button class="cab-filter-btn" style="padding:6px 12px" onclick="cabAdminBlock('${u.id}',false)">Разблокировать</button>`
            : `<button class="cab-filter-btn" style="padding:6px 12px;color:#dc2626;border-color:#fca5a5" onclick="cabAdminBlock('${u.id}',true)">Заблокировать</button>`}
        </td>
      </tr>`);
    }
    box.innerHTML = `
      <div class="cab-table-wrap">
        <div class="cab-table-title"><i class="ti ti-shield-lock" style="margin-right:6px"></i>Пользователи Piksta</div>
        <div class="cab-stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
          <div class="cab-stat-card"><div class="cab-stat-val">${users.length}</div><div class="cab-stat-label">Всего пользователей</div></div>
          <div class="cab-stat-card"><div class="cab-stat-val" style="color:#16a34a">${active}</div><div class="cab-stat-label">С подпиской</div></div>
          <div class="cab-stat-card"><div class="cab-stat-val" style="color:#f59e0b">${trial}</div><div class="cab-stat-label">На пробном</div></div>
          <div class="cab-stat-card"><div class="cab-stat-val" style="color:#dc2626">${blocked}</div><div class="cab-stat-label">Заблокировано</div></div>
        </div>
        <table class="cab-table">
          <thead><tr><th>Имя</th><th>Email</th><th>Регистрация</th><th>Приходов</th><th>Доступ до</th><th>Статус</th><th></th></tr></thead>
          <tbody>${rows.join('') || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px">Пользователей нет</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="cab-table-wrap"><div class="cab-stub-text">Не удалось загрузить пользователей: ${e.message}</div></div>`;
  }
}

async function cabAdminSub(uid, name) {
  const months = prompt('Подписка для ' + name + '\nКоличество месяцев (1, 2, 3, 6, 12):');
  if (!months || isNaN(months) || parseInt(months) <= 0) return;
  const m = parseInt(months);
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + m);
  if (!confirm('Активировать подписку до ' + endDate.toLocaleDateString('ru') + '?')) return;
  try {
    await db.collection('users').doc(uid).update({
      subscription: { endDate: firebase.firestore.Timestamp.fromDate(endDate), months: m, activatedAt: firebase.firestore.FieldValue.serverTimestamp() }
    });
  } catch (e) { alert('Ошибка: ' + e.message); }
  cabNav(cabCurrentSection);
}

async function cabAdminBlock(uid, block) {
  if (!confirm('Точно ' + (block ? 'заблокировать' : 'разблокировать') + '?')) return;
  try { await db.collection('users').doc(uid).update({ blocked: block }); } catch (e) { alert('Ошибка: ' + e.message); }
  cabNav(cabCurrentSection);
}

async function renderCabAdmin(container) {
  const isAdmin = userProfile && userProfile.role === 'admin';
  if (!isAdmin) {
    container.innerHTML = `<div class="cab-stub"><i class="ti ti-shield-lock"></i><div class="cab-stub-title">Доступ ограничен</div><div class="cab-stub-text">Только для администратора</div></div>`;
    return;
  }
  container.innerHTML = `<div class="cab-main-title">Администрирование</div><div id="cabAdminBox"><div style="text-align:center;padding:30px;color:#6b7280">Загрузка пользователей…</div></div>`;
  cabLoadAdminUsers(document.getElementById('cabAdminBox'));
}
