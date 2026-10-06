// ============ CABINET ============
let cabCurrentSection = 'overview';
let cabShipmentsCache = []; // кэш приходов для кабинета

function exitCabinet() {
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
  for (const row of data) {
    const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
    const wh = r[1] || '';
    if (wh) {
      const parts = wh.split(/\s*и\s*/i);
      for (const p of parts) {
        const name = p.trim();
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
    const isOwner = !!owners[name];
    const inclW = !!priceInclWeight[name];
    const cGoods = !!costGoods[name];
    const cShip = !!costShip[name];
    let due, profit;
    if (isOwner) { due = 0; profit = -(goodsCost + shipCo); }
    else if (cGoods || cShip) {
      const gp = cGoods ? goodsCost : goodsClient;
      const sp = cShip ? shipCo : shipCli;
      due = gp + sp;
      profit = (cGoods ? 0 : goodsClient - goodsCost) + (cShip ? 0 : shipCli - shipCo);
    } else if (inclW) { due = goodsClient; profit = (goodsClient - goodsCost) - shipCo; }
    else { due = goodsClient + shipCli; profit = (goodsClient - goodsCost) + (shipCli - shipCo); }
    result.push({
      name, items: itemCount[name] || 0, weight: w, shipWeight,
      buyYuan: buyYuan[name] || 0, clientYuan: clientYuanMap[name] || 0,
      due, profit, isOwner,
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
    <div class="cab-stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="cab-stat-card">
        <div class="cab-stat-val">${ships.length}</div>
        <div class="cab-stat-label">Всего приходов</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${ships.filter(s=>s.status==='sorted'||s.status==='done').reduce((n,s)=>n+(s.data||[]).length,0)}</div>
        <div class="cab-stat-label">Привезено всего товаров</div>
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
          ${shipSummaries.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#9aa0ab;padding:20px">Нет приходов</td></tr>' :
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
    const departed = ship.departed ? '<i class="ti ti-truck" style="color:#3cb371;font-size:14px" title="Выехала"></i>' : '';
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
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#9aa0ab;padding:20px">Нет приходов</td></tr>'}</tbody>
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
const cabInp = 'padding:6px 8px;border:1px solid #d5d8dd;border-radius:6px;font-size:13px;box-sizing:border-box';

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
    <a href="#" onclick="cabCloseShip();return false" style="display:inline-flex;align-items:center;gap:4px;color:#6C4DB8;text-decoration:none;font-size:13px;margin-bottom:10px"><i class="ti ti-arrow-left"></i> Все приходы</a>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div class="cab-main-title" style="margin:0">${ship.name || 'Без названия'}</div>
      <button onclick="cabRenameShip()" title="Переименовать" style="border:none;background:none;color:#9aa0ab;cursor:pointer;font-size:16px"><i class="ti ti-pencil"></i></button>
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
function cabShipItemsHtml() {
  const rows = TABLE.map((r, i) => {
    const qty = parseInt(r[5]) || 1;
    const img = r[2] ? `<img src="${r[2]}" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block">` : '<div style="width:44px;height:44px;border-radius:6px;background:#f3f4f6"></div>';
    return `<tr class="cab-item-row" data-q="${((r[0] || '') + ' ' + (r[1] || '')).toLowerCase()}">
      <td style="width:52px">${img}</td>
      <td style="font-family:monospace;font-size:12px;color:#4a5260">${r[0] || ''}${qty > 1 ? ` <span style="background:#f59e0b;color:#fff;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:700">×${qty}</span>` : ''}</td>
      <td><input data-idx="${i}" value="${(r[1] || '').replace(/"/g, '&quot;')}" onchange="cabEditCell(this,1)" placeholder="клиент" style="${cabInp};width:100%;color:#6C4DB8"></td>
      <td><input data-idx="${i}" value="${r[3] || ''}" onchange="cabEditCell(this,3)" inputmode="decimal" placeholder="—" style="${cabInp};width:80px"></td>
      <td><input data-idx="${i}" value="${r[4] || ''}" onchange="cabEditCell(this,4)" inputmode="decimal" placeholder="${r[3] || '—'}" style="${cabInp};width:80px;color:#6C4DB8"></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <input oninput="cabFilterItems(this.value)" placeholder="Поиск по треку или клиенту" style="${cabInp};width:100%;max-width:340px;margin-bottom:12px">
    <table class="cab-table">
      <thead><tr><th></th><th>Трек</th><th>Клиент</th><th>Закупка ¥</th><th>Клиент ¥</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#9aa0ab;padding:20px">Нет товаров</td></tr>'}</tbody>
    </table>
  </div>`;
}

function cabFilterItems(q) {
  const s = q.trim().toLowerCase();
  document.querySelectorAll('.cab-item-row').forEach(tr => {
    tr.style.display = (!s || tr.dataset.q.includes(s)) ? '' : 'none';
  });
}

async function cabEditCell(inp, col) {
  const idx = parseInt(inp.dataset.idx);
  if (!TABLE[idx]) return;
  let v = inp.value.trim();
  if (col === 1) { v = resolveClientName(v); inp.value = v; }
  TABLE[idx][col] = v;
  try {
    const ref = shipmentsRef().doc(cabShipId);
    const doc = await ref.get();
    if (!doc.exists) return;
    const data = doc.data().data;
    if (!data[idx]) return;
    if (Array.isArray(data[idx])) data[idx][col] = String(v);
    else data[idx][col === 1 ? 'w' : col === 3 ? 'p' : 'pc'] = String(v);
    await ref.update({ data });
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
      <td><label style="font-size:12px;color:#5f6470;display:flex;align-items:center;gap:6px"><input type="checkbox" data-name="${enc}" ${incl ? 'checked' : ''} onchange="cabSetIncl(this)"> вес в цене</label></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
      <label style="font-size:12px;color:#5f6470">Вес от карго, г<br><input value="${currentCargoWeight ? Math.round(currentCargoWeight * 1000) : ''}" onchange="cabSetCargo(this)" inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:12px;color:#5f6470">Вес тары, г<br><input value="${currentTare ? Math.round(currentTare * 1000) : ''}" onchange="cabSetTare(this)" inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:13px;color:#1a1a2e;display:flex;align-items:center;gap:6px;padding-bottom:6px"><input type="checkbox" ${shipmentDeparted ? 'checked' : ''} onchange="cabSetDeparted(this)"> Отправка выехала в карго</label>
    </div>
    <table class="cab-table">
      <thead><tr><th>Клиент</th><th>Позиций</th><th>Вес, г</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#9aa0ab;padding:20px">Нет клиентов</td></tr>'}</tbody>
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
  const rows = calc.clients.map(c => `<tr style="${c.isOwner ? 'background:#fef2f2' : ''}">
      <td style="font-weight:500">${c.name}${c.noWeight ? ' <span title="Вес не указан" style="color:#f59e0b">⚠</span>' : ''}</td>
      <td>${c.count}</td>
      <td>${cabFmt2(c.yuan)}</td>
      <td>${cabFmt2(c.shipWeight)}</td>
      <td>${cabFmt2(c.goodsClient)}</td>
      <td>${cabFmt2(c.shipClient)}</td>
      <td class="val-purple">${c.isOwner ? '—' : cabFmt2(c.due)}</td>
      <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}">${c.profit >= 0 ? '+' : ''}${cabFmt2(c.profit)}</td>
      <td><label style="font-size:12px;color:#5f6470;display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" ${c.isOwner ? 'checked' : ''} data-name="${encodeURIComponent(c.name)}" onchange="cabToggleOwner(this)"> это я</label></td>
    </tr>`).join('');
  return `<div class="cab-table-wrap">
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button onclick="cabShipPDF()" style="background:#6C4DB8;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer"><i class="ti ti-download"></i> PDF</button>
    </div>
    <table class="cab-table">
      <thead><tr><th>Клиент</th><th>Поз.</th><th>Товар ¥</th><th>Вес с тарой, кг</th><th>Товар BYN</th><th>Доставка BYN</th><th>Должен BYN</th><th>Прибыль BYN</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#9aa0ab;padding:20px">Нет клиентов</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:600"><td>Итого</td><td colspan="5">Тара: ${cabFmt2(calc.tareTotal)} кг</td><td class="val-purple">${cabFmt2(calc.grandDue)}</td><td class="${calc.grandProfit >= 0 ? 'val-green' : 'val-red'}">${calc.grandProfit >= 0 ? '+' : ''}${cabFmt2(calc.grandProfit)}</td><td></td></tr></tfoot>
    </table>
  </div>`;
}

function cabToggleOwner(inp) {
  const n = decodeURIComponent(inp.dataset.name);
  if (currentOwners[n]) delete currentOwners[n]; else currentOwners[n] = true;
  saveOwners();
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
      ${f.map(([k, l]) => `<label style="font-size:12px;color:#5f6470">${l}<br><input value="${currentRates[k]}" onchange="cabSetRate('${k}',this)" inputmode="decimal" style="${cabInp};width:100%;margin-top:4px"></label>`).join('')}
    </div>
  </div>`;
}

function cabSetRate(key, inp) {
  currentRates[key] = parseFloat(String(inp.value).replace(',', '.')) || 0;
  saveRates();
}

// ============ КЛИЕНТЫ ============
function renderCabClients(container) {
  // Собираем данные по всем клиентам из всех приходов
  const clientMap = {};
  for (const ship of cabShipmentsCache) {
    const { clients } = cabGetClientsFromShipment(ship);
    const isDone = ship.status === 'done';
    for (const c of clients) {
      if (!clientMap[c.name]) {
        clientMap[c.name] = { name: c.name, totalItems: 0, totalDue: 0, totalProfit: 0,
          totalWeight: 0, shipments: 0, activeDue: 0, isOwner: false, totalYuan: 0 };
      }
      const m = clientMap[c.name];
      m.totalItems += c.items;
      m.totalDue += c.due;
      m.totalProfit += c.profit;
      m.totalWeight += c.weight;
      m.totalYuan += c.clientYuan;
      m.shipments++;
      if (!isDone) m.activeDue += c.due;
      if (c.isOwner) m.isOwner = true;
    }
  }

  const clientList = Object.values(clientMap).sort((a, b) => b.activeDue - a.activeDue);

  const rows = clientList.map(c => {
    const ownerBadge = c.isOwner ? ' <span style="font-size:10px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-weight:600">свой</span>' : '';
    return `<tr>
      <td style="font-weight:500">${c.name}${ownerBadge}</td>
      <td>${c.shipments}</td>
      <td>${c.totalItems}</td>
      <td>${c.totalWeight > 0 ? c.totalWeight.toFixed(2) + ' кг' : '—'}</td>
      <td class="val-purple">${cabFmt(c.activeDue)}</td>
      <td>${cabFmt(c.totalDue)}</td>
      <td class="${c.totalProfit >= 0 ? 'val-green' : 'val-red'}">${c.totalProfit >= 0 ? '+' : ''}${cabFmt(c.totalProfit)}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="cab-main-title">Клиенты</div>
    <div class="cab-stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="cab-stat-card">
        <div class="cab-stat-val">${clientList.length}</div>
        <div class="cab-stat-label">Всего клиентов</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val val-purple" style="color:#6C4DB8">${cabFmt(clientList.reduce((s,c)=>s+c.activeDue,0))}</div>
        <div class="cab-stat-label">Активная задолженность</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${cabFmt(clientList.reduce((s,c)=>s+c.totalYuan,0))} ¥</div>
        <div class="cab-stat-label">Всего юаней (все приходы)</div>
      </div>
    </div>
    <div class="cab-table-wrap">
      <table class="cab-table">
        <thead><tr><th>Клиент</th><th>Приходов</th><th>Позиций</th><th>Вес</th><th>Долг (актив.)</th><th>Всего BYN</th><th>Прибыль</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#9aa0ab;padding:20px">Нет клиентов</td></tr>'}</tbody>
      </table>
    </div>`;
}

// ============ ЦЕНЫ ============
function renderCabPrices(container) {
  // Показываем курсы по каждому приходу
  const rows = cabShipmentsCache.map(ship => {
    const rates = ship.rates ? { ...DEFAULT_RATES, ...ship.rates } : { ...DEFAULT_RATES };
    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const isDone = ship.status === 'done';
    return `<tr style="${isDone ? 'opacity:0.55' : ''}">
      <td style="font-weight:500">${ship.name || 'Без названия'}</td>
      <td><span class="status-dot" style="background:${st.color}"></span>${st.label}</td>
      <td>${rates.clientRate.toFixed(2)}</td>
      <td>${rates.buyRate.toFixed(2)}</td>
      <td>${rates.shipClient}</td>
      <td>${rates.shipCargo}</td>
      <td style="color:#6C4DB8;font-weight:600">${(rates.clientRate - rates.buyRate).toFixed(2)}</td>
      <td style="color:#16a34a;font-weight:600">${rates.shipClient - rates.shipCargo}</td>
    </tr>`;
  }).join('');

  // Текущие курсы (из последнего прихода)
  const lastShip = cabShipmentsCache.find(s => s.status !== 'done') || cabShipmentsCache[0];
  const curRates = lastShip && lastShip.rates ? { ...DEFAULT_RATES, ...lastShip.rates } : { ...DEFAULT_RATES };

  container.innerHTML = `
    <div class="cab-main-title">Цены и курсы</div>
    <div class="cab-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="cab-stat-card">
        <div class="cab-stat-val" style="font-size:22px">${curRates.clientRate.toFixed(2)} ₽/¥</div>
        <div class="cab-stat-label">Курс клиента</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val" style="font-size:22px">${curRates.buyRate.toFixed(2)} ₽/¥</div>
        <div class="cab-stat-label">Курс закупки</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val" style="font-size:22px">${curRates.shipClient} ₽/кг</div>
        <div class="cab-stat-label">Доставка клиенту</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val" style="font-size:22px">${curRates.shipCargo} ₽/кг</div>
        <div class="cab-stat-label">Доставка карго</div>
      </div>
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title">Курсы по приходам</div>
      <table class="cab-table">
        <thead><tr><th>Приход</th><th>Статус</th><th>Клиент ₽/¥</th><th>Закупка ₽/¥</th><th>Дост. клиент</th><th>Дост. карго</th><th>Маржа курс</th><th>Маржа дост.</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#9aa0ab;padding:20px">Нет данных</td></tr>'}</tbody>
      </table>
    </div>`;
}

// ============ РАСЧЁТЫ ============
function renderCabCalc(container) {
  // Детальный расчёт по каждому приходу
  const blocks = [];
  for (const ship of cabShipmentsCache) {
    const { clients, rates } = cabGetClientsFromShipment(ship);
    if (clients.length === 0) continue;
    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const isDone = ship.status === 'done';
    let totalDue = 0, totalProfit = 0;
    for (const c of clients) { totalDue += c.due; totalProfit += c.profit; }

    const clientRows = clients.sort((a,b) => b.due - a.due).map(c => {
      const ownerBadge = c.isOwner ? ' <span style="font-size:10px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px">свой</span>' : '';
      return `<tr>
        <td style="font-weight:500">${c.name}${ownerBadge}</td>
        <td>${c.items}</td>
        <td>${cabFmt2(c.clientYuan)} ¥</td>
        <td>${c.weight > 0 ? c.weight.toFixed(2) : '—'}</td>
        <td>${cabFmt2(c.goodsClient)}</td>
        <td>${cabFmt2(c.shipCli)}</td>
        <td class="val-purple" style="font-weight:600">${cabFmt(c.due)}</td>
        <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}">${c.profit >= 0 ? '+' : ''}${cabFmt(c.profit)}</td>
      </tr>`;
    }).join('');

    blocks.push(`
      <div class="cab-table-wrap" style="${isDone ? 'opacity:0.55' : ''}">
        <div class="cab-table-title" style="display:flex;align-items:center;gap:10px">
          <span class="status-dot" style="background:${st.color}"></span>
          ${ship.name || 'Без названия'}
          <span style="margin-left:auto;font-size:13px;color:#9aa0ab">${(ship.data||[]).length} поз. · ${clients.length} кл.</span>
        </div>
        <div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap">
          <div style="font-size:13px;color:#5f6470">Должны: <strong class="val-purple" style="color:#6C4DB8">${cabFmt(totalDue)} BYN</strong></div>
          <div style="font-size:13px;color:#5f6470">Прибыль: <strong class="${totalProfit>=0?'val-green':'val-red'}" style="color:${totalProfit>=0?'#16a34a':'#dc2626'}">${totalProfit>=0?'+':''}${cabFmt(totalProfit)} BYN</strong></div>
        </div>
        <table class="cab-table">
          <thead><tr><th>Клиент</th><th>Поз.</th><th>Юани</th><th>Вес</th><th>Товар BYN</th><th>Дост. BYN</th><th>Итого</th><th>Прибыль</th></tr></thead>
          <tbody>${clientRows}</tbody>
        </table>
      </div>`);
  }

  container.innerHTML = `
    <div class="cab-main-title">Расчёты по приходам</div>
    ${blocks.length > 0 ? blocks.join('') : '<div class="cab-stub"><i class="ti ti-calculator"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">Создайте приход в Сканере</div></div>'}
  `;
}

// ============ АНАЛИТИКА ============
function renderCabAnalytics(container) {
  const ships = cabShipmentsCache;
  if (ships.length === 0) {
    container.innerHTML = `<div class="cab-main-title">Аналитика</div><div class="cab-stub"><i class="ti ti-chart-bar"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">Аналитика появится после первого прихода</div></div>`;
    return;
  }

  // Статистика по приходам
  let totalItems = 0, totalYuan = 0, totalWeight = 0, totalDue = 0, totalProfit = 0, totalCost = 0;
  const profitByShip = [];
  const clientFreq = {};

  for (const ship of ships) {
    const { clients } = cabGetClientsFromShipment(ship);
    let shipDue = 0, shipProfit = 0, shipYuan = 0, shipW = 0;
    totalItems += (ship.data || []).length;
    for (const c of clients) {
      shipDue += c.due; shipProfit += c.profit;
      shipYuan += c.clientYuan; shipW += c.weight;
      clientFreq[c.name] = (clientFreq[c.name] || 0) + 1;
    }
    totalDue += shipDue; totalProfit += shipProfit; totalYuan += shipYuan; totalWeight += shipW;
    totalCost += shipDue - shipProfit;
    profitByShip.push({ name: ship.name || 'Без названия', profit: shipProfit, due: shipDue, items: (ship.data||[]).length });
  }

  const avgProfit = ships.length > 0 ? totalProfit / ships.length : 0;
  const margin = totalDue > 0 ? (totalProfit / totalDue * 100) : 0;

  // Топ клиентов по частоте
  const topClients = Object.entries(clientFreq).sort((a,b) => b[1] - a[1]).slice(0, 8);

  // Простые бары для прибыли по приходам
  const maxProfit = Math.max(...profitByShip.map(p => Math.abs(p.profit)), 1);
  const barsHtml = profitByShip.map(p => {
    const pct = Math.abs(p.profit) / maxProfit * 100;
    const color = p.profit >= 0 ? '#16a34a' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:120px;font-size:13px;font-weight:500;color:#1a1a2e;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;flex-shrink:0">${p.name}</div>
      <div style="flex:1;background:#f3f4f6;border-radius:4px;height:22px;position:relative;overflow:hidden">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:4px;transition:width 0.3s"></div>
      </div>
      <div style="width:80px;text-align:right;font-size:13px;font-weight:600;color:${color}">${p.profit>=0?'+':''}${cabFmt(p.profit)}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="cab-main-title">Аналитика</div>
    <div class="cab-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="cab-stat-card">
        <div class="cab-stat-val">${totalItems}</div>
        <div class="cab-stat-label">Всего позиций</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${cabFmt(totalYuan)} ¥</div>
        <div class="cab-stat-label">Оборот в юанях</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${totalWeight.toFixed(1)} кг</div>
        <div class="cab-stat-label">Общий вес</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val" style="color:#6C4DB8">${margin.toFixed(1)}%</div>
        <div class="cab-stat-label">Маржинальность</div>
      </div>
    </div>
    <div class="cab-stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="cab-stat-card">
        <div class="cab-stat-val green">${cabFmt(totalProfit)} BYN</div>
        <div class="cab-stat-label">Общая прибыль</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${cabFmt(avgProfit)} BYN</div>
        <div class="cab-stat-label">Средняя прибыль / приход</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val">${cabFmt(totalCost)} BYN</div>
        <div class="cab-stat-label">Общие затраты</div>
      </div>
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
  const currency = (userProfile && userProfile.currency) || 'BYN';
  const name = (userProfile && userProfile.name) || '';
  const email = currentUser ? currentUser.email : '';
  const emailVerified = currentUser ? currentUser.emailVerified : false;

  // Текущие курсы по умолчанию (из последнего прихода)
  const lastShip = cabShipmentsCache.find(s => s.status !== 'done') || cabShipmentsCache[0];
  const curRates = lastShip && lastShip.rates ? { ...DEFAULT_RATES, ...lastShip.rates } : { ...DEFAULT_RATES };

  container.innerHTML = `
    <div class="cab-main-title">Настройки</div>

    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-user" style="margin-right:6px"></i>Профиль</div>
      <div class="cab-settings-grid">
        <div class="cab-settings-row">
          <span class="cab-settings-label">Имя</span>
          <span class="cab-settings-value">${name || '—'}</span>
        </div>
        <div class="cab-settings-row">
          <span class="cab-settings-label">Email</span>
          <span class="cab-settings-value">${email} ${emailVerified ? '<i class="ti ti-circle-check" style="color:#16a34a;font-size:14px" title="Подтверждён"></i>' : '<span style="color:#f59e0b;font-size:12px">(не подтверждён)</span>'}</span>
        </div>
        <div class="cab-settings-row">
          <span class="cab-settings-label">Валюта</span>
          <span class="cab-settings-value">${currency}</span>
        </div>
      </div>
    </div>

    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-currency-yuan" style="margin-right:6px"></i>Текущие курсы</div>
      <div class="cab-settings-grid">
        <div class="cab-settings-row">
          <span class="cab-settings-label">Курс для клиента</span>
          <span class="cab-settings-value">${curRates.clientRate.toFixed(2)} ₽/¥</span>
        </div>
        <div class="cab-settings-row">
          <span class="cab-settings-label">Курс закупки</span>
          <span class="cab-settings-value">${curRates.buyRate.toFixed(2)} ₽/¥</span>
        </div>
        <div class="cab-settings-row">
          <span class="cab-settings-label">Доставка клиенту</span>
          <span class="cab-settings-value">${curRates.shipClient} ₽/кг</span>
        </div>
        <div class="cab-settings-row">
          <span class="cab-settings-label">Доставка карго</span>
          <span class="cab-settings-value">${curRates.shipCargo} ₽/кг</span>
        </div>
      </div>
      <div style="font-size:12px;color:#9aa0ab;margin-top:12px">Курсы привязаны к приходу. При создании нового прихода копируются с предыдущего.</div>
    </div>

    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-info-circle" style="margin-right:6px"></i>О приложении</div>
      <div class="cab-settings-grid">
        <div class="cab-settings-row">
          <span class="cab-settings-label">Версия</span>
          <span class="cab-settings-value">Piksta v2.0</span>
        </div>
        <div class="cab-settings-row">
          <span class="cab-settings-label">Поддержка</span>
          <span class="cab-settings-value"><a href="https://t.me/ekudinof" target="_blank" style="color:#6C4DB8">@ekudinof</a></span>
        </div>
      </div>
    </div>
  `;
}

// ============ АДМИНИСТРИРОВАНИЕ ============
async function renderCabAdmin(container) {
  const isAdmin = userProfile && userProfile.role === 'admin';
  if (!isAdmin) {
    container.innerHTML = `<div class="cab-stub"><i class="ti ti-shield-lock"></i><div class="cab-stub-title">Доступ ограничен</div><div class="cab-stub-text">Только для администратора</div></div>`;
    return;
  }

  container.innerHTML = `<div class="cab-main-title">Администрирование</div><div style="text-align:center;padding:40px;color:#9aa0ab"><i class="ti ti-loader" style="font-size:24px;animation:spin 1s linear infinite"></i> Загрузка...</div>`;

  try {
    const userDocs = await fsList('users');
    const users = userDocs.map(d => ({ id: d.id, ...d.data() }));

    // Собираем кол-во приходов по каждому пользователю
    const userRows = [];
    for (const u of users) {
      let shipCount = 0;
      try {
        const ships = await fsList('users/' + u.id + '/shipments');
        shipCount = ships.length;
      } catch(e) {}
      const verified = u.emailVerified !== false;
      userRows.push(`<tr>
        <td style="font-weight:500">${u.name || '—'}</td>
        <td>${u.email || u.id}</td>
        <td>${u.role === 'admin' ? '<span style="color:#6C4DB8;font-weight:600">admin</span>' : 'user'}</td>
        <td>${shipCount}</td>
        <td>${u.currency || 'BYN'}</td>
        <td>${u.created ? new Date(u.created).toLocaleDateString('ru-RU') : '—'}</td>
      </tr>`);
    }

    container.innerHTML = `
      <div class="cab-main-title">Администрирование</div>
      <div class="cab-stats" style="grid-template-columns:repeat(2,1fr)">
        <div class="cab-stat-card">
          <div class="cab-stat-val">${users.length}</div>
          <div class="cab-stat-label">Пользователей</div>
        </div>
        <div class="cab-stat-card">
          <div class="cab-stat-val">${users.filter(u=>u.role==='admin').length}</div>
          <div class="cab-stat-label">Администраторов</div>
        </div>
      </div>
      <div class="cab-table-wrap">
        <div class="cab-table-title">Пользователи</div>
        <table class="cab-table">
          <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Приходов</th><th>Валюта</th><th>Регистрация</th></tr></thead>
          <tbody>${userRows.join('')}</tbody>
        </table>
      </div>`;
  } catch(e) {
    container.innerHTML = `
      <div class="cab-main-title">Администрирование</div>
      <div class="cab-stub"><i class="ti ti-alert-triangle"></i><div class="cab-stub-title">Ошибка загрузки</div><div class="cab-stub-text">${e.message}</div></div>`;
  }
}
