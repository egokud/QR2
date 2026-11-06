// ============ CABINET ============
let cabCurrentSection = 'overview';
let cabShipmentsCache = []; // кэш приходов для кабинета

// «Выйти» в Кабинете — выход из аккаунта (экрана выбора режима больше нет)
function exitCabinet() {
  if (cabShipId) { cabShipId = null; restoreActiveEditing(); }
  doLogout();
}

// Боковое меню: можно свернуть до значков (запоминается); на узком окне при первом входе — свёрнуто
function cabSidebarSet(mini) {
  const sc = document.getElementById('cabinetScreen'); if (!sc) return;
  sc.classList.toggle('cab-mini', !!mini);
  try { localStorage.setItem('pk_side', mini ? '1' : '0'); } catch (e) {}
  const b = document.getElementById('cabSideTg');
  if (b) { b.innerHTML = `<i class="ti ti-layout-sidebar-left-${mini ? 'expand' : 'collapse'}"></i>`; b.title = mini ? 'Развернуть меню' : 'Свернуть меню'; }
}
function cabSidebarInit() {
  const logo = document.querySelector('.cab-sidebar-logo');
  if (logo && !document.getElementById('cabSideTg')) {
    const b = document.createElement('button');
    b.id = 'cabSideTg'; b.className = 'cab-side-tg';
    b.onclick = e => { e.stopPropagation(); cabSidebarSet(!document.getElementById('cabinetScreen').classList.contains('cab-mini')); };
    logo.appendChild(b);
  }
  document.querySelectorAll('#cabNav .cab-nav-item, .cab-sidebar-logout').forEach(x => { if (!x.title) x.title = x.textContent.trim(); });
  let saved = null; try { saved = localStorage.getItem('pk_side'); } catch (e) {}
  cabSidebarSet(saved === null ? window.innerWidth < 1100 : saved === '1');
}
async function openCabinet() {
  cabSidebarInit();

  const isAdmin = userProfile && userProfile.role === 'admin';
  document.getElementById('cabAdminBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('cabAdminDivider').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('cabUserName').textContent = userProfile.name || currentUser.email;
  document.getElementById('cabUserRole').textContent = isAdmin ? 'Администратор' : 'Пользователь';
  // Клик по логотипу — на Обзор
  const logo = document.querySelector('.cab-sidebar-logo');
  if (logo) { logo.style.cursor = 'pointer'; logo.title = 'Обзор'; logo.onclick = () => cabNav('overview'); }
  await loadCabinetData();
  cabExtPaint();   // кнопка «Расширение»: версия / «устарело»
  await cabRestoreAt();
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

// Где пользователь в Кабинете — чтобы «Обновить» в браузере вернуло туда же (только эта вкладка браузера)
function cabSaveAt() { try { sessionStorage.setItem('pk_cab_at', JSON.stringify({ s: cabCurrentSection, ship: cabShipId || '', tab: cabShipId ? cabShipTab : '', cl: cabClientOpen || '' })); } catch (e) {} }
async function cabRestoreAt() {
  // Пришли из расширения после «Сохранить в Piksta» → «Перейти в Piksta» (?ship=<id>, 06.11.2026):
  // сразу открываем эту закупку на вкладке «Товары и цены». Параметр убираем из адреса, чтобы «Обновить» работало как обычно.
  // Маршрутизация: ссылку строит расширение (assign.js, кнопка «Перейти в Piksta»), режим Кабинета включает showApp() в app.js.
  const goShip = pkUrlShip();
  if (goShip) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    window.__cabAtUsed = 1;
    if (!cabShipmentsCache.some(x => x.id === goShip)) await loadCabinetData();
    if (cabShipmentsCache.some(x => x.id === goShip)) {
      cabNav('shipments'); await cabOpenShip(goShip);
      if (cabShipTab !== 'items') cabShipTabSet('items');
      return;
    }
  }
  let at = null;
  try { const nav = performance.getEntriesByType('navigation')[0]; if (!window.__cabAtUsed && nav && nav.type === 'reload') at = JSON.parse(sessionStorage.getItem('pk_cab_at') || 'null'); } catch (e) {}
  window.__cabAtUsed = 1;
  if (!at || !at.s) { cabNav('overview'); return; }
  if (at.ship && cabShipmentsCache.some(x => x.id === at.ship)) {
    cabNav('shipments'); await cabOpenShip(at.ship);
    if (at.tab && at.tab !== cabShipTab) cabShipTabSet(at.tab);
    return;
  }
  if (at.cl) { cabNav('clients'); cabOpenClient(encodeURIComponent(at.cl)); return; }
  cabNav(document.querySelector(`#cabNav .cab-nav-item[data-section="${at.s}"]`) ? at.s : 'overview');
}
function cabNav(section) {
  if (cabShipId) { cabShipId = null; restoreActiveEditing(); }
  cabClientOpen = null;
  cabCurrentSection = section;
  cabSaveAt();
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
    tariffs: renderCabTariffs,
    admin: renderCabAdmin
  };
  (renderers[section] || renderCabStub)(main, section);
  cabAccessMark();
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
  const due2 = Math.round((due || 0) * 100) / 100;   // сравниваем в копейках: 155.3849 к оплате = 155.38 оплачено
  const paid = p && typeof p.paid === 'number' ? p.paid : ((legacyPaid || {})[name] ? due2 : 0);
  const rest = Math.max(0, Math.round((due2 - paid) * 100) / 100);
  const status = isOwner ? 'owner' : (due2 <= 0.004 || paid >= due2 - 0.004) ? 'full' : paid > 0.004 ? 'part' : 'none';
  return { paid, rest, status, closed: !!(p && p.closed) };
}
// РАСЧЁТ ЗАКРЫТ НЕ НА ТУ СУММУ (только рассортированные и архив):
//  • заплатил больше — переплата идёт в прибыль, итог клиента = сколько заплатил;
//  • заплатил меньше и вы нажали «Оплачено» — остаток списан (скидка), итог = сколько заплатил, прибыль меньше.
// Предоплата и частичная оплата до закрытия — обычный долг. Меняет c.due и c.profit на месте.
function cabSettleAdjust(ship, clients) {
  if (!ship || !clients) return clients;
  const billed = typeof cabIsBilled === 'function' ? cabIsBilled(ship) : (ship.status === 'sorted' || ship.status === 'done');
  for (const c of clients) {
    c.settle = null; c.settleDiff = 0;
    if (c.isOwner) continue;
    const p = (ship.payments || {})[c.name];
    if (!p || typeof p.paid !== 'number') continue;
    const due2 = Math.round(c.due * 100) / 100;
    let kind = null;
    if (billed && p.paid > due2 + 0.004) kind = 'over';
    else if (p.closed && p.paid < due2 - 0.004) kind = 'off';
    if (!kind) continue;
    const diff = Math.round((p.paid - due2) * 100) / 100;
    c.dueBeforeSettle = due2; c.settle = kind; c.settleDiff = diff;
    c.due = p.paid; c.profit += diff;
  }
  return clients;
}
function cabSettleNote(c) {
  if (!c || !c.settle) return '';
  return c.settle === 'over'
    ? `<div style="font-size:12px;color:#16a34a;margin-top:3px;white-space:nowrap" title="По расчёту ${cabFmt2(c.dueBeforeSettle)}. Переплата засчитана в прибыль">+${cabFmt2(c.settleDiff)} сверху</div>`
    : `<div style="font-size:12px;color:#b45309;margin-top:3px;white-space:nowrap" title="По расчёту ${cabFmt2(c.dueBeforeSettle)}. Остаток списан, прибыль меньше">списано ${cabFmt2(-c.settleDiff)}</div>`;
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
    if (!doc.exists) throw new Error('закупка не найдена');
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
// Есть ли дата уже в названии прихода («Отправка 12.10», «Отправка 21-22.09.26») — тогда дату рядом не дублируем
function cabNameHasDate(ship) { return /\d{1,2}\s*[.\-]\s*\d{1,2}/.test((ship && ship.name) || ''); }
function cabShipDateStr(ship) {
  const d = cabShipDate(ship) || (ship && ship.created ? new Date(ship.created) : null);
  return d && !isNaN(d) ? d.toLocaleDateString('ru-RU') : '';
}
// Флаг клиента в приходе: явное значение в приходе, иначе правило из карточки клиента (clientRule в app.js)
function cabFlag(map, kind, name) {
  if (map && Object.prototype.hasOwnProperty.call(map, name)) return !!map[name];
  return typeof clientRule === 'function' ? !!clientRule(kind, name) : false;
}
const cabFmt = (v) => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');   // неразрывный пробел: «38 554» не рвётся на две строки
const cabFmt2 = (v) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

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
  const canonName = typeof buildWhCanon === 'function' ? buildWhCanon(data) : {};
  for (const row of data) {
    const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
    // Делим склад так же, как мобильная версия: только по союзу « и » между словами.
    // Раньше делилось по любой букве «и» внутри имени — отсюда фейковые клиенты из одной-двух букв.
    const parts = splitWarehouses(r[1] || '');
    if (parts.length) {
      for (const p of parts) {
        const low = p.toLowerCase();
        if (!(low in canonName)) canonName[low] = p;  // регистр не важен: каноническое — с заглавными (buildWhCanon)
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
  const tarePct = ship.tarePct || 0;  // тара % к весу клиента — карго не учитывается
  const effectiveTare = tarePct > 0 ? totalW * tarePct / 100 : Math.max(tare || 0, (cargoWeight || 0) - totalW);

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
  cabSettleAdjust(ship, result);
  for (const c of result) { if (!c.settle) continue; const pi = cabPayInfo(ship.payments, ship.paid, c.name, c.due, c.isOwner); c.payPaid = pi.paid; c.payRest = pi.rest; c.payStatus = pi.status; c.paid = pi.status === 'full'; }
  return { clients: result, rates, totalW, effectiveTare };
}

// ============ ЗАГЛУШКА ============
function renderCabStub(container, section) {
  const names = {
    shipments: 'Закупки', clients: 'Клиенты', prices: 'Цены',
    calc: 'Деньги', analytics: 'Аналитика', settings: 'Настройки', tariffs: 'Тариф', admin: 'Администрирование'
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
// Долг клиентов считается только когда приход рассортирован или в архиве — до этого клиентам ещё не выставлено
function cabIsBilled(ship) { return !!ship && (ship.status === 'sorted' || ship.status === 'done'); }
// ДЕНЬГИ ВЛАДЕЛЬЦА (по всем приходам, любой статус; «Это я» не входит — это личные расходы):
//  Вложено в товар = себестоимость (выкуп ¥ × курс выкупа + доставка карго после взвешивания), за которую клиенты ещё не рассчитались.
//    Оплата клиента сначала гасит себестоимость; заплатил всё — деньги вернулись. Нет цены выкупа — берём цену клиента ¥ × курс выкупа.
//  Получено прибыли = наценка, которую клиенты уже заплатили (сверх себестоимости, не больше расчётной прибыли).
//  Оборотка = вложено в товар + полученная прибыль.
function cabMoney(ships) {
  let frozen = 0, realized = 0, nShips = 0;
  for (const ship of ships) {
    const { clients, rates } = cabGetClientsFromShipment(ship);
    let f = 0;
    for (const c of clients) {
      if (c.isOwner) continue;
      const goods = c.buyYuan > 0 ? c.goodsCost : c.clientYuan * rates.buyRate;
      const cost = goods + c.shipCo;
      const paid = c.payPaid || 0;
      f += Math.max(0, cost - paid);
      realized += Math.min(Math.max(0, c.profit), Math.max(0, paid - cost));
    }
    if (f > 0.5) nShips++;
    frozen += f;
  }
  return { frozen, realized, turnover: frozen + realized, nShips };
}
function cabDeliveredKg(ships) {
  return ships.filter(s => s.status === 'sorted' || s.status === 'done').reduce((n, s) => n + cabShipTotalKg(s), 0);
}

// ============ ОБЗОР ============
// Склонение: cabPl(5, 'клиент', 'клиента', 'клиентов') → 'клиентов'
function cabPl(n, one, few, many) {
  const a = Math.abs(Math.round(n)) % 100, b = a % 10;
  return (a > 10 && a < 20) ? many : b === 1 ? one : (b >= 2 && b <= 4) ? few : many;
}
function cabGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const first = userProfile && userProfile.name ? userProfile.name.split(' ')[0] : '';
  return part + (first ? ', ' + first : '');
}
// Итоги «за всё время» одной полосой: подпись сверху, цифра снизу (Обзор и Приходы)
function cabTotalsStrip(ships, withClients) {
  const billed = ships.filter(s => s.status === 'sorted' || s.status === 'done');
  const items = billed.reduce((n, s) => n + (s.data || []).length, 0);
  const kg = cabDeliveredKg(ships);
  const inWork = ships.filter(s => s.status !== 'done' && s.status !== 'sorted').length;
  const segs = [
    ['ti-package', 'Закупок всего', ships.length, inWork ? `${inWork} собирается или в пути` : 'все доставлены'],
    ['ti-shirt', 'Привезено товаров', cabFmt(items), billed.length ? `≈ ${cabFmt(items / billed.length)} за закупку` : ''],
    ['ti-weight', 'Привезено, кг', kg.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), items ? `≈ ${(kg / items).toFixed(2)} кг на товар` : '']
  ];
  if (withClients) {
    const names = new Set(); ships.forEach(s => cabGetClientsFromShipment(s).clients.forEach(c => { if (!c.isOwner) names.add(c.name.toLowerCase()); }));
    segs.push(['ti-users', 'Клиентов', names.size, 'за всё время']);
  }
  return `<div class="cab-strip">${segs.map(([ic, l, v, sub]) => `<div class="cab-strip-seg">
      <div class="cab-strip-l"><i class="ti ${ic}"></i>${l}</div>
      <div class="cab-strip-v">${v}</div>
      <div class="cab-strip-s">${sub}</div>
    </div>`).join('')}</div>`;
}
// Плашка статуса прихода (цветная, вместо точки)
function cabShipPill(status) {
  const st = SHIP_STATUSES[status] || SHIP_STATUSES.forming;
  return `<span class="cab-pill" style="--c:${st.text || st.color};--b:${st.color}22">${st.label}</span>`;
}

// Наценка по клиентам (без «Это я»): got — уже оплачено сверх себестоимости; sure — рассортированные (вес известен), ещё не оплачено;
// est — до сортировки: в основном наценка на курс юаня, доставка посчитается после взвешивания
function cabMarkup(ships) {
  let got = 0, sure = 0, est = 0; const estIds = new Set();
  for (const ship of ships) {
    const { clients, rates } = cabGetClientsFromShipment(ship);
    for (const c of clients) {
      if (c.isOwner) continue;
      const p = Math.max(0, c.profit);
      const cost = (c.buyYuan > 0 ? c.goodsCost : c.clientYuan * rates.buyRate) + c.shipCo;
      const r = Math.min(p, Math.max(0, (c.payPaid || 0) - cost));
      got += r;
      if (cabIsBilled(ship)) sure += p - r; else { est += p - r; if (p - r > 0.5) estIds.add(ship.id); }
    }
  }
  return { got, sure, est, total: got + sure + est, estShips: estIds.size };
}
// Подсказки «?» на блоках Обзора
const CAB_HELP = {
  money: ['Деньги в обороте', 'Сколько ваших денег сейчас крутится в заказах.<br><b>Вложено в товар</b> — сколько вы потратили на выкуп и доставку карго, а клиенты вам это ещё не вернули. Считается с момента выкупа на Pinduoduo, в любом статусе закупки.<br><b>Получено прибыли</b> — ваша наценка, которую клиенты уже заплатили.<br>Отметили оплату клиента — «вложено» уменьшается, «получено» растёт. Ваши личные покупки («Это я») сюда не входят.'],
  markup: ['Наценка в заказах', 'Разница между тем, сколько платят клиенты, и вашей себестоимостью — по всем текущим заказам.<br><b>Уже получено</b> — клиенты заплатили.<br><b>Рассортировано</b> — товар взвешен, сумма точная, ждём оплаты.<br><b>В пути и в сборке (≈)</b> — только наценка на курс юаня. Наценку на доставку посчитаем, когда закупку взвесят, поэтому итог может измениться.<br>Это не обещанная прибыль: если клиент не заберёт или не оплатит заказ, этих денег не будет.'],
  todo: ['Что сделать сейчас', 'Помощник собирает дела, которые приносят деньги или экономят время: кто должен, какая закупка собирается, кого из клиентов пора вернуть, какие имена похожи на дубли.<br>Нажмите на строку — откроется нужный раздел.'],
  an_split: ['Куда идут деньги клиентов', 'Всё, что заплатят клиенты по рассортированным закупкам, разложено на три части: сколько ушло на выкуп товара, сколько — на доставку карго, и сколько осталось вам (наценка).<br>Закупки в пути сюда не входят: пока нет веса, суммы неточные.'],
  an_src: ['Откуда наценка', 'Наценка складывается из двух частей: <b>на курсе</b> — разница между курсом для клиента и курсом закупки, и <b>на доставке</b> — разница между тем, что клиент платит за кг, и тарифом карго.<br>Если доля доставки маленькая или отрицательная — возможно, стоит поднять «Доставку клиенту» в Ценах.'],
  incl: ['Вес в цене', 'Доставка этого клиента уже заложена в цену товара — Piksta <b>не начисляет</b> ему доставку по весу.<br>Если включена «Тара 8%», такого клиента можно не взвешивать.'],
  tare8: ['Тара 8%', 'К весу каждого взвешенного клиента прибавляется 8% на коробки и упаковку. Тару по весу от карго в этом режиме не высчитываем.'],
  departed: ['Отправка выехала с карго', 'Поставьте галочку, когда карго забрало посылки, — закупка перейдёт в статус «В дороге». Снять её можно, пока закупка в дороге: она вернётся в «Формируется».'],
  costGoods: ['Товар по себестоимости', 'Клиент платит за товар столько, сколько он стоил вам, — <b>без наценки</b> на курсе. Ваша прибыль с товара этого клиента — 0. Для своих, друзей и себя.'],
  costShip: ['Доставка по себестоимости', 'Клиент платит доставку по цене карго — <b>без вашей наценки</b> на доставке. Прибыль с доставки этого клиента — 0.'],
  sh_work: ['Сейчас в работе', 'Сколько закупок на каждом этапе: <b>собирается</b> → <b>в пути</b> → <b>на складе</b> → <b>рассортирована</b>. Под этапами — какая закупка дольше всех в пути, самая большая и сколько в среднем весит товар.'],
  sh_bars: ['Позиций в закупках', 'Столбик — одна закупка, высота — сколько в ней позиций, цвет — статус. Наведите на столбик — увидите вес и статус, нажмите — откроется закупка.'],
  sh_pay: ['Оплаты', 'Как клиенты рассчитались по закупке: сколько ещё не оплатили и сколько денег ждём. До сортировки долг ещё не выставлен — поэтому «до сортировки».'],
  cl_base: ['Клиентская база', 'Все, кому вы что-то заказывали. Цветная полоса — из кого состоит база:<br><b>Новые</b> — впервые в самой свежей закупке; <b>Активные</b> — есть в двух последних; <b>Обычные</b> — заказывают время от времени; <b>Разовые</b> — была одна закупка; <b>Забытые</b> — были в 2+ закупках, но в трёх последних их нет. <b>Чемпионы</b> — чаще всех заказывают и приносят больше всего.<br>Нажмите на группу — список ниже отфильтруется.'],
  cl_debt: ['Должны вам', 'Сколько клиенты ещё не заплатили по <b>рассортированным</b> закупкам — там, где долг уже выставлен. Полоса — какая часть уже собрана.<br>Деньги, вложенные в товар, который ещё едет, — в Обзоре, в «Деньги в обороте».'],
  cl_list: ['Список клиентов', 'Поиск — по имени, телефону или Telegram. Фильтры сверху — группы клиентов, папки — ваши собственные группы (например, «Родные» или «Опт»).<br>Нажмите на имя — откроется карточка: долги по всем закупкам, контакты, условия.'],
  flow: ['Где сейчас товар', 'Все закупки по этапам: <b>собирается</b> → <b>в пути</b> → <b>на складе</b> → <b>рассортирована</b>.<br>До сортировки показана примерная наценка (без доставки). После сортировки — сколько клиенты ещё должны.<br>Нажмите на закупку, чтобы открыть её. Архивные закупки — в разделе «Закупки».']
};
// Раздел инструкции piksta.online/help для каждой подсказки
const CAB_HELP_LINK = { money: 'ch8', markup: 'ch8', todo: 's1-4', flow: 's2-1', an_split: 'ch8', an_src: 'ch8', incl: 's5-1', tare8: 's5-1', departed: 's2-1',
  costGoods: 's5-4', costShip: 's5-4', sh_work: 's2-5', sh_bars: 's2-5', sh_pay: 'ch6', cl_base: 'ch7', cl_debt: 's6-4', cl_list: 'ch7' };
// «?» — подсказка всплывает при наведении (на телефоне — по нажатию); внизу ссылка на раздел инструкции
function cabHelpBtn(k) { return `<button type="button" class="cab-help" aria-label="Что это?" onmouseenter="cabTipHover(event,'${k}')" onmouseleave="cabTipLeave()" onclick="cabTipClick(event,'${k}')"><i class="ti ti-help-circle"></i></button>`; }
let cabTipT = null;
function cabTipShow(btn, k) {
  clearTimeout(cabTipT);
  const old = document.getElementById('cabTip'); if (old) { if (old.dataset.k === k) return; old.remove(); }
  const [t, body] = CAB_HELP[k] || ['', ''], ln = CAB_HELP_LINK[k];
  const m = document.createElement('div'); m.className = 'cab-tip'; m.id = 'cabTip'; m.dataset.k = k;
  m.innerHTML = `<div class="tt"><i class="ti ti-help-circle"></i>${t}</div><div class="tb">${body}</div>${ln ? `<span class="tl soon" aria-disabled="true"><i class="ti ti-book"></i>Подробная инструкция — скоро появится</span>` : ''}`;
  m.onmouseenter = () => clearTimeout(cabTipT); m.onmouseleave = cabTipLeave;
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - 28)) + 'px';
  const below = r.bottom + 10 + h <= innerHeight - 8;
  m.style.top = (below ? r.bottom + 10 : Math.max(8, r.top - h - 10)) + 'px';
  m.classList.add(below ? 'dn' : 'up');
  m.style.setProperty('--ax', Math.max(14, Math.min(w - 20, r.left + r.width / 2 - parseFloat(m.style.left))) + 'px');
}
function cabTipHide() { clearTimeout(cabTipT); const x = document.getElementById('cabTip'); if (x) x.remove(); }
function cabTipHover(ev, k) { if (matchMedia('(hover: hover)').matches) cabTipShow(ev.currentTarget, k); }
function cabTipLeave() { clearTimeout(cabTipT); cabTipT = setTimeout(cabTipHide, 250); }
function cabTipClick(ev, k) {
  ev.stopPropagation();
  const x = document.getElementById('cabTip');
  if (x && x.dataset.k === k && !matchMedia('(hover: hover)').matches) { cabTipHide(); return; }
  cabTipShow(ev.currentTarget, k);
  setTimeout(() => document.addEventListener('click', function f(e) { const t = document.getElementById('cabTip'); if (t && t.contains(e.target)) return; cabTipHide(); document.removeEventListener('click', f); }), 0);
}
addEventListener('scroll', () => { if (matchMedia('(hover: hover)').matches) cabTipHide(); }, { passive: true, capture: true });

// ── НОВОСТЬ НА ОБЗОРЕ (06.11.2026): «3 маркетплейса одной кнопкой» ──
// Временно стоит на месте «Деньги в обороте». Крестик прячет её в этом аккаунте (в этом браузере), сама пропадает после CAB_NEWS_UNTIL —
// тогда «Деньги в обороте» возвращаются на место. Следующую новость — сменить CAB_NEWS_ID и текст.
const CAB_NEWS_ID = 'mk3-2026-11', CAB_NEWS_UNTIL = '2026-11-30';
// Актуальная версия расширения — ОДНО место: кнопка «Расширение» в меню и баннер Обзора берут её отсюда.
// Выложили новое расширение на сайт (piksta-extension.zip) — поменять здесь.
const PK_EXT_VER = '1.10.4';
// Какая версия стоит у человека (1.10.5+ сама кладёт номер в localStorage pk_ext_ver, когда открыт piksta.online).
// Старые версии номер не сообщают — узнаём по последнему импорту: с 06.11.2026 у треков из импорта есть пометка площадки (mk).
function cabVerLess(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; }
function cabExtState() {
  let v = ''; try { v = localStorage.getItem('pk_ext_ver') || ''; } catch (e) {}
  if (v) return { old: cabVerLess(v, PK_EXT_VER), ver: v };
  // последняя закупка из импорта расширения: у товаров картинки с площадок (pddpic / alicdn), это не перенесённые треки (mvFrom)
  const fromExt = r => { const o = Array.isArray(r) ? { img: r[2] } : r; return /pddpic|yangkeduo|alicdn/.test(String(o.img || '')) && !o.mvFrom; };
  const imp = (cabShipmentsCache || []).filter(s => s.src !== 'manual' && new Date(s.created || 0) >= new Date('2026-11-06') && (s.data || []).filter(fromExt).length >= 3)[0];
  if (imp && !(imp.data || []).some(r => !Array.isArray(r) && r.mk)) return { old: true, ver: '' };
  return { old: false, ver: '' };
}
function cabExtPaint() {
  const a = document.querySelector('.cab-nav-ext'); if (!a) return;
  const st = cabExtState();
  a.classList.toggle('old', st.old);
  const v = document.getElementById('cabExtVer');
  if (v) v.textContent = st.old ? (st.ver ? 'у вас старая ' + st.ver : 'у вас старая версия') : 'версия ' + PK_EXT_VER;
  let u = a.querySelector('.upd');
  if (st.old && !u) { a.querySelector('.tx').insertAdjacentHTML('beforeend', `<span class="upd">Обновить до ${PK_EXT_VER} →</span>`); a.insertAdjacentHTML('beforeend', '<span class="dot"></span>'); }
  if (!st.old && u) { u.remove(); const d = a.querySelector('.dot'); if (d) d.remove(); }
  a.title = st.old ? 'Расширение устарело — скачайте ' + PK_EXT_VER : 'Скачать расширение Piksta для Chrome';
}
window.addEventListener('pk-ext', () => { cabExtPaint(); if (typeof cabCurrentSection !== 'undefined' && cabCurrentSection === 'overview' && !cabShipId && document.getElementById('cabMain')) cabNav('overview'); });
// Крестик запоминается для каждого аккаунта отдельно (ключ с uid): закрыл в своём Кабинете — в другом аккаунте
// на этом же компьютере новость всё равно видна, пока там тоже не нажмут крестик.
const cabNewsKey = () => 'pk_news_off_' + (typeof savedUid !== 'undefined' && savedUid ? savedUid : 'anon');
function cabNewsOn() {
  if (new Date().toISOString().slice(0, 10) > CAB_NEWS_UNTIL) return false;
  try { return localStorage.getItem(cabNewsKey()) !== CAB_NEWS_ID; } catch (e) { return true; }
}
function cabNewsOff() { try { localStorage.setItem(cabNewsKey(), CAB_NEWS_ID); } catch (e) {} cabNav('overview'); }
function cabNewsCard() {
  return `<div class="cab-card cab-news">
      <button type="button" class="cab-news-x" onclick="cabNewsOff()" title="Скрыть — вернуть «Деньги в обороте»"><i class="ti ti-x"></i></button>
      <div class="cab-news-l">
        <span class="cab-news-tag"><i class="ti ti-sparkles"></i> Новое</span>
        <div class="cab-news-h">3 маркетплейса —<br>одной кнопкой</div>
        <div class="cab-news-p">Треки, фото, цены и названия на русском с Pinduoduo, Taobao и 1688 — за одну загрузку, сразу в закупку.</div>
        <div class="cab-news-bt">
          <a class="cab-news-b1" href="/extension" target="_blank" rel="noopener"><i class="ti ti-download"></i>Обновить расширение</a>
          <span class="cab-news-v">версия ${PK_EXT_VER} · бесплатно</span>
        </div>
      </div>
      <div class="cab-news-art" aria-hidden="true">
        <div class="cab-news-src"><span class="pk-mk pdd">PDD</span><span class="pk-mk tb">TAOBAO</span><span class="pk-mk a1688">1688</span></div>
        <svg class="cab-news-lines" viewBox="0 0 60 120" preserveAspectRatio="none"><path d="M0 18 C30 18 30 60 60 60M0 60 H60M0 102 C30 102 30 60 60 60" /></svg>
        <div class="cab-news-box"><img src="/icons/icon-192x192.png" alt=""><b>Piksta</b><small>1 закупка</small></div>
      </div>
    </div>`;
}
function renderCabOverview(container) {
  if (!cabShipmentsCache.length) { container.innerHTML = cabEmptyOverview(); return; }
  const ships = cabShipmentsCache;
  const money = cabMoney(ships);
  // Наценка в заказах (не «обещанная прибыль»): уже получено / точно — рассортированные, вес известен /
  // оценка — приходы до сортировки: только наценка на курс юаня, доставка посчитается после взвешивания
  const mk = cabMarkup(ships);
  const turn = money.turnover || 1;
  const frozenPct = Math.max(money.frozen > 0 ? 3 : 0, Math.min(100, money.frozen / turn * 100));
  const realPct = money.realized > 0 ? Math.max(3, 100 - frozenPct) : 0;

  // Клиенты: долги, сегменты, дубли — для блока «Что сделать сейчас»
  const S = cabClientsSummary();
  const cl = S.list.filter(c => !c.isOwner);
  const debtSum = cl.reduce((n, c) => n + c.unpaidDue, 0);
  const debtors = cl.filter(c => c.unpaidDue > 0.005).length;
  const segN = k => cl.filter(c => c.status === k).length;
  const dupes = cabFindDupes(S.list).length;

  const todo = [];
  { const E = cabExtState(); if (E.old) todo.push({ ic: 'ti-puzzle', tone: 'orange', t: `Устарело расширение: ${E.ver ? 'у вас <b>' + E.ver + '</b>, ' : ''}есть <b>${PK_EXT_VER}</b>`, s: 'В новой версии — импорт с Taobao и 1688, названия на русском. Обновление — 1 минута', a: `window.open('/extension','_blank')`, btn: 'Обновить' }); }
  if (debtors) todo.push({ ic: 'ti-cash', tone: 'red', t: `${debtors} ${cabPl(debtors, 'клиент должен', 'клиента должны', 'клиентов должны')} <b>${cabFmt(debtSum)} BYN</b>`, s: 'По рассортированным закупкам. Отметьте, кто уже заплатил', a: `cabClientFilter='all';cabNav('clients')`, btn: 'Отметить оплаты' });
  const cnb = cabCnBreak();
  if (cnb) todo.push({ ic: 'ti-calendar-event', tone: 'orange', t: `Через ${cnb.days} ${cabPl(cnb.days, 'день', 'дня', 'дней')} Китай уходит на <b>${cnb.name}</b>`, s: `Фабрики и склады встанут ${cnb.len}. Напишите клиентам заранее — пусть успеют заказать до ${cnb.fmt(cnb.orderBy)}`, a: `cabClientFilter='all';cabNav('clients')`, btn: 'Написать клиентам' });
  for (const s of ships.filter(s => s.status === 'delayed')) todo.push({ ic: 'ti-clock-exclamation', tone: 'orange', t: `<b>${s.name || 'Закупка'}</b> задерживается`, s: 'Предупредите клиентов — это сохраняет доверие', a: `cabOpenShip('${s.id}')`, btn: 'Открыть' });
  for (const s of ships.filter(s => s.status === 'forming')) { const n = (s.data || []).length, k = cabGetClientsFromShipment(s).clients.length; todo.push({ ic: 'ti-shopping-cart', tone: 'blue', t: `<b>${s.name || 'Закупка'}</b> собирается`, s: `${n} ${cabPl(n, 'позиция', 'позиции', 'позиций')} · ${k} ${cabPl(k, 'клиент', 'клиента', 'клиентов')}. Самое время позвать тех, кто давно не заказывал`, a: `cabOpenShip('${s.id}')`, btn: 'Открыть' }); }
  const once = segN('once'), forg = segN('forgotten');
  if (forg) todo.push({ ic: 'ti-zzz', tone: 'amber', t: `${forg} ${cabPl(forg, 'постоянный клиент пропал', 'постоянных клиента пропали', 'постоянных клиентов пропали')}`, s: 'Заказывали 2+ раза, но давно не было. Как вернуть — подскажем', a: `cabClientFilter='forgotten';cabNav('clients')`, btn: 'Вернуть' });
  if (once) todo.push({ ic: 'ti-repeat', tone: 'sky', t: `${once} ${cabPl(once, 'клиент купил', 'клиента купили', 'клиентов купили')} только один раз`, s: `${cl.length ? Math.round(once / cl.length * 100) : 0}% базы. Второй заказ — главный шаг к постоянному клиенту`, a: `cabClientFilter='once';cabNav('clients')`, btn: 'Как вернуть' });
  if (dupes) todo.push({ ic: 'ti-copy', tone: 'gray', t: `${dupes} ${cabPl(dupes, 'клиент записан', 'клиента записаны', 'клиентов записаны')} по-разному`, s: 'Похожие имена — объедините, чтобы история и долги считались верно', a: `cabClientFilter='all';cabNav('clients')`, btn: 'Проверить' });

  // Где сейчас товар — этапы
  const stages = [
    ['Собирается', ['forming'], 'ti-shopping-cart', '#4a90d9'],
    ['В пути', ['transit', 'delayed'], 'ti-truck', '#d4a106'],
    ['На складе', ['warehouse'], 'ti-building-warehouse', '#3cb371'],
    ['Рассортирована', ['sorted'], 'ti-checks', '#8b7fd4']
  ];
  const shipCard = s => {
    const { clients } = cabGetClientsFromShipment(s);
    let profit = 0, rest = 0;
    for (const c of clients) { if (c.isOwner) continue; profit += c.profit; rest += c.payRest; }
    const n = (s.data || []).length;
    const bottom = s.status === 'sorted'
      ? (rest > 0.5 ? `<span class="cab-flow-due">ждём ${cabFmt(rest)} BYN</span>` : `<span class="cab-flow-ok"><i class="ti ti-check"></i> всё оплачено</span>`)
      : `<span class="cab-flow-profit" title="Наценка на курс юаня. Доставку посчитаем после взвешивания">≈ ${profit >= 0 ? '+' : ''}${cabFmt(profit)} <em>без доставки</em></span>`;
    return `<div class="cab-flow-card" onclick="cabOpenShip('${s.id}')">
        <div class="cab-flow-name">${s.name || 'Без названия'}${s.status === 'delayed' ? ' <span class="cab-pill" style="--c:#c2410c;--b:#f9731622">задерж.</span>' : ''}</div>
        <div class="cab-flow-meta">${n} поз. · ${clients.length} кл.</div>
        <div class="cab-flow-bot">${bottom}</div>
      </div>`;
  };
  const archived = ships.filter(s => s.status === 'done').length;
  const flow = stages.map(([label, keys, ic, color], i) => {
    const list = ships.filter(s => keys.includes(s.status));
    return `<div class="cab-flow-col">
      <div class="cab-flow-head" style="--c:${color}"><i class="ti ${ic}"></i>${label}<span>${list.length}</span>${i < stages.length - 1 ? '<i class="ti ti-chevron-right cab-flow-arrow"></i>' : ''}</div>
      <div class="cab-flow-list">${list.map(shipCard).join('') || '<div class="cab-flow-empty">—</div>'}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="cab-hello">
      <div class="cab-main-title" style="margin-bottom:2px">${cabGreeting()}</div>
      <div class="cab-hello-sub">Вот как идут дела: деньги, закупки и что стоит сделать сегодня</div>
    </div>

    <div class="cab-ov-top">
      ${cabNewsOn() ? cabNewsCard() : `<div class="cab-card cab-money">
        <div class="cab-card-l"><i class="ti ti-coins"></i> Деньги в обороте${cabHelpBtn('money')}</div>
        <div class="cab-money-v">${cabFmt(money.turnover)} <small>BYN</small></div>
        <div class="cab-money-bar"><span style="width:${frozenPct}%;background:#6C4DB8"></span>${realPct ? `<span style="width:${realPct}%;background:#16a34a"></span>` : ''}</div>
        <div class="cab-money-leg">
          <div><i style="background:#6C4DB8"></i><span>Вложено в товар</span><b>${cabFmt(money.frozen)} BYN</b><em>ждёт оплаты клиентов · ${money.nShips} ${cabPl(money.nShips, 'закупка', 'закупки', 'закупок')}</em></div>
          <div><i style="background:#16a34a"></i><span>Получено прибыли</span><b style="color:#16a34a">${cabFmt(money.realized)} BYN</b><em>уже ваши деньги</em></div>
        </div>
      </div>`}
      <div class="cab-card cab-wait">
        <div class="cab-card-l"><i class="ti ti-receipt-2"></i> Наценка в заказах${cabHelpBtn('markup')}</div>
        <div class="cab-wait-v">${mk.est > 0.5 ? '≈ ' : ''}${cabFmt(mk.total)} <small>BYN</small></div>
        ${mk.est > 0.5 ? `<div class="cab-wait-warn"><i class="ti ti-scale"></i> Без учёта доставки</div><div class="cab-wait-s">${mk.estShips} ${cabPl(mk.estShips, 'закупка ещё не взвешена', 'закупки ещё не взвешены', 'закупок ещё не взвешены')} — итог изменится</div>` : '<div class="cab-wait-s">все закупки взвешены — суммы точные</div>'}
        <div class="cab-wait-bar">${[[mk.got, '#16a34a'], [mk.sure, '#86efac'], [mk.est, 'est']].filter(x => x[0] > 0.5).map(([v, c]) => `<span style="flex:${v};${c === 'est' ? '' : 'background:' + c}" class="${c === 'est' ? 'est' : ''}"></span>`).join('')}</div>
        <div class="cab-wait-rows">
          <div><i style="background:#16a34a"></i><span>Уже получено</span><b>${cabFmt(mk.got)}</b></div>
          <div><i style="background:#86efac"></i><span>Рассортировано, ждёт оплаты</span><b>${cabFmt(mk.sure)}</b></div>
          <div><i class="est"></i><span>В пути и в сборке <em>≈ оценка</em></span><b>${mk.est > 0.5 ? '≈ ' : ''}${cabFmt(mk.est)}</b></div>
        </div>
      </div>
    </div>

    ${todo.length ? `<div class="cab-card cab-todo">
      <div class="cab-card-h">Что сделать сейчас${cabHelpBtn('todo')}</div>
      ${todo.slice(0, 6).map(x => `<div class="cab-todo-row" onclick="${x.a}">
        <span class="cab-todo-ic t-${x.tone}"><i class="ti ${x.ic}"></i></span>
        <div class="cab-todo-tx"><div>${x.t}</div><div class="cab-todo-s">${x.s}</div></div>
        <button class="cab-todo-btn">${x.btn} <i class="ti ti-arrow-right"></i></button>
      </div>`).join('')}
    </div>` : ''}

    <div class="cab-card">
      <div class="cab-card-h">Где сейчас товар${cabHelpBtn('flow')}${archived ? `<a href="#" onclick="cabNav('shipments');return false" class="cab-card-link">Архив: ${archived} ${cabPl(archived, 'закупка', 'закупки', 'закупок')} →</a>` : ''}</div>
      <div class="cab-flow">${flow}</div>
    </div>

    <div class="cab-card-h" style="margin:4px 2px 10px">За всё время</div>
    ${cabTotalsStrip(ships, true)}
  `;
}

// ============ ПРИХОДЫ ============
// Шапка раздела: этапы «сейчас в работе» + объём по приходам столбиками + факты
function cabShipsHero(ships) {
  const day = 864e5, now = Date.now();
  const age = s => { const t = s.created ? new Date(s.created).getTime() : NaN; return isFinite(t) ? Math.max(0, Math.round((now - t) / day)) : null; };
  const stages = [['Собирается', ['forming'], 'ti-shopping-cart', '#4a90d9'], ['В пути', ['transit', 'delayed'], 'ti-truck', '#d4a106'], ['На складе', ['warehouse'], 'ti-building-warehouse', '#3cb371'], ['Рассортирована', ['sorted'], 'ti-checks', '#8b7fd4']];
  const inWork = ships.filter(s => s.status !== 'done');
  const steps = stages.map(([l, keys, ic, c]) => {
    const list = ships.filter(s => keys.includes(s.status));
    const pos = list.reduce((n, s) => n + (s.data || []).length, 0);
    return `<div class="cab-step${list.length ? '' : ' off'}" style="--c:${c}"><span class="cab-step-ic"><i class="ti ${ic}"></i></span><b>${list.length}</b><span>${l}</span><em>${list.length ? pos + ' поз.' : '—'}</em></div>`;
  }).join('<i class="ti ti-chevron-right cab-step-arr"></i>');
  // Дольше всех в пути — повод проверить
  const road = ships.filter(s => ['transit', 'delayed', 'warehouse'].includes(s.status)).map(s => ({ s, a: age(s) })).filter(x => x.a !== null).sort((a, b) => b.a - a.a)[0];
  const facts = [];
  if (road) facts.push(`<div class="cab-fact${road.a > 30 ? ' warn' : ''}"><i class="ti ti-clock"></i><span>Дольше всех в пути</span><b>${road.s.name || 'Закупка'} — ${road.a} ${cabDaysWord(road.a)}</b></div>`);
  const big = ships.slice().sort((a, b) => (b.data || []).length - (a.data || []).length)[0];
  if (big) facts.push(`<div class="cab-fact"><i class="ti ti-trophy"></i><span>Самая большая закупка</span><b>${big.name || 'Закупка'} — ${(big.data || []).length} поз.</b></div>`);
  const billed = ships.filter(s => s.status === 'sorted' || s.status === 'done');
  const kg = cabDeliveredKg(ships), items = billed.reduce((n, s) => n + (s.data || []).length, 0);
  if (items) facts.push(`<div class="cab-fact"><i class="ti ti-weight"></i><span>В среднем товар весит</span><b>${(kg / items).toFixed(2)} кг · закупка ${cabFmt(kg / billed.length)} кг</b></div>`);
  // Столбики: позиции в каждом приходе, старые слева
  const chron = ships.slice().reverse().slice(-12);
  const maxN = Math.max(1, ...chron.map(s => (s.data || []).length));
  const bars = chron.map(s => {
    const n = (s.data || []).length, st = SHIP_STATUSES[s.status] || SHIP_STATUSES.forming;
    const w = (s.status === 'sorted' || s.status === 'done') ? cabShipTotalKg(s) : 0;
    const mm = (s.name || '').match(/(\d{1,2})(?:-(\d{1,2}))?\.(\d{1,2})/), lbl = mm ? `${(mm[2] || mm[1]).padStart(2, '0')}.${mm[3].padStart(2, '0')}` : '·';
    return `<div class="cab-bar" title="${s.name || ''}: ${n} поз.${w ? ', ' + w.toFixed(1) + ' кг' : ''} · ${st.label}" onclick="${s.status === 'done' ? '' : `cabOpenShip('${s.id}')`}"><em>${n}</em><span style="height:${Math.max(6, n / maxN * 100)}%;background:${st.color}"></span><i>${lbl}</i></div>`;
  }).join('');
  return `<div class="cab-ov-top cab-sh-top">
    <div class="cab-card">
      <div class="cab-card-l"><i class="ti ti-route"></i> Сейчас в работе${cabHelpBtn('sh_work')}<b class="cab-base-n">${inWork.length} ${cabPl(inWork.length, 'закупка', 'закупки', 'закупок')}</b></div>
      <div class="cab-steps">${steps}</div>
      <div class="cab-facts">${facts.join('')}</div>
    </div>
    <div class="cab-card">
      <div class="cab-card-l"><i class="ti ti-chart-bar"></i> Позиций в закупках${cabHelpBtn('sh_bars')}</div>
      <div class="cab-bars">${bars}</div>
      <div class="cab-bars-sum"><span><b>${ships.length}</b> ${cabPl(ships.length, 'закупка', 'закупки', 'закупок')}</span><span><b>${cabFmt(items)}</b> товаров привезено</span><span><b>${kg.toFixed(1)}</b> кг</span></div>
    </div>
  </div>`;
}
// ============ ПОИСК ПОСЫЛКИ ПО ТРЕКУ (все закупки, кроме архива) ============
// Трек целиком, его часть или последние цифры. Русская раскладка переводится в латиницу. Если точных совпадений нет — похожие (до 2 ошибок).
let cabTrackQ = '';
// Состояние оплат закупки одной строкой: рассортированные — кто не оплатил; до сортировки — кто внёс предоплату
function cabShipPayState(ship, clients) {
  const cl = (clients || cabGetClientsFromShipment(ship).clients).filter(c => !c.isOwner);
  if (!cl.length) return { kind: 'none', html: '<span style="color:#9aa0ab">—</span>', text: '' };
  if (cabIsBilled(ship)) {
    const none = cl.filter(c => c.payStatus === 'none').length, part = cl.filter(c => c.payStatus === 'part').length;
    const rest = cl.reduce((n, c) => n + (c.payRest || 0), 0);
    if (!none && !part) return { kind: 'ok', text: 'Все оплатили', html: '<span style="color:#16a34a;font-weight:600;white-space:nowrap"><i class="ti ti-circle-check" style="vertical-align:-2px"></i> Все оплатили</span>' };
    const bits = [];
    if (none) bits.push(`${none} не ${cabPl(none, 'оплатил', 'оплатили', 'оплатили')}`);
    if (part) bits.push(`${part} ${cabPl(part, 'частично', 'частично', 'частично')}`);
    const text = bits.join(' · ');
    return { kind: 'due', text, html: `<span style="color:#dc2626;font-weight:600;white-space:nowrap" title="Осталось собрать ${cabFmt2(rest)} BYN">${text}</span><div style="font-size:12px;color:#6b7280;white-space:nowrap">из ${cl.length} · ждём ${cabFmt(rest)} BYN</div>` };
  }
  const pre = cl.filter(c => (c.payPaid || 0) > 0.004);
  if (!pre.length) return { kind: 'none', html: '<span style="color:#9aa0ab;font-size:13px">до сортировки</span>', text: '' };
  const sum = pre.reduce((n, c) => n + c.payPaid, 0);
  const text = `${pre.length} ${cabPl(pre.length, 'внёс', 'внесли', 'внесли')} предоплату`;
  return { kind: 'pre', text, html: `<span style="color:#2563a8;font-weight:600;white-space:nowrap">${text}</span><div style="font-size:12px;color:#6b7280;white-space:nowrap">${cabFmt(sum)} BYN из ${cl.length}</div>` };
}
function cabFindTracks(q) {
  const norm = v => String(v || '').toUpperCase().replace(/[\s\-]/g, '');
  const t = norm(typeof convertRuToEn === 'function' ? convertRuToEn(String(q || '')) : q);
  const res = { q: t, list: [], fuzzy: false };
  if (t.length < 3) return res;
  const rows = [];
  for (const ship of (cabShipmentsCache || [])) {
    if (ship.status === 'done') continue;
    (ship.data || []).forEach((row, i) => {
      const r = Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'];
      const tr = norm(r[0]); if (tr) rows.push({ ship, r, i, tr });
    });
  }
  for (const x of rows) {
    const sc = x.tr === t ? 0 : x.tr.endsWith(t) ? 1 : x.tr.startsWith(t) ? 2 : x.tr.includes(t) ? 3 : -1;
    if (sc >= 0) res.list.push({ ...x, score: sc });
  }
  if (!res.list.length && t.length >= 8 && typeof levenshtein === 'function') {
    for (const x of rows) { if (Math.abs(x.tr.length - t.length) > 2) continue; const d = levenshtein(t, x.tr); if (d <= 2) res.list.push({ ...x, score: 4 + d }); }
    res.fuzzy = res.list.length > 0;
  }
  res.list.sort((a, b) => a.score - b.score);
  return res;
}
function cabTrackMark(track, q) {
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const k = String(track).toUpperCase().indexOf(q);
  if (!q || k < 0) return esc(track);
  return esc(track.slice(0, k)) + '<mark style="background:#fde68a;color:inherit;border-radius:3px;padding:0 1px">' + esc(track.slice(k, k + q.length)) + '</mark>' + esc(track.slice(k + q.length));
}
function cabTrackSearch(v) {
  cabTrackQ = v;
  const box = document.getElementById('cabTrackRes'); if (!box) return;
  const R = cabFindTracks(v);
  if (R.q.length < 3) { box.innerHTML = R.q ? '<div class="cab-ts-hint">Введите хотя бы 3 символа</div>' : ''; return; }
  if (!R.list.length) { box.innerHTML = `<div class="cab-ts-hint">Не нашли «${cabTrackMark(R.q, '')}» в закупках. Архив не проверяем.</div>`; return; }
  const esc = x => String(x || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const show = R.list.slice(0, 40);
  box.innerHTML = `<div class="cab-ts-head">${R.fuzzy ? 'Точно такого трека нет. Похожие' : 'Найдено'}: ${R.list.length}${R.list.length > show.length ? ' · показаны первые ' + show.length + ', уточните запрос' : ''}</div>
    <div class="cab-ts-list">${show.map(x => {
      const q = parseInt(x.r[5]) || 1;
      const img = x.r[2] ? `<img src="${esc(pkImg(x.r[2]))}" loading="lazy" alt="">` : '<span></span>';
      return `<button type="button" class="cab-ts-row" onclick="cabTrackGo('${x.ship.id}','${encodeURIComponent(x.r[0])}')">
        <span class="cab-ts-img">${img}</span>
        <span class="cab-ts-t"><b>${cabTrackMark(x.r[0], R.fuzzy ? '' : R.q)}${q > 1 ? ` <em>×${q}</em>` : ''}</b><small>${esc(x.ship.name || 'Закупка')} · ${cabShipPill(x.ship.status)}</small></span>
        <span class="cab-ts-c">${esc((x.r[1] || '').trim() || 'клиент не указан')}</span>
        <i class="ti ti-chevron-right"></i></button>`;
    }).join('')}</div>`;
}
async function cabTrackGo(id, encTrack) {
  const t = decodeURIComponent(encTrack);
  await cabOpenShip(id);
  setTimeout(() => {
    const inp = document.querySelector('#cabMain input[oninput^="cabFilterItems"]');
    if (inp) { inp.value = t; cabFilterItems(t); }
  }, 300);
}
const CAB_TS_CSS = `<style>
.cab-ts{position:relative;margin:0 0 16px}
.cab-ts>i{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:20px;color:#8a8fa0;pointer-events:none}
.cab-ts input{width:100%;box-sizing:border-box;padding:13px 14px 13px 44px;border:1.5px solid #d9d0f5;border-radius:12px;font-size:15px;background:#fff;outline:none}
.cab-ts input:focus{border-color:#6C4DB8;box-shadow:0 0 0 3px rgba(108,77,184,.12)}
#cabTrackRes:empty{display:none}
#cabTrackRes{margin:-6px 0 18px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px;box-shadow:0 4px 18px rgba(16,24,40,.06)}
.cab-ts-head{font-size:13px;color:#6b7280;padding:2px 6px 8px}
.cab-ts-hint{font-size:14px;color:#6b7280;padding:6px}
.cab-ts-list{display:flex;flex-direction:column;gap:4px;max-height:420px;overflow:auto}
.cab-ts-row{display:grid;grid-template-columns:44px minmax(0,1.3fr) minmax(0,1fr) 18px;gap:12px;align-items:center;width:100%;text-align:left;background:none;border:0;border-radius:10px;padding:6px;cursor:pointer;font:inherit;color:#1a1a2e}
.cab-ts-row:hover{background:#f6f3fd}
.cab-ts-img img,.cab-ts-img span{width:44px;height:44px;border-radius:8px;object-fit:cover;display:block;background:#f3f4f6}
.cab-ts-t b{display:block;font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cab-ts-t b em{font-style:normal;background:#f59e0b;color:#fff;border-radius:4px;padding:0 5px;font-size:12px;font-family:inherit}
.cab-ts-t small{display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7280;margin-top:3px;flex-wrap:wrap}
.cab-ts-c{font-weight:600;color:#6C4DB8;font-size:15px;overflow:hidden;text-overflow:ellipsis}
.cab-ts-row>i{color:#9aa0ab}
@media(max-width:640px){.cab-ts-row{grid-template-columns:40px minmax(0,1fr) 14px}.cab-ts-c{grid-column:2;grid-row:2;font-size:14px;margin-top:-6px}.cab-ts-row>i{grid-row:1/3;grid-column:3}.cab-ts-img{grid-row:1/3}}
</style>`;

let cabShipFilter = 'all';
function renderCabShipments(container) {
  if (!cabShipmentsCache.length) { container.innerHTML = cabEmptyShipments(); return; }
  const ships = cabShipmentsCache;
  const nAct = ships.filter(s => s.status !== 'done').length, nDone = ships.length - nAct;
  const seg = (k, l, n) => `<button class="cab-seg-b${cabShipFilter === k ? ' on' : ''}" data-f="${k}" onclick="cabFilterShipments('${k}',this)">${l} <i>${n}</i></button>`;
  const filterHtml = `<div class="cab-seg">${seg('all', 'Все', ships.length)}${seg('active', 'Активные', nAct)}${seg('done', 'Архив', nDone)}</div>`;

  const rows = ships.map(ship => {
    const { clients } = cabGetClientsFromShipment(ship);
    let due = 0, profit = 0;
    for (const c of clients) { due += c.due; profit += c.profit; }
    const date = ship.created ? new Date(ship.created).toLocaleDateString('ru-RU') : '—';
    const isDone = ship.status === 'done';
    const departed = (ship.departed && ship.status !== 'sorted' && ship.status !== 'done') ? ' <i class="ti ti-truck" style="color:#3cb371;font-size:14px" title="Выехала"></i>' : '';
    const hide = (cabShipFilter === 'active' && isDone) || (cabShipFilter === 'done' && !isDone);
    return `<tr class="cab-ship-row" data-status="${isDone ? 'done' : 'active'}" style="${isDone ? 'opacity:0.6;' : ''}${hide ? 'display:none' : ''}">
      <td style="font-weight:500">${isDone ? (ship.name || 'Без названия') : `<a href="#" onclick="cabOpenShip('${ship.id}');return false" style="color:#6C4DB8;text-decoration:none">${ship.name || 'Без названия'}</a>`}</td>
      <td>${cabShipPill(ship.status)}${departed}</td>
      <td class="val-purple">${cabFmt(due)}</td>
      <td class="${profit >= 0 ? 'val-green' : 'val-red'}">${profit >= 0 ? '+' : ''}${cabFmt(profit)}</td>
      <td>${cabShipPayState(ship, clients).html}</td>
      <td style="color:#6b7280">${(ship.data || []).length}</td>
      <td style="color:#6b7280">${clients.length}</td>
      <td style="color:#6b7280;white-space:nowrap">${date}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="cab-main-title">Закупки</div>
    ${CAB_TS_CSS}<label class="cab-ts"><i class="ti ti-search" aria-hidden="true"></i><input id="cabTrackQ" type="search" autocomplete="off" spellcheck="false" placeholder="Найти посылку: трек-код целиком, его часть или последние цифры" value="${String(cabTrackQ).replace(/"/g, '&quot;')}" oninput="cabTrackSearch(this.value)" onkeydown="if(event.key==='Escape'){this.value='';cabTrackSearch('')}"></label>
    <div id="cabTrackRes"></div>
    ${cabShipsHero(ships)}
    <div class="cab-table-wrap">
      <div class="cab-cl-bar"><button type="button" class="cab-eb cab-new-big" onclick="cabNewShipOpen()"><i class="ti ti-plus"></i>Создать закупку</button></div>
      <div class="cab-table-top">${filterHtml}</div>
      <table class="cab-table" id="cabShipmentsTable">
        <thead><tr><th>Название</th><th>Статус</th><th>Должны</th><th>Прибыль</th><th><span style="display:inline-flex;align-items:center;gap:2px">Оплаты${cabHelpBtn('sh_pay')}</span></th><th>Позиций</th><th>Клиентов</th><th title="Когда закупка создана в Piksta">Создана</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#6b7280;padding:20px">Нет закупок</td></tr>'}</tbody>
      </table>
    </div>`;
  if (cabTrackQ) cabTrackSearch(cabTrackQ);
}

function cabFilterShipments(filter, btn) {
  cabShipFilter = filter;
  document.querySelectorAll('.cab-seg-b').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
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
  // Вкладка по умолчанию: пока товар едет — «Товары и цены», когда приехал — «Расчёт»
  { const sh = cabShipmentsCache.find(s => s.id === id) || {}; cabShipTab = ['warehouse', 'sorted', 'done'].includes(sh.status) ? 'calc' : 'items'; }
  document.querySelectorAll('#cabNav .cab-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === 'shipments'));
  document.getElementById('cabMain').innerHTML = '<div class="cab-main-title">Загрузка…</div>';
  await loadShipmentData(id, true);
  cabRenderShip();
  cabSaveAt();
}

async function cabCloseShip() {
  cabShipId = null;
  await restoreActiveEditing();
  await loadCabinetData();
  cabNav('shipments');
}

function cabShipTabSet(t) { cabShipTab = t; cabRenderShip(); cabSaveAt(); }

function cabRenderShip() {
  const ship = cabShipmentsCache.find(s => s.id === cabShipId) || {};
  const calc = computeClientCalc();
  const order = ['forming','transit','delayed','warehouse','sorted','done'];
  const opts = order.map(k => `<option value="${k}" ${(ship.status || 'forming') === k ? 'selected' : ''}>${SHIP_STATUSES[k].label}</option>`).join('');
  const tabs = [['calc','Расчёт'],['weigh','Взвешивание'],['items','Товары и цены'],['rates','Курсы']]
    .map(([k, l]) => `<button class="cab-filter-btn ${cabShipTab === k ? 'active' : ''}" onclick="cabShipTabSet('${k}')">${l}</button>`).join('');
  let body = '';
  if (cabShipTab === 'items') body = cabShipItemsHtml();
  else if (cabShipTab === 'weigh') body = cabShipWeighHtml();
  else if (cabShipTab === 'calc') body = cabShipCalcHtml(calc);
  else body = cabShipRatesHtml();
  document.getElementById('cabMain').innerHTML = `
    <a href="#" onclick="cabCloseShip();return false" style="display:inline-flex;align-items:center;gap:4px;color:#6C4DB8;text-decoration:none;font-size:14px;margin-bottom:10px"><i class="ti ti-arrow-left"></i> Все закупки</a>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div class="cab-main-title" style="margin:0">${ship.name || 'Без названия'}</div>
      <button onclick="cabRenameShip()" title="Переименовать" style="border:none;background:none;color:#6b7280;cursor:pointer;font-size:16px"><i class="ti ti-pencil"></i></button>
      <select onchange="cabSetStatus(this.value)" style="${cabInp};margin-left:auto">${opts}</select>
      <button type="button" class="cab-ship-more" onclick="cabShipMore(event,'${cabShipId}')" title="Ещё: архив, Excel, удалить" aria-label="Ещё действия с закупкой"><i class="ti ti-dots"></i></button>
    </div>
    ${cabShipHeadHtml(ship, calc)}
    <div class="cab-filter-row" style="align-items:center">${tabs}${cabShipTab === 'calc' ? `<button onclick="cabShipAllPaid()" style="margin-left:auto;flex-shrink:0;background:#fff;color:#16a34a;border:1px solid #86efac;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:500;cursor:pointer"><i class="ti ti-checks"></i> Все оплатили</button><button onclick="cabShipPDF()" style="margin-left:8px;flex-shrink:0;background:#6C4DB8;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:14px;font-weight:500;cursor:pointer"><i class="ti ti-download"></i> PDF</button>` : ''}</div>
    ${body}`;
}

// Шапка прихода: этапы пути + главные цифры цветными плитками
function cabShipHeadHtml(ship, calc) {
  const st = ship.status || 'forming';
  const steps = [['forming', 'ti-shopping-cart'], ['transit', 'ti-truck'], ['warehouse', 'ti-building-warehouse'], ['sorted', 'ti-checks']];
  const cur = { forming: 0, transit: 1, delayed: 1, warehouse: 2, sorted: 3, done: 3 }[st] ?? 0;
  const stepHtml = steps.map(([k, ic], i) => {
    const kk = (i === 1 && st === 'delayed') ? 'delayed' : k, S = SHIP_STATUSES[kk];
    const cls = i < cur ? 'done' : i === cur ? 'cur' : '';
    return `${i ? '<i class="ti ti-chevron-right cab-sp-arr"></i>' : ''}<div class="cab-sp-step ${cls}" style="--c:${S.color};--t:${S.text}"><span class="dot"><i class="ti ${i < cur ? 'ti-check' : ic}"></i></span>${S.label}</div>`;
  }).join('');
  const weighed = calc.ourWeight > 0;
  const fact = (ic, l, v, cls, sub) => `<div class="cab-sp-f ${cls}"><span class="ic"><i class="ti ${ic}"></i></span><div><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div></div>`;
  const facts = [
    fact('ti-package', 'Позиций', TABLE.length, ''),
    fact('ti-users', 'Клиентов', calc.clients.length, ''),
    weighed ? fact('ti-scale', 'Вес клиентов', cabFmt2(calc.ourWeight) + ' кг', '') : fact('ti-scale', 'Вес клиентов', 'не взвешено', 'muted', `<a href="#" onclick="cabShipTabSet('weigh');return false">Взвесить →</a>`),
    fact('ti-cash', 'Клиенты должны', cabFmt(calc.grandDue) + ' BYN', 'due', weighed ? '' : 'пока без доставки'),
    fact('ti-trending-up', 'Прибыль', (calc.grandProfit >= 0 ? '+' : '') + cabFmt(calc.grandProfit) + ' BYN', calc.grandProfit >= 0 ? 'ok' : 'bad', weighed ? '' : '≈ до взвешивания')
  ].join('');
  const go = st === 'forming' ? `<button class="cab-sp-go" onclick="cabSetDeparted({checked:true})"><i class="ti ti-truck-delivery"></i> Отправка выехала с карго</button>` : '';
  return `<div class="cab-sp"><div class="cab-sp-row"><div class="cab-sp-steps">${stepHtml}</div>${go}</div><div class="cab-sp-facts">${facts}</div></div>`;
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
let cabItemSort = 'track';  // 'track' — как в закупке (по трек-кодам), 'wh' — по клиентам, 'mk' — по маркетплейсам
let cabItemMk = 'all';       // в режиме «По маркетплейсам»: 'all' или одна площадка — показываем только её треки (06.11.2026)
// Порядок и подписи площадок. Пометка mk ставится импортом расширения 1.10+; у старых закупок её нет → «Без пометки».
// Маршрутизация: цвета плашек — те же классы .pk-mk, что рисует pkMkBadge() в app.js.
const CAB_MK = [['pdd', 'PDD', 'pdd'], ['tb', 'TAOBAO', 'tb'], ['1688', '1688', 'a1688'], ['pz', 'POIZON', 'pz'], ['', 'Без пометки', '']];
const cabMkOf = r => (r && r[9]) || '';

function cabSetItemSort(m) { cabItemSort = m; if (m !== 'mk') cabItemMk = 'all'; cabRenderShip(); }
function cabSetItemMk(k) { cabItemMk = cabItemMk === k ? 'all' : k; cabRenderShip(); }

const CAB_NOPDD_TIP = 'Трек есть только в файле карго — в ваших заказах Pinduoduo за даты импорта его не нашли. Причины: заказ раньше даты «С», продавец отправил поздно или заказано с другого аккаунта. Фото нет, цену впишите вручную.';
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
  const mkCount = {};
  for (const r of TABLE) { const k = cabMkOf(r); mkCount[k] = (mkCount[k] || 0) + 1; }
  if (cabItemSort === 'mk') {
    const rank = k => { const n = CAB_MK.findIndex(m => m[0] === k); return n < 0 ? 99 : n; };
    order.sort((a, b) => rank(cabMkOf(TABLE[a])) - rank(cabMkOf(TABLE[b])) || a - b);
    if (cabItemMk !== 'all') order = order.filter(i => cabMkOf(TABLE[i]) === cabItemMk);
  }
  const whCount = {};
  for (const r of TABLE) { const k = (r[1] || '').trim().toLowerCase(); whCount[k] = (whCount[k] || 0) + 1; }
  let lastWh = null, lastMk = null;
  const rows = order.map(i => {
    const r = TABLE[i];
    if (cabItemSort === 'mk' && cabMkOf(r) !== lastMk) {
      lastMk = cabMkOf(r);
      const m = CAB_MK.find(x => x[0] === lastMk) || [lastMk, lastMk, ''];
      var mkHead = `<tr class="cab-item-grp"><td colspan="6" style="background:#f0ecf9;color:#6C4DB8;font-weight:600;padding:8px 10px">${m[2] ? `<span class="pk-mk ${m[2]}" style="margin-left:0">${m[1]}</span>` : m[1]} <span style="font-weight:400;color:#6b7280">· ${mkCount[lastMk] || 0}</span></td></tr>`;
    } else var mkHead = '';
    let head = '';
    if (cabItemSort === 'wh') {
      const k = (r[1] || '').trim().toLowerCase();
      if (k !== lastWh) {
        lastWh = k;
        head = `<tr class="cab-item-grp"><td colspan="6" style="background:#f0ecf9;color:#6C4DB8;font-weight:600;padding:8px 10px">${(r[1] || '').trim() || 'Без клиента'} <span style="font-weight:400;color:#6b7280">· ${whCount[k]}</span></td></tr>`;
      }
    }
    const qty = parseInt(r[5]) || 1;
    const img = r[2] ? `<img src="${r[2]}" loading="lazy" onclick="cabImgZoom(event,this.src)" title="Увеличить" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block;cursor:zoom-in">` : '<div style="width:44px;height:44px;border-radius:6px;background:#f3f4f6"></div>';
    const mv = parseInt(r[7]) || 0;   // сколько раз трек переносили как «не пришёл» (05.11.2026)
    const mvNote = !mv ? '' : mv >= 2
      ? `<div style="font-family:Inter,system-ui,sans-serif;font-size:12px;font-weight:600;color:#b42318;margin-top:3px;white-space:normal"><i class="ti ti-alert-triangle"></i> Не пришёл ${mv} раза — обратитесь в карго, возможно, посылка потерялась</div>`
      : `<div style="font-family:Inter,system-ui,sans-serif;font-size:12px;color:#6b7280;margin-top:3px;white-space:normal"><i class="ti ti-arrow-forward-up"></i> Перенесён из «${cabEsc(r[8] || 'прошлой закупки')}» — в том грузе не пришёл</div>`;
    return mkHead + head + `<tr class="cab-item-row" ${mv >= 2 ? 'style="background:#fdecea;box-shadow:inset 3px 0 0 #f04438"' : ''} data-q="${((r[0] || '') + ' ' + (r[1] || '') + ' ' + (r[6] || '') + ' ' + ((CAB_MK.find(x => x[0] && x[0] === cabMkOf(r)) || [])[1] || '')).toLowerCase().replace(/"/g, '')}">
      <td style="width:52px">${img}</td>
      <td style="font-family:monospace;font-size:13px;color:#4a5260">${r[0] || ''}${mvNote}${r[2] || r[9] ? '' : ` <span title="${CAB_NOPDD_TIP}" style="font-family:Inter,system-ui,sans-serif;font-size:11px;font-weight:600;color:#b45309;background:#fef3c7;border-radius:4px;padding:1px 5px;white-space:nowrap;cursor:help">нет в Pinduoduo</span>`}${qty > 1 ? ` <span style="background:#f59e0b;color:#fff;border-radius:4px;padding:1px 5px;font-size:12px;font-weight:700">×${qty}</span><div class="cab-qty-note" title="Из одного магазина, товары могут быть разными"><i class="ti ti-info-circle"></i> ${qty} ${cabPl(qty, 'товар', 'товара', 'товаров')} под одним треком</div>` : ''}</td>
      <td class="cab-mk-cell">${typeof pkMkBadge === 'function' ? pkMkBadge(r) : ''}</td>
      <td><input data-idx="${i}" value="${(r[6] || '').replace(/"/g, '&quot;')}" onchange="cabEditCell(this,6)" maxlength="40" placeholder="название, 1–3 слова" style="${cabInp};width:100%"></td>
      <td><input data-idx="${i}" value="${(r[1] || '').replace(/"/g, '&quot;')}" onchange="cabEditCell(this,1)" placeholder="клиент" style="${cabInp};width:100%;color:#6C4DB8"></td>
      <td><input data-idx="${i}" value="${r[3] || ''}" onchange="cabEditCell(this,3)" inputmode="decimal" placeholder="—" style="${cabInp};width:80px"></td>
    </tr>`;
  }).join('');
  const noPdd = TABLE.filter(r => !r[2] && !r[9]).length;   // трек с пометкой площадки пришёл из импорта — это не «только из карго»
  return `<div class="cab-table-wrap cab-items-wrap">
    ${noPdd ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:14px;color:#92400e;line-height:1.5;white-space:normal"><b>${noPdd} ${cabPl(noPdd, 'трек', 'трека', 'треков')} без данных Pinduoduo</b> — нет фото, цену нужно вписать вручную. Они пришли только из файла карго: заказ раньше выбранной при импорте даты, продавец отправил поздно или заказано с другого аккаунта. В расширении Piksta 1.9.15 и новее есть кнопка «Поискать за 3 месяца».</div>` : ''}
    <!-- Панель «Товары и цены» (06.11.2026): верхняя строка не меняется при переключении режимов (кнопки не прыгают),
         плашки площадок появляются второй строкой только в «По маркетплейсам» -->
    <div class="cab-items-bar">
      <button type="button" class="cab-eb cab-add-pos" onclick="cabAddItemsOpen()"><i class="ti ti-plus"></i>Добавить позицию</button>
      <input oninput="cabFilterItems(this.value)" placeholder="Трек, название, клиент или площадка" class="cab-items-q" style="${cabInp}">
      <div class="cab-items-sort">
        <button class="cab-filter-btn ${cabItemSort === 'track' ? 'active' : ''}" onclick="cabSetItemSort('track')">По трек-кодам</button>
        <button class="cab-filter-btn ${cabItemSort === 'wh' ? 'active' : ''}" onclick="cabSetItemSort('wh')">По клиентам</button>
        <button class="cab-filter-btn ${cabItemSort === 'mk' ? 'active' : ''}" onclick="cabSetItemSort('mk')">По маркетплейсам</button>
      </div>
    </div>
    ${cabItemSort === 'mk' ? `<div class="cab-mk-chips">
        <button class="cab-mk-chip ${cabItemMk === 'all' ? 'on' : ''}" onclick="cabSetItemMk('all')">Все <small>${TABLE.length}</small></button>
        ${CAB_MK.filter(m => m[0] !== 'pz' || mkCount.pz).filter(m => m[0] || mkCount['']).map(m => `<button class="cab-mk-chip ${cabItemMk === m[0] ? 'on' : ''}" ${mkCount[m[0]] ? '' : 'disabled'} onclick="cabSetItemMk('${m[0]}')">${m[2] ? `<span class="pk-mk ${m[2]}" style="margin-left:0">${m[1]}</span>` : m[1]} <small>${mkCount[m[0]] || 0}</small></button>`).join('')}
      </div>` : ''}
    <table class="cab-table cab-items-t">
      <colgroup><col style="width:56px"><col style="width:28%"><col style="width:84px"><col><col style="width:24%"><col style="width:96px"></colgroup>
      <thead><tr><th></th><th>Трек</th><th title="Где куплено: Pinduoduo, Taobao, 1688">Площадка</th><th>Название</th><th>Клиент</th><th>Выкуп ¥</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:20px">Нет товаров · <a href="#" onclick="cabAddItemsOpen();return false">добавить позицию</a></td></tr>'}</tbody>
    </table>
  </div>`;
}

// Увеличение фото товара: карточка рядом с картинкой, закрывается кликом или Esc
function cabImgZoom(ev, src) {
  ev.stopPropagation();
  let z = document.getElementById('cabZoom');
  if (!z) {
    z = document.createElement('div'); z.id = 'cabZoom'; z.className = 'cab-zoom';
    z.onclick = () => z.remove();
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { const q = document.getElementById('cabZoom'); if (q) q.remove(); } });
    document.addEventListener('click', function out(e) { const q = document.getElementById('cabZoom'); if (q && !q.contains(e.target)) q.remove(); });
    document.body.appendChild(z);
  }
  z.innerHTML = `<img src="${src}" alt="">`;
  const size = Math.min(380, innerWidth - 32, innerHeight - 32);
  const r = ev.target.getBoundingClientRect();
  let x = r.right + 12, y = r.top + r.height / 2 - size / 2;
  if (x + size > innerWidth - 16) x = Math.max(16, r.left - size - 12);
  y = Math.max(16, Math.min(y, innerHeight - size - 16));
  z.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
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
  if (col === 6) { v = v.slice(0, 40); inp.value = v; }
  TABLE[idx][col] = v;
  try {
    const ref = shipmentsRef().doc(cabShipId);
    await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const data = doc.data().data;
      if (!data || !data[idx]) return;
      if (col === 6) {   // название товара — поле n (строку-массив старого формата переводим в объект, как в мобильной)
        if (Array.isArray(data[idx])) { const a = data[idx]; data[idx] = { t: a[0], w: a[1] || '', img: a[2] || '', p: a[3] || '', pc: a[4] || '', q: a[5] || '1' }; }
        if (v) data[idx].n = String(v); else delete data[idx].n;
      }
      else if (Array.isArray(data[idx])) data[idx][col] = String(v);
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
  const ship = cabShipmentsCache.find(x => x.id === cabShipId) || {};
  const rows = names.map(n => {
    const enc = encodeURIComponent(n);
    const g = currentWeights[n] ? Math.round(currentWeights[n] * 1000) : '';
    const incl = !!currentPriceInclWeight[n];
    return `<tr>
      <td style="font-weight:500">${n}</td>
      <td>${counts[n]}</td>
      <td><input data-name="${enc}" value="${g}" onchange="cabSetWeight(this)" inputmode="numeric" placeholder="граммы" style="${cabInp};width:110px"></td>
      <td><label style="font-size:13px;color:#5f6470;display:flex;align-items:center;gap:6px"><input type="checkbox" data-name="${enc}" ${incl ? 'checked' : ''} onchange="cabSetIncl(this)"> вес в цене</label></td>
    </tr>`;
  }).join('');
  // сводка
  let needW = 0, doneW = 0;
  for (const n of names) { if (currentTarePct > 0 && currentPriceInclWeight[n] && !(currentWeights[n] > 0)) continue; needW++; if ((currentWeights[n] || 0) > 0) doneW++; }
  const calc = computeClientCalc();
  const pct = needW ? Math.round(doneW / needW * 100) : 0;
  const tareHow = currentTarePct > 0 ? 'Тара 8% к весу клиентов' : currentCargoWeight > 0 ? 'Тара = вес от карго − вес клиентов' : 'Тара вручную';
  const diff = currentCargoWeight > 0 ? currentCargoWeight - calc.ourWeight - (currentTarePct > 0 ? calc.tareTotal : 0) : null;
  const departed = (ship.status || 'forming') !== 'forming';
  const side = `<aside class="cab-wg-side">
      <div class="cab-wg-prog"><div class="l">Взвешено клиентов</div><div class="v">${doneW} <small>из ${needW}</small></div><div class="bar"><span style="width:${pct}%"></span></div>${doneW < needW ? '<div class="s">Пока не взвешены все — доставка и прибыль считаются не полностью</div>' : '<div class="s ok"><i class="ti ti-check"></i> Все взвешены — расчёт готов</div>'}</div>
      <div class="cab-wg-row"><span>Вес клиентов</span><b>${cabFmt2(calc.ourWeight)} кг</b></div>
      <div class="cab-wg-row"><span>Тара</span><b>${cabFmt2(calc.tareTotal)} кг</b></div>
      <div class="cab-wg-row"><span>Вес от карго</span><b>${currentCargoWeight > 0 ? cabFmt2(currentCargoWeight) + ' кг' : '—'}</b></div>
      ${diff !== null && Math.abs(diff) > 0.05 && currentTarePct > 0 ? `<div class="cab-wg-row ${diff > 0 ? 'warn' : ''}"><span>Расхождение с карго</span><b>${diff > 0 ? '+' : ''}${cabFmt2(diff)} кг</b></div>` : ''}
      <div class="cab-wg-how">${tareHow}</div>
    </aside>`;
  return `<div class="cab-wg">
    <div class="cab-table-wrap cab-wg-main">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
      <label style="font-size:13px;color:#5f6470">Вес от карго, г<br><input value="${currentCargoWeight ? Math.round(currentCargoWeight * 1000) : ''}" onchange="cabSetCargo(this)" inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:13px;color:#5f6470">Вес тары, г<br><input value="${currentTare ? Math.round(currentTare * 1000) : ''}" onchange="cabSetTare(this)" ${currentTarePct > 0 ? 'disabled' : ''} inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <span style="display:flex;align-items:center;gap:4px;padding-bottom:6px"><label style="font-size:14px;color:#1a1a2e;display:flex;align-items:center;gap:6px"><input type="checkbox" ${currentTarePct > 0 ? 'checked' : ''} onchange="onTarePctChange(this.checked);cabRenderShip()"> Тара 8%</label>${cabHelpBtn('tare8')}</span>
      <span style="display:flex;align-items:center;gap:4px;padding-bottom:6px"><label style="font-size:14px;color:#1a1a2e;display:flex;align-items:center;gap:6px"><input type="checkbox" ${departed ? 'checked' : ''} onchange="cabSetDeparted(this)"> Отправка выехала с карго</label>${cabHelpBtn('departed')}</span>
    </div>
    <table class="cab-table">
      <thead><tr><th>Клиент</th><th>Позиций</th><th>Вес, г</th><th><span style="display:inline-flex;align-items:center;gap:2px">Доставка${cabHelpBtn('incl')}</span></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
    </table>
    </div>
    ${side}
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
  const st = (cabShipmentsCache.find(s => s.id === cabShipId) || {}).status || 'forming';
  if (!inp.checked && st !== 'transit') { alert('Закупка уже дальше дороги — статус меняйте в списке статусов вверху'); cabRenderShip(); return; }
  shipmentDeparted = inp.checked;
  const key = shipmentDeparted ? 'transit' : 'forming';
  await shipmentsRef().doc(cabShipId).update({ departed: shipmentDeparted });
  await cabSetStatus(key);
  cabRenderShip();
}

// ---- Расчёт ----
// Колонки «Товар» и «Доставка» показывают то, что реально идёт в «Должен»:
// по себестоимости (или «это я») — себестоимость, «вес в цене» — доставка не начисляется
function cabCalcGoodsCell(c) {
  const atCost = c.isOwner || !!currentCostGoods[c.name];
  return atCost ? `<span class="cab-atcost" title="По себестоимости (по цене клиента: ${cabFmt2(c.goodsClient)})">${cabFmt2(c.goodsCost)}</span>` : cabFmt2(c.goodsClient);
}
function cabCalcShipCell(c) {
  if (!c.isOwner && currentPriceInclWeight[c.name] && !currentCostShip[c.name]) return `<span style="color:#6b7280" title="Вес включён в цену товара — доставку клиент не платит">в цене</span>`;
  const atCost = c.isOwner || !!currentCostShip[c.name];
  return atCost ? `<span class="cab-atcost" title="По себестоимости (по цене клиента: ${cabFmt2(c.shipClient)})">${cabFmt2(c.shipCost)}</span>` : cabFmt2(c.shipClient);
}

function cabShipCalcHtml(calc) {
  const chk = (field, c, label, tip) => `<label title="${tip || ''}" style="font-size:14px;color:#4a5260;display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer"><input type="checkbox" ${field[c.name] ? 'checked' : ''} data-name="${encodeURIComponent(c.name)}" onchange="cabToggleCost(this,'${field === currentOwners ? 'owner' : field === currentCostGoods ? 'goods' : 'ship'}')"> ${label}</label>`;
  const shipC = cabShipmentsCache.find(s => s.id === cabShipId) || {};
  const pinp = 'padding:5px 7px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;width:80px;box-sizing:border-box';
  const rows = calc.clients.map(c => {
    const pi = cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, c.isOwner);
    const payCells = c.isOwner ? '<td>—</td><td>—</td>'
      : `<td style="font-weight:600;white-space:nowrap;color:${pi.rest > 0.004 ? '#dc2626' : '#16a34a'}">${cabFmt2(pi.rest)}</td>
         <td><div style="display:flex;align-items:center;gap:10px"><input value="${pi.paid ? pi.paid.toFixed(2) : ''}" placeholder="0" onchange="cabCardSetPaid('${cabShipId}','${encodeURIComponent(c.name)}',this.value)" inputmode="decimal" style="${pinp}"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" title="Полностью оплачено" ${pi.status === 'full' ? 'checked' : ''} onchange="cabCardSetFull('${cabShipId}','${encodeURIComponent(c.name)}', this.checked)" style="margin:0">${cabPayBadge(pi.status)}</label></div>${cabSettleNote(c)}</td>`;
    const dueCell = c.isOwner ? '—'
      : `<a href="#" onclick="cabEditDue('${encodeURIComponent(c.name)}');return false" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + cabFmt2(c.dueCalc) + '. Нажмите, чтобы изменить' : 'Нажмите, чтобы изменить задолженность'}" style="color:#6C4DB8;text-decoration:none;border-bottom:1px dashed #b9a8e3">${cabFmt2(c.due)}</a>${c.dueEdited ? ' <i class="ti ti-pencil" style="font-size:14px;color:#f59e0b" title="Исправлено вручную"></i>' : ''}`;
    return `<tr style="${c.isOwner ? 'background:#fef2f2' : ''}">
      <td style="font-weight:500"><span class="cab-cl-nm cab-cl-link" onclick="cabGoClient('${encodeURIComponent(c.name)}')" title="Открыть карточку клиента"><span class="cab-cl-av">${String(c.name).trim().charAt(0).toUpperCase()}</span>${c.name}</span>${c.noWeight ? ' <span class="cab-nw" title="Вес не указан — доставка этому клиенту пока не посчитана">не взвешен</span>' : ''}</td>
      <td style="white-space:nowrap">${c.count}</td>
      <td style="white-space:nowrap">${cabFmt2(c.shipWeight)}</td>
      <td style="white-space:nowrap">${cabCalcGoodsCell(c)}</td>
      <td style="white-space:nowrap">${cabCalcShipCell(c)}</td>
      <td class="val-purple" style="white-space:nowrap">${dueCell}</td>
      <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}" style="white-space:nowrap">${c.profit >= 0 ? '+' : ''}${cabFmt2(c.profit)}</td>
      ${payCells}
      <td><div style="display:flex;flex-direction:column;gap:3px">${chk(currentOwners, c, '<b style="color:#dc2626;font-weight:600">Это я</b>', 'Это вы сами: покупка для себя — клиент ничего не должен, в доход и долги не входит')}${c.isOwner ? '' : chk(currentCostGoods, c, 'Товар', 'Товар по себестоимости: без наценки на курсе, прибыль с товара — 0') + chk(currentCostShip, c, 'Доставка', 'Доставка по себестоимости: по цене карго, без вашей наценки')}</div></td>
    </tr>`;
  }).join('');
  let paidSum = 0, restSum = 0;
  for (const c of calc.clients) { if (c.isOwner) continue; const pi = cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, c.isOwner); paidSum += pi.paid || 0; restSum += pi.rest || 0; }
  const colPct = calc.grandDue > 0 ? Math.min(100, Math.round(paidSum / calc.grandDue * 100)) : 0;
  return `<div class="cab-cs">
      <div class="cab-cs-main"><div class="l">Собрано с клиентов</div><div class="v">${cabFmt(paidSum)} <small>из ${cabFmt(calc.grandDue)} BYN</small></div><div class="bar"><span style="width:${colPct}%"></span></div><div class="s">${restSum > 0.5 ? 'Осталось собрать <b>' + cabFmt(restSum) + ' BYN</b>' : '<i class="ti ti-check"></i> Все оплатили'}</div></div>
      <div class="cab-cs-f"><div class="l">Прибыль</div><div class="v ${calc.grandProfit >= 0 ? 'ok' : 'bad'}">${calc.grandProfit >= 0 ? '+' : ''}${cabFmt(calc.grandProfit)} BYN</div></div>
      <div class="cab-cs-f"><div class="l">Тара</div><div class="v">${cabFmt2(calc.tareTotal)} кг</div></div>
    </div>
    <div class="cab-table-wrap">
    <div style="font-size:13px;color:#6b7280;margin-bottom:8px;white-space:normal">Суммы в BYN, вес — с долей тары. <span class="cab-atcost">Подчёркнутые</span> суммы — по себестоимости. Сумму «Должен» можно исправить нажатием.</div>
    <div style="overflow-x:auto;margin:0 -4px;padding:0 4px">
    <table class="cab-table" style="background:#fff">
      <thead><tr><th>Клиент</th><th>Поз.</th><th title="Вес клиента с его долей тары">Вес, кг</th><th>Товар</th><th>Доставка</th><th>Должен</th><th>Прибыль</th><th>Остаток</th><th>Оплата</th><th><span style="display:inline-flex;align-items:center;gap:2px">Условия${cabHelpBtn('costGoods')}</span></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:600"><td>Итого</td><td colspan="4" style="white-space:nowrap">Тара: ${cabFmt2(calc.tareTotal)} кг</td><td class="val-purple" style="white-space:nowrap">${cabFmt2(calc.grandDue)}</td><td class="${calc.grandProfit >= 0 ? 'val-green' : 'val-red'}" style="white-space:nowrap">${calc.grandProfit >= 0 ? '+' : ''}${cabFmt2(calc.grandProfit)}</td><td style="color:#dc2626;white-space:nowrap">${cabFmt2(calc.clients.reduce((n, c) => n + (c.isOwner ? 0 : cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, false).rest), 0))}</td><td></td><td></td></tr></tfoot>
    </table>
    </div>
  </div>`;
}

function cabToggleCost(inp, kind) {
  const n = decodeURIComponent(inp.dataset.name);
  const map = kind === 'owner' ? currentOwners : kind === 'goods' ? currentCostGoods : currentCostShip;
  map[n] = inp.checked;  // явное значение только для этого прихода
  saveOwners();
  const sc = cabShipmentsCache.find(x => x.id === (editingShipmentId || activeShipmentId));
  if (sc) { sc.owners = { ...currentOwners }; sc.costGoods = { ...currentCostGoods }; sc.costShip = { ...currentCostShip }; }
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
  const f = [['clientRate','Курс клиента, BYN за ¥'],['buyRate','Курс выкупа, BYN за ¥'],['shipClient','Доставка клиенту, BYN/кг'],['shipCargo','Доставка карго, BYN/кг']];
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
  once:      { label: 'Разовый',  bg: '#e0f2fe', color: '#0369a1' },
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
      else if (typeof whBetter === 'function') map[key].name = whBetter(map[key].name, c.name);  // регистр не важен — показываем написание с заглавными
      const m = map[key];
      m.ships.push({ ship, c });
      m.totalItems += c.items;
      m.totalDue += c.due;
      m.totalProfit += c.profit;
      m.totalWeight += c.weight;
      if (c.isOwner) m.isOwner = true;
      if (!c.isOwner && cabIsBilled(ship)) m.unpaidDue += c.payRest;   // долг — только рассортированные и архив
    }
  }
  const list = Object.values(map);
  for (const m of list) {
    const ids = m.ships.map(x => x.ship.id);
    const inLatest = latestIds.length > 0 && ids.includes(latestIds[0]);
    const inBoth = latestIds.length === 2 && latestIds.every(id => ids.includes(id));
    const last3 = ships.slice(0, 3).map(s => s.id);
    if (ids.length === 1 && inLatest) m.status = 'new';                          // впервые в самом свежем приходе
    else if (inBoth) m.status = 'active';                                        // в двух последних приходах
    else if (ids.length === 1) m.status = 'once';                                // разовый: был только в одном приходе
    else if (!ids.some(id => last3.includes(id))) m.status = 'forgotten';        // 2+ прихода, но в трёх последних нет
    else m.status = 'regular';
  }
  const clientItemsSum = list.reduce((n, m) => n + m.totalItems, 0);
  return { list, totalItemsDb, noClientItems, sharedItems, sharedExtra, clientItemsSum };
}

// ---- ДУБЛИ КЛИЕНТОВ ----
// Нормализация для поиска: регистр, ё/е, пробелы и знаки не важны («Марина (Marinn07)» = «Марина(Marinn07)»)
function cabNameNorm(n) { return String(n || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, ''); }
function cabLev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Группы похожих имён. exact — отличаются только пробелами/знаками/регистром (все варианты одной группой);
// near — длинное имя (10+), одинаковые первые 2 буквы и не больше 2 букв разницы («Марина/Карина» не предлагаем).
// В группе основное имя — у кого больше приходов; остальные предлагаем присоединить к нему одной кнопкой.
function cabFindDupes(list) {
  const groups = {};
  for (const c of list) { const n = cabNameNorm(c.name); if (n) (groups[n] = groups[n] || []).push(c); }
  const out = [];
  const byShips = arr => arr.slice().sort((x, y) => y.ships.length - x.ships.length || x.name.localeCompare(y.name, 'ru'));
  for (const g of Object.values(groups)) if (g.length > 1) { const s = byShips(g); out.push({ keep: s[0], drops: s.slice(1), exact: true }); }
  const keys = Object.keys(groups);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const na = keys[i], nb = keys[j];
    if (Math.min(na.length, nb.length) >= 10 && na.slice(0, 2) === nb.slice(0, 2) && cabLev(na, nb) <= 2) {
      const s = byShips([...groups[na], ...groups[nb]]);
      out.push({ keep: s[0], drops: s.slice(1), exact: false });
    }
  }
  return out.sort((x, y) => (y.exact - x.exact) || x.keep.name.localeCompare(y.keep.name, 'ru'));
}

// Объединить клиента fromName в toName во ВСЕХ приходах: имя в товарах + веса, оплаты, отметки. Транзакция на каждый приход.
async function cabMergeClients(fromName, toName) {
  const fl = fromName.toLowerCase(), tl = toName.toLowerCase();
  if (fl === tl) return;
  const touched = cabShipmentsCache.filter(s => (s.data || []).some(row => splitWarehouses((Array.isArray(row) ? row[1] : row.w) || '').some(p => p.toLowerCase() === fl)));
  if (!cabMergeSkipConfirm && !confirm(`Объединить клиента «${fromName}» с «${toName}»?\n\nВо всех закупках (${touched.length}) имя «${fromName}» заменится на «${toName}», вместе с весами и оплатами.\nОтменить автоматически нельзя.`)) return;
  const MAPS = ['weights', 'payments', 'dueOverride', 'owners', 'costGoods', 'costShip', 'priceInclWeight'];
  try {
    for (const ship of touched) {
      const ref = shipmentsRef().doc(ship.id);
      await db.runTransaction(async t => {
        const doc = await t.get(ref);
        if (!doc.exists) return;
        const d = doc.data();
        const upd = {};
        upd.data = (d.data || []).map(row => {
          const w = (Array.isArray(row) ? row[1] : row.w) || '';
          const parts = splitWarehouses(w);
          if (!parts.some(p => p.toLowerCase() === fl)) return row;
          const np = []; for (const p of parts) { const v = p.toLowerCase() === fl ? toName : p; if (!np.some(x => x.toLowerCase() === v.toLowerCase())) np.push(v); }
          const nw = np.join(' и ');
          if (Array.isArray(row)) { const r = row.slice(); r[1] = nw; return r; }
          return { ...row, w: nw };
        });
        for (const f of MAPS) {
          const m = { ...(d[f] || {}) };
          const fk = Object.keys(m).find(k => k.toLowerCase() === fl);
          if (fk === undefined) continue;
          const tk = Object.keys(m).find(k => k.toLowerCase() === tl);
          const v = m[fk]; delete m[fk];
          if (tk === undefined) m[toName] = v;
          else if (f === 'weights') m[tk] = Math.round(((m[tk] || 0) + (v || 0)) * 1000) / 1000;
          else if (f === 'payments') m[tk] = { paid: Math.round((((m[tk] && m[tk].paid) || 0) + ((v && v.paid) || 0)) * 100) / 100, at: new Date().toISOString() };
          else if (f === 'dueOverride') delete m[tk];      // у объединённого клиента — снова расчётная сумма
          else m[tk] = !!(m[tk] || v);
          upd[f] = m;
        }
        t.update(ref, upd);
      });
    }
    // папка клиента — переносим, если у основного своей нет
    const FD = cabFolders();
    if (FD.map[fl] && !FD.map[tl]) { FD.map[tl] = FD.map[fl]; delete FD.map[fl]; userProfile.clientFolders = FD; await db.collection('users').doc(savedUid).update({ clientFolders: FD }); }
    else if (FD.map[fl]) { delete FD.map[fl]; userProfile.clientFolders = FD; await db.collection('users').doc(savedUid).update({ clientFolders: FD }); }
    // правило клиента («Это я» и т.п.) — переносим, если у основного своего нет
    const rules = (userProfile && userProfile.clientRules) || {};
    if (rules[fl] && !rules[tl]) {
      const nr = { ...rules, [tl]: rules[fl] }; delete nr[fl];
      await db.collection('users').doc(savedUid).update({ clientRules: nr });
      userProfile.clientRules = nr;
    }
    // данные клиента (фамилия, Telegram, телефон, заметка) — переносим, если у основного своих нет
    const info = (userProfile && userProfile.clientInfo) || {};
    if (info[fl]) {
      const ni = { ...info }; if (!ni[tl]) ni[tl] = ni[fl]; delete ni[fl];
      await db.collection('users').doc(savedUid).update({ clientInfo: ni });
      userProfile.clientInfo = ni;
    }
  } catch (e) { alert('Не удалось объединить: ' + e.message); }
  await loadCabinetData();
  cabClientOpen = cabClientOpen ? toName : null;
  renderCabClients(document.getElementById('cabMain'));
}
function cabMergeDupe(encFrom, encTo) { cabMergeClients(decodeURIComponent(encFrom), decodeURIComponent(encTo)); }
// Группа: присоединить все варианты к основному имени по очереди (подтверждение — одно на всю группу)
async function cabMergeGroup(encList, encTo) {
  const from = JSON.parse(decodeURIComponent(encList)), to = decodeURIComponent(encTo);
  if (!confirm(`Объединить в «${to}» клиентов: ${from.map(x => '«' + x + '»').join(', ')}?\n\nВо всех закупках эти имена заменятся на «${to}», вместе с весами и оплатами. Отменить автоматически нельзя.`)) return;
  cabMergeSkipConfirm = true;
  try { for (const f of from) await cabMergeClients(f, to); } finally { cabMergeSkipConfirm = false; }
}
let cabMergeSkipConfirm = false;
// Из карточки клиента: выбранного клиента присоединить к открытому
function cabMergeIntoOpen(sel) {
  const from = sel.value; sel.selectedIndex = 0;
  if (from && cabClientOpen) cabMergeClients(from, cabClientOpen);
}

// ---- ДАННЫЕ КЛИЕНТА (02.11.2026) ----
// Имя — как клиент записан в закупках (обязательное, меняется переименованием во всех закупках). Остальное по желанию:
// userProfile.clientInfo = { 'имя в нижнем регистре': { ln: фамилия, tg: логин Telegram, ph: телефон, note: заметка } }; папка — в clientFolders.
function cabClientInfo(name) { const m = (userProfile && userProfile.clientInfo) || {}; return m[String(name || '').toLowerCase()] || {}; }
const cabTgUser = v => String(v || '').trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/[^\w]/g, '');
const cabTel = v => String(v || '').replace(/[^\d+]/g, '');
const cabFullName = name => { const ln = cabClientInfo(name).ln; return ln && !String(name).toLowerCase().includes(ln.toLowerCase()) ? name + ' ' + ln : name; };
async function cabSaveClientInfo(name, info) {
  const k = String(name).toLowerCase(), all = { ...((userProfile && userProfile.clientInfo) || {}) };
  const clean = {};
  for (const f of ['ln', 'tg', 'ph', 'note']) {
    let v = String((info || {})[f] || '').trim().slice(0, f === 'note' ? 500 : 80);
    if (f === 'tg') v = cabTgUser(v);
    if (v) clean[f] = v;
  }
  const old = all[k] || {};
  for (const f of ['n', 'pre']) { const v = (info && f in info) ? info[f] : old[f]; if (v) clean[f] = f === 'n' ? String(v).trim().slice(0, 80) : v; }
  if (Object.keys(clean).length) all[k] = clean; else delete all[k];
  userProfile.clientInfo = all;
  await db.collection('users').doc(savedUid).update({ clientInfo: all });
}
// Переименование клиента во всех закупках (если имя уже занято — это объединение, со своим вопросом)
async function cabRenameClient(oldName, newName) {
  newName = String(newName || '').trim().replace(/\s+/g, ' ');
  if (!newName || newName === oldName) return false;
  const S = cabClientsSummary(), exists = S.list.some(x => x.name.toLowerCase() === newName.toLowerCase() && x.name.toLowerCase() !== oldName.toLowerCase());
  if (exists) { await cabMergeClients(oldName, newName); return true; }
  const n = cabShipmentsCache.filter(s => (s.data || []).some(row => splitWarehouses((Array.isArray(row) ? row[1] : row.w) || '').some(p => p.toLowerCase() === oldName.toLowerCase()))).length;
  if (!confirm(`Переименовать «${oldName}» в «${newName}» во всех закупках (${n})?`)) return false;
  cabMergeSkipConfirm = true;
  try { await cabMergeClients(oldName, newName); } finally { cabMergeSkipConfirm = false; }
  return true;
}
// Блок «Данные клиента» в карточке Кабинета: поля сохраняются сами при уходе с поля
function cabClientInfoHtml(name) {
  const I = cabClientInfo(name), enc = encodeURIComponent(name), tg = cabTgUser(I.tg), ph = cabTel(I.ph);
  const inp = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d5d8dd;border-radius:8px;font-size:14px;font-family:inherit;background:#fff';
  const lab = t => `<div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px">${t}</div>`;
  const fld = (f, t, ph0, v) => `<div>${lab(t)}<input value="${cabEsc(v || '')}" placeholder="${ph0}" onchange="cabCInfoSet('${enc}','${f}',this.value)" style="${inp}"></div>`;
  return `<div class="cab-table-wrap cab-cinfo" style="padding:14px 18px;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><b style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Данные клиента</b><span style="font-size:12.5px;color:#6b7280"><i class="ti ti-device-floppy"></i> сохраняется само</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
      <div>${lab('Имя *')}<input value="${cabEsc(name)}" onchange="cabCInfoRename('${enc}',this)" title="Как клиент записан в закупках — поменяется везде" style="${inp}"></div>
      ${fld('ln', 'Фамилия', 'по желанию', I.ln)}${fld('tg', 'Telegram', '@логин', I.tg ? '@' + cabTgUser(I.tg) : '')}${fld('ph', 'Телефон', '+375 …', I.ph)}
    </div>
    <div style="margin-top:10px">${lab('Заметка')}<textarea rows="2" placeholder="Например: берёт только детское" onchange="cabCInfoSet('${enc}','note',this.value)" style="${inp};resize:vertical">${cabEsc(I.note || '')}</textarea></div>
    <div id="cabCInfoBtns">${cabCInfoBtns(name)}</div>
  </div>`;
}
function cabCInfoBtns(name) {
  const I = cabClientInfo(name), tg = cabTgUser(I.tg), ph = cabTel(I.ph);
  return tg || ph ? `<div style="display:flex;gap:8px;margin-top:10px">${tg ? `<a class="cab-filter-btn" href="https://t.me/${tg}" target="_blank" rel="noopener" style="background:#2AABEE;border-color:#2AABEE;color:#fff;text-decoration:none"><i class="ti ti-brand-telegram"></i> Написать</a>` : ''}${ph ? `<a class="cab-filter-btn" href="tel:${ph}" style="text-decoration:none"><i class="ti ti-phone"></i> Позвонить</a>` : ''}</div>` : '';
}
async function cabCInfoSet(enc, field, val) {
  const name = decodeURIComponent(enc), I = { ...cabClientInfo(name) }; I[field] = val;
  try { await cabSaveClientInfo(name, I); showToast('Сохранено'); } catch (e) { alert('Не удалось сохранить: ' + e.message); return; }
  const b = document.getElementById('cabCInfoBtns'); if (b) b.innerHTML = cabCInfoBtns(name);
  const t = document.querySelector('#cabMain .cab-main-title'); if (t && field === 'ln') t.textContent = cabFullName(name);
}
async function cabCInfoRename(enc, inp) {
  const old = decodeURIComponent(enc);
  if (!(await cabRenameClient(old, inp.value))) inp.value = old;
}

// ---- ПАПКИ КЛИЕНТОВ (откуда пришли: Threads, чат СП и т.п.) ----
// userProfile.clientFolders = { list: ['Threads', ...], map: { 'имя в нижнем регистре': 'Threads' } } — у клиента одна папка
let cabFolderFilter = '';        // '' — все папки, '-' — без папки
const cabSel = new Set();        // отмеченные галочками клиенты (для «В папку»)
function cabFolders() { const f = (userProfile && userProfile.clientFolders) || {}; return { list: Array.isArray(f.list) ? f.list.slice() : [], map: { ...(f.map || {}) } }; }
function cabFolderOf(name) { return cabFolders().map[String(name).toLowerCase()] || ''; }
async function cabSaveFolders(f) {
  userProfile.clientFolders = f;
  try { await db.collection('users').doc(savedUid).update({ clientFolders: f }); } catch (e) { alert('Не удалось сохранить папки: ' + e.message); }
  renderCabClients(document.getElementById('cabMain'));
}
function cabFolderNew() {
  const n = (prompt('Название новой папки (например, Threads):') || '').trim(); if (!n) return;
  const f = cabFolders(); if (f.list.some(x => x.toLowerCase() === n.toLowerCase())) { alert('Такая папка уже есть'); return; }
  f.list.push(n); cabSaveFolders(f);
}
function cabFolderRename(enc) {
  const old = decodeURIComponent(enc); const n = (prompt('Новое название папки:', old) || '').trim(); if (!n || n === old) return;
  const f = cabFolders(); f.list = f.list.map(x => x === old ? n : x); for (const k in f.map) if (f.map[k] === old) f.map[k] = n;
  if (cabFolderFilter === old) cabFolderFilter = n; cabSaveFolders(f);
}
function cabFolderDelete(enc) {
  const name = decodeURIComponent(enc); if (!confirm(`Удалить папку «${name}»?\nКлиенты останутся, просто без папки.`)) return;
  const f = cabFolders(); f.list = f.list.filter(x => x !== name); for (const k in f.map) if (f.map[k] === name) delete f.map[k];
  if (cabFolderFilter === name) cabFolderFilter = ''; cabSaveFolders(f);
}
function cabSetFolderFilter(enc) { cabFolderFilter = decodeURIComponent(enc); renderCabClients(document.getElementById('cabMain')); }
function cabSetClientFolder(enc, folder) {
  const f = cabFolders(); const k = decodeURIComponent(enc).toLowerCase();
  if (folder) f.map[k] = folder; else delete f.map[k]; cabSaveFolders(f);
}
// Галочки в списке: панель «Выбрано N → В папку» обновляется без перерисовки таблицы
function cabSelBar() {
  const bar = document.getElementById('cabSelBar'); if (!bar) return;
  const f = cabFolders();
  bar.style.display = cabSel.size ? 'flex' : 'none';
  bar.innerHTML = `<b>Выбрано: ${cabSel.size}</b>
    <select onchange="if(this.value)cabSelMove(this.value)" class="cab-sel-select"><option value="">Переместить в папку…</option>${f.list.map(x => `<option value="${x.replace(/"/g, '&quot;')}">${x}</option>`).join('')}<option value="+">+ Новая папка…</option></select>
    <button class="cab-filter-btn" onclick="cabSelMove('-')">Убрать из папки</button>
    <button class="cab-filter-btn" onclick="cabSel.clear();renderCabClients(document.getElementById('cabMain'))">Снять выбор</button>`;
}
function cabSelToggle(enc, on) { const n = decodeURIComponent(enc); if (on) cabSel.add(n); else cabSel.delete(n); cabSelBar(); }
function cabSelAllVisible(on) {
  document.querySelectorAll('#cabClientsTable input[data-sel]').forEach(i => { i.checked = on; const n = decodeURIComponent(i.dataset.sel); if (on) cabSel.add(n); else cabSel.delete(n); });
  cabSelBar();
}
function cabSelMove(folder) {
  if (!cabSel.size) return;
  const f = cabFolders();
  if (folder === '+') {
    const n = (prompt('Название новой папки:') || '').trim(); if (!n) { cabSelBar(); return; }
    if (!f.list.some(x => x.toLowerCase() === n.toLowerCase())) f.list.push(n);
    folder = f.list.find(x => x.toLowerCase() === n.toLowerCase());
  }
  for (const n of cabSel) { if (folder === '-') delete f.map[n.toLowerCase()]; else f.map[n.toLowerCase()] = folder; }
  cabSel.clear(); cabSaveFolders(f);
}

// ---- СЕГМЕНТЫ КЛИЕНТОВ: подсказки «что делать» (маркетинг удержания) ----
const CAB_SEG_BAR = { new: '#8b5cf6', active: '#22c55e', regular: '#cbd5e1', once: '#38bdf8', forgotten: '#f59e0b', champ: '#eab308' };
const CAB_ADVICE = {
  once: {
    ic: 'ti-repeat', title: n => `${n} ${cabPl(n, 'клиент купил', 'клиента купили', 'клиентов купили')} только один раз`,
    why: 'Второй заказ — главный шаг: кто заказал дважды, обычно остаётся надолго. Вернуть знакомого покупателя проще и дешевле, чем найти нового.',
    tips: [
      ['Спросите, как заказ', 'Через 1–2 недели после получения: всё ли подошло, понравилось ли. Это забота, а не реклама — и повод для следующего заказа.'],
      ['Дайте причину вернуться', 'Бонус на второй заказ: доставка одной позиции в подарок или курс чуть лучше.'],
      ['Позовите заранее', '«Собираю отправку до такого-то числа — успеете добавить». Дата отсечки подталкивает решиться.'],
      ['Попросите отзыв или фото', 'С разрешения опубликуйте в Threads или канале — это реклама для следующих клиентов.']
    ],
    msg: 'Здравствуйте, {имя}! Как вам заказ из Китая — всё подошло? Собираю следующую отправку до {дата}. Если захотите что-то добавить — доставка одной позиции в подарок.'
  },
  forgotten: {
    ic: 'ti-zzz', title: n => `${n} ${cabPl(n, 'постоянный клиент пропал', 'постоянных клиента пропали', 'постоянных клиентов пропали')}`,
    why: 'Заказывали 2+ раза, но в трёх последних закупках их нет. Обычно причина простая: забыли, нашли дешевле или что-то не понравилось. Часто хватает одного личного сообщения.',
    tips: [
      ['Напишите лично, по имени', '«Давно вас не было — всё в порядке?» Спросите, что можно улучшить. Ответ подскажет, как вернуть и других.'],
      ['Предложение на возвращение', 'Бонус или скидка, которые действуют только до ближайшей отправки — есть повод не откладывать.'],
      ['Напомните, что брали', 'Покажите похожие новинки к их прошлым покупкам — так проще захотеть снова.'],
      ['Скоро: уведомления в Piksta', 'Напоминание о новой отправке придёт клиенту прямо в приложение.']
    ],
    msg: 'Здравствуйте, {имя}! Давно вас не было в наших заказах — всё хорошо? Собираю отправку до {дата}. Для тех, кто с нами давно, — {бонус}. Если в прошлый раз что-то не понравилось, напишите — исправлю.'
  },
  new: {
    ic: 'ti-sparkles', title: n => `${n} ${cabPl(n, 'новый клиент', 'новых клиента', 'новых клиентов')} в последней закупке`,
    why: 'Первый опыт решает, будет ли второй заказ. Новичку важно понимать, что происходит с его посылкой.',
    tips: [
      ['Поприветствуйте', 'Коротко расскажите, как всё устроено: сроки, когда платить, как забрать.'],
      ['Держите в курсе', 'Напишите, когда посылка выехала и когда приехала — тишина пугает новичков больше всего.'],
      ['Спросите впечатления', 'После получения — пара вопросов: всё ли понравилось, что улучшить.'],
      ['Позовите в канал или чат', 'Там анонсы следующих отправок — новичок не потеряется.']
    ],
    msg: 'Здравствуйте, {имя}! Спасибо за первый заказ. Напишу, как только посылка выедет, — обычно доставка занимает {срок}. Анонсы следующих отправок — в нашем канале: {ссылка}.'
  },
  active: {
    ic: 'ti-heart', title: n => `${n} ${cabPl(n, 'клиент заказывает', 'клиента заказывают', 'клиентов заказывают')} каждую закупку`,
    why: 'Это ядро вашего дохода. Задача — не потерять их и сделать вашими «амбассадорами».',
    tips: [
      ['Ранний доступ', 'Сообщайте о следующей отправке им первым — это приятно и ничего не стоит.'],
      ['Маленький сюрприз', 'Записка, наклейка или пробник в посылке — дёшево, а запоминается надолго.'],
      ['«Приведи подругу»', 'Бонус обоим за нового клиента. Активные советуют охотнее всех.'],
      ['Просите отзывы', 'У постоянных они самые искренние — публикуйте с разрешения.']
    ],
    msg: 'Здравствуйте, {имя}! Спасибо, что заказываете с нами постоянно. Вы узнаёте первыми: следующая отправка собирается до {дата}. А если приведёте подругу — {бонус} вам обеим.'
  },
  regular: {
    ic: 'ti-calendar-repeat', title: n => `${n} ${cabPl(n, 'клиент заказывает', 'клиента заказывают', 'клиентов заказывают')} время от времени`,
    why: 'Были в 2+ закупках и недавно. Цель — чтобы заказывали в каждой закупке, как активные.',
    tips: [
      ['Анонсы с датой отсечки', 'Регулярно сообщайте, до какого числа собирается отправка.'],
      ['Подборки', '«Что сейчас выгодно брать» — помогает найти повод заказать.'],
      ['Бонус за серию', 'Заказ в двух отправках подряд — небольшой подарок или скидка на доставку.']
    ],
    msg: 'Здравствуйте, {имя}! Собираю отправку до {дата}. Если закажете и в этой, и в следующей — {бонус}.'
  },
  champ: {
    ic: 'ti-trophy', title: n => `Ваши чемпионы — ${n} ${cabPl(n, 'лучший клиент', 'лучших клиента', 'лучших клиентов')}`,
    why: 'Заказывают часто, были недавно и приносят больше всего. Их стоит поощрять — и они приведут похожих на себя.',
    tips: [
      ['Персональные условия', 'Курс чуть лучше или скидка на доставку — «для своих».'],
      ['Подарок к празднику', 'Поздравление и маленький презент — лояльность растёт сильнее, чем от скидки.'],
      ['Статус VIP', 'Закрытый чат или ранний доступ к отправкам.'],
      ['Попросите рекомендацию', 'У чемпионов самые тёплые знакомые — их друзья тоже станут хорошими клиентами.']
    ],
    msg: 'Здравствуйте, {имя}! Вы один из самых постоянных наших клиентов — спасибо! Для вас теперь {бонус}. И если кому-то из знакомых нужен заказ из Китая — буду рад помочь.'
  }
};
// Чемпионы: 3+ прихода, были недавно (не «забытые»), больше всего сумма заказов. Топ-10% базы, от 3 до 10 человек
function cabChampions(list) {
  const cl = list.filter(c => !c.isOwner);
  const top = Math.min(10, Math.max(3, Math.round(cl.length * 0.1)));
  return cl.filter(c => c.ships.length >= 3 && c.status !== 'forgotten').sort((a, b) => b.totalDue - a.totalDue).slice(0, top);
}
let cabAdviceOpen = false;   // по умолчанию свёрнут — список клиентов сразу на виду; раскрытие помним до перезагрузки
function cabAdviceToggle() {
  cabAdviceOpen = !cabAdviceOpen;
  renderCabClients(document.getElementById('cabMain'));
}
function cabCopy(text, btn) {
  const done = () => { if (btn) { const o = btn.innerHTML; btn.innerHTML = '<i class="ti ti-check"></i> Скопировано'; setTimeout(() => { btn.innerHTML = o; }, 1500); } };
  const fallback = () => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
// ---- Готовые сообщения меняются по поводу: распродажи в Китае (11.11, 618), праздники, сезон, конец месяца ----
const CAB_MSG_OPEN = {
  once: 'Здравствуйте, {имя}! Как вам прошлый заказ — всё подошло?',
  forgotten: 'Здравствуйте, {имя}! Давно вас не было в наших заказах — всё хорошо?',
  new: 'Здравствуйте, {имя}! Спасибо за первый заказ.',
  active: 'Здравствуйте, {имя}! Спасибо, что заказываете с нами постоянно.',
  regular: 'Здравствуйте, {имя}!',
  champ: 'Здравствуйте, {имя}! Вы один из самых постоянных наших клиентов — спасибо!'
};
const CAB_MSG_CTA = {
  once: 'Если захотите что-то добавить — доставка одной позиции в подарок.',
  forgotten: 'Для тех, кто с нами давно, — {бонус}. Если в прошлый раз что-то не понравилось, напишите — исправлю.',
  new: 'Напишу, как только ваша посылка выедет. Анонсы отправок — в нашем канале: {ссылка}.',
  active: 'Вы узнаёте первыми. А если приведёте подругу — {бонус} вам обеим.',
  regular: 'Если закажете и в этой, и в следующей отправке — {бонус}.',
  champ: 'Для вас — {бонус}. И если кому-то из знакомых нужен заказ из Китая — буду рад помочь.'
};
// Поводы: [метка, проверка даты, фраза]. Порядок = приоритет
// Длинные каникулы в Китае: фабрики, склады и карго не работают. За 4 недели до начала — подсказка написать клиентам
const CAB_CN_NY = ['2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23'];  // Китайский Новый год (дата праздника)
function cabCnBreak(now) {
  now = now || new Date(); const y = now.getFullYear(), list = [];
  for (const iso of CAB_CN_NY) list.push({ name: 'Китайский Новый год', start: new Date(iso + 'T00:00:00'), len: 'на 2–3 недели', lead: 10 });
  for (const yy of [y, y + 1]) {
    list.push({ name: 'майские каникулы', start: new Date(yy, 4, 1), len: 'на 5 дней', lead: 5 });
    list.push({ name: '«Золотую неделю»', start: new Date(yy, 9, 1), len: 'на неделю', lead: 5 });
  }
  const day = 24 * 60 * 60 * 1000;
  const next = list.map(b => ({ ...b, days: Math.ceil((b.start - now) / day) })).filter(b => b.days > 0 && b.days <= 28).sort((a, b) => a.days - b.days)[0];
  if (!next) return null;
  next.orderBy = new Date(next.start.getTime() - next.lead * day);
  next.fmt = dt => dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return next;
}
const CAB_MSG_CTX = [
  ['Каникулы в Китае', () => !!cabCnBreak(), () => { const b = cabCnBreak(); return `С ${b.fmt(b.start)} Китай уходит на ${b.name} — фабрики и склады не работают ${b.len}. Чтобы посылки не застряли, заказы собираю до ${b.fmt(b.orderBy)}.`; }],
  ['Распродажа 11.11', d => (d.m === 10 && d.d >= 15) || (d.m === 11 && d.d <= 11), 'Скоро 11.11 — главная распродажа в Китае, цены в китайских магазинах самые низкие в году. Собираю заказы до {дата}.'],
  ['Распродажа 618', d => (d.m === 5 && d.d >= 25) || (d.m === 6 && d.d <= 18), 'В июне в Китае распродажа 618 — хорошие скидки на всё. Собираю заказы до {дата}.'],
  ['Новый год', d => (d.m === 11 && d.d >= 20) || d.m === 12 || (d.m === 1 && d.d <= 7), 'Скоро Новый год — самое время заказать подарки, чтобы точно успели приехать. Собираю отправку до {дата}.'],
  ['14 февраля и 8 Марта', d => (d.m === 1 && d.d >= 20) || d.m === 2 || (d.m === 3 && d.d <= 8), 'Скоро праздники — подарки лучше заказать заранее, чтобы точно успели. Собираю отправку до {дата}.'],
  ['1 сентября', d => d.m === 8 || (d.m === 7 && d.d >= 15), 'Скоро 1 сентября — одежда, рюкзаки и канцелярия из Китая обходятся заметно дешевле. Собираю отправку до {дата}.'],
  ['Сезон', d => true, d => ({ 12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3 })[d.m] !== undefined ? ['Зима в разгаре — тёплые вещи и домашний уют из Китая выходят заметно дешевле. Собираю отправку до {дата}.', 'Весна — время обновить гардероб к теплу. Собираю отправку до {дата}.', 'Лето — купальники, лёгкая одежда и всё для отдыха. Собираю отправку до {дата}.', 'Начинается холодный сезон — куртки, обувь и тёплые вещи из Китая обходятся заметно дешевле. Собираю отправку до {дата}.'][({ 12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3 })[d.m]] : ''],
  ['Конец месяца', d => d.d >= 22, 'В конце месяца закрываю отправку — до {дата} ещё можно добавить заказ.'],
  ['', d => true, 'Собираю следующую отправку до {дата}.']
];
const cabMsgIdx = {};
function cabMsgVariants(seg) {
  const now = new Date(), d = { m: now.getMonth() + 1, d: now.getDate() };
  const out = [];
  if (seg === 'new') out.push({ tag: 'Приветствие', text: CAB_ADVICE.new.msg });
  for (const [tag, ok, ph] of CAB_MSG_CTX) {
    if (!ok(d)) continue;
    const phrase = typeof ph === 'function' ? ph(d) : ph; if (!phrase) continue;
    out.push({ tag: tag === 'Сезон' ? ['Зима', 'Весна', 'Лето', 'Осень'][[0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0][d.m - 1]] : tag, text: `${CAB_MSG_OPEN[seg]} ${phrase} ${CAB_MSG_CTA[seg]}` });
  }
  if (seg !== 'new' && CAB_ADVICE[seg].msg) out.push({ tag: '', text: CAB_ADVICE[seg].msg });
  return out;
}
function cabMsgNext(seg) { cabMsgIdx[seg] = (cabMsgIdx[seg] || 0) + 1; renderCabClients(document.getElementById('cabMain')); }

// Блок «Что делать с этими клиентами»: сегмент = текущий фильтр, на «Все» — главная возможность
function cabAdviceHtml(all, champs) {
  const cl = all.filter(c => !c.isOwner);
  const cnt = k => k === 'champ' ? champs.length : cl.filter(c => c.status === k).length;
  let seg = cabClientFilter, auto = false;
  if (!CAB_ADVICE[seg]) {
    auto = true;
    seg = cl.length && cnt('once') / cl.length >= 0.3 ? 'once' : cnt('forgotten') ? 'forgotten' : champs.length ? 'champ' : 'active';
  }
  const A = CAB_ADVICE[seg], n = cnt(seg);
  const people = seg === 'champ' ? champs : cl.filter(c => c.status === seg);
  const tabs = ['once', 'forgotten', 'new', 'active', 'champ'].map(k => `<span class="cab-adv-tab${k === seg ? ' on' : ''}" style="--c:${CAB_SEG_BAR[k]}" onclick="cabSetClientFilter('${k}')"><i class="ti ${CAB_ADVICE[k].ic}"></i>${k === 'champ' ? 'Чемпионы' : { once: 'Разовые', forgotten: 'Забытые', new: 'Новые', active: 'Активные' }[k]}</span>`).join('');
  const head = `<div class="cab-adv-head" onclick="cabAdviceToggle()">
      <span class="cab-adv-ic" style="--c:${CAB_SEG_BAR[seg]}"><i class="ti ${A.ic}"></i></span>
      <div class="cab-adv-ttl"><div class="cab-adv-kick">${auto ? 'Главная возможность сейчас' : 'Что делать с этими клиентами'}</div><div>${A.title(n)}</div></div>
      ${cabAdviceOpen ? '<span class="cab-adv-more">Свернуть <i class="ti ti-chevron-up"></i></span>' : `<span class="cab-adv-cta">${{ once: 'Как вернуть их', forgotten: 'Как напомнить о себе', new: 'Как удержать', active: 'Как не потерять', regular: 'Как сделать постоянными', champ: 'Как поощрить' }[seg]}<span class="cab-adv-chev"><i class="ti ti-chevron-down"></i><i class="ti ti-chevron-down"></i></span></span>`}
    </div>`;
  if (!cabAdviceOpen) return `<div class="cab-card cab-adv cab-adv-closed">${head}</div>`;
  const vars = cabMsgVariants(seg), vi = (cabMsgIdx[seg] || 0) % vars.length, V = vars[vi];
  const msgEnc = encodeURIComponent(V.text).replace(/'/g, '%27'), namesEnc = encodeURIComponent(people.map(c => c.name).join('\n')).replace(/'/g, '%27');
  return `<div class="cab-card cab-adv">
    ${head}
    <div class="cab-adv-tabs">${tabs}</div>
    <div class="cab-adv-why">${A.why}</div>
    <div class="cab-adv-body">
      <ol class="cab-adv-tips">${A.tips.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>
      <div class="cab-adv-msg">
        <div class="cab-adv-msg-l"><i class="ti ti-message-2"></i> Готовое сообщение${V.tag ? `<span class="cab-adv-msg-tag">повод: ${V.tag}</span>` : ''}${vars.length > 1 ? `<button class="cab-adv-next" onclick="event.stopPropagation();cabMsgNext('${seg}')" title="Показать другой текст"><i class="ti ti-refresh"></i> ${vi + 1}/${vars.length}</button>` : ''}</div>
        <div class="cab-adv-msg-t">${V.text.replace(/\{([^}]+)\}/g, '<mark>$1</mark>')}</div>
        <div class="cab-adv-msg-b">
          <button class="cab-filter-btn" onclick="event.stopPropagation();cabCopy(decodeURIComponent('${msgEnc}'),this)"><i class="ti ti-copy"></i> Скопировать текст</button>
          ${people.length ? `<button class="cab-filter-btn" onclick="event.stopPropagation();cabCopy(decodeURIComponent('${namesEnc}'),this)"><i class="ti ti-users"></i> Имена (${people.length})</button>` : ''}
        </div>
        <div class="cab-adv-msg-n">Подставьте свои данные вместо выделенного</div>
      </div>
    </div>
    ${seg === 'champ' && champs.length ? `<div class="cab-champs">${champs.map((c, i) => `<span class="cab-champ" onclick="cabOpenClient('${encodeURIComponent(c.name)}')"><b>${i + 1}</b>${c.name}<em>${c.ships.length} прих. · ${cabFmt(c.totalDue)} BYN</em></span>`).join('')}</div>` : ''}
  </div>`;
}

function cabSetClientFilter(f) { cabClientFilter = f; renderCabClients(document.getElementById('cabMain')); }

function renderCabClients(container) {
  if (cabClientOpen) { cabRenderClientCard(container, cabClientOpen); return; }
  const S = cabClientsSummary();
  if (!S.list.length) { container.innerHTML = cabEmptyClients(); return; }
  const all = S.list.sort((a, b) => b.unpaidDue - a.unpaidDue || a.name.localeCompare(b.name, 'ru'));
  const cnt = k => all.filter(c => c.status === k).length;
  const totalUnpaid = all.reduce((n, m) => n + m.unpaidDue, 0);
  const debtors = all.filter(m => m.unpaidDue > 0.005).length;
  const okSum = S.clientItemsSum - S.sharedExtra + S.noClientItems === S.totalItemsDb;
  const F = cabFolders();
  if (cabFolderFilter && cabFolderFilter !== '-' && !F.list.includes(cabFolderFilter)) cabFolderFilter = '';
  const folderOf = c => F.map[c.name.toLowerCase()] || '';
  const champs = cabChampions(all);
  let list = cabClientFilter === 'all' ? all : cabClientFilter === 'champ' ? all.filter(c => champs.includes(c)) : all.filter(c => c.status === cabClientFilter);
  if (cabFolderFilter) list = list.filter(c => cabFolderFilter === '-' ? !folderOf(c) : folderOf(c) === cabFolderFilter);

  const rowHtml = c => {
    const st = CAB_CLIENT_STATUS[c.status];
    const ownerBadge = c.isOwner ? ' <span style="font-size:12px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-weight:600">свой</span>' : '';
    const enc = encodeURIComponent(c.name);
    const qI = cabClientInfo(c.name), q = [c.name, cabFullName(c.name), qI.ph, qI.tg].filter(Boolean).join(' ').toLowerCase().replace(/"/g, '');
    return `<tr data-q="${cabEsc(q)}">
      <td class="cab-sel-td"><input type="checkbox" data-sel="${enc}" ${cabSel.has(c.name) ? 'checked' : ''} onchange="cabSelToggle('${enc}',this.checked)"></td>
      <td style="font-weight:500"><a href="#" onclick="cabOpenClient('${encodeURIComponent(c.name)}');return false" style="color:#6C4DB8;text-decoration:none">${cabEsc(cabFullName(c.name))}</a>${ownerBadge}${(() => { const I = cabClientInfo(c.name); return (I.tg ? ' <i class="ti ti-brand-telegram" title="@' + cabEsc(cabTgUser(I.tg)) + '" style="color:#2AABEE"></i>' : '') + (I.ph ? ' <i class="ti ti-phone" title="' + cabEsc(I.ph) + '" style="color:#16a34a"></i>' : '') + (I.note ? ' <i class="ti ti-note" title="' + cabEsc(I.note) + '" style="color:#b45309"></i>' : ''); })()}</td>
      <td><span style="font-size:13px;background:${st.bg};color:${st.color};padding:3px 8px;border-radius:5px;font-weight:600">${st.label}</span></td>
      <td>${c.ships.length}</td>
      <td>${c.totalItems}</td>
      <td>${c.totalWeight > 0 ? c.totalWeight.toFixed(2) + ' кг' : '—'}</td>
      <td class="val-purple">${c.unpaidDue > 0.005 ? cabFmt(c.unpaidDue) : '<span style="color:#16a34a">0</span>'}</td>
      <td>${cabFmt(c.totalDue)}</td>
      <td class="${c.totalProfit >= 0 ? 'val-green' : 'val-red'}">${c.totalProfit >= 0 ? '+' : ''}${cabFmt(c.totalProfit)}</td>
    </tr>`;
  };
  // Есть папки — список разделён на группы по папкам (в порядке папок), «Без папки» в конце; внутри — текущая сортировка и фильтр статуса
  let rows;
  if (F.list.length) {
    const groups = [...F.list, ''].map(fd => ({ fd, items: list.filter(c => folderOf(c) === fd) })).filter(g => g.items.length);
    rows = groups.map(g => `<tr class="cab-grp"><td colspan="9"><i class="ti ti-folder${g.fd ? '' : '-off'}"></i> ${g.fd || 'Без папки'} <span>${g.items.length}</span></td></tr>` + g.items.map(rowHtml).join('')).join('');
  } else rows = list.map(rowHtml).join('');
  const fchip = (val, label, n, extra) => `<span class="cab-fchip${cabFolderFilter === val ? ' on' : ''}" onclick="cabSetFolderFilter('${encodeURIComponent(val)}')">${label}${n !== null ? ` <i>${n}</i>` : ''}${extra || ''}</span>`;
  const folderRow = `<div class="cab-frow"><span class="cab-frow-l"><i class="ti ti-folders"></i> Папки:</span>
    ${fchip('', 'Все', null)}
    ${F.list.map(fd => fchip(fd, fd, all.filter(c => folderOf(c) === fd).length,
      cabFolderFilter === fd ? ` <b onclick="event.stopPropagation();cabFolderRename('${encodeURIComponent(fd)}')" title="Переименовать"><i class="ti ti-pencil"></i></b><b onclick="event.stopPropagation();cabFolderDelete('${encodeURIComponent(fd)}')" title="Удалить папку"><i class="ti ti-x"></i></b>` : '')).join('')}
    ${F.list.length ? fchip('-', 'Без папки', all.filter(c => !folderOf(c)).length) : ''}
    <span class="cab-fchip add" onclick="cabFolderNew()"><i class="ti ti-plus"></i> Папка</span>
    <span style="font-size:12px;color:#9aa0ab;margin-left:6px">Отметьте клиентов галочками → «Переместить в папку»</span></div>`;

  const fbtn = (k, l) => `<button onclick="cabSetClientFilter('${k}')" style="border:none;background:${cabClientFilter === k ? '#f0ecf9' : 'none'};color:${cabClientFilter === k ? '#6C4DB8' : '#6b7280'};font-weight:${cabClientFilter === k ? 600 : 500};font-size:14px;padding:5px 10px;border-radius:6px;cursor:pointer">${l}</button>`;

  container.innerHTML = `
    <div class="cab-main-title" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">Клиенты</div>
    ${cabPreClientsHtml(S)}
    ${(() => {
      const cl = all.filter(c => !c.isOwner), tot = cl.length || 1;
      const segs = [['new', 'Новые', 'Впервые в самой свежей закупке'], ['active', 'Активные', 'Есть в двух последних закупках'], ['regular', 'Обычные', 'Заказывают время от времени, были недавно'], ['once', 'Разовые', 'Заказывали только в одной закупке'], ['forgotten', 'Забытые', 'Были в 2+ закупках, но в трёх последних их нет']]
        .map(([k, l, t]) => ({ k, l, t, n: cl.filter(c => c.status === k).length }));
      const bar = segs.filter(x => x.n).map(x => `<span class="${cabClientFilter === x.k ? 'on' : ''}" style="flex:${x.n};background:${CAB_SEG_BAR[x.k]}" title="${x.l}: ${x.n} — ${x.t}" onclick="cabSetClientFilter(cabClientFilter === '${x.k}' ? 'all' : '${x.k}')"></span>`).join('');
      const leg = segs.map(x => `<span class="cab-base-chip${cabClientFilter === x.k ? ' on' : ''}" title="${x.t}. Нажмите — показать в списке" onclick="cabSetClientFilter(cabClientFilter === '${x.k}' ? 'all' : '${x.k}')"><i style="background:${CAB_SEG_BAR[x.k]}"></i>${x.l}<b>${x.n}</b><em>${Math.round(x.n / tot * 100)}%</em></span>`).join('')
        + `<span class="cab-base-chip champ${cabClientFilter === 'champ' ? ' on' : ''}" title="Чаще всех заказывают, были недавно и приносят больше всего" onclick="cabSetClientFilter(cabClientFilter === 'champ' ? 'all' : 'champ')"><i class="ti ti-trophy"></i>Чемпионы<b>${champs.length}</b></span>`;
      return `<div class="cab-ov-top cab-cl-top">
        <div class="cab-card">
          <div class="cab-card-l"><i class="ti ti-users"></i> Клиентская база${cabHelpBtn('cl_base')}<b class="cab-base-n">${cl.length}</b>${cabClientFilter !== 'all' ? `<a href="#" class="cab-card-link" onclick="cabSetClientFilter('all');return false">Показать всех ×</a>` : ''}</div>
          <div class="cab-base-bar">${bar}</div>
          <div class="cab-base-leg">${leg}</div>
        </div>
        ${(() => {
          let billed = 0, paid = 0;
          for (const ship of cabShipmentsCache) { if (!cabIsBilled(ship)) continue; for (const c of cabGetClientsFromShipment(ship).clients) { if (c.isOwner) continue; billed += c.due; paid += Math.min(c.due, c.payPaid || 0); } }
          const pct = billed > 0 ? Math.round(paid / billed * 100) : 100;
          return `<div class="cab-card cab-debt">
          <div class="cab-card-l"><i class="ti ti-cash"></i> Должны вам${cabHelpBtn('cl_debt')}</div>
          <div class="cab-debt-v">${cabFmt(totalUnpaid)} <small>BYN</small></div>
          <div class="cab-debt-bar"><span style="width:${Math.max(pct, paid > 0 ? 2 : 0)}%"></span></div>
          <div class="cab-debt-p"><span>Собрано <b>${cabFmt(paid)}</b> из ${cabFmt(billed)} BYN</span><b>${pct}%</b></div>
          <div class="cab-debt-s">${debtors} ${cabPl(debtors, 'клиент', 'клиента', 'клиентов')} · по рассортированным закупкам<a href="#" onclick="document.getElementById('cabClientsTable').scrollIntoView({behavior:'smooth'});return false">к списку ↓</a></div>
        </div>`;
        })()}
      </div>`;
    })()}
    ${cabAdviceHtml(all, champs)}
    <div style="font-size:13px;color:${okSum ? '#9aa0ab' : '#dc2626'};margin:0 0 14px">
      Сверка позиций: в базе ${S.totalItemsDb} = у клиентов ${S.clientItemsSum}${S.sharedExtra ? ' − повторы общих ' + S.sharedExtra : ''}${S.noClientItems ? ' + без клиента ' + S.noClientItems : ''} ${okSum ? '✓' : '— не сходится'}
    </div>
    ${(() => {
      const dupes = cabFindDupes(all).slice(0, 12);
      if (!dupes.length) return '';
      return `<div class="cab-table-wrap" style="border-color:#fde68a;background:#fffdf5">
        <div class="cab-table-title" style="margin-bottom:8px"><i class="ti ti-copy" style="color:#b45309;margin-right:6px"></i>Похожие имена — возможно, это один клиент</div>
        <div class="cab-dupes">${dupes.map(p => `<div class="cab-dupe">
          <div>
            <div class="cab-dupe-names">${p.drops.map(d => `<b>${d.name}</b> <span>(${d.ships.length} прих.)</span>`).join(' <span>+</span> ')} <i class="ti ti-arrow-right"></i> <b>${p.keep.name}</b> <span>(${p.keep.ships.length} прих.)</span></div>
            <div class="cab-dupe-hint" style="color:${p.exact ? '#16a34a' : '#b45309'}">${p.exact ? 'Отличаются только пробелами или знаками' : 'Похожее написание — проверьте'}</div>
          </div>
          <button class="cab-filter-btn" onclick="cabMergeGroup('${encodeURIComponent(JSON.stringify(p.drops.map(d => d.name)))}','${encodeURIComponent(p.keep.name)}')">Объединить${p.drops.length > 1 ? ' все' : ''}</button>
        </div>`).join('')}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:8px">Другие написания (напр. «Катя Бычковская» и «Kati Bychkovskaya») — в карточке клиента: «Присоединить клиента…»</div>
      </div>`;
    })()}
    <div class="cab-table-wrap">
      ${CAB_TS_CSS}<div class="cab-cl-bar">
        <button type="button" class="cab-eb cab-new-big" onclick="cabClAddOpen()"><i class="ti ti-user-plus"></i>Добавить клиента</button>
        <label class="cab-ts"><i class="ti ti-search" aria-hidden="true"></i><input id="cabClQ" type="search" autocomplete="off" spellcheck="false" placeholder="Найти клиента: имя, телефон или Telegram" value="${cabEsc(cabClQ)}" oninput="cabClSearch(this.value)" onkeydown="if(event.key==='Escape'){this.value='';cabClSearch('')}"></label>
      </div>
      <div id="cabClQNone" class="cab-cl-qnone" style="display:none"></div>
      <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:10px">
        ${fbtn('all', 'Все')}${fbtn('new', 'Новые')}${fbtn('active', 'Активные')}${fbtn('regular', 'Обычные')}${fbtn('once', 'Разовые')}${fbtn('forgotten', 'Забытые')}${fbtn('champ', 'Чемпионы')}${cabHelpBtn('cl_list')}
      </div>
      ${folderRow}
      <div id="cabSelBar" class="cab-selbar" style="display:none"></div>
      <table class="cab-table" id="cabClientsTable">
        <thead><tr><th class="cab-sel-td"><input type="checkbox" title="Отметить всех в списке" onchange="cabSelAllVisible(this.checked)"></th><th>Клиент</th><th>Статус</th><th>Закупок</th><th>Позиций</th><th>Вес</th><th>Долг (не оплачено)</th><th>Всего BYN</th><th>Прибыль</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
      </table>
    </div>`;
  cabSelBar();
  if (cabClQ) cabClSearch(cabClQ);
}

// Поиск клиента в списке «Клиенты» — фильтрует строки на месте, без перерисовки
let cabClQ = '';
function cabClSearch(v) {
  cabClQ = String(v || '');
  const q = cabClQ.trim().toLowerCase(), t = document.getElementById('cabClientsTable'); if (!t) return;
  let shown = 0;
  t.querySelectorAll('tbody tr[data-q]').forEach(tr => { const on = !q || tr.dataset.q.includes(q); tr.style.display = on ? '' : 'none'; if (on) shown++; });
  t.querySelectorAll('tbody tr.cab-grp').forEach(g => { let n = g.nextElementSibling, any = false; while (n && !n.classList.contains('cab-grp')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; } g.style.display = any ? '' : 'none'; });
  const none = document.getElementById('cabClQNone');
  if (none) { none.style.display = q && !shown ? '' : 'none'; none.innerHTML = q && !shown ? `Клиента «${cabEsc(cabClQ.trim())}» нет в этом списке${cabClientFilter !== 'all' || cabFolderFilter ? ' — <a href="#" onclick="cabFolderFilter=\'\';cabSetClientFilter(\'all\');return false">показать всех</a>' : ''}. <a href="#" onclick="cabClAddOpen();return false">Добавить нового клиента</a>` : ''; }
}

function cabOpenClient(encName) {
  cabClientOpen = decodeURIComponent(encName);
  cabClientShipOpen.clear();
  renderCabClients(document.getElementById('cabMain'));
  cabSaveAt();
}
function cabCloseClient() {
  cabClientOpen = null;
  renderCabClients(document.getElementById('cabMain'));
  cabSaveAt();
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
    const date = cabNameHasDate(ship) ? '' : cabShipDateStr(ship);
    const sst = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const inp = 'padding:5px 7px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;width:92px;box-sizing:border-box';
    const paidHtml = c.isOwner ? '<div onclick="event.stopPropagation()" style="grid-column:5/9;font-size:13px;color:#dc2626;cursor:default">свой склад</div>'
      : `<div onclick="event.stopPropagation()" style="cursor:default"><input value="${c.due.toFixed(2)}" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + c.dueCalc.toFixed(2) + '. Пусто — вернуть расчётную' : 'Можно исправить сумму. Пусто — вернуть расчётную'}" onchange="cabCardSetDue('${ship.id}','${enc}',this.value)" inputmode="decimal" style="${inp};color:#6C4DB8;font-weight:600${c.dueEdited ? ';border-color:#f59e0b' : ''}"></div>
        <div onclick="event.stopPropagation()" style="cursor:default"><input value="${c.payPaid ? c.payPaid.toFixed(2) : ''}" placeholder="0" onchange="cabCardSetPaid('${ship.id}','${enc}',this.value)" inputmode="decimal" style="${inp}"></div>
        <b onclick="event.stopPropagation()" ${cabIsBilled(ship) ? '' : 'title="Закупка ещё не рассортирована — в долг не входит"'} style="justify-self:end;font-size:14px;cursor:default;color:${!cabIsBilled(ship) ? '#9aa0ab' : c.payRest > 0.004 ? '#dc2626' : '#16a34a'}">${cabFmt2(c.payRest)}</b>
        <label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" title="Отметить полностью оплаченным" ${c.payStatus === 'full' ? 'checked' : ''} onchange="cabCardSetFull('${ship.id}','${enc}', this.checked)" style="width:16px;height:16px;margin:0;cursor:pointer">${cabPayBadge(c.payStatus)}${cabSettleNote(c)}</label>`;
    let items = '';
    if (open) {
      const rows = (ship.data || []).map(row => Array.isArray(row) ? row : [row.t, row.w, row.img || '', row.p || '', row.pc || '', row.q || '1'])
        .filter(r => splitWarehouses(r[1] || '').some(p => p.toLowerCase() === low))
        .map(r => {
          const parts = splitWarehouses(r[1] || '');
          const shared = parts.length > 1 ? ` <span style="font-size:12px;color:#6b7280">(общий: ${r[1]})</span>` : '';
          const price = parseFloat(r[4]) || parseFloat(r[3]) || 0;
          const img = r[2] ? `<img src="${pkImg(r[2])}" loading="lazy" onclick="cabZoomImg(this.src)" title="Увеличить" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block;cursor:zoom-in">` : '<div style="width:44px;height:44px;border-radius:6px;background:#f3f4f6"></div>';
          return `<tr><td style="width:52px">${img}</td><td style="font-family:monospace;font-size:13px;color:#4a5260">${r[0] || ''}${shared}</td><td>${price ? cabFmt2(price) + ' ¥' : '—'}${(parseInt(r[5]) || 1) > 1 ? ' ×' + r[5] : ''}</td></tr>`;
        }).join('');
      items = `<div style="padding:4px 0 6px">
        <div style="font-size:13px;color:#6b7280;margin:6px 0 8px">Вес клиента в закупке: <b style="color:#1a1a2e">${c.weight > 0 ? c.weight.toFixed(2) + ' кг' : 'не взвешен'}</b>${c.shipWeight > 0 ? ' · с тарой ' + c.shipWeight.toFixed(2) + ' кг' : ''} (вес вводится на клиента целиком, не по товарам)</div>
        <table class="cab-table"><thead><tr><th></th><th>Трек-код</th><th>Цена клиента</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="color:#6b7280">Нет товаров</td></tr>'}</tbody></table>
      </div>`;
    }
    return `<div class="cab-cship">
      <div onclick="cabToggleClientShip('${ship.id}')" class="cab-cship-row" style="cursor:pointer">
        <i class="ti ti-chevron-${open ? 'down' : 'right'}" style="color:#6b7280"></i>
        <div style="font-weight:600">${ship.name || 'Без названия'}${date ? ` <span style="font-weight:400;color:#6b7280;font-size:13px">· ${date}</span>` : ''}</div>
        <span style="font-size:13px;color:#4a5260"><span class="status-dot" style="background:${sst.color}"></span>${sst.label}</span>
        <span style="font-size:14px;justify-self:end">${c.items} поз.</span>
        ${paidHtml}
      </div>
      ${open ? `<div style="grid-column:1/-1;padding:0 14px 10px;overflow-x:auto">${items}</div>` : ''}
    </div>`;
  }).join('');

  container.innerHTML = `
    <a href="#" onclick="cabCloseClient();return false" style="display:inline-flex;align-items:center;gap:4px;color:#6C4DB8;text-decoration:none;font-size:14px;margin-bottom:10px"><i class="ti ti-arrow-left"></i> Все клиенты</a>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <div class="cab-main-title" style="margin:0">${cabEsc(cabFullName(m.name))}</div>
      <span style="font-size:13px;background:${st.bg};color:${st.color};padding:3px 8px;border-radius:5px;font-weight:600">${st.label}</span>
      ${m.isOwner ? '<span style="font-size:13px;background:#fee2e2;color:#dc2626;padding:3px 8px;border-radius:5px">свой</span>' : ''}
      <select onchange="cabSetClientFolder('${enc}', this.value)" title="Папка клиента (откуда пришёл)" style="margin-left:auto;padding:7px 10px;border:1px solid #d5d8dd;border-radius:8px;font-size:14px;background:#fff;color:#4a5260;cursor:pointer">
        <option value="">Без папки</option>${cabFolders().list.map(fd => `<option value="${fd.replace(/"/g, '&quot;')}" ${cabFolderOf(m.name) === fd ? 'selected' : ''}>Папка: ${fd}</option>`).join('')}
      </select>
      <select onchange="cabMergeIntoOpen(this)" title="Если это один и тот же человек под разными именами" style="padding:7px 10px;border:1px solid #d5d8dd;border-radius:8px;font-size:14px;background:#fff;color:#4a5260;cursor:pointer">
        <option value="">Присоединить клиента…</option>
        ${(() => { const nm = cabNameNorm(m.name); const others = S.list.filter(x => x.name !== m.name)
            .map(x => ({ x, d: cabLev(cabNameNorm(x.name), nm) })).sort((a, b) => a.d - b.d || a.x.name.localeCompare(b.x.name, 'ru'));
          return others.map(o => `<option value="${o.x.name.replace(/"/g, '&quot;')}">${o.x.name} (${o.x.ships.length} прих.)</option>`).join(''); })()}
      </select>
    </div>
    ${cabClientInfoHtml(m.name)}
    <div class="cab-table-wrap" style="padding:14px 18px">
      <div style="display:flex;gap:24px;flex-wrap:wrap;row-gap:6px">
        ${ruleChk('owner', 'Это я')}${ruleChk('costGoods', 'Товар по себестоимости')}${ruleChk('costShip', 'Доставка по себестоимости')}
      </div>
      <div style="font-size:13px;color:#6b7280;margin-top:8px">Действуют в закупках, которые формируются, и во всех следующих. Для закупок в дороге и на складе — галочки в колонке «Условия» на вкладке «Расчёт» конкретной закупки.</div>
    </div>
    <div class="cab-stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="cab-stat-card"><div class="cab-stat-val">${m.totalItems}</div><div class="cab-stat-label">Позиций всего</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${m.ships.length}</div><div class="cab-stat-label">Закупок</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val" style="color:#6C4DB8">${cabFmt2(m.unpaidDue)}</div><div class="cab-stat-label">Не оплачено, BYN</div></div>
      <div class="cab-stat-card"><div class="cab-stat-val">${cabFmt2(m.totalDue)}</div><div class="cab-stat-label">Всего за всё время, BYN</div></div>
    </div>
    ${(() => { const D = cabClientDebts(m); if (D.length < 2) return ''; const tot = D.reduce((n, d) => n + d.rest, 0);
      return `<div class="cab-fifo-bar"><div><small>Должна всего</small><b>${cabFmt2(tot)} BYN</b><span>по ${D.length} ${cabPl(D.length, 'закупке', 'закупкам', 'закупкам')} · самая старая — ${cabEsc(D[0].ship.name || 'Закупка')}</span></div><button type="button" class="cab-eb ok" onclick="cabFifoOpen('${enc}')"><i class="ti ti-cash"></i>Внести оплату</button></div>`; })()}
    <div class="cab-table-title">Закупки клиента</div>
    <div style="overflow-x:auto;padding-bottom:2px">
      <div class="cab-cships">
        <div class="cab-cship cab-cship-head"><div class="cab-cship-row">
          <span></span><span>Закупка</span><span>Статус</span><span style="justify-self:end">Позиций</span><span>Итого, BYN</span><span>Оплачено, BYN</span><span style="justify-self:end">Остаток</span><span>Оплата</span>
        </div></div>
        ${shipsHtml}
      </div>
    </div>`;
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
      if ((ship.status || 'forming') === 'forming') {  // закупка ещё собирается — условие действует сразу
        if (map[c.name] === !!on) continue;
        map[c.name] = !!on;
      } else {
        if (Object.prototype.hasOwnProperty.call(map, c.name)) continue;  // уже есть явное значение
        map[c.name] = kind === 'owner' ? c.isOwner : kind === 'costGoods' ? c.costGoodsOn : c.costShipOn;
      }
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
    alert('Условие сохранено: оно уже действует в закупках, которые формируются, и будет действовать во всех следующих. В закупках, которые уже в дороге или на складе, условия не меняются — для них откройте закупку, вкладка «Расчёт», колонка «Условия» и поставьте галочку напротив клиента.');
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
// «Все оплатили»: отметить всех клиентов прихода (кроме «это я») оплатившими полностью — только с подтверждением
async function cabShipAllPaid() {
  const ship = cabShipmentsCache.find(s => s.id === cabShipId); if (!ship) return;
  const { clients } = cabGetClientsFromShipment(ship);
  const left = clients.filter(c => !c.isOwner && c.payRest > 0.004);
  if (!left.length) { alert('Все клиенты этой закупки уже оплатили.'); return; }
  const sum = left.reduce((n, c) => n + c.payRest, 0);
  const warn = cabIsBilled(ship) ? '' : '\n\nВнимание: закупка ещё не рассортирована — суммы могут измениться после взвешивания.';
  if (!confirm(`Отметить оплатившими полностью ${left.length} клиентов закупки «${ship.name || ''}»?\nОстаток к оплате: ${cabFmt2(sum)} BYN.${warn}\n\nОтменить можно у каждого клиента вручную.`)) return;
  try {
    for (const c of left) await cabSavePayment(ship.id, cabClientKey(ship, c.name), Math.round(c.due * 100) / 100);
  } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  cabRerender();
}

// Галочка «Оплачено»: пусто — клиент заплатил ровно итог; введена меньшая сумма — спросить и закрыть расчёт (списать остаток);
// снять галочку — открыть расчёт обратно (если был закрыт), иначе обнулить оплату.
async function cabCardSetFull(shipId, encName, on) {
  const ship = cabShipmentsCache.find(s => s.id === shipId); if (!ship) return;
  const key = cabClientKey(ship, decodeURIComponent(encName));
  const c = cabGetClientsFromShipment(ship).clients.find(x => x.name === key);
  const p = (ship.payments || {})[key];
  const paid = p && typeof p.paid === 'number' ? p.paid : 0;
  const due2 = c ? Math.round((c.dueBeforeSettle != null && c.settle ? c.dueBeforeSettle : c.due) * 100) / 100 : 0;
  try {
    if (on) {
      if (paid > 0.004 && paid < due2 - 0.004) {
        if (!confirm(`«${key}» заплатил(а) ${cabFmt2(paid)} из ${cabFmt2(due2)} BYN.\n\nЗакрыть расчёт и списать остаток ${cabFmt2(due2 - paid)} BYN? Прибыль станет меньше на эту сумму.\n\nЕсли это предоплата и клиент ещё доплатит — нажмите «Отмена».`)) { cabRerender(); return; }
        await cabTxMapField(shipId, 'payments', key, { paid: Math.round(paid * 100) / 100, at: new Date().toISOString(), closed: true });
      } else if (paid >= due2 - 0.004 && paid > 0.004) {
        // уже оплачено (или с переплатой) — ничего не меняем
      } else {
        await cabSavePayment(shipId, key, due2);
      }
    } else {
      if (p && p.closed) await cabTxMapField(shipId, 'payments', key, { paid: paid, at: new Date().toISOString() });
      else await cabSavePayment(shipId, key, 0);
    }
  } catch (e) { alert('Не удалось сохранить: ' + e.message); }
  cabRerender();
}
async function cabCardSetPaid(shipId, encName, val) {
  const ship = cabShipmentsCache.find(s => s.id === shipId); if (!ship) return;
  const key = cabClientKey(ship, decodeURIComponent(encName));
  const t = String(val).trim().replace(',', '.');
  const v = t === '' ? 0 : parseFloat(t);
  if (isNaN(v) || v < 0) { alert('Введите сумму числом'); return; }
  if (cabIsBilled(ship)) {   // переплата в рассортированной закупке уходит в прибыль — переспрашиваем, чтобы опечатка не стала «доходом»
    const c = cabGetClientsFromShipment(ship).clients.find(x => x.name === key);
    const due2 = c ? Math.round((c.settle ? c.dueBeforeSettle : c.due) * 100) / 100 : 0;
    if (c && !c.isOwner && v > due2 + 0.004 && !confirm(`Итог «${key}» — ${cabFmt2(due2)} BYN, вы вводите ${cabFmt2(v)}.\n\nЗасчитать переплату ${cabFmt2(v - due2)} BYN в прибыль?`)) { cabRerender(); return; }
  }
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

// ---- БАЗОВЫЕ КУРСЫ: users/{uid}.baseRates — с ними создаются новые закупки (и в мобильной версии) ----
const CAB_RATE_FIELDS = [
  ['clientRate', 'Курс для клиента', 'BYN за 1 ¥', 2],
  ['buyRate', 'Курс выкупа', 'BYN за 1 ¥', 2],
  ['shipClient', 'Доставка клиенту', 'BYN за 1 кг', 0],
  ['shipCargo', 'Доставка карго', 'BYN за 1 кг', 0]
];
function cabBaseRates() {
  if (userProfile && userProfile.baseRates) return { ...DEFAULT_RATES, ...userProfile.baseRates };
  const last = cabShipmentsCache[0];   // свежий сверху — так же, как раньше брались курсы для нового прихода
  return last && last.rates ? { ...DEFAULT_RATES, ...last.rates } : { ...DEFAULT_RATES };
}
const cabRateNum = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null; };
const cabRateStr = (v, d) => d ? Number(v).toFixed(Math.max(d, (String(Math.round(v * 10000) / 10000).split('.')[1] || '').length)) : String(Math.round(v * 10000) / 10000);
async function cabSetBaseRate(key, inp) {
  const v = cabRateNum(inp.value);
  const base = cabBaseRates();
  if (v === null) { inp.value = cabRateStr(base[key], key.endsWith('Rate') ? 2 : 0); return; }
  if (v === base[key]) return;
  base[key] = v;
  try {
    await db.collection('users').doc(savedUid).update({ baseRates: base });
    userProfile.baseRates = base;
  } catch (e) { alert('Не удалось сохранить: ' + e.message); return; }
  // Формирующиеся приходы ещё никому не выставлены — предлагаем сразу перевести их на новый курс
  const forming = cabShipmentsCache.filter(s => s.status === 'forming' && (s.rates || {})[key] !== v);
  if (forming.length && confirm(`Базовый курс сохранён.\n\nПрименить его и к формирующимся закупкам (${forming.map(s => '«' + (s.name || 'Без названия') + '»').join(', ')})?`)) {
    for (const s of forming) {
      const r = { ...DEFAULT_RATES, ...(s.rates || {}), [key]: v };
      try { await shipmentsRef().doc(s.id).update({ rates: r }); s.rates = r; cabSyncMobileRates(s.id, r); } catch (e) { alert('Не удалось обновить «' + s.name + '»: ' + e.message); }
    }
  }
  renderCabPrices(document.getElementById('cabMain'));
}
// Если этот приход открыт в мобильной части — обновляем курсы в памяти, чтобы расчёт там совпадал
function cabSyncMobileRates(shipId, r) {
  if (shipId === (typeof editingShipmentId !== 'undefined' && editingShipmentId || activeShipmentId)) currentRates = { ...r };
}

// ---- Меню «⋯» в строке прихода ----
function cabRowMenu(ev, id) {
  ev.stopPropagation();
  cabRowMenuClose();
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const done = ship.status === 'done';
  const m = document.createElement('div');
  m.className = 'cab-menu'; m.id = 'cabRowMenu';
  m.innerHTML = `
    <button ${done ? 'disabled title="Архив — курсы не меняем, иначе изменится вся статистика"' : ''} onclick="cabRowMenuClose();cabRatesEdit('${id}')"><i class="ti ti-pencil"></i>Изменить курсы${done ? '<em>архив</em>' : ''}</button>
    <button onclick="cabRowMenuClose();cabRatesToBase('${id}')"><i class="ti ti-arrow-bar-to-up"></i>Сделать курсы базовыми</button>
    <button onclick="cabRowMenuClose();cabShipCSV('${id}')"><i class="ti ti-file-spreadsheet"></i>Скачать расчёт (Excel / CSV)</button>
    ${done ? '' : `<button onclick="cabRowMenuClose();cabOpenShip('${id}')"><i class="ti ti-external-link"></i>Открыть закупку</button>`}
    <button class="r" onclick="cabRowMenuClose();cabShipDel('${id}')"><i class="ti ti-trash"></i>Удалить закупку</button>`;
  document.body.appendChild(m);
  const r = ev.currentTarget.getBoundingClientRect();
  const mw = 270;
  m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
  const below = r.bottom + 4, h = m.offsetHeight;
  m.style.top = (below + h > window.innerHeight - 8 ? r.top - h - 4 : below) + 'px';
  setTimeout(() => document.addEventListener('click', cabRowMenuClose, { once: true }), 0);
}
function cabRowMenuClose() { const m = document.getElementById('cabRowMenu'); if (m) m.remove(); }
async function cabRatesToBase(id) {
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const r = { ...DEFAULT_RATES, ...(ship.rates || {}) };
  if (!confirm(`Сделать курсы закупки «${ship.name || 'Без названия'}» базовыми?\nС ними будут создаваться новые закупки.`)) return;
  try { await db.collection('users').doc(savedUid).update({ baseRates: r }); userProfile.baseRates = r; } catch (e) { alert('Не удалось сохранить: ' + e.message); return; }
  renderCabPrices(document.getElementById('cabMain'));
}
// Выгрузка расчёта по клиентам прихода: CSV с «;» и BOM — открывается в Excel с кириллицей
function cabShipCSV(id) {
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const { clients, rates } = cabGetClientsFromShipment(ship);
  const n = v => (Math.round((v || 0) * 100) / 100).toFixed(2).replace('.', ',');
  const lines = [
    [`Закупка: ${ship.name || ''}`], [`Курс для клиента ${rates.clientRate} BYN/¥; курс выкупа ${rates.buyRate} BYN/¥; доставка клиенту ${rates.shipClient} BYN/кг; карго ${rates.shipCargo} BYN/кг`], [],
    ['Клиент', 'Позиций', 'Вес, кг', 'Сумма, ¥', 'Должен, BYN', 'Оплачено, BYN', 'Остаток, BYN', 'Прибыль, BYN']
  ];
  for (const c of clients) lines.push([c.name + (c.isOwner ? ' (свой)' : ''), c.items, n(c.weight), n(c.clientYuan), n(c.due), n(c.payPaid), n(c.payRest), n(c.profit)]);
  const t = cabShipTotals(ship);
  lines.push(['Итого', clients.reduce((a, c) => a + c.items, 0), n(t.weight), n(t.yuan), n(t.due), n(clients.reduce((a, c) => a + (c.payPaid || 0), 0)), n(clients.reduce((a, c) => a + (c.isOwner ? 0 : c.payRest), 0)), n(t.profit)]);
  const csv = String.fromCharCode(0xFEFF) + lines.map(r => r.map(x => { const s = String(x); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Piksta — ${(ship.name || 'закупка').replace(/[\\/:*?"<>|]/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---- Окно «Изменить курсы прихода» с предпросмотром ----
let cabRatesShipId = null;
function cabRatesEdit(id) {
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship || ship.status === 'done') return;
  cabRatesShipId = id;
  const r = { ...DEFAULT_RATES, ...(ship.rates || {}) };
  const { clients } = cabGetClientsFromShipment(ship);
  const paidN = clients.filter(c => !c.isOwner && (c.payPaid || 0) > 0.004).length;
  const fullN = clients.filter(c => !c.isOwner && c.payStatus === 'full').length;
  const ov = document.createElement('div');
  ov.className = 'cab-ovl'; ov.id = 'cabRatesOvl';
  ov.onclick = e => { if (e.target === ov) cabRatesClose(); };
  ov.innerHTML = `<div class="cab-dlg">
    <div class="cab-dlg-h">Курсы закупки «${ship.name || 'Без названия'}» ${cabShipPill(ship.status)}<button class="cab-dlg-x" onclick="cabRatesClose()"><i class="ti ti-x"></i></button></div>
    <div class="cab-rates-grid">${CAB_RATE_FIELDS.map(([k, l, u, d]) => `<label class="cab-rate-f"><span>${l}</span><input data-k="${k}" value="${cabRateStr(r[k], d)}" inputmode="decimal" oninput="cabRatesPreview()"><em>${u}</em></label>`).join('')}</div>
    <div class="cab-rates-prev" id="cabRatesPrev"></div>
    ${paidN ? `<div class="cab-rates-who">
      <div class="cab-rates-who-h"><i class="ti ti-alert-triangle"></i> ${paidN} ${cabPl(paidN, 'клиент уже платил', 'клиента уже платили', 'клиентов уже платили')}${fullN ? `, ${fullN} — полностью` : ''}. Кому пересчитать сумму?</div>
      <label><input type="radio" name="cabRatesWho" value="unpaid" checked onchange="cabRatesPreview()"> Только тем, кто ещё не рассчитался полностью <em>у рассчитавшихся сумма останется прежней</em></label>
      <label><input type="radio" name="cabRatesWho" value="all" onchange="cabRatesPreview()"> Всем клиентам <em>у рассчитавшихся может появиться долг или переплата</em></label>
    </div>` : ''}
    <div class="cab-dlg-f"><span>Изменения сразу видны и в мобильной версии</span><button class="cab-filter-btn" onclick="cabRatesClose()">Отмена</button><button class="cab-filter-btn active" onclick="cabRatesSave()">Сохранить</button></div>
  </div>`;
  document.body.appendChild(ov);
  cabRatesPreview();
  const f = ov.querySelector('input[data-k]'); if (f) { f.focus(); f.select(); }
}
function cabRatesClose() { const o = document.getElementById('cabRatesOvl'); if (o) o.remove(); cabRatesShipId = null; }
function cabRatesRead() {
  const ship = cabShipmentsCache.find(s => s.id === cabRatesShipId);
  const r = { ...DEFAULT_RATES, ...(ship && ship.rates || {}) };
  let bad = false;
  document.querySelectorAll('#cabRatesOvl input[data-k]').forEach(i => { const v = cabRateNum(i.value); if (v === null) { bad = true; i.classList.add('bad'); } else { i.classList.remove('bad'); r[i.dataset.k] = v; } });
  const w = document.querySelector('#cabRatesOvl input[name=cabRatesWho]:checked');
  return { ship, r, bad, who: w ? w.value : 'all' };
}
// Новые суммы с учётом выбора: рассчитавшимся полностью фиксируем прежнюю сумму (dueOverride)
function cabRatesApply(ship, r, who) {
  const before = cabGetClientsFromShipment(ship).clients;
  const freeze = {};
  if (who === 'unpaid') for (const c of before) if (!c.isOwner && c.payStatus === 'full' && !c.dueEdited) freeze[c.name] = Math.round(c.due * 100) / 100;
  const after = cabGetClientsFromShipment({ ...ship, rates: r, dueOverride: { ...(ship.dueOverride || {}), ...freeze } }).clients;
  return { before, after, freeze };
}
function cabRatesPreview() {
  const box = document.getElementById('cabRatesPrev'); if (!box) return;
  const { ship, r, bad, who } = cabRatesRead();
  if (!ship || bad) { box.innerHTML = '<span style="color:#dc2626">Введите числа</span>'; return; }
  const { before, after } = cabRatesApply(ship, r, who);
  const sum = (arr, f) => arr.reduce((n, c) => n + (c.isOwner ? 0 : f(c)), 0);
  const row = (l, a, b, good) => { const d = b - a; return `<div><span>${l}</span><b>${cabFmt2(a)}</b><i class="ti ti-arrow-right"></i><b>${cabFmt2(b)}</b><em class="${Math.abs(d) < 0.005 || good === null ? '' : (d > 0) === good ? 'up' : 'down'}">${Math.abs(d) < 0.005 ? 'без изменений' : (d > 0 ? '+' : '') + cabFmt2(d)}</em></div>`; };
  box.innerHTML = row('Клиенты должны, BYN', sum(before, c => c.due), sum(after, c => c.due), true)
    + row('Прибыль, BYN', sum(before, c => c.profit), sum(after, c => c.profit), true)
    + (cabIsBilled(ship) ? row('Остаток к оплате, BYN', sum(before, c => c.payRest), sum(after, c => c.payRest), null) : '');
}
async function cabRatesSave() {
  const { ship, r, bad, who } = cabRatesRead();
  if (!ship) return;
  if (bad) { alert('Проверьте курсы — нужны числа'); return; }
  const { freeze } = cabRatesApply(ship, r, who);
  const ref = shipmentsRef().doc(ship.id);
  try {
    await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (!doc.exists) throw new Error('закупка не найдена');
      const upd = { rates: r };
      if (Object.keys(freeze).length) upd.dueOverride = { ...(doc.data().dueOverride || {}), ...freeze };
      t.update(ref, upd);
    });
  } catch (e) { alert('Не удалось сохранить: ' + e.message); return; }
  ship.rates = r;
  if (Object.keys(freeze).length) {
    ship.dueOverride = { ...(ship.dueOverride || {}), ...freeze };
    if (ship.id === (typeof editingShipmentId !== 'undefined' && editingShipmentId || activeShipmentId) && typeof currentDueOverride !== 'undefined') Object.assign(currentDueOverride, freeze);
  }
  cabSyncMobileRates(ship.id, r);
  cabRatesClose();
  cabRerender();
}

function renderCabPrices(container) {
  const rents = [];
  const rows = cabShipmentsCache.map(ship => {
    const rates = ship.rates ? { ...DEFAULT_RATES, ...ship.rates } : { ...DEFAULT_RATES };
    const isDone = ship.status === 'done';
    const t = cabShipTotals(ship);
    if (ship.status === 'forming') t.rent = null;   // формируется: веса нет, рентабельность не окончательна
    if (t.rent !== null) rents.push(t.rent);
    return `<tr class="${isDone ? 'cab-row-done' : ''}">
      <td style="font-weight:500">${ship.name || 'Без названия'}</td>
      <td>${cabShipPill(ship.status)}</td>
      <td class="cab-num">${rates.clientRate.toFixed(2)}</td>
      <td class="cab-num">${rates.buyRate.toFixed(2)}</td>
      <td class="cab-num">${cabRateStr(rates.shipClient)}</td>
      <td class="cab-num">${cabRateStr(rates.shipCargo)}</td>
      <td class="cab-num" style="font-weight:600;color:${t.rent === null ? '#6b7280' : t.rent >= 0 ? '#16a34a' : '#dc2626'}">${cabPct(t.rent)}</td>
      <td class="cab-dots-td">${isDone ? '' : `<button class="cab-pen" title="Изменить курсы" onclick="cabRatesEdit('${ship.id}')"><i class="ti ti-pencil"></i></button>`}<button class="cab-dots" title="Ещё" onclick="cabRowMenu(event,'${ship.id}')"><i class="ti ti-dots"></i></button></td>
    </tr>`;
  }).join('');
  const avgRent = rents.length ? rents.reduce((a, b) => a + b, 0) / rents.length : null;
  const base = cabBaseRates();
  const th = (l1, l2, title) => `<th class="cab-num" title="${title}"><div>${l1}</div><small>${l2}</small></th>`;

  container.innerHTML = `
    <div class="cab-main-title">Цены и курсы</div>
    <div class="cab-rates-bar">
      <div class="cab-rates-bar-h"><b>Базовые курсы</b><span>с ними создаются новые закупки — и в мобильной версии</span></div>
      <div class="cab-rates-bar-f">
        ${CAB_RATE_FIELDS.map(([k, l, u, d]) => `<label class="cab-rate-f"><span>${l}</span><input value="${cabRateStr(base[k], d)}" inputmode="decimal" onchange="cabSetBaseRate('${k}',this)" onkeydown="if(event.key==='Enter')this.blur()"><em>${u}</em></label>`).join('')}
        <div class="cab-rate-f cab-rate-ro" title="Прибыль ÷ сколько должны клиенты × 100%, среднее по закупкам (кроме формирующихся)"><span>Средняя рентабельность</span><b>${cabPct(avgRent)}</b><em>по закупкам</em></div>
      </div>
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title">Курсы по закупкам</div>
      <table class="cab-table cab-prices">
        <thead><tr><th>Закупка</th><th>Статус</th>
          ${th('Курс для клиента', 'BYN за 1 ¥', 'Сколько BYN клиент платит за 1 юань')}
          ${th('Курс выкупа', 'BYN за 1 ¥', 'Сколько BYN стоит вам 1 юань при выкупе')}
          ${th('Доставка клиенту', 'BYN за 1 кг', 'Сколько клиент платит за доставку 1 кг')}
          ${th('Доставка карго', 'BYN за 1 кг', 'Сколько вы платите карго за 1 кг')}
          ${th('Рентабельность', 'прибыль ÷ оборот', 'Прибыль ÷ сколько должны клиенты × 100%')}
          <th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#6b7280;padding:20px">Нет данных</td></tr>'}</tbody>
      </table>
      <div style="font-size:13px;color:#9aa0ab;margin-top:12px">Карандаш — изменить курсы закупки (архив не меняется). Формирующиеся закупки — «—», в среднюю рентабельность не входят.</div>
    </div>`;
}

// ============ РАСЧЁТЫ ============
const cabCalcOpen = new Set();
// «Деньги»: закупка открывается сразу на вкладке «Расчёт»
async function cabCalcGo(id) { await cabOpenShip(id); if (cabShipId === id && cabShipTab !== 'calc') cabShipTabSet('calc'); }
function cabCalcToggle(id) {
  if (cabCalcOpen.has(id)) cabCalcOpen.delete(id); else cabCalcOpen.add(id);
  renderCabCalc(document.getElementById('cabMain'));
}
function cabCalcAll(open) {
  cabCalcOpen.clear();
  if (open) cabShipmentsCache.forEach(s => cabCalcOpen.add(s.id));
  renderCabCalc(document.getElementById('cabMain'));
}

let cabCalcFilter = 'all';   // all / wait (ждут оплаты) / work (до сортировки) / done (архив)
function cabCalcSetFilter(f) { cabCalcFilter = f; renderCabCalc(document.getElementById('cabMain')); }
function renderCabCalc(container) {
  if (!cabShipmentsCache.some(cabIsBilled)) { container.innerHTML = cabEmptyMoney('calc'); return; }
  const rows = [];
  let sumBilled = 0, sumPaid = 0, nWait = 0, nWork = 0, nDone = 0;
  for (const ship of cabShipmentsCache) {
    const { clients } = cabGetClientsFromShipment(ship);
    if (clients.length === 0) continue;
    const billed = cabIsBilled(ship), isDone = ship.status === 'done';
    let due = 0, profit = 0, paid = 0, rest = 0, kg = 0;
    for (const c of clients) { kg += c.weight || 0; if (c.isOwner) continue; due += c.due; profit += c.profit; paid += Math.min(c.due, c.payPaid || 0); rest += c.payRest; }
    const wait = billed && rest > 0.5;
    if (wait) nWait++; if (!billed) nWork++; if (isDone) nDone++;
    if (billed) { sumBilled += due; sumPaid += paid; }
    rows.push({ ship, clients, billed, isDone, due, profit, paid, rest, kg, wait });
  }
  const shown = rows.filter(r => cabCalcFilter === 'all' || (cabCalcFilter === 'wait' && r.wait) || (cabCalcFilter === 'work' && !r.billed) || (cabCalcFilter === 'done' && r.isDone));

  const blocks = shown.map(({ ship, clients, billed, isDone, due, profit, paid, rest, kg, wait }) => {
    const open = false;   // подробная таблица клиентов — во вкладке «Расчёт» закупки (03.11.2026)
    const pct = due > 0 ? Math.round(paid / due * 100) : 100;
    const rent = due > 0 ? profit / due * 100 : null;
    const date = cabNameHasDate(ship) ? '' : cabShipDateStr(ship);
    const approx = billed || kg > 0 ? '' : '≈ ';
    const debtors = billed ? clients.filter(c => !c.isOwner && c.payRest > 0.5).sort((a, b) => b.payRest - a.payRest) : [];
    // правая часть шапки: после сортировки — сколько собрано; до — что будет к оплате
    const right = billed
      ? `<div class="cab-cc-pay"><div class="cab-cc-pay-t"><span>Собрано <b>${cabFmt(paid)}</b> из ${cabFmt(due)}</span><b class="${rest > 0.5 ? 'red' : 'ok'}">${rest > 0.5 ? 'осталось ' + cabFmt(rest) : '<i class="ti ti-check"></i> всё оплачено'}</b></div><div class="cab-cc-bar"><span style="width:${Math.max(pct, paid > 0 ? 2 : 0)}%"></span></div></div>`
      : `<div class="cab-cc-pay est"><div class="cab-cc-pay-t"><span>К оплате будет</span><b>${approx}${cabFmt(due)} BYN</b></div><div class="cab-cc-note">${kg > 0 ? 'предварительно — закупка ещё не рассортирована' : 'без доставки — посчитаем после взвешивания'}</div></div>`;
    const cell = (l, v, cls) => `<div class="cab-cc-cell"><span>${l}</span><b class="${cls || ''}">${v}</b></div>`;
    const cells = cell('Клиенты должны', approx + cabFmt(due) + ' BYN')
      + cell('Оплачено', billed ? cabFmt(paid) + ' BYN' : '—', billed ? 'ok' : 'mut')
      + cell('Наценка', approx + (profit >= 0 ? '+' : '') + cabFmt(profit) + ' BYN', profit >= 0 ? 'ok' : 'red')
      + cell('Рентабельность', ship.status === 'forming' || rent === null ? '—' : rent.toFixed(1) + '%', 'mut')
      + cell('Вес', kg > 0 ? kg.toFixed(1) + ' кг' : 'не взвешен', kg > 0 ? '' : 'mut');
    const chips = debtors.length ? `<div class="cab-cc-debt"><span>Больше всех должны:</span>${debtors.slice(0, 4).map(c => `<em onclick="event.stopPropagation();cabNav('clients');cabOpenClient('${encodeURIComponent(c.name)}')">${c.name} <b>${cabFmt(c.payRest)}</b></em>`).join('')}${debtors.length > 4 ? `<i>+ ещё ${debtors.length - 4}</i>` : ''}</div>` : '';

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
          <td>${c.isOwner ? '—' : billed ? cabPayBadge(c.payStatus) : '<span style="color:#9aa0ab;font-size:13px">до сортировки</span>'}</td>
          <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}">${c.profit >= 0 ? '+' : ''}${cabFmt(c.profit)}</td>
        </tr>`;
      }).join('');
      table = `<div class="cab-cc-table"><table class="cab-table">
          <thead><tr><th>Клиент</th><th>Поз.</th><th>Юани</th><th>Вес, кг</th><th>Товар BYN</th><th>Дост. BYN</th><th>Итого</th><th>Оплата</th><th>Наценка</th></tr></thead>
          <tbody>${clientRows}</tbody>
        </table></div>`;
    }
    return `<div class="cab-cc${isDone ? ' done' : ''}${open ? ' open' : ''}">
      <div class="cab-cc-head" onclick="cabCalcGo('${ship.id}')" title="Открыть расчёт закупки">
        <i class="ti ti-arrow-right cab-cc-chev"></i>
        <div class="cab-cc-title"><div><b>${ship.name || 'Без названия'}</b>${cabShipPill(ship.status)}</div><span>${date ? date + ' · ' : ''}${(ship.data || []).length} поз. · ${clients.length} ${cabPl(clients.length, 'клиент', 'клиента', 'клиентов')}</span></div>
        ${right}
      </div>
      <div class="cab-cc-cells" onclick="cabCalcGo('${ship.id}')">${cells}</div>
      ${chips}
      ${table}
    </div>`;
  });

  const seg = (k, l, n) => `<button class="cab-seg-b${cabCalcFilter === k ? ' on' : ''}" onclick="cabCalcSetFilter('${k}')">${l} <i>${n}</i></button>`;
  const totPct = sumBilled > 0 ? Math.round(sumPaid / sumBilled * 100) : 100;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <div class="cab-main-title" style="margin:0">Деньги</div>
      <span style="color:#6b7280;font-size:14px">сбор оплат по всем закупкам · нажмите на закупку — откроется её расчёт</span>
    </div>
    <div class="cab-cc-top">
      <div class="cab-seg">${seg('all', 'Все', rows.length)}${seg('wait', 'Ждут оплаты', nWait)}${seg('work', 'До сортировки', nWork)}${seg('done', 'Архив', nDone)}</div>
      <div class="cab-cc-sum"><span>По рассортированным собрано <b>${cabFmt(sumPaid)}</b> из ${cabFmt(sumBilled)} BYN</span><div class="cab-cc-bar"><span style="width:${Math.max(totPct, sumPaid > 0 ? 2 : 0)}%"></span></div><b>${totPct}%</b></div>
    </div>
    ${blocks.length > 0 ? blocks.join('') : rows.length ? '<div class="cab-cc-empty">В этом фильтре закупок нет</div>' : '<div class="cab-stub"><i class="ti ti-calculator"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">Создайте закупку в Сканере</div></div>'}
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

// Экономика прихода (без «Это я»): сколько заплатят клиенты и из чего это состоит
function cabShipEcon(ship) {
  const { clients, rates } = cabGetClientsFromShipment(ship);
  const e = { due: 0, goods: 0, cargo: 0, profit: 0, rateM: 0, shipM: 0, items: (ship.data || []).length, kg: 0, n: 0, per: [] };
  for (const c of clients) {
    e.kg += c.weight || 0;
    if (c.isOwner) continue;
    const goods = c.buyYuan > 0 ? c.goodsCost : c.clientYuan * rates.buyRate;
    const rateM = c.costGoodsOn ? 0 : c.goodsClient - goods;
    e.due += c.due; e.goods += goods; e.cargo += c.shipCo; e.profit += c.profit; e.rateM += rateM; e.shipM += c.profit - rateM; e.n++;
    e.per.push({ name: c.name, due: c.due, profit: c.profit });
  }
  return e;
}
function renderCabAnalytics(container) {
  if (!cabShipmentsCache.some(cabIsBilled)) { container.innerHTML = cabEmptyMoney('analytics'); return; }
  const per = CAB_PERIODS.find(p => p[0] === cabAnPeriod) || CAB_PERIODS[4];
  const inRange = (s, a, b) => { const d = cabShipDate(s); return !!d && d >= a && d < b; };
  let from = null, prevFrom = null; const now = new Date();
  if (per[2]) { from = new Date(); from.setMonth(from.getMonth() - per[2]); prevFrom = new Date(from); prevFrom.setMonth(prevFrom.getMonth() - per[2]); }
  // Период — по дате отправки из названия прихода. Приходы без даты попадают только во «Всё время»
  const ships = cabShipmentsCache.filter(s => !from || inRange(s, from, new Date(now.getTime() + 864e5)));
  const prevShips = from ? cabShipmentsCache.filter(s => inRange(s, prevFrom, from)) : [];
  const seg = CAB_PERIODS.map(p => `<button class="cab-seg-b${cabAnPeriod === p[0] ? ' on' : ''}" onclick="cabSetAnPeriod('${p[0]}')">${p[1]}</button>`).join('');
  const head = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap"><div class="cab-main-title" style="margin:0">Аналитика</div><div class="cab-seg" style="margin-left:auto">${seg}</div></div>`;
  if (ships.length === 0) {
    container.innerHTML = head + `<div class="cab-stub"><i class="ti ti-chart-bar"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">За выбранный период закупок нет</div></div>`;
    return;
  }
  // Деньги — только рассортированные приходы (вес известен, суммы точные). Остальные — отдельно, как оценка
  const sum = list => list.reduce((a, s) => { const e = cabShipEcon(s); for (const k of ['due', 'goods', 'cargo', 'profit', 'rateM', 'shipM', 'items', 'kg']) a[k] += e[k]; a.n++; return a; }, { due: 0, goods: 0, cargo: 0, profit: 0, rateM: 0, shipM: 0, items: 0, kg: 0, n: 0 });
  const billed = ships.filter(cabIsBilled), open = ships.filter(s => !cabIsBilled(s));
  const T = sum(billed), O = sum(open), P = sum(prevShips.filter(cabIsBilled));
  const pctOf = (v, t) => t > 0 ? Math.round(v / t * 100) : 0;
  const rent = T.due > 0 ? T.profit / T.due * 100 : null;
  const delta = (cur, prev) => { if (!from || !(prev > 0)) return ''; const d = Math.round((cur - prev) / prev * 100); return `<span class="cab-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% к прошлому периоду</span>`; };

  // 1. Из каждых 100 BYN клиента
  const gP = pctOf(T.goods, T.due), cP = pctOf(T.cargo, T.due), mP = Math.max(0, 100 - gP - cP);
  const split = T.due > 0 ? `<div class="cab-card cab-an-split">
      <div class="cab-card-l"><i class="ti ti-coins"></i> Куда идут деньги клиентов${cabHelpBtn('an_split')}<span class="cab-an-scope">${billed.length} ${cabPl(billed.length, 'рассортированная закупка', 'рассортированные закупки', 'рассортированных закупок')}</span></div>
      <div class="cab-an-big">${cabFmt(T.due)} <small>BYN заплатят клиенты</small></div>
      <div class="cab-an-bar"><span style="flex:${T.goods};background:#a99be0"><b>${gP}%</b></span><span style="flex:${T.cargo};background:#f5c518"><b>${cP}%</b></span><span style="flex:${Math.max(0, T.profit)};background:#16a34a"><b>${mP}%</b></span></div>
      <div class="cab-an-leg">
        <div><i style="background:#a99be0"></i><span>Товар (выкуп)</span><b>${cabFmt(T.goods)} BYN</b></div>
        <div><i style="background:#f5c518"></i><span>Доставка карго</span><b>${cabFmt(T.cargo)} BYN</b></div>
        <div><i style="background:#16a34a"></i><span>Ваша наценка</span><b style="color:#16a34a">${cabFmt(T.profit)} BYN</b></div>
      </div>
      <div class="cab-an-say">Из каждых <b>100 BYN</b>, которые платит клиент: <b>${gP}</b> уходят на товар, <b>${cP}</b> — карго, <b class="g">${mP}</b> остаются вам.</div>
    </div>` : `<div class="cab-card cab-an-split"><div class="cab-card-l"><i class="ti ti-coins"></i> Куда идут деньги клиентов</div><div class="cab-an-say">За этот период ещё нет рассортированных закупок — точные суммы появятся после взвешивания.</div></div>`;

  // 2. Откуда наценка: курс или доставка
  const kpis = `<div class="cab-an-kpis">
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-receipt-2"></i> Наценка</div><div class="cab-an-kv g">${cabFmt(T.profit)} <small>BYN</small></div><div class="cab-an-ks">рентабельность ${cabPct(rent)}</div>${delta(T.profit, P.profit)}</div>
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-package"></i>Средняя закупка</div><div class="cab-an-kv">${cabFmt(T.n ? T.profit / T.n : 0)} <small>BYN наценки</small></div><div class="cab-an-ks">${cabFmt(T.n ? T.items / T.n : 0)} поз. · ${(T.n ? T.kg / T.n : 0).toFixed(0)} кг</div></div>
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-user"></i> Средний заказ клиента</div><div class="cab-an-kv">${cabFmt(billed.reduce((n, s) => n + cabShipEcon(s).n, 0) ? T.due / billed.reduce((n, s) => n + cabShipEcon(s).n, 0) : 0)} <small>BYN</small></div><div class="cab-an-ks">наценка с заказа ≈ ${cabFmt(billed.reduce((n, s) => n + cabShipEcon(s).n, 0) ? T.profit / billed.reduce((n, s) => n + cabShipEcon(s).n, 0) : 0)} BYN</div></div>
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-arrows-split"></i> Откуда наценка${cabHelpBtn('an_src')}</div>
        <div class="cab-an-src"><span style="flex:${Math.max(0, T.rateM)};background:#6C4DB8"></span><span style="flex:${Math.max(0, T.shipM)};background:#f59e0b"></span></div>
        <div class="cab-an-src-l"><span><i style="background:#6C4DB8"></i>на курсе юаня</span><b>${T.rateM >= 0 ? '+' : ''}${cabFmt(T.rateM)}</b></div>
        <div class="cab-an-src-l"><span><i style="background:#f59e0b"></i>на доставке</span><b class="${T.shipM < 0 ? 'red' : ''}">${T.shipM >= 0 ? '+' : ''}${cabFmt(T.shipM)}</b></div></div>
    </div>`;

  // 3. Наценка по закупкам: столбики, оценка штриховкой
  const chron = ships.slice().reverse();
  const ecs = chron.map(s => ({ s, e: cabShipEcon(s), b: cabIsBilled(s) }));
  const maxP = Math.max(1, ...ecs.map(x => Math.abs(x.e.profit)));
  const bars = ecs.map(({ s, e, b }) => {
    const mm = (s.name || '').match(/(\d{1,2})(?:-(\d{1,2}))?\.(\d{1,2})/), lbl = mm ? `${(mm[2] || mm[1]).padStart(2, '0')}.${mm[3].padStart(2, '0')}` : '·';
    const est = !b;
    return `<div class="cab-bar" title="${s.name || ''}: наценка ${est ? '≈ ' : ''}${cabFmt(e.profit)} BYN${est ? ' (оценка, без доставки)' : ''}, ${e.items} поз."><em class="${est ? 'est' : ''}">${est ? '≈' : '+'}${cabFmt(e.profit)}</em><span class="${est ? 'est' : ''}" style="height:${Math.max(4, Math.abs(e.profit) / maxP * 100)}%;${est ? '' : 'background:' + (e.profit >= 0 ? '#16a34a' : '#dc2626')}"></span><i>${lbl}</i></div>`;
  }).join('');
  const chart = `<div class="cab-card"><div class="cab-card-h">Наценка по закупкам<span class="cab-an-chips"><span><i style="background:#16a34a"></i>точно</span><span><i class="est"></i>оценка — ещё не взвешена</span></span></div><div class="cab-bars cab-an-bars">${bars}</div></div>`;

  // 4. Лучшие клиенты по наценке за период
  const cm = {};
  for (const s of ships) for (const p of cabShipEcon(s).per) { const k = p.name.toLowerCase(); (cm[k] = cm[k] || { name: p.name, profit: 0, due: 0, n: 0 }); cm[k].profit += p.profit; cm[k].due += p.due; cm[k].n++; }
  const top = Object.values(cm).sort((a, b) => b.profit - a.profit).slice(0, 8);
  const allProfit = Object.values(cm).reduce((n, c) => n + Math.max(0, c.profit), 0);
  const top5 = top.slice(0, 5).reduce((n, c) => n + Math.max(0, c.profit), 0);
  const maxC = Math.max(1, ...top.map(c => c.profit));
  const clientsBox = top.length ? `<div class="cab-card"><div class="cab-card-h">Кто приносит больше всего</div>
      ${top.map((c, i) => `<div class="cab-an-cl" onclick="cabNav('clients');cabOpenClient('${encodeURIComponent(c.name)}')"><b class="n">${i + 1}</b><span class="nm">${c.name}</span><span class="tr"><span style="width:${Math.max(2, c.profit / maxC * 100)}%"></span></span><span class="v">+${cabFmt(c.profit)}</span><em>${c.n} прих. · ${cabFmt(c.due)} BYN</em></div>`).join('')}
    </div>` : '';

  // 5. Выводы словами
  const tips = [];
  const best = ecs.filter(x => x.b && x.e.due > 0).sort((a, b) => b.e.profit / b.e.due - a.e.profit / a.e.due);
  if (best.length > 1) tips.push(['ti-trophy', `Самая выгодная закупка — <b>${best[0].s.name}</b>: рентабельность ${(best[0].e.profit / best[0].e.due * 100).toFixed(1)}%. Самая слабая — <b>${best[best.length - 1].s.name}</b>: ${(best[best.length - 1].e.profit / best[best.length - 1].e.due * 100).toFixed(1)}%.`]);
  const lowShip = ecs.filter(x => x.b && x.e.cargo > 0 && x.e.shipM < 0);
  if (lowShip.length) tips.push(['ti-alert-triangle', `На доставке вы теряете в ${lowShip.length} ${cabPl(lowShip.length, 'закупке', 'закупках', 'закупках')} (${lowShip.slice(0, 3).map(x => x.s.name).join(', ')}): карго обходится дороже, чем платят клиенты. Проверьте «Доставку клиенту» в Ценах или «вес в цене».`]);
  if (allProfit > 0 && Object.keys(cm).length > 8) tips.push(['ti-users', `5 лучших клиентов приносят <b>${Math.round(top5 / allProfit * 100)}%</b> наценки. ${top5 / allProfit > 0.5 ? 'Берегите их — это ваши чемпионы.' : 'Доход распределён ровно — хорошая устойчивость.'}`]);
  if (T.items > 0 && T.kg > 0 && T.cargo > 0) tips.push(['ti-weight', `Средний товар весит <b>${(T.kg / T.items).toFixed(2)} кг</b> — доставка карго одной позиции обходится вам ≈ <b>${cabFmt2(T.cargo / T.items)} BYN</b>.`]);
  if (O.n) tips.push(['ti-truck', `Ещё ${O.n} ${cabPl(O.n, 'закупка', 'закупки', 'закупок')} в пути и в сборке: ≈ ${cabFmt(O.profit)} BYN наценки без учёта доставки. В итоги выше они не входят.`]);
  const tipsBox = tips.length ? `<div class="cab-card cab-an-tips"><div class="cab-card-h"><i class="ti ti-bulb" style="color:#eab308;margin-right:6px"></i>Что видно из цифр</div>${tips.map(([ic, t]) => `<div class="cab-an-tip"><i class="ti ${ic}"></i><span>${t}</span></div>`).join('')}</div>` : '';

  container.innerHTML = head + split + (billed.length ? kpis : '') + chart + `<div class="cab-an-two">${clientsBox}${tipsBox}</div>`;
}

// ============ НАСТРОЙКИ ============
function renderCabSettings(container) {
  // Настройки Кабинета (03.11.2026) — всё, что есть в мобильной: имя, почта, валюта, тема, пароль, помощь, расширение, выход
  const currency = (userProfile && userProfile.currency) || 'BYN';
  const name = (userProfile && userProfile.name) || '';
  const email = currentUser ? currentUser.email : '';
  const ver = currentUser ? currentUser.emailVerified : false;
  const dark = document.body.classList.contains('dark');
  const created = cabToDate(userProfile && userProfile.created) || (currentUser && currentUser.metadata ? new Date(currentUser.metadata.creationTime) : null);
  const A = typeof pkAccess === 'function' ? pkAccess(userProfile) : {};
  const plan = A.kind === 'admin' ? 'Администратор' : A.kind === 'sub' ? (typeof PK_PLANS !== 'undefined' && PK_PLANS[(userProfile.subscription || {}).plan] ? PK_PLANS[userProfile.subscription.plan].n : 'Подписка') + (A.end ? ' · до ' + A.end.toLocaleDateString('ru-RU') : '')
    : A.kind === 'trial' ? 'Пробный период' + (A.end ? ' · до ' + A.end.toLocaleDateString('ru-RU') : '') : A.kind === 'grace' ? 'Нужно оплатить' : A.kind === 'readonly' ? 'Только просмотр' : '—';
  const tips = typeof pkTourMenuOn === 'function' && pkTourMenuOn();
  const row = (l, v) => `<div class="cab-set-row"><span class="cab-set-l">${l}</span><div class="cab-set-v">${v}</div></div>`;
  container.innerHTML = `
    <div class="cab-main-title">Настройки</div>
    <div class="cab-set">
    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-user" style="margin-right:6px"></i>Профиль</div>
      ${row('Имя', `<input id="cabSetName" value="${cabEsc(name)}" maxlength="60" class="cab-set-in"><button type="button" class="cab-set-btn" onclick="cabSaveName()">Сохранить</button><span id="cabSetNameMsg" class="cab-set-msg"></span>`)}
      ${row('Почта', `<span>${cabEsc(email)}</span> ${ver ? '<span class="cab-set-ok"><i class="ti ti-circle-check"></i> подтверждена</span>' : `<span class="cab-set-warn">не подтверждена</span> <button type="button" class="cab-set-btn" onclick="cabSendVerify(this)">Отправить письмо</button>`}`)}
      ${row('Валюта', `<select id="cabSetCur" class="cab-set-in" style="max-width:280px" onchange="cabSaveCurrency(this.value)">${[['BYN', 'BYN — белорусский рубль'], ['RUB', 'RUB — российский рубль'], ['KZT', 'KZT — казахстанский тенге']].map(([k, l]) => `<option value="${k}" ${currency === k ? 'selected' : ''}>${l}</option>`).join('')}</select><span id="cabSetCurMsg" class="cab-set-msg"></span>`)}
      ${row('Тариф', `<span>${plan}</span> <a href="#" onclick="cabNav('tariffs');return false" class="cab-set-link">Тариф и оплата →</a>`)}
      ${created ? row('В Piksta с', created.toLocaleDateString('ru-RU')) : ''}
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-palette" style="margin-right:6px"></i>Оформление</div>
      ${row('Тема', `<div class="cab-set-seg"><button type="button" class="${dark ? '' : 'on'}" onclick="cabSetTheme(false)"><i class="ti ti-sun"></i> Светлая</button><button type="button" class="${dark ? 'on' : ''}" onclick="cabSetTheme(true)"><i class="ti ti-moon"></i> Тёмная</button></div>`)}
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-lock" style="margin-right:6px"></i>Пароль</div>
      ${row('Новый пароль', `<input id="cabSetP1" type="password" autocomplete="new-password" placeholder="минимум 6 символов" class="cab-set-in">`)}
      ${row('Ещё раз', `<input id="cabSetP2" type="password" autocomplete="new-password" class="cab-set-in"><button type="button" class="cab-set-btn" onclick="cabChangePass()">Сменить пароль</button><span id="cabSetPMsg" class="cab-set-msg"></span>`)}
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title"><i class="ti ti-help-circle" style="margin-right:6px"></i>Помощь и связь</div>
      <div style="font-size:14px;color:#4a5260;line-height:1.6;margin-bottom:12px">Вопросы по работе, видеоуроки по интерфейсу, ошибки — пишите, ответим.</div>
      <div class="cab-set-help">
        <span class="cab-set-hb doc soon" aria-disabled="true" title="Инструкцию обновляем под новые функции"><i class="ti ti-book"></i> Инструкция Piksta<em>скоро появится</em></span>
        <a class="cab-set-hb tg" href="https://t.me/piksta_support_bot" target="_blank" rel="noopener"><i class="ti ti-brand-telegram"></i> Telegram · @piksta_support_bot</a>
        <a class="cab-set-hb" href="mailto:support@piksta.online"><i class="ti ti-mail"></i> support@piksta.online</a>
        ${tips ? `<button type="button" class="cab-set-hb" onclick="pkTourStart('c')"><i class="ti ti-route"></i> Подсказки по интерфейсу</button>` : ''}
      </div>
    </div>
    <div class="cab-table-wrap" style="margin-top:16px">
      <div class="cab-table-title"><i class="ti ti-puzzle" style="margin-right:6px"></i>Расширение для Chrome</div>
      <div style="font-size:14px;color:#4a5260;line-height:1.6;margin-bottom:12px">Импорт заказов из Pinduoduo, Taobao и 1688 в закупку — с фото, ценами и сверкой с файлом карго. Ставится один раз; обновление — так же, новой папкой.</div>
      <a href="/extension" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:#6C4DB8;color:#fff;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:500;text-decoration:none"><i class="ti ti-download" style="font-size:18px"></i> Скачать расширение</a>
      <ol style="font-size:14px;color:#4a5260;line-height:1.7;margin:12px 0 0;padding-left:20px">
        <li>Распакуйте архив — получится папка с расширением.</li>
        <li>Откройте в Chrome адрес <span style="font-family:monospace;color:#6C4DB8">chrome://extensions</span> и включите «Режим разработчика» (справа вверху).</li>
        <li>«Загрузить распакованное» → выберите папку. Старую версию, если была, удалите — данные не пропадут.</li>
      </ol>
    </div>
    <button type="button" class="cab-set-out" onclick="exitCabinet()"><i class="ti ti-logout"></i> Выйти из аккаунта</button>
    </div>`;
}
const cabSetMsg = (id, t, ok) => { const m = document.getElementById(id); if (!m) return; m.textContent = t; m.className = 'cab-set-msg ' + (ok ? 'ok' : 'bad'); if (ok) setTimeout(() => { if (m.textContent === t) m.textContent = ''; }, 2500); };
async function cabSaveName() {
  const v = (document.getElementById('cabSetName').value || '').trim(); if (!v) return cabSetMsg('cabSetNameMsg', 'Впишите имя', false);
  try {
    await currentUser.updateProfile({ displayName: v });
    await db.collection('users').doc(currentUser.uid).update({ name: v });
    userProfile.name = v;
    const u = document.getElementById('cabUserName'); if (u) u.textContent = v;
    const b = document.getElementById('userBadgeName'); if (b) b.textContent = v;
    cabSetMsg('cabSetNameMsg', 'Сохранено', true);
  } catch (e) { cabSetMsg('cabSetNameMsg', 'Не сохранилось: ' + e.message, false); }
}
async function cabSaveCurrency(v) {
  userProfile.currency = v;
  const sel = document.getElementById('profileCurrency'); if (sel) sel.value = v;
  try { await db.collection('users').doc(currentUser.uid).update({ currency: v }); cabSetMsg('cabSetCurMsg', 'Сохранено', true); }
  catch (e) { cabSetMsg('cabSetCurMsg', 'Не сохранилось', false); }
}
function cabSetTheme(dark) {
  document.body.classList.toggle('dark', !!dark);
  const t = document.getElementById('themeToggle'); if (t) t.checked = !!dark;
  if (userProfile) userProfile.theme = dark ? 'dark' : 'light';
  try { db.collection('users').doc(currentUser.uid).update({ theme: dark ? 'dark' : 'light' }).catch(() => {}); } catch (e) {}
  renderCabSettings(document.getElementById('cabMain'));
}
async function cabChangePass() {
  const p1 = document.getElementById('cabSetP1').value, p2 = document.getElementById('cabSetP2').value;
  if (p1.length < 6) return cabSetMsg('cabSetPMsg', 'Минимум 6 символов', false);
  if (p1 !== p2) return cabSetMsg('cabSetPMsg', 'Пароли не совпадают', false);
  try { await currentUser.updatePassword(p1); document.getElementById('cabSetP1').value = ''; document.getElementById('cabSetP2').value = ''; cabSetMsg('cabSetPMsg', 'Пароль изменён', true); }
  catch (e) { cabSetMsg('cabSetPMsg', e.code === 'auth/requires-recent-login' ? 'Для смены пароля выйдите и войдите заново' : 'Ошибка: ' + e.message, false); }
}
async function cabSendVerify(btn) {
  btn.disabled = true;
  try { await currentUser.sendEmailVerification({ url: location.origin + '/app' }); btn.textContent = 'Письмо отправлено'; }
  catch (e) { btn.disabled = false; btn.textContent = e.code === 'auth/too-many-requests' ? 'Попробуйте позже' : 'Ошибка'; }
}

// ============ ТАРИФ ============
// Сетка из «Piksta/Тарифы/piksta-tariffs.json» (утверждено 29.10.2026). Цены — в ₽, итоговые суммы за период (не формула).
// Все функции во всех тарифах; тарифы отличаются только объёмом треков в месяц. Превышение лимита ничего не блокирует.
const PIKSTA_TARIFFS = {
  periods: [[1, 'Месяц', 0], [3, '3 месяца', 10], [6, '6 месяцев', 15], [12, 'Год', 25]],
  defaultPeriod: 12,
  tiers: [
    { id: 'start', name: 'Старт', tracks: 300, rub: { 1: 390, 3: 1050, 6: 1990, 12: 3510 } },
    { id: 'main', name: 'Основной', tracks: 1000, rub: { 1: 690, 3: 1860, 6: 3520, 12: 6210 }, recommended: true },
    { id: 'pro', name: 'Профи', tracks: 3000, rub: { 1: 1190, 3: 3210, 6: 6070, 12: 10710 } },
    { id: 'enterprise', name: 'Крупный / карго', tracks: null, rub: null }
  ],
  // ЧЕРНОВИК состава тарифов (обсуждается, ограничения в коде пока не включены): [название, в каких тарифах]
  features: [
    ['Импорт треков из Pinduoduo', ['start', 'main', 'pro']],
    ['Сканер с фото товара', ['start', 'main', 'pro']],
    ['Картинки без интернета', ['start', 'main', 'pro']],
    ['Клиенты и взвешивание', ['start', 'main', 'pro']],
    ['Расчёт по клиентам и PDF', ['start', 'main', 'pro']],
    ['Учёт оплат и долгов', ['main', 'pro']],
    ['Себестоимость и прибыль', ['main', 'pro']],
    ['Аналитика по периодам', ['main', 'pro']],
    ['«Вложено в товар», дубли', ['main', 'pro']],
    ['Таможенная опись', ['pro']],
    ['Второй пользователь', ['pro']],
    ['Выгрузка в Excel', ['pro']],
    ['Новинки первыми, поддержка', ['pro']]
  ],
  founderDiscountPct: 30,  // цена первых клиентов (участники пилота, userProfile.founder) — пока подписка без перерыва
  trialDays: 30,           // тест для новых; участникам пилота (founder) — 90. Источник истины — PK_TRIAL_DAYS в init.js и правила Firestore
  tg: 'piksta_support_bot',
  email: 'support@piksta.online'
};
const PIKSTA_COUNTRIES = { BY: 'Беларусь', RU: 'Россия', KZ: 'Казахстан', OT: 'Другая' };
let cabTariffPeriod = PIKSTA_TARIFFS.defaultPeriod;

// Доступ пользователя: общий расчёт pkAccess (init.js) — тот же, что баннер сканера и правила Firestore
function cabAccessInfo() { return pkAccess(userProfile); }

// Плашка в боковом меню Кабинета: 5 дней льготы / только просмотр / заблокирован
function cabAccessMark() {
  const nav = document.getElementById('cabNav'); if (!nav) return;
  let el = document.getElementById('cabAccess');
  const A = pkAccess(userProfile);
  const d = x => x.toLocaleDateString('ru-RU');
  const ended = A.from === 'sub' ? 'Подписка закончилась' : 'Тест закончился';
  const m = A.kind === 'grace' ? { c: '#dc2626', bg: '#fef2f2', i: 'ti-alert-triangle', t: ended, s: `${d(A.end)}. Всё работает ещё ${A.left} ${cabDaysWord(A.left)} — до ${d(A.until)}, потом только просмотр` }
    : A.kind === 'readonly' ? { c: '#4a5260', bg: '#f3f4f6', i: 'ti-lock', t: 'Только просмотр', s: `${ended} ${d(A.end)}. Данные сохранены, изменения недоступны` }
    : A.kind === 'blocked' ? { c: '#4a5260', bg: '#f3f4f6', i: 'ti-lock', t: 'Доступ ограничен', s: 'Только просмотр. Обратитесь в техподдержку' } : null;
  if (!m) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'cabAccess'; nav.after(el); }
  el.style.cssText = `margin:10px 12px;padding:10px 12px;border-radius:10px;background:${m.bg};color:${m.c};font-size:12px;line-height:1.35;cursor:pointer;white-space:normal;overflow:visible;flex-shrink:0`;
  el.onclick = () => cabNav('tariffs');
  el.innerHTML = `<div style="font-weight:600;font-size:13px;margin-bottom:2px;white-space:normal"><i class="ti ${m.i}" style="vertical-align:-2px"></i> ${m.t}</div><div style="white-space:normal">${m.s}</div>`;
}

function cabDaysWord(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  return (a > 10 && a < 20) ? 'дней' : b === 1 ? 'день' : (b >= 2 && b <= 4) ? 'дня' : 'дней';
}

// Объём: число треков по месяцам. Дата трека — дата заказа (ts из расширения), иначе дата создания прихода. Только количество.
function cabTrackVolume() {
  const now = new Date();
  const key = d => d.getFullYear() + '-' + d.getMonth();
  const cur = key(now), prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1), prev = key(prevD);
  let nCur = 0, nPrev = 0;
  for (const ship of cabShipmentsCache) {
    const sc = ship.created ? new Date(ship.created) : null;
    for (const row of (ship.data || [])) {
      const ts = !Array.isArray(row) && row && row.ts ? Number(row.ts) : 0;
      const d = ts ? new Date(ts * 1000) : sc;
      if (!d || isNaN(d)) continue;
      const k = key(d);
      if (k === cur) nCur++; else if (k === prev) nPrev++;
    }
  }
  const mName = d => d.toLocaleDateString('ru-RU', { month: 'long' });
  return { nCur, nPrev, curName: mName(now), prevName: mName(prevD) };
}
function cabTierFor(n) { return PIKSTA_TARIFFS.tiers.find(t => t.tracks === null || n <= t.tracks); }
const cabRub = v => cabFmt(v) + ' ₽';
function cabSetTariffPeriod(m) { cabTariffPeriod = m; renderCabTariffs(document.getElementById('cabMain')); }

// Тариф в Кабинете (03.11.2026): те же цены, тарифы, оплата и история, что в мобильной «Тариф и оплата» (js/mtariff.js).
// Срок — только месяц или год. Оплата открывается окном поверх Кабинета (шаги из mtariff.js: срок и способ → реквизиты и скрин).
const CAB_TF_FEATS = [
  ['Мобильная версия: сканер, закупки, клиенты, оплаты', ['start', 'main', 'pro']],
  ['Импорт заказов из Pinduoduo, Taobao и 1688', ['start', 'main', 'pro']],
  ['Кабинет на компьютере', ['main', 'pro']],
  ['Аналитика бизнеса', ['pro']],
  ['Telegram-бот и общение с клиентами', ['pro']]
];
const cabInCabinet = () => { const c = document.getElementById('cabinetScreen'); return !!(c && c.classList.contains('show')); };
function cabTfPick(k) { pkTfSel = k; document.querySelectorAll('.ctf-card').forEach(el => el.classList.toggle('sel', el.dataset.k === k)); }
function cabTfPer(p) { pkTPer = p; renderCabTariffs(document.getElementById('cabMain')); }
function cabTfPay(k) {
  document.body.classList.add('pk-cabpay');
  let bk = document.getElementById('cabPayBk');
  if (!bk) { bk = document.createElement('div'); bk.id = 'cabPayBk'; bk.className = 'cab-paybk'; bk.onclick = () => cabTfPayClose(); document.body.appendChild(bk); }
  pkPayStart(k);
}
function cabTfPayClose() {
  try { pkPayS = null; } catch (e) {}   // иначе догрузка курсов снова откроет окно оплаты
  if (typeof pkScrClose === 'function') pkScrClose();
  document.body.classList.remove('pk-cabpay');
  if (cabInCabinet() && cabCurrentSection === 'tariffs') renderCabTariffs(document.getElementById('cabMain'));
}
function renderCabTariffs(container) {
  if (!container) return;
  if (typeof pkTP !== 'function') { container.innerHTML = '<div class="cab-main-title">Тариф</div><p>Загрузка…</p>'; return; }
  if (!cabTfLoaded) { cabTfLoaded = true; Promise.all([pkLoadGeo(), pkLoadRates()]).then(() => { if (cabCurrentSection === 'tariffs' && !cabShipId) renderCabTariffs(document.getElementById('cabMain')); }); }
  const { A, sub, plan } = pkPlanNow();
  const T = pkTracks(), vol = Math.max(T.cur, T.prev), cur = pkGeoCur(), P = pkTP(cur), y = pkTPer === 'y';
  const rec = plan && PK_PLANS[plan].lim >= vol ? plan : pkFitPlan(vol), sel = pkTfSel || rec;
  const d = x => x ? x.toLocaleDateString('ru-RU') : '';
  // шапка: что сейчас
  let ic = 'ti-hourglass', tone = 'acc', title = '', text = '', bar = '';
  if (A.kind === 'admin') { ic = 'ti-shield-check'; title = 'Администратор'; text = 'Тарифы не действуют. Проверять оплату — с тестового аккаунта.'; }
  else if (A.kind === 'trial') {
    const tot = (userProfile && userProfile.founder) ? 90 : 30, pct = Math.max(4, Math.min(100, A.left / tot * 100));
    title = `Пробный период · осталось ${A.left} ${cabDaysWord(A.left)}`; text = `До ${d(A.end)}. Открыто всё, как в «Основном». Треков в ${PK_MON_IN[new Date().getMonth()]}: ${pkN(T.cur)}`;
    bar = `<div class="ctf-bar"><span style="width:${pct}%"></span></div>`;
  } else if (A.kind === 'sub') {
    const U = pkUsage(), lim = U.lim, pct = lim === Infinity ? 0 : Math.min(100, U.n / lim * 100);
    ic = 'ti-circle-check'; tone = 'ok'; title = `${PK_PLANS[plan].n} · до ${d(A.end)}`;
    text = `Треков с ${d(U.P.start)} по ${d(U.P.last)}: ${pkN(U.n)}${lim === Infinity ? ' · без лимита' : ' из ' + pkN(lim)} · осталось ${A.left} ${cabDaysWord(A.left)}`;
    if (lim !== Infinity) bar = `<div class="ctf-bar ${U.state === 'ok' ? '' : U.state === 'warn' ? 'warn' : 'bad'}"><span style="width:${Math.max(3, pct)}%"></span></div>`;
  } else if (A.kind === 'grace') { ic = 'ti-alert-triangle'; tone = 'bad'; title = `${A.from === 'sub' ? 'Подписка закончилась' : 'Пробный период закончился'} ${d(A.end)}`; text = `Ещё ${A.left} ${cabDaysWord(A.left)} всё работает, потом — только просмотр. Данные никуда не денутся.`; }
  else if (A.kind === 'readonly') { ic = 'ti-lock'; tone = 'mut'; title = 'Только просмотр'; text = 'Оплатите тариф — и всё снова заработает. Данные сохранены.'; }
  else { ic = 'ti-lock'; tone = 'mut'; title = 'Доступ ограничен'; text = 'Напишите в поддержку.'; }
  let note = '';
  const pend = sub.pending, rej = sub.rejected;
  if (pend) note = `<div class="ctf-note wait"><i class="ti ti-clock"></i><div><b>Оплата на проверке: «${PK_PLANS[pend.plan] ? PK_PLANS[pend.plan].n : ''}» · ${pend.period === 'y' ? 'год' : 'месяц'} · ${pkN(pend.amount)} ${pkEsc(pend.cur)}</b><span>Отправлено ${d(pkToDate(pend.at))}. Пока проверяем — всё работает как раньше.</span></div></div>`;
  else if (rej && (!sub.history || !sub.history.length || pkToDate(rej.rejectedAt) > pkToDate(sub.history[sub.history.length - 1].at)))
    note = `<div class="ctf-note bad"><i class="ti ti-alert-circle"></i><div><b>Оплата от ${d(pkToDate(rej.at))} не подтверждена</b><span>Напишите в поддержку — <a href="https://t.me/piksta_support_bot" target="_blank" rel="noopener">@piksta_support_bot</a>, разберёмся.</span></div></div>`;
  // карточки тарифов
  const cards = ['start', 'main', 'pro'].map(k => {
    const [m, yr] = P[k], save = m * 12 - yr, isCur = k === plan, isRec = k === rec;
    // (05.11.2026, Егор) как в мобильной: «За год» — крупно сколько в месяц при оплате за год, ниже сумма за год и выгода
    const big = y ? `<span class="ctf-pr">${pkN(pkMo(yr, cur))}<small> ${P.s} / мес</small></span>` : `<span class="ctf-pr">${pkN(m)}<small> ${P.s} / мес</small></span>`;
    const line = y ? `<div class="ctf-y ok">при оплате за год — ${pkN(yr)}&nbsp;${P.s}<br>выгода ${pkN(save)}&nbsp;${P.s}</div>` : `<div class="ctf-y">или ${pkN(yr)} ${P.s} за год — выгода ${pkN(save)} ${P.s}</div>`;
    const feats = CAB_TF_FEATS.map(([f, on]) => on.includes(k) ? `<li><i class="ti ti-check"></i>${f}</li>` : `<li class="off"><i class="ti ti-minus"></i>${f}</li>`).join('');
    const lim = PK_PLANS[k].lim === Infinity ? 'Без лимита по трекам' : `До ${pkN(PK_PLANS[k].lim)} треков в месяц`;
    return `<div class="ctf-card ${k === sel ? 'sel' : ''}" data-k="${k}" onclick="cabTfPick('${k}')">
      ${isCur ? '<span class="ctf-tag cur">Ваш тариф</span>' : isRec ? '<span class="ctf-tag">Подходит вам</span>' : ''}
      <div class="ctf-name">${PK_PLANS[k].n}</div>
      <div class="ctf-lim">${lim}</div>
      ${big}${line}
      <ul class="ctf-feats">${feats}</ul>
      <button type="button" class="ctf-btn" onclick="event.stopPropagation();cabTfPay('${k}')">${isCur ? 'Продлить' : 'Оплатить'} «${PK_PLANS[k].n}»</button>
    </div>`;
  }).join('');
  const hist = (sub.history || []).slice().reverse().slice(0, 12);
  const histHtml = hist.length ? `<div class="cab-table-wrap ctf-hist"><div class="cab-table-title">История оплат</div><table class="cab-table"><thead><tr><th>Дата</th><th>Тариф</th><th>Срок</th><th style="text-align:right">Сумма</th></tr></thead><tbody>${hist.map(h => `<tr><td>${d(pkToDate(h.at))}</td><td>${PK_PLANS[h.plan] ? PK_PLANS[h.plan].n : ''}</td><td>${h.period === 'y' ? 'год' : 'месяц'}${h.end ? ' · до ' + d(pkToDate(h.end)) : ''}</td><td style="text-align:right;font-weight:600">${pkHistAmt(h)}</td></tr>`).join('')}</tbody></table></div>` : '';
  container.innerHTML = `<div class="ctf">
    <div class="cab-main-title">Тариф и оплата</div>
    <div class="ctf-now ${tone}"><i class="ti ${ic}"></i><div class="ctf-now-b"><b>${title}</b><span>${text}</span>${bar}</div>
      <div class="ctf-vol"><div><span>Треков в этом месяце</span><b>${pkN(T.cur)}</b></div><div><span>в прошлом</span><b>${pkN(T.prev)}</b></div></div></div>
    ${note}
    <div class="ctf-seg-row"><div class="ctf-seg"><button type="button" class="${!y ? 'on' : ''}" onclick="cabTfPer('m')">Помесячно</button><button type="button" class="${y ? 'on' : ''}" onclick="cabTfPer('y')">За год · выгоднее</button></div>
      <span class="ctf-cur">Цены в валюте вашей страны · <button type="button" onclick="cabTfCur()">${PK_SYM[cur]} <i class="ti ti-chevron-down"></i></button></span></div>
    <div class="ctf-cards">${cards}</div>
    ${histHtml}
    <p class="ctf-foot">Оплата — ЕРИП, карта, Alipay или USDT, способы зависят от страны. После оплаты прикрепите скрин — проверим и включим тариф, обычно в течение пары часов. Вопросы — <a href="https://t.me/piksta_support_bot" target="_blank" rel="noopener">@piksta_support_bot</a></p>
  </div>`;
}
let cabTfLoaded = false;
function cabTfCur() {
  const c = pkGeoCur();
  const pick = k => { try { localStorage.setItem('pk_cur', k); } catch (e) {} renderCabTariffs(document.getElementById('cabMain')); };
  const old = document.getElementById('ctfCurMenu'); if (old) { old.remove(); return; }
  const btn = document.querySelector('.ctf-cur button'); if (!btn) return;
  const m = document.createElement('div'); m.id = 'ctfCurMenu'; m.className = 'ctf-curmenu';
  m.innerHTML = ['BYN', 'RUB', 'KZT'].map(k => `<button type="button" data-k="${k}" class="${c === k ? 'on' : ''}">${{ BYN: 'Белорусские рубли', RUB: 'Российские рубли', KZT: 'Тенге' }[k]}<small>${PK_SYM[k]}</small></button>`).join('');
  m.onclick = e => { const b = e.target.closest('button'); if (b) pick(b.dataset.k); };
  btn.parentElement.appendChild(m);
  setTimeout(() => document.addEventListener('click', function f(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', f); } }), 0);
}

// Прежний вид тарифа (до 03.11.2026) — не используется, оставлен на время
function renderCabTariffsOld(container) {
  const T = PIKSTA_TARIFFS;
  const A = cabAccessInfo();
  const d = x => x.toLocaleDateString('ru-RU');
  const st = {
    admin:   { icon: 'ti-shield-check', color: '#6C4DB8', bg: '#f0ecf9', title: 'Администратор', text: 'Доступ без ограничений' },
    sub:     { icon: 'ti-circle-check', color: '#16a34a', bg: '#f0fdf4', title: 'Подписка активна', text: A.end ? `До ${d(A.end)} · осталось ${A.left} ${cabDaysWord(A.left)}` : '' },
    trial:   { icon: 'ti-hourglass',    color: '#ea580c', bg: '#fff7ed', title: 'Пробный период', text: A.end ? `До ${d(A.end)} · осталось ${A.left} ${cabDaysWord(A.left)}` : '' },
    grace:   { icon: 'ti-alert-triangle', color: '#dc2626', bg: '#fef2f2', title: A.from === 'sub' ? 'Подписка закончилась' : 'Пробный период закончился', text: A.end ? `${d(A.end)} · всё работает ещё ${A.left} ${cabDaysWord(A.left)} (до ${A.until ? d(A.until) : ''}), потом только просмотр` : '' },
    readonly:{ icon: 'ti-lock',         color: '#4a5260', bg: '#f3f4f6', title: 'Только просмотр', text: A.end ? `${A.from === 'sub' ? 'Подписка закончилась' : 'Пробный период закончился'} ${d(A.end)} · данные сохранены, изменения недоступны` : '' },
    blocked: { icon: 'ti-lock',         color: '#4a5260', bg: '#f3f4f6', title: 'Доступ ограничен', text: 'Только просмотр · обратитесь в техподдержку' }
  }[A.kind];
  const V = cabTrackVolume();
  const vol = Math.max(V.nCur, V.nPrev);
  const fit = cabTierFor(vol);
  const sub = (userProfile && userProfile.subscription) || {};
  const curTier = A.kind === 'sub' ? sub.tier : null;
  const founder = !!(userProfile && userProfile.founder);
  const k = founder ? (100 - T.founderDiscountPct) / 100 : 1;
  const per = T.periods.find(p => p[0] === cabTariffPeriod) || T.periods[3];
  const round10 = v => Math.round(v / 10) * 10;

  const periodBtns = T.periods.map(p => `<button class="cab-filter-btn ${p[0] === per[0] ? 'active' : ''}" onclick="cabSetTariffPeriod(${p[0]})">${p[1]}${p[2] ? ` <span class="cab-period-off">−${p[2]}%</span>` : ''}</button>`).join('');

  // «Крупный / карго» видят только те, кому админ включил индивидуальный тариф (users/{uid}.individual)
  const tiers = T.tiers.filter(t => t.rub || (userProfile && userProfile.individual));
  const cards = tiers.map(t => {
    const isFit = vol > 0 && fit && fit.id === t.id;
    const flags = [];
    if (curTier === t.id) flags.push('<span class="cab-plan-badge cur">Ваш тариф</span>');
    else if (t.recommended) flags.push('<span class="cab-plan-badge">Рекомендуем</span>');
    const limit = t.tracks ? `до ${cabFmt(t.tracks)} треков в месяц` : `больше ${cabFmt(T.tiers[T.tiers.length - 2].tracks)} треков`;
    let price;
    if (!t.rub) price = `<div class="cab-plan-price" style="font-size:24px">Индивидуально</div><div class="cab-plan-note"><a href="https://t.me/${T.tg}" target="_blank" rel="noopener" style="color:#6C4DB8;text-decoration:none;font-weight:500">Обсудить в Telegram</a></div>`;
    else {
      // Крупно — цена в месяц (главное, что видит человек), мелко — сумма за весь срок
      const full = t.rub[per[0]];
      const pay = founder ? round10(full * k) : full;
      const month = Math.round(pay / per[0]);
      const base = t.rub[1];                       // обычная цена месяца без скидок
      const old = month < base ? `<span class="cab-plan-old">${cabRub(base)}</span>` : '';
      price = `<div class="cab-plan-price">${cabRub(month)}</div>
        <div class="cab-plan-sub">в месяц ${old}</div>
        <div class="cab-plan-note">${per[0] === 1 ? 'оплата помесячно' : `<b>${cabRub(pay)}</b> при оплате за ${per[0] === 12 ? 'год' : per[1].toLowerCase()}`}</div>`;
    }
    return `<div class="cab-plan${(curTier === t.id) ? ' current' : t.recommended && !curTier ? ' rec' : ''}">
      <div class="cab-plan-head"><span class="cab-plan-title">${t.name}</span>${flags.join('')}</div>
      <div class="cab-plan-limit">${limit}</div>
      <div class="cab-plan-body">${price}</div>
      <div class="cab-plan-foot">${isFit ? '<span class="cab-plan-fit"><i class="ti ti-check"></i> Под ваш объём</span>' : ''}</div>
      ${t.rub ? `<ul class="cab-plan-feats">${T.features.map(([f, tiersIn]) => tiersIn.includes(t.id)
        ? `<li><i class="ti ti-check"></i>${f}</li>` : `<li class="off"><i class="ti ti-minus"></i>${f}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');

  const acc = (currentUser && currentUser.email) || '';
  const mailSubj = encodeURIComponent('Piksta — оплата подписки');
  const mailBody = encodeURIComponent(`Здравствуйте! Хочу оплатить подписку Piksta.\nАккаунт: ${acc}\nТариф: ${fit ? fit.name : ''}\nСрок: ${per[1]}`);
  const country = userProfile && userProfile.country ? PIKSTA_COUNTRIES[userProfile.country] : '';

  container.innerHTML = `
    <div class="cab-main-title">Тариф</div>
    <div class="cab-access" style="background:${st.bg}">
      <i class="ti ${st.icon}" style="color:${st.color}"></i>
      <div><div class="cab-access-title" style="color:${st.color}">${st.title}</div><div class="cab-access-text">${st.text}</div></div>
      <div class="cab-access-vol">
        <div><span>${V.curName}</span><b>${cabFmt(V.nCur)}</b></div>
        <div><span>${V.prevName}</span><b>${cabFmt(V.nPrev)}</b></div>
        <div class="cab-access-vol-l">треков в месяц</div>
      </div>
    </div>
    <div class="cab-filter-row" style="align-items:center">${periodBtns}
      ${userProfile && userProfile.role === 'admin' ? '<span style="margin-left:auto;font-size:13px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:3px 8px">Состав тарифов — черновик, видят все; ограничения пока не включены</span>' : ''}</div>
    ${founder ? `<div class="cab-founder"><i class="ti ti-star"></i> Цена первых клиентов: −${T.founderDiscountPct}% навсегда, пока подписка продлевается без перерыва</div>` : ''}
    <div class="cab-plans" style="grid-template-columns:repeat(${tiers.length},minmax(0,1fr))">${cards}</div>
    <div class="cab-table-wrap">
      <div class="cab-table-title">Как оплатить</div>
      <div class="cab-pay-text">Онлайн-оплата пока не подключена. Напишите нам: пришлём сумму${country ? ` для страны «${country}»` : ''} и способ оплаты,</div>
      <div class="cab-pay-text">после оплаты продлим доступ. Цены в рублях, BYN и KZT — по курсу на день оплаты. Ваш аккаунт: <b>${acc || '—'}</b></div>
      <div class="cab-pay-text" style="color:#6b7280">Если треков стало больше лимита — работа не останавливается, мы просто предложим тариф выше.</div>
      <div class="cab-pay-btns">
        <a class="cab-pay-btn primary" href="https://t.me/${T.tg}" target="_blank" rel="noopener"><i class="ti ti-brand-telegram"></i> Написать в Telegram</a>
        <a class="cab-pay-btn" href="mailto:${T.email}?subject=${mailSubj}&body=${mailBody}"><i class="ti ti-mail"></i> ${T.email}</a>
      </div>
    </div>`;
}

// ============ АДМИНИСТРИРОВАНИЕ (пользователи Piksta, как в мобильной) ============
function cabToDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (typeof v === 'object' && v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

// Список пользователей: поиск по e-mail/имени, фильтры, выбор галочками, письмо выбранным
let cabAdminUsers = [], cabAdminQ = '', cabAdminF = 'all';
const cabAdminSel = new Set();
const CAB_ADMIN_FILTERS = [
  ['all', 'Все'], ['trial', 'Пробный'], ['sub', 'Подписка'], ['soon', 'Скоро конец (≤7 дн.)'],
  ['grace', '5 дней на оплату'], ['readonly', 'Только просмотр'], ['unpaid', 'Не оплатили'], ['blocked', 'Заблокированы'], ['pilot', 'Пилот']
];

async function cabLoadAdminUsers(box) {
  if (!box) return;
  try {
    let docs;
    try {
      const snap = await Promise.race([db.collection('users').get(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
      docs = snap.docs;
    } catch (e) { docs = await fsList('users'); }
    const users = docs.map(d => ({ id: d.id, ...d.data() })).filter(u => (u.role || 'user') === 'user'); // без админа и служебного аккаунта бота
    await Promise.all(users.map(async u => {
      u._acc = pkAccess(u);
      u._ships = '—'; u._items = '—';
      try {
        const ss = await db.collection('users').doc(u.id).collection('shipments').get();
        u._ships = ss.size;
        const sd = ss.docs.map(d => d.data());
        u._items = sd.reduce((n, d) => n + ((d.data || []).length), 0);  // только число позиций, для статистики тарифов
        if (typeof pkUsageOf === 'function') u._use = pkUsageOf(u, sd);   // треки за текущий период тарифа
      } catch (e) {}
    }));
    users.sort((a, b) => (cabToDate(b.created) || 0) - (cabToDate(a.created) || 0));
    cabAdminUsers = users;
    for (const id of [...cabAdminSel]) if (!users.some(u => u.id === id)) cabAdminSel.delete(id);
    box.innerHTML = `
      <div class="cab-table-wrap">
        <div class="cab-table-title"><i class="ti ti-shield-lock" style="margin-right:6px"></i>Пользователи Piksta</div>
        <div class="cab-ustats" id="cabAdminStats"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 12px">
          <div style="position:relative;flex:1 1 220px;max-width:340px">
            <i class="ti ti-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9ca3af"></i>
            <input id="cabAdminQ" type="search" placeholder="Поиск по e-mail или имени" value="${cabEsc(cabAdminQ)}" oninput="cabAdminQ=this.value;cabAdminRenderList()"
              style="width:100%;box-sizing:border-box;padding:8px 10px 8px 32px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px">
          </div>
          <select id="cabAdminF" class="cab-usel" style="padding:8px 10px" onchange="cabAdminSetFilter(this.value)"></select>
          <div id="cabAdminBar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1 1 auto;justify-content:flex-end;font-size:13px;color:#4a5260"></div>
        </div>
        <div class="cab-users" id="cabUList"></div>
      </div>`;
    if (!document.getElementById('cabAdminCss')) { const st = document.createElement('style'); st.id = 'cabAdminCss'; st.textContent = CAB_ADMIN_CSS; document.head.appendChild(st); }
    cabAdminRenderList();
  } catch (e) {
    box.innerHTML = `<div class="cab-table-wrap"><div class="cab-stub-text">Не удалось загрузить пользователей: ${e.message}</div></div>`;
  }
}

// Карточка пользователя в админке: колонки одинаковой ширины во всех карточках, перестройка по ширине самой карточки
const CAB_ADMIN_CSS = `
.cab-ac{border:1px solid #ebe7f3;border-radius:14px;padding:12px 14px;background:#fff;container-type:inline-size}
.cab-ac.off{background:#fdf7f7;border-color:#f6d7d7}
.cab-ac-top{display:grid;grid-template-columns:18px minmax(0,1fr) 150px 128px 96px 86px;gap:8px 16px;align-items:center}
.cab-ac-m>span{overflow:hidden;text-overflow:ellipsis}
.cab-ac-cb{width:16px;height:16px;margin:0;cursor:pointer}
.cab-ac-who{display:flex;align-items:center;gap:10px;min-width:0}
.cab-ac-who .cab-uav{width:36px;height:36px;flex:0 0 36px}
.cab-ac-mail{font-weight:600;font-size:15px;color:#1a1a2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cab-ac-sub{display:flex;align-items:center;gap:8px;margin-top:3px;min-width:0}
.cab-ac-pill{padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.cab-ac-unv{display:flex;align-items:center;gap:4px;margin-top:4px;font-size:12px;font-weight:600;color:#a16207;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cab-ac-unv i{font-size:14px;flex:none}.cab-ac-unv.late{color:#b91c1c}
.cab-ac-vbtn{color:#92400e;border-color:#f6d58a}.cab-ac-vbtn.late{background:#facc15;border-color:#eab308;color:#422006;font-weight:700;box-shadow:0 0 0 3px rgba(250,204,21,.35)}
.cab-ac-name{font-size:13px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cab-ac-m{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#6b7280;white-space:nowrap;min-width:0}
.cab-ac-m b{font-size:14px;color:#1a1a2e;font-weight:600}
.cab-ac-lim{display:block;height:5px;border-radius:3px;background:#ece8f4;overflow:hidden;margin-top:3px;max-width:150px}
.cab-ac-lim em{display:block;height:100%;border-radius:3px}
.cab-ac-hist{font-size:12.5px;color:#6b7280;margin-top:8px;line-height:1.45}
.cab-ac-hist b{color:#1a1a2e;font-weight:600}
.cab-sub-box{background:#fff;border-radius:14px;width:100%;max-width:440px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:10px}
.cab-sub-l{font-size:11.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:-4px}
.cab-sub-seg{display:flex;background:#f0edf6;border-radius:10px;padding:3px;gap:3px}
.cab-sub-seg button{flex:1;border:0;background:none;font:inherit;font-size:13.5px;font-weight:600;color:#6b7280;padding:8px 6px;border-radius:8px;cursor:pointer}
.cab-sub-seg button.on{background:#fff;color:#6C4DB8;box-shadow:0 1px 3px rgba(23,20,42,.12)}
.cab-ac-bot{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap;border-top:1px solid #f0edf6;margin-top:10px;padding-top:10px}
.cab-ac-bot .cab-usel{font-size:13px;padding:5px 6px}
.cab-ac-cty{display:inline-flex;flex-direction:column;gap:1px}.cab-ac-cty small{font-size:11px;color:#8a8fa0;white-space:nowrap;padding-left:2px}
.cab-ac-bot .cab-uopt{font-size:13px;white-space:nowrap}
.cab-ac-act{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.cab-ac-act .cab-filter-btn{padding:6px 10px;font-size:13px;display:inline-flex;align-items:center;gap:5px}
/* Широкий экран: всё в одну строку; уже — настройки и кнопки переносятся во вторую строку */
@container (min-width: 1600px){
  .cab-ac-row{display:flex;align-items:center;gap:18px}
  .cab-ac-top{flex:1 1 auto;min-width:0;grid-template-columns:18px minmax(220px,1fr) 150px 128px 96px 86px}
  .cab-ac-bot{flex:0 0 auto;flex-wrap:nowrap;border-top:0;margin-top:0;padding-top:0;border-left:1px solid #f0edf6;padding-left:18px}
  .cab-ac-act{margin-left:6px}
}
@container (max-width: 820px){
  .cab-ac-act .cab-filter-btn{padding:6px 9px}
  .cab-ac-act .cab-filter-btn .t{display:none}
  .cab-ac-act .cab-filter-btn i{font-size:16px}
}
@container (max-width: 430px){
  .cab-ac-act{margin-left:0;width:100%}
  .cab-ac-act .cab-filter-btn{flex:1 1 0;justify-content:center}
}
@container (max-width: 700px){
  .cab-ac-top{grid-template-columns:18px minmax(0,1.5fr) minmax(0,1fr) minmax(0,.7fr) minmax(0,.7fr);gap:8px 12px}
  .cab-ac-who{grid-column:2 / -1}
  .cab-ac-m1{grid-column-start:2}
}
@container (max-width: 430px){
  .cab-ac-top{grid-template-columns:18px repeat(2,minmax(0,1fr))}
  .cab-ac-m3{grid-column-start:2}
}`;

function cabEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function cabAdminMatch(u, f) {
  const k = u._acc.kind, left = u._acc.left;
  if (f === 'all') return true;
  if (f === 'soon') return (k === 'trial' || k === 'sub') && left <= 7;
  if (f === 'unpaid') return k === 'grace' || k === 'readonly';
  if (f === 'pilot') return !!u.founder;
  return k === f;
}

function cabAdminVisible() {
  const q = cabAdminQ.trim().toLowerCase();
  return cabAdminUsers.filter(u => cabAdminMatch(u, cabAdminF) && (!q || String(u.email || '').toLowerCase().includes(q) || String(u.name || '').toLowerCase().includes(q)));
}

function cabAdminSetFilter(f) { cabAdminF = f; cabAdminRenderList(); }
function cabAdminToggle(id, on) { if (on) cabAdminSel.add(id); else cabAdminSel.delete(id); cabAdminRenderBar(); }
function cabAdminSelectVisible(on) { for (const u of cabAdminVisible()) { if (on) cabAdminSel.add(u.id); else cabAdminSel.delete(u.id); } cabAdminRenderList(); }

function cabAdminRenderBar() {
  const bar = document.getElementById('cabAdminBar'); if (!bar) return;
  const vis = cabAdminVisible(), n = cabAdminSel.size;
  const allOn = vis.length > 0 && vis.every(u => cabAdminSel.has(u.id));
  bar.innerHTML = `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-right:auto"><input type="checkbox" ${allOn ? 'checked' : ''} onchange="cabAdminSelectVisible(this.checked)"> Выбрать всех (${vis.length})</label>
    ${n ? `<span>Выбрано: <b>${n}</b></span>` : ''}
    ${n ? `<button class="cab-filter-btn" onclick="cabAdminSel.clear();cabAdminRenderList()">Снять выбор</button>` : ''}
    <button class="cab-filter-btn" ${n ? '' : 'disabled'} onclick="cabAdminCopyEmails()" title="Скопировать адреса выбранных"><i class="ti ti-copy"></i> Адреса</button>
    <button class="cab-filter-btn" ${n ? '' : 'disabled'} style="color:#fff;background:#6C4DB8;border-color:#6C4DB8" onclick="cabAdminMailOpen()"><i class="ti ti-mail"></i> Написать письмо</button>`;
}

function cabAdminRenderList() {
  const list = document.getElementById('cabUList'); if (!list) return;
  const cnt = k => cabAdminUsers.filter(u => cabAdminMatch(u, k)).length;
  const sel = document.getElementById('cabAdminF');
  if (sel) sel.innerHTML = CAB_ADMIN_FILTERS.map(([k, t]) => `<option value="${k}" ${cabAdminF === k ? 'selected' : ''}>${t} — ${cnt(k)}</option>`).join('');
  const stats = document.getElementById('cabAdminStats');
  if (stats) stats.innerHTML = [[cabAdminUsers.length, 'Всего пользователей', '#1a1a2e'], [cnt('sub'), 'С подпиской', '#16a34a'], [cnt('trial'), 'На пробном', '#f59e0b'],
    [cnt('unpaid'), 'Не оплатили', '#dc2626'], [cnt('blocked'), 'Заблокировано', '#6b7280']]
    .map(([v, l, c]) => `<div class="cab-stat-card"><div class="cab-stat-val" style="color:${c}">${v}</div><div class="cab-stat-label">${l}</div></div>`).join('');
  const now = new Date();
  const rows = cabAdminVisible().map(u => {
    const A = u._acc, created = cabToDate(u.created) || now;
    const isBlocked = A.kind === 'blocked';
    const end = A.end || null;
    const daysLeft = end ? Math.ceil((end - now) / 864e5) : 0;
    const st = {
      blocked: ['Заблокирован', '#4a5260', '#f3f4f6'], readonly: ['Только просмотр', '#b91c1c', '#fde8e8'],
      grace: [`5 дней на оплату · ещё ${A.left} дн.`, '#b91c1c', '#fde8e8'], sub: ['Подписка', '#15803d', '#dcfce7'],
      trial: [u.founder ? 'Пробный · пилот' : 'Пробный', '#92400e', '#fef3c7']
    }[A.kind] || ['—', '#4a5260', '#f3f4f6'];
    const plan = A.from === 'sub' && typeof PK_PLANS !== 'undefined' ? (PK_PLANS[(u.subscription || {}).plan] ? u.subscription.plan : 'main') : null;
    if (A.kind === 'sub' && plan) st[0] = PK_PLANS[plan].n + (u.founder ? ' · пилот' : '');
    const U = u._use;
    const dm = x => x.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const useHtml = !U ? '<b>—</b>' : `<b>${U.n.toLocaleString('ru-RU')}${U.lim === Infinity ? '' : ' из ' + U.lim.toLocaleString('ru-RU')}</b>${U.lim === Infinity ? '' : `<i class="cab-ac-lim"><em style="width:${Math.max(3, Math.min(100, U.n / U.lim * 100))}%;background:${U.state === 'ok' ? '#6C4DB8' : U.state === 'warn' ? '#f59e0b' : '#dc2626'}"></em></i>`}`;
    const useLbl = !U ? 'Треков' : U.P.cal ? 'Треков за ' + U.P.start.toLocaleDateString('ru-RU', { month: 'long' }) : `Треков ${dm(U.P.start)}–${dm(U.P.last)}`;
    const hist = ((u.subscription || {}).history || []).slice(-2).reverse();
    const histHtml = hist.length && typeof PK_PLANS !== 'undefined' ? `<div class="cab-ac-hist">Оплаты: ${hist.map((h, i) => {
      const t = `${(cabToDate(h.at) || now).toLocaleDateString('ru-RU')} · ${PK_PLANS[h.plan] ? PK_PLANS[h.plan].n : ''}, ${h.period === 'y' || h.months === 12 ? 'год' : 'месяц'} · ${h.gift || h.method === 'gift' ? 'подарок' : h.amount > 0 ? h.amount.toLocaleString('ru-RU') + ' ' + cabEsc(h.cur || '') + (CAB_PAY_M[h.method] ? ' · ' + CAB_PAY_M[h.method] : '') : 'продлено'}${h.note ? ' (' + cabEsc(h.note) + ')' : ''}`;
      return i === 0 ? `<b>${t}</b>` : t; }).join(' · ')}</div>` : '';
    const cSrc = { ip: 'по IP', user: 'выбрал сам', admin: 'вручную' }[u.countrySrc] || '';
    const cTip = [cSrc && 'Страна: ' + cSrc, u.countryIp && 'IP: ' + u.countryIp, u.countryOther && 'Страна: ' + u.countryOther, u.countryCur && 'Валюта: ' + u.countryCur].filter(Boolean).join(' · ');
    const ctry = `<span class="cab-ac-cty"><select onchange="cabAdminSetField('${u.id}','country',this.value||null,true)" class="cab-usel" title="${cabEsc(cTip)}">
        <option value="">Страна —</option>${Object.entries(PIKSTA_COUNTRIES).map(([k, v]) => `<option value="${k}" ${u.country === k ? 'selected' : ''}>${k === 'OT' && u.countryOther ? cabEsc(u.countryOther) : v}</option>`).join('')}</select>${cSrc ? `<small title="${cabEsc(cTip)}">${cSrc}${u.countryIp && u.countrySrc === 'user' ? ' · IP ' + cabEsc(u.countryIp) : ''}</small>` : ''}</span>`;
    const fnd = `<label class="cab-uopt" title="Участник пилота: пробный период 3 месяца вместо 30 дней и цена −${PIKSTA_TARIFFS.founderDiscountPct}%, пока подписка продлевается без перерыва"><input type="checkbox" ${u.founder ? 'checked' : ''} onchange="cabAdminSetField('${u.id}','founder',this.checked,true)"> Пилот</label>`;
    const ind = `<label class="cab-uopt" title="Показать пользователю тариф «Крупный / карго» (индивидуальная цена)"><input type="checkbox" ${u.individual ? 'checked' : ''} onchange="cabAdminSetField('${u.id}','individual',this.checked)"> Индив. тариф</label>`;
    const ini = String(u.name || u.email || '?').trim().charAt(0).toUpperCase();
    const endTxt = end ? `${end.toLocaleDateString('ru-RU')} <em style="font-style:normal;font-weight:600;color:${daysLeft > 7 ? '#16a34a' : '#dc2626'}">· ${daysLeft > 0 ? daysLeft + ' дн.' : 'истёк'}</em>` : '—';
    const num = v => typeof v === 'number' ? v.toLocaleString('ru-RU') : v;
    // почта не подтверждена: сколько часов с регистрации, чем закончилась последняя отправка письма
    const unver = !u.emailVerified && u.email !== 'bot@piksta.online';
    const hrs = Math.floor((now - created) / 36e5), late = unver && hrs >= 24;
    const VM = u.verifyMail || {}, vmAt = cabToDate(VM.at);
    const vmTxt = !VM.n ? 'данных об отправке нет' : (VM.ok ? 'письмо ушло' : 'Google отказал: ' + (VM.err || '?')) + (vmAt ? ' · ' + vmAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + (VM.n > 1 ? ' · попыток ' + VM.n : '');
    const nudged = cabToDate(u.verifyNudge);
    const vPill = unver ? `<div class="cab-ac-unv${late ? ' late' : ''}" title="${cabEsc(vmTxt)}"><i class="ti ti-mail-exclamation"></i>Не подтверждена · ${hrs < 48 ? hrs + ' ч' : Math.floor(hrs / 24) + ' дн.'}${VM.n && !VM.ok ? ' · ошибка отправки' : ''}</div>` : '';
    const vBtn = unver ? `<button class="cab-filter-btn cab-ac-vbtn${late ? ' late' : ''}" onclick="cabAdminVerifyNudge('${u.id}')" title="${cabEsc('Попросить Piksta отправить новое письмо подтверждения при следующем входе и открыть письмо человеку в Gmail. ' + vmTxt + (nudged ? '. Уже просили: ' + nudged.toLocaleString('ru-RU') : ''))}"><i class="ti ti-mail-forward"></i><span class="t"> Подтверждение</span></button>` : '';
    return `<div class="cab-ac${['blocked', 'readonly'].includes(A.kind) ? ' off' : ''}"><div class="cab-ac-row">
      <div class="cab-ac-top">
        <input type="checkbox" class="cab-ac-cb" ${cabAdminSel.has(u.id) ? 'checked' : ''} onchange="cabAdminToggle('${u.id}',this.checked)" title="Выбрать для письма">
        <div class="cab-ac-who"><span class="cab-uav">${cabEsc(ini)}</span><div style="min-width:0">
          <div class="cab-ac-mail" title="${cabEsc(u.email || u.id)}">${cabEsc(u.email || u.id)}</div>
          <div class="cab-ac-sub"><span class="cab-ac-pill" style="color:${st[1]};background:${st[2]}">${st[0]}</span><span class="cab-ac-name">${cabEsc(u.name || '—')}</span></div>${vPill}
        </div></div>
        <div class="cab-ac-m cab-ac-m1"><span>${A.from === 'sub' ? 'Подписка до' : 'Тест до'}</span><b>${endTxt}</b></div>
        <div class="cab-ac-m"><span>${useLbl}</span>${useHtml}</div>
        <div class="cab-ac-m cab-ac-m3"><span>Закупок · поз.</span><b>${num(u._ships)} · ${num(u._items)}</b></div>
        <div class="cab-ac-m"><span>Регистрация</span><b>${created.toLocaleDateString('ru-RU')}</b></div>
      </div>
      <div class="cab-ac-bot">
        ${ctry}${fnd}${ind}
        <div class="cab-ac-act">
          ${vBtn}<button class="cab-filter-btn" onclick="cabAdminMailOpen('${u.id}')" title="Письмо"><i class="ti ti-mail"></i><span class="t"> Письмо</span></button>
          <button class="cab-filter-btn" style="color:#16a34a;border-color:#86efac" onclick="cabAdminSub('${u.id}')" title="Продлить подписку"><i class="ti ti-calendar-plus"></i><span class="t"> Продлить</span></button>
          ${isBlocked
            ? `<button class="cab-filter-btn" onclick="cabAdminBlock('${u.id}',false)" title="Разблокировать"><i class="ti ti-lock-open"></i><span class="t"> Разблокировать</span></button>`
            : `<button class="cab-filter-btn" style="color:#dc2626;border-color:#fca5a5" onclick="cabAdminBlock('${u.id}',true)" title="Заблокировать"><i class="ti ti-lock"></i><span class="t"> Заблокировать</span></button>`}
        </div>
      </div>
    </div>
      ${histHtml}
    </div>`;
  });
  list.innerHTML = rows.join('') || '<div class="cab-stub-text" style="text-align:center;padding:20px">Никого не нашлось</div>';
  cabAdminRenderBar();
}

function cabAdminEmails(ids) { return (ids || [...cabAdminSel]).map(id => (cabAdminUsers.find(u => u.id === id) || {}).email).filter(Boolean); }

async function cabAdminCopyEmails() {
  const list = cabAdminEmails().join(', ');
  try { await navigator.clipboard.writeText(list); showToast('Скопировано адресов: ' + cabAdminEmails().length); }
  catch (e) { prompt('Скопируйте адреса:', list); }
}

// Письмо: открывается окно Gmail (вошли как администратор), адресаты — в скрытой копии, друг друга не видят
// «Подтверждение»: отметка в профиле (Piksta сама отправит свежее письмо, когда человек откроет приложение) + готовое письмо ему в Gmail
async function cabAdminVerifyNudge(uid) {
  const u = cabAdminUsers.find(x => x.id === uid); if (!u) return;
  try { await db.collection('users').doc(uid).update({ verifyNudge: firebase.firestore.FieldValue.serverTimestamp() }); u.verifyNudge = new Date(); }
  catch (e) { alert('Не удалось: ' + e.message); return; }
  cabAdminMailOpen(uid);
  const sj = document.getElementById('cabMailSubj'), bd = document.getElementById('cabMailBody');
  if (sj) sj.value = 'Piksta: подтверждение почты';
  if (bd) bd.value = 'Здравствуйте, {имя}!\n\nВидим, что почта в Piksta ещё не подтверждена. Откройте, пожалуйста, piksta.online/app — Piksta сразу отправит вам новое письмо со ссылкой. Письмо приходит с адреса noreply@piksta.online; если его нет во «Входящих», загляните в «Спам» и «Промоакции».\n\nЕсли не получится — просто ответьте на это письмо, поможем.\n\nКоманда Piksta';
  cabAdminRenderList();
}
function cabAdminMailOpen(oneId) {
  const ids = oneId ? [oneId] : [...cabAdminSel];
  const emails = cabAdminEmails(ids);
  if (!emails.length) return;
  window.__cabMailIds = ids;
  const who = emails.length === 1 ? cabEsc(emails[0]) : `${emails.length} получателей (скрытая копия — друг друга не видят)`;
  const ov = document.createElement('div');
  ov.id = 'cabMailOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `<div style="background:#fff;border-radius:14px;width:100%;max-width:560px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25)">
    <div style="font-size:18px;font-weight:700;margin-bottom:4px">Письмо</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:12px">Кому: ${who}</div>
    <input id="cabMailSubj" placeholder="Тема" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:8px">
    <textarea id="cabMailBody" rows="8" placeholder="Текст письма. {имя} заменится на имя, если письмо одному человеку" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;resize:vertical;font-family:inherit"></textarea>
    <div style="font-size:12px;color:#6b7280;margin:8px 0 14px">Откроется Gmail с готовым письмом — проверьте и нажмите «Отправить» там.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="cab-filter-btn" onclick="document.getElementById('cabMailOv').remove()">Отмена</button>
      <button class="cab-filter-btn" style="color:#fff;background:#6C4DB8;border-color:#6C4DB8" onclick="cabAdminMailGo()"><i class="ti ti-brand-gmail"></i> Открыть в Gmail</button>
    </div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  document.getElementById('cabMailSubj').focus();
}

function cabAdminMailGo() {
  const ids = window.__cabMailIds || [];
  const emails = cabAdminEmails(ids);
  const one = ids.length === 1 ? cabAdminUsers.find(u => u.id === ids[0]) : null;
  const subj = document.getElementById('cabMailSubj').value.trim();
  const body = document.getElementById('cabMailBody').value.replace(/\{имя\}/g, one ? (one.name || '') : '').trim();
  const E = encodeURIComponent;
  const base = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + E(subj) + '&body=' + E(body);
  let url = base + (emails.length === 1 ? '&to=' + E(emails[0]) : '&bcc=' + E(emails.join(',')));
  if (url.length > 7500) { cabAdminCopyEmails(); alert('Адресов слишком много для одной ссылки. Адреса скопированы — вставьте их в «Скрытую копию» в Gmail.'); url = base; }
  window.open(url, '_blank');
  document.getElementById('cabMailOv').remove();
}

// «Продлить»: тариф, срок 1 или 12 месяцев, оплата или подарок (02.11.2026). Продление — от текущей даты окончания, если она впереди.
const CAB_PAY_M = { bnb: 'ЕРИП', tbank: 'Т-Банк', alipay: 'Alipay', trc20: 'USDT TRC20', bep20: 'USDT BEP20', other: 'другое', bot: 'бот' };
let cabSubS = null;
function cabSubAmt(S) {
  if (typeof PK_BYN === 'undefined') return '';
  const base = PK_BYN[S.plan][S.m === 12 ? 1 : 0] * (S.cur === 'BYN' ? 1 : PK_MARKUP);
  if (S.cur === 'BYN') return base;
  const r = PK_RATES[S.cur === 'USDT' ? 'USD' : S.cur]; if (!r) return '';
  return pkUp(base / r, S.cur === 'RUB' || S.cur === 'KZT' ? 100 : 1);
}
function cabSubEnd(u, m) {
  // (05.11.2026) оплаченный срок — после текущей подписки или после пробного периода / пилота (pkPaidStart в init.js)
  const from = typeof pkPaidStart === 'function' ? pkPaidStart(u) : new Date();
  const curEnd = u.subscription ? cabToDate(u.subscription.endDate) : null;
  const e = new Date(from); e.setMonth(e.getMonth() + m);
  const how = curEnd && curEnd > new Date() ? 'продление от текущей даты окончания' : from - new Date() > 864e5 ? 'после пробного периода (до ' + from.toLocaleDateString('ru-RU') + ')' : 'от сегодня';
  return { e, ext: how };
}
function cabAdminSub(uid) {
  const u = cabAdminUsers.find(x => x.id === uid); if (!u) return;
  const sub = u.subscription || {}, pend = sub.pending;
  const cur0 = { BY: 'BYN', RU: 'RUB', KZ: 'KZT' }[u.country] || 'BYN';
  cabSubS = { uid, plan: pend ? pend.plan : (PK_PLANS[sub.plan] ? sub.plan : 'main'), m: pend ? (pend.months || 1) : 1, gift: false,
    cur: pend ? pend.cur : cur0, method: pend ? pend.method : ({ BYN: 'bnb', RUB: 'tbank' }[cur0] || 'other'), amount: pend ? pend.amount : '', note: '', auto: !pend };
  if (cabSubS.auto) cabSubS.amount = cabSubAmt(cabSubS);
  const ov = document.createElement('div');
  ov.id = 'cabSubOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  cabSubRender();
}
function cabSubSet(k, v) {
  const S = cabSubS; S[k] = v;
  if ((k === 'plan' || k === 'm' || k === 'cur') && S.auto) S.amount = cabSubAmt(S);
  if (k === 'cur') S.method = { BYN: 'bnb', RUB: 'tbank', CNY: 'alipay', USDT: 'trc20' }[v] || 'other';
  cabSubRender();
}
function cabSubRender() {
  const ov = document.getElementById('cabSubOv'), S = cabSubS; if (!ov || !S) return;
  const u = cabAdminUsers.find(x => x.id === S.uid) || {};
  const pend = (u.subscription || {}).pending;
  const seg = (k, opts) => `<div class="cab-sub-seg">${opts.map(([v, t]) => `<button type="button" class="${S[k] === v ? 'on' : ''}" onclick="cabSubSet('${k}',${typeof v === 'string' ? `'${v}'` : v})">${t}</button>`).join('')}</div>`;
  const { e, ext } = cabSubEnd(u, S.m);
  const inp = 'padding:9px 11px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;background:#fff;min-width:0';
  ov.innerHTML = `<div class="cab-sub-box" role="dialog" aria-label="Продлить подписку">
    <div style="font-size:18px;font-weight:700">Продлить · ${cabEsc(u.email || '')}</div>
    ${pend ? `<div style="background:#fef3c7;color:#92400e;border-radius:10px;padding:9px 11px;font-size:13px">На проверке оплата из приложения: «${PK_PLANS[pend.plan] ? PK_PLANS[pend.plan].n : ''}», ${pend.period === 'y' ? 'год' : 'месяц'}, ${cabEsc(pend.amount)} ${cabEsc(pend.cur)}. Поля заполнены по ней — после продления она закроется.</div>` : ''}
    <div class="cab-sub-l">Тариф</div>${seg('plan', [['start', 'Старт'], ['main', 'Основной'], ['pro', 'Профи']])}
    <div class="cab-sub-l">Срок</div>${seg('m', [[1, '1 месяц'], [12, '12 месяцев']])}
    <div class="cab-sub-l">Основание</div>${seg('gift', [[false, 'Оплата'], [true, 'Подарок / промо']])}
    ${S.gift ? '' : `<div style="display:flex;gap:8px">
      <input id="cabSubAmt" value="${cabEsc(S.amount)}" inputmode="decimal" placeholder="Сумма" oninput="cabSubS.amount=this.value;cabSubS.auto=false" style="${inp};flex:1">
      <select onchange="cabSubSet('cur',this.value)" style="${inp};width:96px">${['BYN', 'RUB', 'KZT', 'CNY', 'USDT'].map(c => `<option ${S.cur === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select onchange="cabSubS.method=this.value" style="${inp};width:128px">${Object.entries(CAB_PAY_M).filter(([k]) => k !== 'bot').map(([k, t]) => `<option value="${k}" ${S.method === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`}
    <input id="cabSubNote" value="${cabEsc(S.note)}" oninput="cabSubS.note=this.value" placeholder="Комментарий: например, «скидка пилота −30%»" style="${inp}">
    <div style="background:#e7f8ee;color:#15803d;border-radius:10px;padding:9px 11px;font-size:13.5px">Будет: <b>${PK_PLANS[S.plan].n} до ${e.toLocaleDateString('ru-RU')}</b> — ${ext}${S.gift ? ' · подарок' : ''}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="cab-filter-btn" onclick="document.getElementById('cabSubOv').remove()">Отмена</button>
      <button class="cab-filter-btn" id="cabSubGo" style="color:#fff;background:#6C4DB8;border-color:#6C4DB8" onclick="cabSubSave()"><i class="ti ti-calendar-plus"></i> Продлить</button>
    </div></div>`;
}
async function cabSubSave() {
  const S = cabSubS, u = cabAdminUsers.find(x => x.id === S.uid); if (!S || !u) return;
  const amount = S.gift ? 0 : Math.round(parseFloat(String(S.amount).replace(',', '.').replace(/\s/g, '')) * 100) / 100 || 0;
  const { e } = cabSubEnd(u, S.m), TS = firebase.firestore.Timestamp, FV = firebase.firestore.FieldValue;
  const h = { at: TS.now(), plan: S.plan, period: S.m === 12 ? 'y' : 'm', months: S.m, amount, cur: S.gift ? '' : S.cur, method: S.gift ? 'gift' : S.method, gift: !!S.gift, end: TS.fromDate(e), by: 'admin' };
  if (S.note.trim()) h.note = S.note.trim().slice(0, 200);
  const upd = { 'subscription.endDate': TS.fromDate(e), 'subscription.months': S.m, 'subscription.plan': S.plan, 'subscription.by': 'admin',
    'subscription.activatedAt': FV.serverTimestamp(), 'subscription.history': FV.arrayUnion(h) };
  if ((u.subscription || {}).pending) upd['subscription.pending'] = FV.delete();
  const b = document.getElementById('cabSubGo'); if (b) { b.disabled = true; b.textContent = 'Сохраняю…'; }
  try {
    await db.collection('users').doc(S.uid).update(upd);
    document.getElementById('cabSubOv').remove();
    showToast(`${u.email}: «${PK_PLANS[S.plan].n}» до ${e.toLocaleDateString('ru-RU')}`);
  } catch (err) { if (b) { b.disabled = false; b.textContent = 'Продлить'; } alert('Ошибка: ' + err.message); return; }
  cabNav(cabCurrentSection);
}

// Поле профиля пользователя из админки (страна, «первый клиент»). null — убрать поле
async function cabAdminSetField(uid, field, value, rerender) {
  try {
    const upd = { [field]: value === null ? firebase.firestore.FieldValue.delete() : value };
    if (field === 'country') upd.countrySrc = value === null ? firebase.firestore.FieldValue.delete() : 'admin';
    await db.collection('users').doc(uid).update(upd);
    const u = cabAdminUsers.find(x => x.id === uid);
    if (u) { if (value === null) delete u[field]; else u[field] = value; if (field === 'country') { if (value === null) delete u.countrySrc; else u.countrySrc = 'admin'; } u._acc = pkAccess(u); }
    if (rerender) cabAdminRenderList();
  } catch (e) { alert('Ошибка: ' + e.message); cabNav(cabCurrentSection); }
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


// ============ НАВИГАЦИЯ «НАЗАД» И «ПОМОЩЬ» (03.11.2026) ============
// Каждый экран Кабинета (раздел / закупка / карточка клиента) — запись в истории браузера:
// кнопка «Назад» в браузере и «← Назад» сверху возвращают туда, откуда пришли, и не уводят из Piksta.
// Сверху каждой страницы — полоса: слева «← Назад: <откуда>», справа «Помощь».
const CAB_SEC_NAMES = { overview: 'Обзор', shipments: 'Закупки', clients: 'Клиенты', prices: 'Цены', calc: 'Деньги', analytics: 'Аналитика', settings: 'Настройки', tariffs: 'Тариф', admin: 'Админ' };
let cabHistRestoring = false, cabHistT = null;
function cabGoClient(enc) { cabNav('clients'); cabOpenClient(enc); }
function cabViewState() {
  const st = { s: cabCurrentSection };
  if (cabShipId) { st.sh = cabShipId; st.t = cabShipTab; const sh = cabShipmentsCache.find(x => x.id === cabShipId); st.l = sh ? (sh.name || 'Закупка') : 'Закупка'; }
  else if (cabCurrentSection === 'clients' && cabClientOpen) { st.cl = cabClientOpen; st.l = cabClientOpen; }
  else st.l = CAB_SEC_NAMES[cabCurrentSection] || '';
  return st;
}
const cabViewKey = st => [st.s, st.sh || '', st.cl || ''].join('|');
function cabHistMark() {
  if (cabHistRestoring || typeof cabInCabinet !== 'function' || !cabInCabinet()) return;
  const st = cabViewState(), cur = history.state && history.state.cab;
  if (!cur) { history.replaceState({ cab: st, d: 0 }, ''); return; }
  if (cabViewKey(cur) === cabViewKey(st)) { history.replaceState({ cab: st, d: history.state.d || 0, p: history.state.p }, ''); return; }
  history.pushState({ cab: st, d: (history.state.d || 0) + 1, p: cur.l || '' }, '');
}
window.addEventListener('popstate', async e => {
  const st = e.state && e.state.cab;
  if (!st || typeof cabInCabinet !== 'function' || !cabInCabinet()) return;
  cabHistRestoring = true;
  try {
    if (st.sh && !cabShipmentsCache.some(x => x.id === st.sh)) cabNav('shipments');   // закупку уже удалили
    else if (st.sh) {
      if (cabShipId !== st.sh) { cabCurrentSection = st.s; await cabOpenShip(st.sh); }
      if (st.t && cabShipTab !== st.t && cabShipId === st.sh) cabShipTabSet(st.t);
    } else {
      cabNav(st.s);
      if (st.cl) cabOpenClient(encodeURIComponent(st.cl));
    }
  } catch (err) {}
  setTimeout(() => { cabHistRestoring = false; cabTopBar(); }, 60);
});
function cabTopBar() {
  const main = document.getElementById('cabMain'); if (!main) return;
  let bar = main.firstElementChild && main.firstElementChild.id === 'cabTop' ? main.firstElementChild : null;
  if (!bar) { bar = document.createElement('div'); bar.id = 'cabTop'; bar.className = 'cab-top'; main.insertBefore(bar, main.firstChild); }
  const h = history.state || {}, back = h.cab && h.d > 0 ? (h.p || 'назад') : '';
  bar.innerHTML = `${back ? `<button type="button" class="cab-top-back" onclick="history.back()" title="Вернуться"><i class="ti ti-arrow-left"></i><span>Назад: <b>${cabEsc(back)}</b></span></button>` : '<span></span>'}
    <button type="button" class="cab-top-help" onclick="cabHelpMenu(event)"><i class="ti ti-help-circle"></i> Помощь</button>`;
}
(function () {
  const main = document.getElementById('cabMain'); if (!main || !window.MutationObserver) return;
  new MutationObserver(() => {
    clearTimeout(cabHistT);
    cabHistT = setTimeout(() => { cabHistMark(); cabTopBar(); }, 0);
  }).observe(main, { childList: true });
})();
// «Помощь»: инструкция, связь с поддержкой, подсказки, расширение
function cabHelpMenu(ev) {
  if (ev) ev.stopPropagation();
  const old = document.getElementById('cabHelpPop'); if (old) { old.remove(); return; }
  const p = document.createElement('div'); p.id = 'cabHelpPop'; p.className = 'cab-help-pop';
  const tips = typeof pkTourMenuOn === 'function' && pkTourMenuOn();
  p.innerHTML = `<div class="hh">Помощь и связь</div>
    <span class="hb doc soon" aria-disabled="true"><i class="ti ti-book"></i><span>Инструкция Piksta<small>скоро появится — обновляем под новые функции</small></span></span>
    <p>Не нашли ответ — напишите, ответим.</p>
    <a class="hb tg" href="https://t.me/piksta_support_bot" target="_blank" rel="noopener"><i class="ti ti-brand-telegram"></i><span>Написать в Telegram<small>@piksta_support_bot</small></span></a>
    <a class="hb" href="mailto:support@piksta.online"><i class="ti ti-mail"></i><span>Написать на почту<small>support@piksta.online</small></span></a>
    ${tips ? `<button type="button" class="hb" onclick="document.getElementById('cabHelpPop').remove();pkTourStart('c')"><i class="ti ti-route"></i><span>Подсказки по интерфейсу<small>пройти обучение заново</small></span></button>` : ''}
    <a class="hb" href="/extension" target="_blank" rel="noopener"><i class="ti ti-puzzle"></i><span>Расширение для Chrome<small>скачать и инструкция</small></span></a>`;
  document.body.appendChild(p);
  const b = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : { right: innerWidth - 20, bottom: 60 };
  p.style.top = (b.bottom + 8) + 'px'; p.style.right = Math.max(12, innerWidth - b.right) + 'px';
  setTimeout(() => document.addEventListener('click', function f(e) { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('click', f); } }), 0);
}

// ============ ПЕРВЫЙ ВХОД: ПУСТЫЕ РАЗДЕЛЫ (03.11.2026) ============
// Пока в разделе нечего показать — объясняем, что здесь будет и что сделать сейчас. Появились данные — обычный экран.
// Гайды «Быстрый старт» (обновлены 06.11.2026 под импорт Pinduoduo / Taobao / 1688). Исходники: project code/guide/quickstart*.html
const CAB_GUIDE_PDD = '/guides/piksta-start-marketplejsy.pdf', CAB_GUIDE_MAN = '/guides/piksta-start-vruchnuyu.pdf';
function cabEmptyOverview() {
  const first = userProfile && userProfile.name ? String(userProfile.name).split(' ')[0] : '';
  return `<div class="cab-main-title">${first ? 'Добро пожаловать, ' + cabEsc(first) + '!' : 'Добро пожаловать в Piksta!'}</div>
    <div class="cab-start"><h2>С чего начать</h2><p>Три шага — и первая закупка разобрана по клиентам. Начните с закупки: всё остальное Piksta посчитает сама.</p></div>
    <div class="cab-start-steps">
      <div class="cab-start-st cur"><span class="n">1</span><b>Создайте закупку</b><span>Импорт с Pinduoduo, Taobao и 1688 через расширение — или вручную, с любой площадки.</span><button type="button" class="cab-eb" onclick="cabNav('shipments')">Перейти в «Закупки» <i class="ti ti-arrow-right"></i></button></div>
      <div class="cab-start-st"><span class="n">2</span><b>Отправили — «В дороге»</b><span>Карго забрало посылки — отметьте отправку в закупке. Включится сканер.</span></div>
      <div class="cab-start-st"><span class="n">3</span><b>Приехало — сканируйте</b><span>С телефона: посылка → чья. Взвесьте, и Piksta посчитает, кто сколько должен.</span></div>
    </div>
    <div class="cab-start-ghost"><b>Здесь появятся: деньги в обороте, где сейчас товар, кто должен</b><i style="width:70%"></i><i style="width:45%"></i><i style="width:58%"></i></div>`;
}
function cabEmptyShipments() {
  return `<div class="cab-main-title">Закупки</div>
    <div class="cab-emp-head"><b>У вас пока нет ни одной закупки</b><span>Откуда ваши заказы? Выберите путь — к каждому есть короткий гайд на 1 страницу.</span></div>
    <div class="cab-choice">
      <div class="cab-ch rec"><div class="hd"><span class="ic pdd"><i class="ti ti-shopping-bag"></i></span><span><b>С маркетплейсов · автоматически</b><small>треки, фото, цены и названия подтянутся сами</small></span></div>
        <div class="cab-ch-mk"><span class="pk-mk pdd">PDD</span><span class="pk-mk tb">TAOBAO</span><span class="pk-mk a1688">1688</span><span class="cab-ch-mk-t">за одну загрузку</span></div>
        <ol><li>Скачайте расширение и поставьте в Chrome (2 минуты).</li><li>В Chrome войдите в Piksta и на свои площадки: Pinduoduo, Taobao, 1688.</li><li>Значок Piksta → отметьте площадки и даты → «Загрузить» → «Распределить по клиентам».</li><li>Впишите клиентов → «Сохранить в Piksta» — закупка откроется здесь.</li></ol>
        <div class="bt"><a class="cab-eb" href="/extension" target="_blank" rel="noopener"><i class="ti ti-download"></i>Скачать расширение</a><a class="cab-eb gh" href="${CAB_GUIDE_PDD}" target="_blank" rel="noopener"><i class="ti ti-file-type-pdf"></i>Гайд</a></div></div>
      <div class="cab-ch"><div class="hd"><span class="ic"><i class="ti ti-pencil-plus"></i></span><span><b>Вручную · любые площадки</b><small>Poizon и все остальные</small></span></div>
        <ol><li>«Создать вручную» → название (дата подставится сама).</li><li>Трек — вписать или снять камерой; название, цена, фото — по желанию.</li><li>Клиент — имя, Piksta подсказывает уже знакомые.</li><li>«Сохранить закупку».</li></ol>
        <div class="bt"><button type="button" class="cab-eb" onclick="cabManualOpen()"><i class="ti ti-plus"></i>Создать вручную</button><a class="cab-eb gh" href="${CAB_GUIDE_MAN}" target="_blank" rel="noopener"><i class="ti ti-file-type-pdf"></i>Гайд</a></div></div>
    </div>
    <div class="cab-emp-foot"><i class="ti ti-file-spreadsheet"></i>Есть таблица треков от карго? <a href="#" onclick="cabUploadOpen();return false">Загрузить таблицу</a> — треки встанут сами.</div>
    <div class="cab-cl-bar" style="margin-top:18px"><button type="button" class="cab-eb cab-new-big" onclick="cabNewShipOpen()"><i class="ti ti-plus"></i>Создать закупку</button></div>`;
}
function cabEmptyClients() {
  return `<div class="cab-main-title">Клиенты</div>
    <div class="cab-emp"><span class="big"><i class="ti ti-users"></i></span><h3>Клиентов пока нет</h3>
      <p>Клиенты появляются сами: в закупке у товара пишете, чей он, — и человек сразу здесь, с долгами, оплатами и историей.</p>
      <p class="sm">Хотите заранее завести постоянных — с телефоном и Telegram? Добавьте: Piksta подскажет их имена, когда будете вносить товары.</p>
      <div class="bt"><button type="button" class="cab-eb" onclick="cabClAddOpen()"><i class="ti ti-user-plus"></i>Добавить клиента</button><button type="button" class="cab-eb gh" onclick="cabNav('shipments')"><i class="ti ti-package"></i>В «Закупки»</button></div></div>
    ${cabPreClientsHtml({ list: [] })}`;
}
function cabEmptyMoney(kind) {
  const ships = cabShipmentsCache, last = ships[0];
  const order = ['forming', 'transit', 'warehouse', 'sorted'], lab = ['Собирается', 'В пути', 'На складе', 'Рассортирована'];
  let path = '';
  if (last) {
    const cur = { forming: 0, transit: 1, delayed: 1, warehouse: 2, sorted: 3, done: 3 }[last.status || 'forming'] ?? 0;
    path = `<div class="cab-emp-path">${order.map((k, i) => `<span class="${i < cur ? 'dn' : i === cur ? 'on' : ''}">${i < cur ? '<i class="ti ti-check"></i>' : ''}${lab[i]}</span>`).join('<i class="ti ti-chevron-right"></i>')}</div>
      <p class="sm">Сейчас: «${cabEsc(last.name || 'Закупка')}» — ${cabEsc((SHIP_STATUSES[last.status || 'forming'] || {}).label || '').toLowerCase()}. <a href="#" onclick="cabOpenShip('${last.id}');return false">Открыть →</a></p>`;
  }
  const go = last ? '' : `<div class="bt"><button type="button" class="cab-eb" onclick="cabNav('shipments')"><i class="ti ti-package"></i>В «Закупки»</button></div>`;
  return kind === 'calc'
    ? `<div class="cab-main-title">Деньги</div><div class="cab-emp"><span class="big ok"><i class="ti ti-wallet"></i></span><h3>Оплаты появятся после первой сортировки</h3>
      <p>Когда закупка приедет и вы разложите её по клиентам, здесь будет видно, кто сколько должен и кто уже заплатил.</p>${path}${go}</div>`
    : `<div class="cab-main-title">Аналитика</div><div class="cab-emp"><span class="big"><i class="ti ti-chart-bar"></i></span><h3>Аналитика появится после первой сортировки</h3>
      <p>Прибыль по закупкам, наценка, лучшие клиенты, сколько в среднем весит товар — как только первая закупка будет рассортирована.</p>${path}${go}</div>`;
}

// ---- Клиенты, добавленные заранее (ещё без закупок): userProfile.clientInfo[имя] = { n: имя, pre: 1, ph, tg, ln } ----
function cabPreClients(S) {
  const have = new Set(((S && S.list) || []).map(c => c.name.toLowerCase()));
  const m = (userProfile && userProfile.clientInfo) || {};
  return Object.keys(m).filter(k => m[k] && m[k].pre && m[k].n && !have.has(k)).map(k => ({ k, ...m[k] })).sort((a, b) => a.n.localeCompare(b.n, 'ru'));
}
function cabPreClientsHtml(S) {
  const L = cabPreClients(S); if (!L.length) return '';
  return `<div class="cab-pre"><div class="cab-pre-h"><i class="ti ti-user-check"></i> Добавлены заранее — ещё без закупок <span>${L.length}</span></div>
    <div class="cab-pre-list">${L.map(x => `<span class="cab-pre-it"><b>${cabEsc(x.n)}${x.ln ? ' ' + cabEsc(x.ln) : ''}</b>${x.ph ? `<small>${cabEsc(x.ph)}</small>` : ''}${x.tg ? `<small>@${cabEsc(x.tg)}</small>` : ''}<button type="button" onclick="cabClPreDel('${encodeURIComponent(x.k)}')" title="Убрать" aria-label="Убрать ${cabEsc(x.n)}"><i class="ti ti-x"></i></button></span>`).join('')}</div>
    <div class="cab-pre-note">Как только впишете имя в закупке — клиент переедет в общий список со всеми данными.</div></div>`;
}
function cabClAddOpen() {
  cabClAddClose();
  const ov = document.createElement('div');
  ov.className = 'cab-ovl'; ov.id = 'cabClAddOvl';
  ov.onclick = e => { if (e.target === ov) cabClAddClose(); };
  ov.innerHTML = `<div class="cab-dlg" style="width:460px">
    <div class="cab-dlg-h">Новый клиент<button class="cab-dlg-x" onclick="cabClAddClose()" aria-label="Закрыть"><i class="ti ti-x"></i></button></div>
    <div class="cab-cl-form">
      <label class="w">Имя — как будете писать в закупках <em>*</em><input id="cabClN" autocomplete="off" oninput="cabClAddCheck()" placeholder="Например: Ольга"></label>
      <label>Фамилия<input id="cabClL" autocomplete="off"></label>
      <label>Телефон<input id="cabClP" autocomplete="off" inputmode="tel" placeholder="+375…"></label>
      <label class="w">Telegram<input id="cabClT" autocomplete="off" placeholder="@логин"></label>
    </div>
    <div id="cabClMsg" class="cab-cl-msg"></div>
    <div class="cab-dlg-f"><span>Имя подскажется при вводе товаров</span><button class="cab-filter-btn" onclick="cabClAddClose()">Отмена</button><button class="cab-filter-btn active" id="cabClSave" onclick="cabClAddSave()">Добавить</button></div>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(() => { const i = document.getElementById('cabClN'); if (i) i.focus(); }, 50);
}
function cabClAddClose() { const o = document.getElementById('cabClAddOvl'); if (o) o.remove(); }
function cabClKnown() {
  const names = cabClientsSummary().list.map(c => c.name);
  for (const x of cabPreClients({ list: [] })) names.push(x.n);
  return names;
}
function cabClAddCheck() {
  const v = (document.getElementById('cabClN').value || '').trim(), box = document.getElementById('cabClMsg'); if (!box) return null;
  const lv = v.toLowerCase(); let res = null;
  if (v) {
    const known = cabClKnown();
    const same = known.find(n => n.toLowerCase() === lv);
    const sim = !same && known.find(n => { const ln = n.toLowerCase(); return (ln.length > 2 && lv.length > 2 && (ln.startsWith(lv) || lv.startsWith(ln))) || cabLev(ln, lv) <= (Math.min(ln.length, lv.length) > 4 ? 2 : 1); });
    if (same) res = { kind: 'same', n: same }; else if (sim) res = { kind: 'sim', n: sim };
  }
  box.innerHTML = !res ? '' : res.kind === 'same' ? `<i class="ti ti-alert-circle"></i> Клиент «${cabEsc(res.n)}» уже есть.`
    : `<i class="ti ti-info-circle"></i> Похожее имя уже есть — «${cabEsc(res.n)}». Если это один человек, впишите то же имя. Если нет — добавляйте, а ошибётесь — Piksta предложит объединить.`;
  box.className = 'cab-cl-msg' + (res ? ' ' + res.kind : '');
  return res;
}
async function cabClAddSave() {
  const n = (document.getElementById('cabClN').value || '').trim().replace(/\s+/g, ' ');
  if (!n) { document.getElementById('cabClN').focus(); return; }
  const chk = cabClAddCheck(); if (chk && chk.kind === 'same') return;
  const b = document.getElementById('cabClSave'); b.disabled = true; b.textContent = 'Сохраняю…';
  try {
    await cabSaveClientInfo(n, { n, pre: 1, ln: document.getElementById('cabClL').value, ph: document.getElementById('cabClP').value, tg: document.getElementById('cabClT').value });
  } catch (e) { b.disabled = false; b.textContent = 'Добавить'; alert('Не удалось сохранить: ' + (e.message || e)); return; }
  cabClAddClose();
  if (typeof showToast === 'function') showToast(`Клиент «${n}» добавлен`);
  cabRerender();
}
async function cabClPreDel(enc) {
  const k = decodeURIComponent(enc), all = { ...((userProfile && userProfile.clientInfo) || {}) }, x = all[k]; if (!x) return;
  if (!confirm(`Убрать «${x.n || k}» из добавленных заранее?`)) return;
  delete all[k];
  try { await db.collection('users').doc(savedUid).update({ clientInfo: all }); userProfile.clientInfo = all; } catch (e) { alert('Не удалось: ' + (e.message || e)); return; }
  cabRerender();
}

// ---- «Создать вручную» и «Загрузить таблицу» прямо из Кабинета (формы мобильной версии — окном по центру) ----
function cabEnsureSheet() {
  if (document.getElementById('pkSheet')) return;
  const bg = document.createElement('div'); bg.className = 'pk-sheet-bg'; bg.id = 'pkSheetBg'; bg.onclick = () => { if (typeof pkSheetClose === 'function') pkSheetClose(); };
  const sh = document.createElement('div'); sh.className = 'pk-sheet'; sh.id = 'pkSheet'; sh.setAttribute('role', 'dialog');
  document.body.appendChild(bg); document.body.appendChild(sh);
}
function cabManualOpen() {
  if (typeof pkNewManual !== 'function') { alert('Обновите страницу'); return; }
  cabEnsureSheet();
  document.body.classList.add('pk-cabman');
  let bk = document.getElementById('cabManBk');
  if (!bk) { bk = document.createElement('div'); bk.id = 'cabManBk'; bk.className = 'cab-manbk'; bk.onclick = () => { if (typeof pkManBack === 'function') pkManBack(); }; document.body.appendChild(bk); }
  if (!window.__cabManW && typeof pkManClose === 'function') {   // закрыли форму (сохранили или вышли) — обновить Кабинет
    window.__cabManW = 1;
    const orig = window.pkManClose;
    window.pkManClose = function () {
      const r = orig.apply(this, arguments);
      if (document.body.classList.contains('pk-cabman')) {
        document.body.classList.remove('pk-cabman');
        if (cabInCabinet()) setTimeout(() => loadCabinetData().then(() => { if (!cabShipId) cabNav(cabCurrentSection || 'shipments'); }), 600);
      }
      return r;
    };
  }
  pkNewManual();
  // закрыли окно названия «Отменой» — снять затемнение Кабинета
  const t = setInterval(() => { const sh = document.getElementById('pkSheetBg');   // фон шторки включается сразу, без анимации
    if (typeof pkMan !== 'undefined' && pkMan) { clearInterval(t); return; }   // форма товаров открыта — затемнение снимет pkManClose
    if (!sh || !sh.classList.contains('on')) { clearInterval(t); document.body.classList.remove('pk-cabman'); } }, 300);
}
// «+ Добавить позицию» в открытую закупку (06.11.2026): форма как в «Закупке вручную» (mobile.js → pkAddItems),
// после сохранения перечитываем закупку и остаёмся на «Товарах и ценах».
function cabAddItemsOpen() {
  if (typeof pkAddItems !== 'function' || !cabShipId) { alert('Обновите страницу'); return; }
  cabEnsureSheet();
  document.body.classList.add('pk-cabman');
  let bk = document.getElementById('cabManBk');
  if (!bk) { bk = document.createElement('div'); bk.id = 'cabManBk'; bk.className = 'cab-manbk'; bk.onclick = () => { if (typeof pkManBack === 'function') pkManBack(); }; document.body.appendChild(bk); }
  const id = cabShipId;
  pkAddItems(id, async () => {
    document.body.classList.remove('pk-cabman');
    await loadCabinetData();
    if (cabShipId === id) { await loadShipmentData(id, true); cabShipTab = 'items'; cabRenderShip(); }
  });
  // закрыли без добавления — снять затемнение
  const t = setInterval(() => { if (typeof pkMan !== 'undefined' && pkMan) return; clearInterval(t); document.body.classList.remove('pk-cabman'); }, 400);
}
// «Создать закупку» — то же окно «Новая закупка», что на телефоне (pkNewShip): расширение / таблица / вручную
function cabNewShipOpen() {
  if (typeof pkNewShip !== 'function') { cabManualOpen(); return; }
  cabEnsureSheet();
  pkNewShip();
}
function cabUploadOpen() {
  if (typeof openUploadModal !== 'function') return;
  if (!window.__cabUpW && typeof uploadCSV === 'function') {
    window.__cabUpW = 1;
    const orig = window.uploadCSV;
    window.uploadCSV = async function () { const r = await orig.apply(this, arguments); if (cabInCabinet()) { await loadCabinetData(); if (!cabShipId) cabNav(cabCurrentSection || 'shipments'); } return r; };
  }
  openUploadModal();
}

// ---- Закупка: «⋯» (архив, Excel, удалить) и удаление с подтверждением ----
function cabShipMore(ev, id) {
  ev.stopPropagation(); cabRowMenuClose();
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const done = ship.status === 'done';
  const m = document.createElement('div'); m.className = 'cab-menu'; m.id = 'cabRowMenu';
  m.innerHTML = `<button onclick="cabRowMenuClose();cabShipArchive('${id}',${done ? 0 : 1})"><i class="ti ${done ? 'ti-archive-off' : 'ti-archive'}"></i>${done ? 'Вернуть из архива' : 'В архив'}</button>
    <button onclick="cabRowMenuClose();cabShipCSV('${id}')"><i class="ti ti-file-spreadsheet"></i>Скачать расчёт (Excel / CSV)</button>
    <button onclick="cabRowMenuClose();cabNamesClean('${id}')"><i class="ti ti-wand"></i>Почистить названия</button>
    <button class="r" onclick="cabRowMenuClose();cabShipDel('${id}')"><i class="ti ti-trash"></i>Удалить закупку</button>`;
  document.body.appendChild(m);
  const r = ev.currentTarget.getBoundingClientRect(), mw = 260;
  m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
  m.style.top = (r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('click', cabRowMenuClose, { once: true }), 0);
}
// «Почистить названия» (06.11.2026): тот же словарь, что в расширении (pknames.js → pkNameFix). Сначала показываем
// «было → станет», меняем только по кнопке «Применить». Пустые названия не трогаем.
let cabNamesFix = null;
function cabNamesClean(id) {
  if (typeof pkNameFix !== 'function') { alert('Обновите страницу'); return; }
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const ch = [];
  (ship.data || []).forEach((r, i) => { const n = Array.isArray(r) ? '' : String(r.n || '').trim(); if (!n) return; const f = pkNameFix(n); if (f && f !== n) ch.push({ i, from: n, to: f }); });
  cabNamesFix = { id, ch };
  const ov = document.createElement('div'); ov.className = 'cab-ovl'; ov.id = 'cabNamesOv'; ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div class="cab-dlg" style="max-width:620px"><div class="cab-dlg-h"><b>Почистить названия</b><button class="cab-dlg-x" onclick="document.getElementById('cabNamesOv').remove()"><i class="ti ti-x"></i></button></div>
    <div style="padding:4px 2px 10px;color:#4a5260;font-size:14px;line-height:1.5">${ch.length ? `Уберём «2026», «новинка», повторы и обрывки, английские слова переведём: <b>${ch.length}</b> ${cabPl(ch.length, 'название', 'названия', 'названий')} из ${(ship.data || []).length}.` : 'Все названия уже в порядке — чистить нечего.'}</div>
    ${ch.length ? `<div class="cab-nf-list">${ch.slice(0, 200).map(x => `<div class="cab-nf"><span class="f">${cabEsc(x.from)}</span><i class="ti ti-arrow-right"></i><b>${cabEsc(x.to)}</b></div>`).join('')}</div>` : ''}
    <div class="cab-dlg-f"><span>${ch.length ? 'Любое название потом можно поправить вручную' : ''}</span>${ch.length ? `<button class="cab-eb" onclick="cabNamesApply(this)"><i class="ti ti-check"></i>Применить</button>` : `<button class="cab-filter-btn" onclick="document.getElementById('cabNamesOv').remove()">Закрыть</button>`}</div></div>`;
  document.body.appendChild(ov);
}
async function cabNamesApply(btn) {
  const F = cabNamesFix; if (!F || !F.ch.length) return;
  btn.disabled = true; btn.textContent = 'Сохраняю…';
  try {
    const ref = shipmentsRef().doc(F.id);
    await db.runTransaction(async t => {
      const doc = await t.get(ref); if (!doc.exists) return;
      const data = doc.data().data || [];
      for (const x of F.ch) { const r = data[x.i]; if (!r || Array.isArray(r) || String(r.n || '').trim() !== x.from) continue; r.n = x.to; }
      t.update(ref, { data });
    });
    document.getElementById('cabNamesOv').remove();
    await loadCabinetData();
    if (cabShipId === F.id) { await loadShipmentData(F.id, true); cabRenderShip(); }
    if (typeof showToast === 'function') showToast('Названия почищены · ' + F.ch.length);
  } catch (e) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i>Применить'; alert('Не сохранилось: ' + (e.message || e)); }
}
async function cabShipArchive(id, on) {
  if (on && !confirm('Отправить закупку в архив? Она пропадёт из активных, статистика сохранится.')) return;
  if (cabShipId !== id) return;
  await cabSetStatus(on ? 'done' : 'sorted');
  cabRenderShip();
}
function cabShipDel(id) {
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const n = (ship.data || []).length, cl = cabGetClientsFromShipment(ship).clients.length;
  const paid = Object.values(ship.payments || {}).some(p => p && p.paid > 0);
  const lim = typeof pkLimDelNote === 'function' ? pkLimDelNote(ship).trim() : '';
  const ov = document.createElement('div'); ov.className = 'cab-ovl'; ov.id = 'cabDelOvl';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div class="cab-dlg cab-del">
    <span class="ic"><i class="ti ti-trash"></i></span>
    <h3>Удалить «${cabEsc(ship.name || 'Без названия')}»?</h3>
    <p>Удалится вместе со всем, что внутри:</p>
    <ul><li>${n} ${cabPl(n, 'позиция', 'позиции', 'позиций')}${cl ? `, ${cl} ${cabPl(cl, 'клиент', 'клиента', 'клиентов')} в ней` : ''}</li><li>веса, ${paid ? '<b>внесённые оплаты</b>' : 'оплаты'} и отметки сканирования</li></ul>
    ${lim ? `<p class="lim">${cabEsc(lim)}</p>` : ''}
    <p class="warn">Вернуть нельзя. Если закупка просто закончилась — лучше «В архив», статистика сохранится.</p>
    <div class="row"><button type="button" class="cab-eb gh" onclick="document.getElementById('cabDelOvl').remove()">Отмена</button><button type="button" class="cab-eb red" id="cabDelGo" onclick="cabShipDelGo('${id}')"><i class="ti ti-trash"></i>Да, удалить</button></div>
  </div>`;
  document.body.appendChild(ov);
}
async function cabShipDelGo(id) {
  const b = document.getElementById('cabDelGo'); if (b) { b.disabled = true; b.textContent = 'Удаляю…'; }
  const ship = cabShipmentsCache.find(s => s.id === id);
  try {
    await shipmentsRef().doc(id).delete();
    if (typeof pkLimDeleted === 'function') try { await pkLimDeleted(ship); } catch (e) {}
    try { if (typeof scannedRef === 'function') await scannedRef(id).delete(); } catch (e) {}
  } catch (e) { if (b) { b.disabled = false; b.innerHTML = '<i class="ti ti-trash"></i>Да, удалить'; } alert('Не удалось удалить: ' + (e.message || e)); return; }
  const ov = document.getElementById('cabDelOvl'); if (ov) ov.remove();
  if (typeof activeShipmentId !== 'undefined' && activeShipmentId === id) activeShipmentId = null;
  if (typeof editingShipmentId !== 'undefined' && editingShipmentId === id) editingShipmentId = null;
  const wasOpen = cabShipId === id; cabShipId = null;
  try { if (typeof loadShipments === 'function') await loadShipments(); } catch (e) {}
  await loadCabinetData();
  if (wasOpen || cabCurrentSection === 'shipments') cabNav('shipments'); else cabRerender();
  if (typeof showToast === 'function') showToast(`Закупка «${(ship && ship.name) || ''}» удалена`);
}

// ============ ОПЛАТА КЛИЕНТА ПО ВСЕМ ЗАКУПКАМ (03.11.2026) ============
// Одна сумма «сколько дал сейчас» гасит долги от самой старой рассортированной закупки к новой.
// Дал больше общего долга — излишек ложится переплатой на самую новую (в рассортированной — в прибыль).
function cabShipTime(s) {
  const d = cabShipDate(s); if (d) return d.getTime();
  const c = s && s.created; if (!c) return 0;
  const t = c.seconds ? c.seconds * 1000 : new Date(c).getTime();
  return isFinite(t) ? t : 0;
}
// долги клиента (m — строка из cabClientsSummary) по закупкам, старые сначала
function cabClientDebts(m) {
  return (m && m.ships || []).filter(x => !x.c.isOwner && cabIsBilled(x.ship) && x.c.payRest > 0.004)
    .map(x => ({ ship: x.ship, key: x.c.name, due: Math.round((x.c.settle ? x.c.dueBeforeSettle : x.c.due) * 100) / 100, paid: Math.round((x.c.payPaid || 0) * 100) / 100, rest: Math.round(x.c.payRest * 100) / 100 }))
    .sort((a, b) => cabShipTime(a.ship) - cabShipTime(b.ship));
}
function cabFifoPlan(debts, amount) {
  let left = Math.round((amount || 0) * 100) / 100;
  const rows = debts.map(d => { const add = Math.min(d.rest, left); left = Math.round((left - add) * 100) / 100; return { ...d, add, after: Math.round((d.rest - add) * 100) / 100 }; });
  return { rows, extra: left > 0.004 ? left : 0 };
}
// записать: возвращает «как было» — для «Отменить»
async function cabFifoApply(debts, amount) {
  const P = cabFifoPlan(debts, amount), now = new Date().toISOString(), prev = [];
  const last = P.rows[P.rows.length - 1];
  for (const r of P.rows) {
    const add = r.add + (r === last ? P.extra : 0);
    if (!(add > 0.004)) continue;
    const cur = (r.ship.payments || {})[r.key];
    prev.push([r.ship.id, r.key, cur ? { ...cur } : null]);
    await cabTxMapField(r.ship.id, 'payments', r.key, { paid: Math.round((r.paid + add) * 100) / 100, at: now });
  }
  return { prev, plan: P };
}
async function cabFifoUndo(prev) { for (const [id, k, v] of prev) await cabTxMapField(id, 'payments', k, v); }
function cabFifoRowsHtml(debts, amount, fmt) {
  const P = cabFifoPlan(debts, amount);
  const rows = P.rows.map(r => `<div class="r"><span>${cabEsc(r.ship.name || 'Закупка')}<small>${r.add > 0.004 ? fmt(r.paid + r.add) + ' из ' + fmt(r.due) : 'не трогаем'}</small></span>${!(r.add > 0.004) ? `<span class="no">долг ${fmt(r.rest)}</span>` : r.after < 0.005 ? '<span class="ok"><i class="ti ti-circle-check"></i> закрыта</span>' : `<span class="pt">останется ${fmt(r.after)}</span>`}</div>`).join('');
  const ex = P.extra > 0.004 ? `<div class="r"><span>Переплата ${fmt(P.extra)}<small>на «${cabEsc(P.rows[P.rows.length - 1].ship.name || 'Закупка')}» — засчитаем в прибыль</small></span><span class="ov"><i class="ti ti-trending-up"></i></span></div>` : '';
  return `<span class="h">Куда пойдут деньги — от старой к новой</span>${rows}${ex}`;
}

// ---- Кабинет: карточка клиента → «Внести оплату» ----
let cabFifo = null;
function cabFifoOpen(enc) {
  const name = decodeURIComponent(enc);
  const m = cabClientsSummary().list.find(x => x.name.toLowerCase() === name.toLowerCase()); if (!m) return;
  const debts = cabClientDebts(m); if (!debts.length) return;
  const total = Math.round(debts.reduce((n, d) => n + d.rest, 0) * 100) / 100;
  cabFifo = { name: m.name, debts, total };
  const ov = document.createElement('div'); ov.className = 'cab-ovl'; ov.id = 'cabFifoOvl';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div class="cab-dlg cab-fifo">
    <div class="cab-dlg-h">Оплата · ${cabEsc(cabFullName(m.name))}<button class="cab-dlg-x" onclick="document.getElementById('cabFifoOvl').remove()" aria-label="Закрыть"><i class="ti ti-x"></i></button></div>
    <div class="cab-fifo-3"><div><small>Должна всего</small><b>${cabFmt2(total)}</b></div><div><small>Дала сейчас</small><b id="cabFifoA" style="color:#16a34a">${cabFmt2(total)}</b></div><div><small>Останется</small><b id="cabFifoL" style="color:#dc2626">0.00</b></div></div>
    <label class="cab-fifo-l">Сколько дала сейчас, BYN<input id="cabFifoIn" inputmode="decimal" autocomplete="off" value="${total.toFixed(2)}" oninput="cabFifoHint()"></label>
    <div class="cab-fifo-chips"><button type="button" onclick="cabFifoSet(${total})">Весь долг · ${cabFmt2(total)}</button><button type="button" onclick="cabFifoSet(${debts[0].rest})">Самую старую · ${cabFmt2(debts[0].rest)}</button></div>
    <div class="cab-fifo-dist" id="cabFifoDist"></div>
    <div class="cab-dlg-f"><span>Нужна одна закупка — впишите оплату в её строке</span><button class="cab-filter-btn" onclick="document.getElementById('cabFifoOvl').remove()">Отмена</button><button class="cab-filter-btn active" id="cabFifoGo" onclick="cabFifoSave()">Записать</button></div>
  </div>`;
  document.body.appendChild(ov);
  cabFifoHint();
  setTimeout(() => { const i = document.getElementById('cabFifoIn'); if (i) { i.focus(); i.select(); } }, 50);
}
const cabFifoVal = () => { const v = parseFloat(String((document.getElementById('cabFifoIn') || {}).value || '').replace(',', '.').replace(/\s/g, '')); return isNaN(v) || v < 0 ? 0 : Math.round(v * 100) / 100; };
function cabFifoSet(v) { const i = document.getElementById('cabFifoIn'); i.value = (+v).toFixed(2); cabFifoHint(); }
function cabFifoHint() {
  if (!cabFifo) return;
  const a = cabFifoVal(), left = Math.max(0, Math.round((cabFifo.total - a) * 100) / 100);
  document.getElementById('cabFifoA').textContent = cabFmt2(a);
  document.getElementById('cabFifoL').textContent = cabFmt2(left);
  document.getElementById('cabFifoDist').innerHTML = a > 0 ? cabFifoRowsHtml(cabFifo.debts, a, cabFmt2) : '';
  const b = document.getElementById('cabFifoGo'); b.disabled = !(a > 0); b.textContent = a > 0 ? 'Записать ' + cabFmt2(a) + ' BYN' : 'Записать';
}
async function cabFifoSave() {
  if (!cabFifo) return;
  const a = cabFifoVal(); if (!(a > 0)) return;
  const extra = cabFifoPlan(cabFifo.debts, a).extra;
  if (extra > 0.004 && !confirm(`Общий долг ${cabFmt2(cabFifo.total)} BYN, вы вносите ${cabFmt2(a)}.\n\nЗасчитать переплату ${cabFmt2(extra)} BYN в прибыль по последней закупке?`)) return;
  const b = document.getElementById('cabFifoGo'); b.disabled = true; b.textContent = 'Сохраняю…';
  let res;
  try { res = await cabFifoApply(cabFifo.debts, a); } catch (e) { b.disabled = false; cabFifoHint(); alert('Не удалось сохранить: ' + (e.message || e)); return; }
  const ov = document.getElementById('cabFifoOvl'); if (ov) ov.remove();
  const left = Math.max(0, Math.round((cabFifo.total - a) * 100) / 100); cabFifo = null;
  cabRerender();
  const msg = left > 0.004 ? `Оплата записана · осталось ${cabFmt2(left)} BYN` : 'Оплата записана · долг закрыт';
  if (typeof pkUndoToast === 'function') pkUndoToast(msg, async () => { try { await cabFifoUndo(res.prev); cabRerender(); } catch (e) { alert('Не получилось отменить: ' + (e.message || e)); } });
  else if (typeof showToast === 'function') showToast(msg);
}
