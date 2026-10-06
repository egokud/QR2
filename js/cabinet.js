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
  // Показать админ-кнопку только для egokud
  const isAdmin = userProfile && userProfile.role === 'admin';
  document.getElementById('cabAdminBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('cabAdminDivider').style.display = isAdmin ? 'block' : 'none';
  // Имя и роль в сайдбаре
  document.getElementById('cabUserName').textContent = userProfile.name || currentUser.email;
  document.getElementById('cabUserRole').textContent = isAdmin ? 'Администратор' : 'Пользователь';
  // Загружаем данные и показываем Обзор
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
  cabCurrentSection = section;
  // Подсветка активного пункта
  document.querySelectorAll('#cabNav .cab-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });
  const main = document.getElementById('cabMain');
  if (section === 'overview') {
    renderCabOverview(main);
  } else {
    renderCabStub(main, section);
  }
}

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

function renderCabOverview(container) {
  const ships = cabShipmentsCache;
  // Считаем статистику
  const activeShips = ships.filter(s => s.status !== 'done').length;
  const totalClients = new Set();
  let grandDue = 0;
  let grandProfit = 0;
  const shipSummaries = [];

  for (const ship of ships) {
    const data = ship.data || [];
    const rates = ship.rates ? { ...DEFAULT_RATES, ...ship.rates } : { ...DEFAULT_RATES };
    const weights = ship.weights || {};
    const owners = ship.owners || {};
    const priceInclWeight = ship.priceInclWeight || {};
    const costGoods = ship.costGoods || {};
    const costShip = ship.costShip || {};
    const tare = ship.tare || 0;
    const cargoWeight = ship.cargoWeight || 0;

    // Собираем клиентов
    const clientsSet = new Set();
    const buyYuan = {};
    const clientYuanMap = {};
    for (const row of data) {
      const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
      const wh = r[1] || '';
      if (wh) {
        const parts = wh.split(/\s*и\s*/i);
        for (const p of parts) {
          const name = p.trim();
          if (name) {
            clientsSet.add(name);
            totalClients.add(name);
            const buy = parseFloat(r[3]) || 0;
            const cli = parseFloat(r[4]) || buy;
            buyYuan[name] = (buyYuan[name] || 0) + buy / parts.length;
            clientYuanMap[name] = (clientYuanMap[name] || 0) + cli / parts.length;
          }
        }
      }
    }

    // Считаем due и profit по клиентам (как computeClientCalc)
    let totalW = 0;
    const cNames = Array.from(clientsSet);
    for (const n of cNames) totalW += (weights[n] || 0);
    const effectiveTare = Math.max(tare || 0, (cargoWeight || 0) - totalW);

    let shipDue = 0, shipProfit = 0;
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
      shipDue += due;
      shipProfit += profit;
    }
    grandDue += shipDue;
    grandProfit += shipProfit;

    const st = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    shipSummaries.push({
      name: ship.name || 'Без названия',
      count: data.length,
      clients: cNames.length,
      status: st.label,
      statusColor: st.color,
      due: shipDue,
      profit: shipProfit,
      isDone: ship.status === 'done'
    });
  }

  // Клиенты с задолженностью (по всем приходам)
  const clientDebt = {};
  for (const ship of ships) {
    if (ship.status === 'done') continue;
    const data = ship.data || [];
    const rates = ship.rates ? { ...DEFAULT_RATES, ...ship.rates } : { ...DEFAULT_RATES };
    const weights = ship.weights || {};
    const owners = ship.owners || {};
    const priceInclWeight = ship.priceInclWeight || {};
    const costGoods = ship.costGoods || {};
    const costShip = ship.costShip || {};
    const tare = ship.tare || 0;
    const cargoWeight = ship.cargoWeight || 0;
    const buyY = {}, cliY = {};
    const cSet = new Set();
    for (const row of data) {
      const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
      const wh = r[1] || '';
      if (wh) {
        const parts = wh.split(/\s*и\s*/i);
        for (const p of parts) {
          const name = p.trim();
          if (name) {
            cSet.add(name);
            const buy = parseFloat(r[3]) || 0;
            const cli = parseFloat(r[4]) || buy;
            buyY[name] = (buyY[name] || 0) + buy / parts.length;
            cliY[name] = (cliY[name] || 0) + cli / parts.length;
          }
        }
      }
    }
    let totalW = 0;
    const cNames = Array.from(cSet);
    for (const n of cNames) totalW += (weights[n] || 0);
    const effTare = Math.max(tare || 0, (cargoWeight || 0) - totalW);
    for (const name of cNames) {
      if (owners[name]) continue;
      const w = weights[name] || 0;
      const ts = totalW > 0 ? (w / totalW) * effTare : 0;
      const sw = w > 0 ? Math.ceil((w + ts) * 20) / 20 : 0;
      const gc = (cliY[name] || 0) * rates.clientRate;
      const gCo = (buyY[name] || 0) * rates.buyRate;
      const sc = sw * rates.shipClient;
      const sCo = sw * rates.shipCargo;
      const cG = !!costGoods[name]; const cS = !!costShip[name]; const iW = !!priceInclWeight[name];
      let due;
      if (cG || cS) { due = (cG ? gCo : gc) + (cS ? sCo : sc); }
      else if (iW) { due = gc; }
      else { due = gc + sc; }
      clientDebt[name] = (clientDebt[name] || 0) + due;
    }
  }
  const topDebtors = Object.entries(clientDebt).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Рендер
  const fmt = (v) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  container.innerHTML = `
    <div class="cab-main-title">Обзор</div>
    <div class="cab-stats">
      <div class="cab-stat-card">
        <div class="cab-stat-val">${activeShips}</div>
        <div class="cab-stat-label">Активных приходов</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val val-purple" style="color:#6C4DB8">${fmt(grandDue)} <span style="font-size:14px;font-weight:400;opacity:0.7">BYN</span></div>
        <div class="cab-stat-label">Клиенты должны</div>
      </div>
      <div class="cab-stat-card">
        <div class="cab-stat-val green">${fmt(grandProfit)} <span style="font-size:14px;font-weight:400;opacity:0.7">BYN</span></div>
        <div class="cab-stat-label">Прибыль (все приходы)</div>
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
              <td class="val-purple">${fmt(s.due)}</td>
              <td class="${s.profit >= 0 ? 'val-green' : 'val-red'}">${s.profit >= 0 ? '+' : ''}${fmt(s.profit)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    ${topDebtors.length > 0 ? `
    <div class="cab-table-wrap">
      <div class="cab-table-title">Топ клиентов по задолженности</div>
      <table class="cab-table">
        <thead><tr><th>Клиент</th><th>Должен BYN</th></tr></thead>
        <tbody>
          ${topDebtors.map(([name, debt]) => `<tr>
            <td style="font-weight:500">${name}</td>
            <td class="val-purple">${fmt(debt)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;
}

