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
    tariffs: renderCabTariffs,
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
  return { clients: result, rates, totalW, effectiveTare };
}

// ============ ЗАГЛУШКА ============
function renderCabStub(container, section) {
  const names = {
    shipments: 'Приходы', clients: 'Клиенты', prices: 'Цены',
    calc: 'Расчёты', analytics: 'Аналитика', settings: 'Настройки', tariffs: 'Тариф', admin: 'Администрирование'
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
//  Вложено в товар = себестоимость (закупка ¥ × курс закупки + доставка карго после взвешивания), за которую клиенты ещё не рассчитались.
//    Оплата клиента сначала гасит себестоимость; заплатил всё — деньги вернулись. Нет закупочной цены — берём цену клиента ¥ × курс закупки.
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
    ['ti-package', 'Приходов всего', ships.length, inWork ? `${inWork} собирается или в пути` : 'все доставлены'],
    ['ti-shirt', 'Привезено товаров', cabFmt(items), billed.length ? `≈ ${cabFmt(items / billed.length)} за приход` : ''],
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
  money: ['Деньги в обороте', 'Сколько ваших денег сейчас крутится в заказах.<br><b>Вложено в товар</b> — сколько вы потратили на выкуп и доставку карго, а клиенты вам это ещё не вернули. Считается с момента выкупа на Pinduoduo, в любом статусе прихода.<br><b>Получено прибыли</b> — ваша наценка, которую клиенты уже заплатили.<br>Отметили оплату клиента — «вложено» уменьшается, «получено» растёт. Ваши личные покупки («Это я») сюда не входят.'],
  markup: ['Наценка в заказах', 'Разница между тем, сколько платят клиенты, и вашей себестоимостью — по всем текущим заказам.<br><b>Уже получено</b> — клиенты заплатили.<br><b>Рассортировано</b> — товар взвешен, сумма точная, ждём оплаты.<br><b>В пути и в сборке (≈)</b> — только наценка на курс юаня. Наценку на доставку посчитаем, когда приход взвесят, поэтому итог может измениться.<br>Это не обещанная прибыль: если клиент не заберёт или не оплатит заказ, этих денег не будет.'],
  todo: ['Что сделать сейчас', 'Помощник собирает дела, которые приносят деньги или экономят время: кто должен, какой приход собирается, кого из клиентов пора вернуть, какие имена похожи на дубли.<br>Нажмите на строку — откроется нужный раздел.'],
  an_split: ['Куда идут деньги клиентов', 'Всё, что заплатят клиенты по рассортированным приходам, разложено на три части: сколько ушло на выкуп товара, сколько — на доставку карго, и сколько осталось вам (наценка).<br>Приходы в пути сюда не входят: пока нет веса, суммы неточные.'],
  an_src: ['Откуда наценка', 'Наценка складывается из двух частей: <b>на курсе</b> — разница между курсом для клиента и курсом закупки, и <b>на доставке</b> — разница между тем, что клиент платит за кг, и тарифом карго.<br>Если доля доставки маленькая или отрицательная — возможно, стоит поднять «Доставку клиенту» в Ценах.'],
  flow: ['Где сейчас товар', 'Все приходы по этапам: <b>собирается</b> → <b>в пути</b> → <b>на складе</b> → <b>рассортирован</b>.<br>До сортировки показана примерная наценка (без доставки). После сортировки — сколько клиенты ещё должны.<br>Нажмите на приход, чтобы открыть его. Архивные приходы — в разделе «Приходы».']
};
function cabHelpBtn(k) { return `<button class="cab-help" title="Что это?" onclick="cabHelp(event,'${k}')"><i class="ti ti-help-circle"></i></button>`; }
function cabHelp(ev, k) {
  ev.stopPropagation();
  const old = document.getElementById('cabHelpPop'); if (old) { old.remove(); if (old.dataset.k === k) return; }
  const [t, body] = CAB_HELP[k] || ['', ''];
  const m = document.createElement('div');
  m.className = 'cab-help-pop'; m.id = 'cabHelpPop'; m.dataset.k = k;
  m.innerHTML = `<b>${t}</b><div>${body}</div>`;
  document.body.appendChild(m);
  const r = ev.currentTarget.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(window.innerWidth - 348, r.left - 12)) + 'px';
  const h = m.offsetHeight;
  m.style.top = (r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('click', () => { const x = document.getElementById('cabHelpPop'); if (x) x.remove(); }, { once: true }), 0);
}

function renderCabOverview(container) {
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
  if (debtors) todo.push({ ic: 'ti-cash', tone: 'red', t: `${debtors} ${cabPl(debtors, 'клиент должен', 'клиента должны', 'клиентов должны')} <b>${cabFmt(debtSum)} BYN</b>`, s: 'По рассортированным приходам. Отметьте, кто уже заплатил', a: `cabClientFilter='all';cabNav('clients')`, btn: 'Отметить оплаты' });
  for (const s of ships.filter(s => s.status === 'delayed')) todo.push({ ic: 'ti-clock-exclamation', tone: 'orange', t: `<b>${s.name || 'Приход'}</b> задерживается`, s: 'Предупредите клиентов — это сохраняет доверие', a: `cabOpenShip('${s.id}')`, btn: 'Открыть' });
  for (const s of ships.filter(s => s.status === 'forming')) { const n = (s.data || []).length, k = cabGetClientsFromShipment(s).clients.length; todo.push({ ic: 'ti-shopping-cart', tone: 'blue', t: `<b>${s.name || 'Приход'}</b> собирается`, s: `${n} ${cabPl(n, 'позиция', 'позиции', 'позиций')} · ${k} ${cabPl(k, 'клиент', 'клиента', 'клиентов')}. Самое время позвать тех, кто давно не заказывал`, a: `cabOpenShip('${s.id}')`, btn: 'Открыть' }); }
  const once = segN('once'), forg = segN('forgotten');
  if (forg) todo.push({ ic: 'ti-zzz', tone: 'amber', t: `${forg} ${cabPl(forg, 'постоянный клиент пропал', 'постоянных клиента пропали', 'постоянных клиентов пропали')}`, s: 'Заказывали 2+ раза, но давно не было. Как вернуть — подскажем', a: `cabClientFilter='forgotten';cabNav('clients')`, btn: 'Вернуть' });
  if (once) todo.push({ ic: 'ti-repeat', tone: 'sky', t: `${once} ${cabPl(once, 'клиент купил', 'клиента купили', 'клиентов купили')} только один раз`, s: `${cl.length ? Math.round(once / cl.length * 100) : 0}% базы. Второй заказ — главный шаг к постоянному клиенту`, a: `cabClientFilter='once';cabNav('clients')`, btn: 'Как вернуть' });
  if (dupes) todo.push({ ic: 'ti-copy', tone: 'gray', t: `${dupes} ${cabPl(dupes, 'клиент записан', 'клиента записаны', 'клиентов записаны')} по-разному`, s: 'Похожие имена — объедините, чтобы история и долги считались верно', a: `cabClientFilter='all';cabNav('clients')`, btn: 'Проверить' });

  // Где сейчас товар — этапы
  const stages = [
    ['Собирается', ['forming'], 'ti-shopping-cart', '#4a90d9'],
    ['В пути', ['transit', 'delayed'], 'ti-truck', '#d4a106'],
    ['На складе', ['warehouse'], 'ti-building-warehouse', '#3cb371'],
    ['Рассортирован', ['sorted'], 'ti-checks', '#8b7fd4']
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
      <div class="cab-hello-sub">Вот как идут дела: деньги, приходы и что стоит сделать сегодня</div>
    </div>

    <div class="cab-ov-top">
      <div class="cab-card cab-money" title="Деньги в обороте = вложено в товар + полученная прибыль. Вложено — себестоимость товара (закупка + доставка карго), за который клиенты ещё не рассчитались; отсчёт с выкупа на Pinduoduo. Покупки «Это я» не входят">
        <div class="cab-card-l"><i class="ti ti-coins"></i> Деньги в обороте${cabHelpBtn('money')}</div>
        <div class="cab-money-v">${cabFmt(money.turnover)} <small>BYN</small></div>
        <div class="cab-money-bar"><span style="width:${frozenPct}%;background:#6C4DB8"></span>${realPct ? `<span style="width:${realPct}%;background:#16a34a"></span>` : ''}</div>
        <div class="cab-money-leg">
          <div><i style="background:#6C4DB8"></i><span>Вложено в товар</span><b>${cabFmt(money.frozen)} BYN</b><em>ждёт оплаты клиентов · ${money.nShips} ${cabPl(money.nShips, 'приход', 'прихода', 'приходов')}</em></div>
          <div><i style="background:#16a34a"></i><span>Получено прибыли</span><b style="color:#16a34a">${cabFmt(money.realized)} BYN</b><em>уже ваши деньги</em></div>
        </div>
      </div>
      <div class="cab-card cab-wait">
        <div class="cab-card-l"><i class="ti ti-receipt-2"></i> Наценка в заказах${cabHelpBtn('markup')}</div>
        <div class="cab-wait-v">${mk.est > 0.5 ? '≈ ' : ''}${cabFmt(mk.total)} <small>BYN</small></div>
        ${mk.est > 0.5 ? `<div class="cab-wait-warn"><i class="ti ti-scale"></i> Без учёта доставки</div><div class="cab-wait-s">${mk.estShips} ${cabPl(mk.estShips, 'приход ещё не взвешен', 'прихода ещё не взвешены', 'приходов ещё не взвешены')} — итог изменится</div>` : '<div class="cab-wait-s">все приходы взвешены — суммы точные</div>'}
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
      <div class="cab-card-h">Где сейчас товар${cabHelpBtn('flow')}${archived ? `<a href="#" onclick="cabNav('shipments');return false" class="cab-card-link">Архив: ${archived} ${cabPl(archived, 'приход', 'прихода', 'приходов')} →</a>` : ''}</div>
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
  const stages = [['Собирается', ['forming'], 'ti-shopping-cart', '#4a90d9'], ['В пути', ['transit', 'delayed'], 'ti-truck', '#d4a106'], ['На складе', ['warehouse'], 'ti-building-warehouse', '#3cb371'], ['Рассортирован', ['sorted'], 'ti-checks', '#8b7fd4']];
  const inWork = ships.filter(s => s.status !== 'done');
  const steps = stages.map(([l, keys, ic, c]) => {
    const list = ships.filter(s => keys.includes(s.status));
    const pos = list.reduce((n, s) => n + (s.data || []).length, 0);
    return `<div class="cab-step${list.length ? '' : ' off'}" style="--c:${c}"><span class="cab-step-ic"><i class="ti ${ic}"></i></span><b>${list.length}</b><span>${l}</span><em>${list.length ? pos + ' поз.' : '—'}</em></div>`;
  }).join('<i class="ti ti-chevron-right cab-step-arr"></i>');
  // Дольше всех в пути — повод проверить
  const road = ships.filter(s => ['transit', 'delayed', 'warehouse'].includes(s.status)).map(s => ({ s, a: age(s) })).filter(x => x.a !== null).sort((a, b) => b.a - a.a)[0];
  const facts = [];
  if (road) facts.push(`<div class="cab-fact${road.a > 30 ? ' warn' : ''}"><i class="ti ti-clock"></i><span>Дольше всех в пути</span><b>${road.s.name || 'Приход'} — ${road.a} ${cabDaysWord(road.a)}</b></div>`);
  const big = ships.slice().sort((a, b) => (b.data || []).length - (a.data || []).length)[0];
  if (big) facts.push(`<div class="cab-fact"><i class="ti ti-trophy"></i><span>Самый большой приход</span><b>${big.name || 'Приход'} — ${(big.data || []).length} поз.</b></div>`);
  const billed = ships.filter(s => s.status === 'sorted' || s.status === 'done');
  const kg = cabDeliveredKg(ships), items = billed.reduce((n, s) => n + (s.data || []).length, 0);
  if (items) facts.push(`<div class="cab-fact"><i class="ti ti-weight"></i><span>В среднем товар весит</span><b>${(kg / items).toFixed(2)} кг · приход ${cabFmt(kg / billed.length)} кг</b></div>`);
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
      <div class="cab-card-l"><i class="ti ti-route"></i> Сейчас в работе<b class="cab-base-n">${inWork.length} ${cabPl(inWork.length, 'приход', 'прихода', 'приходов')}</b></div>
      <div class="cab-steps">${steps}</div>
      <div class="cab-facts">${facts.join('')}</div>
    </div>
    <div class="cab-card">
      <div class="cab-card-l"><i class="ti ti-chart-bar"></i> Позиций в приходах</div>
      <div class="cab-bars">${bars}</div>
      <div class="cab-bars-sum"><span><b>${ships.length}</b> ${cabPl(ships.length, 'приход', 'прихода', 'приходов')}</span><span><b>${cabFmt(items)}</b> товаров привезено</span><span><b>${kg.toFixed(1)}</b> кг</span></div>
    </div>
  </div>`;
}
let cabShipFilter = 'all';
function renderCabShipments(container) {
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
      <td>${date}</td>
      <td>${(ship.data || []).length}</td>
      <td>${clients.length}</td>
      <td>${cabShipPill(ship.status)}${departed}</td>
      <td class="val-purple">${cabFmt(due)}</td>
      <td class="${profit >= 0 ? 'val-green' : 'val-red'}">${profit >= 0 ? '+' : ''}${cabFmt(profit)}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="cab-main-title">Приходы</div>
    ${cabShipsHero(ships)}
    <div class="cab-table-wrap">
      <div class="cab-table-top">${filterHtml}</div>
      <table class="cab-table" id="cabShipmentsTable">
        <thead><tr><th>Название</th><th title="Когда приход создан в Piksta">Создан</th><th>Позиций</th><th>Клиентов</th><th>Статус</th><th>Должны</th><th>Прибыль</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px">Нет приходов</td></tr>'}</tbody>
      </table>
    </div>`;
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
  cabShipTab = 'items';
  document.querySelectorAll('#cabNav .cab-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === 'shipments'));
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
  const order = ['forming','transit','delayed','warehouse','sorted','done'];
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
    <div class="cab-filter-row" style="align-items:center">${tabs}${cabShipTab === 'calc' ? `<button onclick="cabShipAllPaid()" style="margin-left:auto;flex-shrink:0;background:#fff;color:#16a34a;border:1px solid #86efac;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:500;cursor:pointer"><i class="ti ti-checks"></i> Все оплатили</button><button onclick="cabShipPDF()" style="margin-left:8px;flex-shrink:0;background:#6C4DB8;color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:14px;font-weight:500;cursor:pointer"><i class="ti ti-download"></i> PDF</button>` : ''}</div>
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
      <td><input data-name="${enc}" value="${g}" onchange="cabSetWeight(this)" inputmode="numeric" placeholder="граммы" style="${cabInp};width:110px"></td>
      <td><label style="font-size:13px;color:#5f6470;display:flex;align-items:center;gap:6px"><input type="checkbox" data-name="${enc}" ${incl ? 'checked' : ''} onchange="cabSetIncl(this)"> вес в цене</label></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <div style="display:flex;gap:16px;flex-wrap:nowrap;align-items:flex-end;margin-bottom:16px">
      <label style="font-size:13px;color:#5f6470">Вес от карго, г<br><input value="${currentCargoWeight ? Math.round(currentCargoWeight * 1000) : ''}" onchange="cabSetCargo(this)" inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:13px;color:#5f6470">Вес тары, г<br><input value="${currentTare ? Math.round(currentTare * 1000) : ''}" onchange="cabSetTare(this)" ${currentTarePct > 0 ? 'disabled' : ''} inputmode="numeric" style="${cabInp};width:130px;margin-top:4px"></label>
      <label style="font-size:14px;color:#1a1a2e;display:flex;align-items:center;gap:6px;padding-bottom:6px" title="К весу каждого взвешенного клиента +8%, тару по карго не высчитываем"><input type="checkbox" ${currentTarePct > 0 ? 'checked' : ''} onchange="onTarePctChange(this.checked);cabRenderShip()"> Тара 8%</label>
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
  const chk = (field, c, label) => `<label style="font-size:14px;color:#4a5260;display:flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer"><input type="checkbox" ${field[c.name] ? 'checked' : ''} data-name="${encodeURIComponent(c.name)}" onchange="cabToggleCost(this,'${field === currentCostGoods ? 'goods' : 'ship'}')"> ${label}</label>`;
  const shipC = cabShipmentsCache.find(s => s.id === cabShipId) || {};
  const pinp = 'padding:5px 7px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;width:80px;box-sizing:border-box';
  const rows = calc.clients.map(c => {
    const pi = cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, c.isOwner);
    const payCells = c.isOwner ? '<td>—</td><td>—</td>'
      : `<td style="font-weight:600;white-space:nowrap;color:${pi.rest > 0.004 ? '#dc2626' : '#16a34a'}">${cabFmt2(pi.rest)}</td>
         <td><div style="display:flex;align-items:center;gap:10px"><input value="${pi.paid ? pi.paid.toFixed(2) : ''}" placeholder="0" onchange="cabCardSetPaid('${cabShipId}','${encodeURIComponent(c.name)}',this.value)" inputmode="decimal" style="${pinp}"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" title="Полностью оплачено" ${pi.status === 'full' ? 'checked' : ''} onchange="cabCardSetPaid('${cabShipId}','${encodeURIComponent(c.name)}', this.checked ? '${c.due.toFixed(2)}' : '0')" style="margin:0">${cabPayBadge(pi.status)}</label></div></td>`;
    const dueCell = c.isOwner ? '—'
      : `<a href="#" onclick="cabEditDue('${encodeURIComponent(c.name)}');return false" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + cabFmt2(c.dueCalc) + '. Нажмите, чтобы изменить' : 'Нажмите, чтобы изменить задолженность'}" style="color:#6C4DB8;text-decoration:none;border-bottom:1px dashed #b9a8e3">${cabFmt2(c.due)}</a>${c.dueEdited ? ' <i class="ti ti-pencil" style="font-size:14px;color:#f59e0b" title="Исправлено вручную"></i>' : ''}`;
    return `<tr style="${c.isOwner ? 'background:#fef2f2' : ''}">
      <td style="font-weight:500">${c.name}${c.noWeight ? ' <span title="Вес не указан" style="color:#f59e0b">⚠</span>' : ''}</td>
      <td style="white-space:nowrap">${c.count}</td>
      <td style="white-space:nowrap">${cabFmt2(c.shipWeight)}</td>
      <td style="white-space:nowrap">${cabCalcGoodsCell(c)}</td>
      <td style="white-space:nowrap">${cabCalcShipCell(c)}</td>
      <td class="val-purple" style="white-space:nowrap">${dueCell}</td>
      <td class="${c.profit >= 0 ? 'val-green' : 'val-red'}" style="white-space:nowrap">${c.profit >= 0 ? '+' : ''}${cabFmt2(c.profit)}</td>
      ${payCells}
      <td><div style="display:flex;flex-direction:column;gap:3px">${chk(currentCostGoods, c, 'Товар')}${chk(currentCostShip, c, 'Доставка')}</div></td>
    </tr>`;
  }).join('');
  return `<div class="cab-table-wrap">
    <div style="font-size:13px;color:#6b7280;margin-bottom:8px">Суммы в BYN, вес — с долей тары. <span class="cab-atcost">Подчёркнутые</span> — по себестоимости</div>
    <div style="overflow-x:auto;margin:0 -4px;padding:0 4px">
    <table class="cab-table" style="background:#fff">
      <thead><tr><th>Клиент</th><th>Поз.</th><th title="Вес клиента с его долей тары">Вес, кг</th><th>Товар</th><th>Доставка</th><th>Должен</th><th>Прибыль</th><th>Остаток</th><th>Оплата</th><th>По себест.</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:600"><td>Итого</td><td colspan="4" style="white-space:nowrap">Тара: ${cabFmt2(calc.tareTotal)} кг</td><td class="val-purple" style="white-space:nowrap">${cabFmt2(calc.grandDue)}</td><td class="${calc.grandProfit >= 0 ? 'val-green' : 'val-red'}" style="white-space:nowrap">${calc.grandProfit >= 0 ? '+' : ''}${cabFmt2(calc.grandProfit)}</td><td style="color:#dc2626;white-space:nowrap">${cabFmt2(calc.clients.reduce((n, c) => n + (c.isOwner ? 0 : cabPayInfo(shipC.payments, shipC.paid, c.name, c.due, false).rest), 0))}</td><td></td><td></td></tr></tfoot>
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
  if (!cabMergeSkipConfirm && !confirm(`Объединить клиента «${fromName}» с «${toName}»?\n\nВо всех приходах (${touched.length}) имя «${fromName}» заменится на «${toName}», вместе с весами и оплатами.\nОтменить автоматически нельзя.`)) return;
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
  } catch (e) { alert('Не удалось объединить: ' + e.message); }
  await loadCabinetData();
  cabClientOpen = cabClientOpen ? toName : null;
  renderCabClients(document.getElementById('cabMain'));
}
function cabMergeDupe(encFrom, encTo) { cabMergeClients(decodeURIComponent(encFrom), decodeURIComponent(encTo)); }
// Группа: присоединить все варианты к основному имени по очереди (подтверждение — одно на всю группу)
async function cabMergeGroup(encList, encTo) {
  const from = JSON.parse(decodeURIComponent(encList)), to = decodeURIComponent(encTo);
  if (!confirm(`Объединить в «${to}» клиентов: ${from.map(x => '«' + x + '»').join(', ')}?\n\nВо всех приходах эти имена заменятся на «${to}», вместе с весами и оплатами. Отменить автоматически нельзя.`)) return;
  cabMergeSkipConfirm = true;
  try { for (const f of from) await cabMergeClients(f, to); } finally { cabMergeSkipConfirm = false; }
}
let cabMergeSkipConfirm = false;
// Из карточки клиента: выбранного клиента присоединить к открытому
function cabMergeIntoOpen(sel) {
  const from = sel.value; sel.selectedIndex = 0;
  if (from && cabClientOpen) cabMergeClients(from, cabClientOpen);
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
    why: 'Заказывали 2+ раза, но в трёх последних приходах их нет. Обычно причина простая: забыли, нашли дешевле или что-то не понравилось. Часто хватает одного личного сообщения.',
    tips: [
      ['Напишите лично, по имени', '«Давно вас не было — всё в порядке?» Спросите, что можно улучшить. Ответ подскажет, как вернуть и других.'],
      ['Предложение на возвращение', 'Бонус или скидка, которые действуют только до ближайшей отправки — есть повод не откладывать.'],
      ['Напомните, что брали', 'Покажите похожие новинки к их прошлым покупкам — так проще захотеть снова.'],
      ['Скоро: уведомления в Piksta', 'Напоминание о новой отправке придёт клиенту прямо в приложение.']
    ],
    msg: 'Здравствуйте, {имя}! Давно вас не было в наших заказах — всё хорошо? Собираю отправку до {дата}. Для тех, кто с нами давно, — {бонус}. Если в прошлый раз что-то не понравилось, напишите — исправлю.'
  },
  new: {
    ic: 'ti-sparkles', title: n => `${n} ${cabPl(n, 'новый клиент', 'новых клиента', 'новых клиентов')} в последнем приходе`,
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
    ic: 'ti-heart', title: n => `${n} ${cabPl(n, 'клиент заказывает', 'клиента заказывают', 'клиентов заказывают')} каждый приход`,
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
    why: 'Были в 2+ приходах и недавно. Цель — чтобы заказывали каждый приход, как активные.',
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
const CAB_MSG_CTX = [
  ['Распродажа 11.11', d => (d.m === 10 && d.d >= 15) || (d.m === 11 && d.d <= 11), 'Скоро 11.11 — главная распродажа в Китае, цены на Pinduoduo самые низкие в году. Собираю заказы до {дата}.'],
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
    return `<tr>
      <td class="cab-sel-td"><input type="checkbox" data-sel="${enc}" ${cabSel.has(c.name) ? 'checked' : ''} onchange="cabSelToggle('${enc}',this.checked)"></td>
      <td style="font-weight:500"><a href="#" onclick="cabOpenClient('${encodeURIComponent(c.name)}');return false" style="color:#6C4DB8;text-decoration:none">${c.name}</a>${ownerBadge}</td>
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
    <div class="cab-main-title">Клиенты</div>
    ${(() => {
      const cl = all.filter(c => !c.isOwner), tot = cl.length || 1;
      const segs = [['new', 'Новые', 'Впервые в самом свежем приходе'], ['active', 'Активные', 'Есть в двух последних приходах'], ['regular', 'Обычные', 'Заказывают время от времени, были недавно'], ['once', 'Разовые', 'Заказывали только в одном приходе'], ['forgotten', 'Забытые', 'Были в 2+ приходах, но в трёх последних их нет']]
        .map(([k, l, t]) => ({ k, l, t, n: cl.filter(c => c.status === k).length }));
      const bar = segs.filter(x => x.n).map(x => `<span class="${cabClientFilter === x.k ? 'on' : ''}" style="flex:${x.n};background:${CAB_SEG_BAR[x.k]}" title="${x.l}: ${x.n} — ${x.t}" onclick="cabSetClientFilter(cabClientFilter === '${x.k}' ? 'all' : '${x.k}')"></span>`).join('');
      const leg = segs.map(x => `<span class="cab-base-chip${cabClientFilter === x.k ? ' on' : ''}" title="${x.t}. Нажмите — показать в списке" onclick="cabSetClientFilter(cabClientFilter === '${x.k}' ? 'all' : '${x.k}')"><i style="background:${CAB_SEG_BAR[x.k]}"></i>${x.l}<b>${x.n}</b><em>${Math.round(x.n / tot * 100)}%</em></span>`).join('')
        + `<span class="cab-base-chip champ${cabClientFilter === 'champ' ? ' on' : ''}" title="Чаще всех заказывают, были недавно и приносят больше всего" onclick="cabSetClientFilter(cabClientFilter === 'champ' ? 'all' : 'champ')"><i class="ti ti-trophy"></i>Чемпионы<b>${champs.length}</b></span>`;
      return `<div class="cab-ov-top cab-cl-top">
        <div class="cab-card">
          <div class="cab-card-l"><i class="ti ti-users"></i> Клиентская база<b class="cab-base-n">${cl.length}</b>${cabClientFilter !== 'all' ? `<a href="#" class="cab-card-link" onclick="cabSetClientFilter('all');return false">Показать всех ×</a>` : ''}</div>
          <div class="cab-base-bar">${bar}</div>
          <div class="cab-base-leg">${leg}</div>
        </div>
        ${(() => {
          let billed = 0, paid = 0;
          for (const ship of cabShipmentsCache) { if (!cabIsBilled(ship)) continue; for (const c of cabGetClientsFromShipment(ship).clients) { if (c.isOwner) continue; billed += c.due; paid += Math.min(c.due, c.payPaid || 0); } }
          const pct = billed > 0 ? Math.round(paid / billed * 100) : 100;
          return `<div class="cab-card cab-debt" title="Только по рассортированным и архивным приходам. Деньги, вложенные в ещё не оплаченный товар, — в Обзоре">
          <div class="cab-card-l"><i class="ti ti-cash"></i> Должны вам</div>
          <div class="cab-debt-v">${cabFmt(totalUnpaid)} <small>BYN</small></div>
          <div class="cab-debt-bar"><span style="width:${Math.max(pct, paid > 0 ? 2 : 0)}%"></span></div>
          <div class="cab-debt-p"><span>Собрано <b>${cabFmt(paid)}</b> из ${cabFmt(billed)} BYN</span><b>${pct}%</b></div>
          <div class="cab-debt-s">${debtors} ${cabPl(debtors, 'клиент', 'клиента', 'клиентов')} · по рассортированным приходам<a href="#" onclick="document.getElementById('cabClientsTable').scrollIntoView({behavior:'smooth'});return false">к списку ↓</a></div>
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
      <div style="display:flex;gap:2px;flex-wrap:nowrap;margin-bottom:10px">
        ${fbtn('all', 'Все')}${fbtn('new', 'Новые')}${fbtn('active', 'Активные')}${fbtn('regular', 'Обычные')}${fbtn('once', 'Разовые')}${fbtn('forgotten', 'Забытые')}${fbtn('champ', 'Чемпионы')}
      </div>
      ${folderRow}
      <div id="cabSelBar" class="cab-selbar" style="display:none"></div>
      <table class="cab-table" id="cabClientsTable">
        <thead><tr><th class="cab-sel-td"><input type="checkbox" title="Отметить всех в списке" onchange="cabSelAllVisible(this.checked)"></th><th>Клиент</th><th>Статус</th><th>Приходов</th><th>Позиций</th><th>Вес</th><th>Долг (не оплачено)</th><th>Всего BYN</th><th>Прибыль</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#6b7280;padding:20px">Нет клиентов</td></tr>'}</tbody>
      </table>
    </div>`;
  cabSelBar();
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
    const date = cabNameHasDate(ship) ? '' : cabShipDateStr(ship);
    const sst = SHIP_STATUSES[ship.status] || SHIP_STATUSES.forming;
    const inp = 'padding:5px 7px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;width:92px;box-sizing:border-box';
    const paidHtml = c.isOwner ? '<div onclick="event.stopPropagation()" style="grid-column:5/9;font-size:13px;color:#dc2626;cursor:default">свой склад</div>'
      : `<div onclick="event.stopPropagation()" style="cursor:default"><input value="${c.due.toFixed(2)}" title="${c.dueEdited ? 'Исправлено вручную. По расчёту: ' + c.dueCalc.toFixed(2) + '. Пусто — вернуть расчётную' : 'Можно исправить сумму. Пусто — вернуть расчётную'}" onchange="cabCardSetDue('${ship.id}','${enc}',this.value)" inputmode="decimal" style="${inp};color:#6C4DB8;font-weight:600${c.dueEdited ? ';border-color:#f59e0b' : ''}"></div>
        <div onclick="event.stopPropagation()" style="cursor:default"><input value="${c.payPaid ? c.payPaid.toFixed(2) : ''}" placeholder="0" onchange="cabCardSetPaid('${ship.id}','${enc}',this.value)" inputmode="decimal" style="${inp}"></div>
        <b onclick="event.stopPropagation()" ${cabIsBilled(ship) ? '' : 'title="Приход ещё не рассортирован — в долг не входит"'} style="justify-self:end;font-size:14px;cursor:default;color:${!cabIsBilled(ship) ? '#9aa0ab' : c.payRest > 0.004 ? '#dc2626' : '#16a34a'}">${cabFmt2(c.payRest)}</b>
        <label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" title="Отметить полностью оплаченным" ${c.payStatus === 'full' ? 'checked' : ''} onchange="cabCardSetPaid('${ship.id}','${enc}', this.checked ? '${c.due.toFixed(2)}' : '0')" style="width:16px;height:16px;margin:0;cursor:pointer">${cabPayBadge(c.payStatus)}</label>`;
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div class="cab-main-title" style="margin:0">${m.name}</div>
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
    <div style="overflow-x:auto;padding-bottom:2px">
      <div class="cab-cships">
        <div class="cab-cship cab-cship-head"><div class="cab-cship-row">
          <span></span><span>Приход</span><span>Статус</span><span style="justify-self:end">Позиций</span><span>Итого, BYN</span><span>Оплачено, BYN</span><span style="justify-self:end">Остаток</span><span>Оплата</span>
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
// «Все оплатили»: отметить всех клиентов прихода (кроме «это я») оплатившими полностью — только с подтверждением
async function cabShipAllPaid() {
  const ship = cabShipmentsCache.find(s => s.id === cabShipId); if (!ship) return;
  const { clients } = cabGetClientsFromShipment(ship);
  const left = clients.filter(c => !c.isOwner && c.payRest > 0.004);
  if (!left.length) { alert('Все клиенты этого прихода уже оплатили.'); return; }
  const sum = left.reduce((n, c) => n + c.payRest, 0);
  const warn = cabIsBilled(ship) ? '' : '\n\nВнимание: приход ещё не рассортирован — суммы могут измениться после взвешивания.';
  if (!confirm(`Отметить оплатившими полностью ${left.length} клиентов прихода «${ship.name || ''}»?\nОстаток к оплате: ${cabFmt2(sum)} BYN.${warn}\n\nОтменить можно у каждого клиента вручную.`)) return;
  try {
    for (const c of left) await cabSavePayment(ship.id, cabClientKey(ship, c.name), Math.round(c.due * 100) / 100);
  } catch (e) { alert('Не удалось сохранить: ' + e.message); }
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

// ---- БАЗОВЫЕ КУРСЫ: users/{uid}.baseRates — с ними создаются новые приходы (и в мобильной версии) ----
const CAB_RATE_FIELDS = [
  ['clientRate', 'Курс для клиента', 'BYN за 1 ¥', 2],
  ['buyRate', 'Курс закупки', 'BYN за 1 ¥', 2],
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
  if (forming.length && confirm(`Базовый курс сохранён.\n\nПрименить его и к формирующимся приходам (${forming.map(s => '«' + (s.name || 'Без названия') + '»').join(', ')})?`)) {
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
    ${done ? '' : `<button onclick="cabRowMenuClose();cabOpenShip('${id}')"><i class="ti ti-external-link"></i>Открыть приход</button>`}`;
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
  if (!confirm(`Сделать курсы прихода «${ship.name || 'Без названия'}» базовыми?\nС ними будут создаваться новые приходы.`)) return;
  try { await db.collection('users').doc(savedUid).update({ baseRates: r }); userProfile.baseRates = r; } catch (e) { alert('Не удалось сохранить: ' + e.message); return; }
  renderCabPrices(document.getElementById('cabMain'));
}
// Выгрузка расчёта по клиентам прихода: CSV с «;» и BOM — открывается в Excel с кириллицей
function cabShipCSV(id) {
  const ship = cabShipmentsCache.find(s => s.id === id); if (!ship) return;
  const { clients, rates } = cabGetClientsFromShipment(ship);
  const n = v => (Math.round((v || 0) * 100) / 100).toFixed(2).replace('.', ',');
  const lines = [
    [`Приход: ${ship.name || ''}`], [`Курс для клиента ${rates.clientRate} BYN/¥; курс закупки ${rates.buyRate} BYN/¥; доставка клиенту ${rates.shipClient} BYN/кг; карго ${rates.shipCargo} BYN/кг`], [],
    ['Клиент', 'Позиций', 'Вес, кг', 'Сумма, ¥', 'Должен, BYN', 'Оплачено, BYN', 'Остаток, BYN', 'Прибыль, BYN']
  ];
  for (const c of clients) lines.push([c.name + (c.isOwner ? ' (свой)' : ''), c.items, n(c.weight), n(c.clientYuan), n(c.due), n(c.payPaid), n(c.payRest), n(c.profit)]);
  const t = cabShipTotals(ship);
  lines.push(['Итого', clients.reduce((a, c) => a + c.items, 0), n(t.weight), n(t.yuan), n(t.due), n(clients.reduce((a, c) => a + (c.payPaid || 0), 0)), n(clients.reduce((a, c) => a + (c.isOwner ? 0 : c.payRest), 0)), n(t.profit)]);
  const csv = String.fromCharCode(0xFEFF) + lines.map(r => r.map(x => { const s = String(x); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Piksta — ${(ship.name || 'приход').replace(/[\\/:*?"<>|]/g, '-')}.csv`;
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
    <div class="cab-dlg-h">Курсы прихода «${ship.name || 'Без названия'}» ${cabShipPill(ship.status)}<button class="cab-dlg-x" onclick="cabRatesClose()"><i class="ti ti-x"></i></button></div>
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
      if (!doc.exists) throw new Error('приход не найден');
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
      <div class="cab-rates-bar-h"><b>Базовые курсы</b><span>с ними создаются новые приходы — и в мобильной версии</span></div>
      <div class="cab-rates-bar-f">
        ${CAB_RATE_FIELDS.map(([k, l, u, d]) => `<label class="cab-rate-f"><span>${l}</span><input value="${cabRateStr(base[k], d)}" inputmode="decimal" onchange="cabSetBaseRate('${k}',this)" onkeydown="if(event.key==='Enter')this.blur()"><em>${u}</em></label>`).join('')}
        <div class="cab-rate-f cab-rate-ro" title="Прибыль ÷ сколько должны клиенты × 100%, среднее по приходам (кроме формирующихся)"><span>Средняя рентабельность</span><b>${cabPct(avgRent)}</b><em>по приходам</em></div>
      </div>
    </div>
    <div class="cab-table-wrap">
      <div class="cab-table-title">Курсы по приходам</div>
      <table class="cab-table cab-prices">
        <thead><tr><th>Приход</th><th>Статус</th>
          ${th('Курс для клиента', 'BYN за 1 ¥', 'Сколько BYN клиент платит за 1 юань')}
          ${th('Курс закупки', 'BYN за 1 ¥', 'Сколько BYN стоит вам 1 юань при выкупе')}
          ${th('Доставка клиенту', 'BYN за 1 кг', 'Сколько клиент платит за доставку 1 кг')}
          ${th('Доставка карго', 'BYN за 1 кг', 'Сколько вы платите карго за 1 кг')}
          ${th('Рентабельность', 'прибыль ÷ оборот', 'Прибыль ÷ сколько должны клиенты × 100%')}
          <th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#6b7280;padding:20px">Нет данных</td></tr>'}</tbody>
      </table>
      <div style="font-size:13px;color:#9aa0ab;margin-top:12px">Карандаш — изменить курсы прихода (архив не меняется). Формирующиеся приходы — «—», в среднюю рентабельность не входят.</div>
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

let cabCalcFilter = 'all';   // all / wait (ждут оплаты) / work (до сортировки) / done (архив)
function cabCalcSetFilter(f) { cabCalcFilter = f; renderCabCalc(document.getElementById('cabMain')); }
function renderCabCalc(container) {
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
    const open = cabCalcOpen.has(ship.id);
    const pct = due > 0 ? Math.round(paid / due * 100) : 100;
    const rent = due > 0 ? profit / due * 100 : null;
    const date = cabNameHasDate(ship) ? '' : cabShipDateStr(ship);
    const approx = billed || kg > 0 ? '' : '≈ ';
    const debtors = billed ? clients.filter(c => !c.isOwner && c.payRest > 0.5).sort((a, b) => b.payRest - a.payRest) : [];
    // правая часть шапки: после сортировки — сколько собрано; до — что будет к оплате
    const right = billed
      ? `<div class="cab-cc-pay"><div class="cab-cc-pay-t"><span>Собрано <b>${cabFmt(paid)}</b> из ${cabFmt(due)}</span><b class="${rest > 0.5 ? 'red' : 'ok'}">${rest > 0.5 ? 'осталось ' + cabFmt(rest) : '<i class="ti ti-check"></i> всё оплачено'}</b></div><div class="cab-cc-bar"><span style="width:${Math.max(pct, paid > 0 ? 2 : 0)}%"></span></div></div>`
      : `<div class="cab-cc-pay est"><div class="cab-cc-pay-t"><span>К оплате будет</span><b>${approx}${cabFmt(due)} BYN</b></div><div class="cab-cc-note">${kg > 0 ? 'предварительно — приход ещё не рассортирован' : 'без доставки — посчитаем после взвешивания'}</div></div>`;
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
      <div class="cab-cc-head" onclick="cabCalcToggle('${ship.id}')">
        <i class="ti ti-chevron-${open ? 'down' : 'right'} cab-cc-chev"></i>
        <div class="cab-cc-title"><div><b>${ship.name || 'Без названия'}</b>${cabShipPill(ship.status)}</div><span>${date ? date + ' · ' : ''}${(ship.data || []).length} поз. · ${clients.length} ${cabPl(clients.length, 'клиент', 'клиента', 'клиентов')}</span></div>
        ${right}
      </div>
      <div class="cab-cc-cells" onclick="cabCalcToggle('${ship.id}')">${cells}</div>
      ${chips}
      ${table}
    </div>`;
  });

  const seg = (k, l, n) => `<button class="cab-seg-b${cabCalcFilter === k ? ' on' : ''}" onclick="cabCalcSetFilter('${k}')">${l} <i>${n}</i></button>`;
  const totPct = sumBilled > 0 ? Math.round(sumPaid / sumBilled * 100) : 100;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;margin-bottom:16px">
      <div class="cab-main-title" style="margin:0">Расчёты по приходам</div>
      <button class="cab-filter-btn" style="margin-left:auto" onclick="cabCalcAll(true)"><i class="ti ti-arrows-maximize"></i> Развернуть все</button>
      <button class="cab-filter-btn" onclick="cabCalcAll(false)"><i class="ti ti-arrows-minimize"></i> Свернуть все</button>
    </div>
    <div class="cab-cc-top">
      <div class="cab-seg">${seg('all', 'Все', rows.length)}${seg('wait', 'Ждут оплаты', nWait)}${seg('work', 'До сортировки', nWork)}${seg('done', 'Архив', nDone)}</div>
      <div class="cab-cc-sum"><span>По рассортированным собрано <b>${cabFmt(sumPaid)}</b> из ${cabFmt(sumBilled)} BYN</span><div class="cab-cc-bar"><span style="width:${Math.max(totPct, sumPaid > 0 ? 2 : 0)}%"></span></div><b>${totPct}%</b></div>
    </div>
    ${blocks.length > 0 ? blocks.join('') : rows.length ? '<div class="cab-cc-empty">В этом фильтре приходов нет</div>' : '<div class="cab-stub"><i class="ti ti-calculator"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">Создайте приход в Сканере</div></div>'}
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
  const per = CAB_PERIODS.find(p => p[0] === cabAnPeriod) || CAB_PERIODS[4];
  const inRange = (s, a, b) => { const d = cabShipDate(s); return !!d && d >= a && d < b; };
  let from = null, prevFrom = null; const now = new Date();
  if (per[2]) { from = new Date(); from.setMonth(from.getMonth() - per[2]); prevFrom = new Date(from); prevFrom.setMonth(prevFrom.getMonth() - per[2]); }
  // Период — по дате отправки из названия прихода. Приходы без даты попадают только во «Всё время»
  const ships = cabShipmentsCache.filter(s => !from || inRange(s, from, new Date(now.getTime() + 864e5)));
  const prevShips = from ? cabShipmentsCache.filter(s => inRange(s, prevFrom, from)) : [];
  const seg = CAB_PERIODS.map(p => `<button class="cab-seg-b${cabAnPeriod === p[0] ? ' on' : ''}" onclick="cabSetAnPeriod('${p[0]}')">${p[1]}</button>`).join('');
  const head = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px"><div class="cab-main-title" style="margin:0">Аналитика</div><div class="cab-seg" style="margin-left:auto">${seg}</div></div>`;
  if (ships.length === 0) {
    container.innerHTML = head + `<div class="cab-stub"><i class="ti ti-chart-bar"></i><div class="cab-stub-title">Нет данных</div><div class="cab-stub-text">За выбранный период приходов нет</div></div>`;
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
      <div class="cab-card-l"><i class="ti ti-coins"></i> Куда идут деньги клиентов${cabHelpBtn('an_split')}<span class="cab-an-scope">${billed.length} ${cabPl(billed.length, 'рассортированный приход', 'рассортированных прихода', 'рассортированных приходов')}</span></div>
      <div class="cab-an-big">${cabFmt(T.due)} <small>BYN заплатят клиенты</small></div>
      <div class="cab-an-bar"><span style="flex:${T.goods};background:#a99be0"><b>${gP}%</b></span><span style="flex:${T.cargo};background:#f5c518"><b>${cP}%</b></span><span style="flex:${Math.max(0, T.profit)};background:#16a34a"><b>${mP}%</b></span></div>
      <div class="cab-an-leg">
        <div><i style="background:#a99be0"></i><span>Товар (выкуп)</span><b>${cabFmt(T.goods)} BYN</b></div>
        <div><i style="background:#f5c518"></i><span>Доставка карго</span><b>${cabFmt(T.cargo)} BYN</b></div>
        <div><i style="background:#16a34a"></i><span>Ваша наценка</span><b style="color:#16a34a">${cabFmt(T.profit)} BYN</b></div>
      </div>
      <div class="cab-an-say">Из каждых <b>100 BYN</b>, которые платит клиент: <b>${gP}</b> уходят на товар, <b>${cP}</b> — карго, <b class="g">${mP}</b> остаются вам.</div>
    </div>` : `<div class="cab-card cab-an-split"><div class="cab-card-l"><i class="ti ti-coins"></i> Куда идут деньги клиентов</div><div class="cab-an-say">За этот период ещё нет рассортированных приходов — точные суммы появятся после взвешивания.</div></div>`;

  // 2. Откуда наценка: курс или доставка
  const kpis = `<div class="cab-an-kpis">
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-receipt-2"></i> Наценка</div><div class="cab-an-kv g">${cabFmt(T.profit)} <small>BYN</small></div><div class="cab-an-ks">рентабельность ${cabPct(rent)}</div>${delta(T.profit, P.profit)}</div>
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-package"></i> Средний приход</div><div class="cab-an-kv">${cabFmt(T.n ? T.profit / T.n : 0)} <small>BYN наценки</small></div><div class="cab-an-ks">${cabFmt(T.n ? T.items / T.n : 0)} поз. · ${(T.n ? T.kg / T.n : 0).toFixed(0)} кг</div></div>
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-user"></i> Средний заказ клиента</div><div class="cab-an-kv">${cabFmt(billed.reduce((n, s) => n + cabShipEcon(s).n, 0) ? T.due / billed.reduce((n, s) => n + cabShipEcon(s).n, 0) : 0)} <small>BYN</small></div><div class="cab-an-ks">наценка с заказа ≈ ${cabFmt(billed.reduce((n, s) => n + cabShipEcon(s).n, 0) ? T.profit / billed.reduce((n, s) => n + cabShipEcon(s).n, 0) : 0)} BYN</div></div>
      <div class="cab-card"><div class="cab-card-l"><i class="ti ti-arrows-split"></i> Откуда наценка${cabHelpBtn('an_src')}</div>
        <div class="cab-an-src"><span style="flex:${Math.max(0, T.rateM)};background:#6C4DB8"></span><span style="flex:${Math.max(0, T.shipM)};background:#f59e0b"></span></div>
        <div class="cab-an-src-l"><span><i style="background:#6C4DB8"></i>на курсе юаня</span><b>${T.rateM >= 0 ? '+' : ''}${cabFmt(T.rateM)}</b></div>
        <div class="cab-an-src-l"><span><i style="background:#f59e0b"></i>на доставке</span><b class="${T.shipM < 0 ? 'red' : ''}">${T.shipM >= 0 ? '+' : ''}${cabFmt(T.shipM)}</b></div></div>
    </div>`;

  // 3. Наценка по приходам: столбики, оценка штриховкой
  const chron = ships.slice().reverse();
  const ecs = chron.map(s => ({ s, e: cabShipEcon(s), b: cabIsBilled(s) }));
  const maxP = Math.max(1, ...ecs.map(x => Math.abs(x.e.profit)));
  const bars = ecs.map(({ s, e, b }) => {
    const mm = (s.name || '').match(/(\d{1,2})(?:-(\d{1,2}))?\.(\d{1,2})/), lbl = mm ? `${(mm[2] || mm[1]).padStart(2, '0')}.${mm[3].padStart(2, '0')}` : '·';
    const est = !b;
    return `<div class="cab-bar" title="${s.name || ''}: наценка ${est ? '≈ ' : ''}${cabFmt(e.profit)} BYN${est ? ' (оценка, без доставки)' : ''}, ${e.items} поз."><em class="${est ? 'est' : ''}">${est ? '≈' : '+'}${cabFmt(e.profit)}</em><span class="${est ? 'est' : ''}" style="height:${Math.max(4, Math.abs(e.profit) / maxP * 100)}%;${est ? '' : 'background:' + (e.profit >= 0 ? '#16a34a' : '#dc2626')}"></span><i>${lbl}</i></div>`;
  }).join('');
  const chart = `<div class="cab-card"><div class="cab-card-h">Наценка по приходам<span class="cab-an-chips"><span><i style="background:#16a34a"></i>точно</span><span><i class="est"></i>оценка — ещё не взвешен</span></span></div><div class="cab-bars cab-an-bars">${bars}</div></div>`;

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
  if (best.length > 1) tips.push(['ti-trophy', `Самый выгодный приход — <b>${best[0].s.name}</b>: рентабельность ${(best[0].e.profit / best[0].e.due * 100).toFixed(1)}%. Самый слабый — <b>${best[best.length - 1].s.name}</b>: ${(best[best.length - 1].e.profit / best[best.length - 1].e.due * 100).toFixed(1)}%.`]);
  const lowShip = ecs.filter(x => x.b && x.e.cargo > 0 && x.e.shipM < 0);
  if (lowShip.length) tips.push(['ti-alert-triangle', `На доставке вы теряете в ${lowShip.length} ${cabPl(lowShip.length, 'приходе', 'приходах', 'приходах')} (${lowShip.slice(0, 3).map(x => x.s.name).join(', ')}): карго обходится дороже, чем платят клиенты. Проверьте «Доставку клиенту» в Ценах или «вес в цене».`]);
  if (allProfit > 0 && Object.keys(cm).length > 8) tips.push(['ti-users', `5 лучших клиентов приносят <b>${Math.round(top5 / allProfit * 100)}%</b> наценки. ${top5 / allProfit > 0.5 ? 'Берегите их — это ваши чемпионы.' : 'Доход распределён ровно — хорошая устойчивость.'}`]);
  if (T.items > 0 && T.kg > 0 && T.cargo > 0) tips.push(['ti-weight', `Средний товар весит <b>${(T.kg / T.items).toFixed(2)} кг</b> — доставка карго одной позиции обходится вам ≈ <b>${cabFmt2(T.cargo / T.items)} BYN</b>.`]);
  if (O.n) tips.push(['ti-truck', `Ещё ${O.n} ${cabPl(O.n, 'приход', 'прихода', 'приходов')} в пути и в сборке: ≈ ${cabFmt(O.profit)} BYN наценки без учёта доставки. В итоги выше они не входят.`]);
  const tipsBox = tips.length ? `<div class="cab-card cab-an-tips"><div class="cab-card-h"><i class="ti ti-bulb" style="color:#eab308;margin-right:6px"></i>Что видно из цифр</div>${tips.map(([ic, t]) => `<div class="cab-an-tip"><i class="ti ${ic}"></i><span>${t}</span></div>`).join('')}</div>` : '';

  container.innerHTML = head + split + (billed.length ? kpis : '') + chart + `<div class="cab-an-two">${clientsBox}${tipsBox}</div>`;
}

// ============ НАСТРОЙКИ ============
function renderCabSettings(container) {
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
    </div>`;
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
  trialDays: 90,           // сейчас в app.js 90; по плану для новых после пилота — 30
  tg: 'ekudinof',
  email: 'egokud@gmail.com'
};
const PIKSTA_COUNTRIES = { BY: 'Беларусь', RU: 'Россия', KZ: 'Казахстан' };
let cabTariffPeriod = PIKSTA_TARIFFS.defaultPeriod;

// Доступ пользователя: тот же расчёт, что и баннер в мобильной версии (app.js)
function cabAccessInfo() {
  const now = new Date();
  if (userProfile && userProfile.role === 'admin') return { kind: 'admin' };
  const sub = userProfile && userProfile.subscription;
  const subEnd = sub && sub.endDate ? cabToDate(sub.endDate) : null;
  if (subEnd) {
    const left = Math.ceil((subEnd - now) / 864e5);
    return left > 0 ? { kind: 'sub', end: subEnd, left } : { kind: 'expired', end: subEnd };
  }
  const created = cabToDate(userProfile && userProfile.created) || now;
  const trialEnd = new Date(created.getTime() + PIKSTA_TARIFFS.trialDays * 864e5);
  const left = Math.ceil((trialEnd - now) / 864e5);
  return left > 0 ? { kind: 'trial', end: trialEnd, left } : { kind: 'demo', end: trialEnd };
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

function renderCabTariffs(container) {
  const T = PIKSTA_TARIFFS;
  const A = cabAccessInfo();
  const d = x => x.toLocaleDateString('ru-RU');
  const st = {
    admin:   { icon: 'ti-shield-check', color: '#6C4DB8', bg: '#f0ecf9', title: 'Администратор', text: 'Доступ без ограничений' },
    sub:     { icon: 'ti-circle-check', color: '#16a34a', bg: '#f0fdf4', title: 'Подписка активна', text: A.end ? `До ${d(A.end)} · осталось ${A.left} ${cabDaysWord(A.left)}` : '' },
    trial:   { icon: 'ti-hourglass',    color: '#ea580c', bg: '#fff7ed', title: 'Пробный период', text: A.end ? `До ${d(A.end)} · осталось ${A.left} ${cabDaysWord(A.left)}` : '' },
    expired: { icon: 'ti-alert-triangle', color: '#dc2626', bg: '#fef2f2', title: 'Подписка закончилась', text: A.end ? `${d(A.end)} · сейчас видно только 5 треков в приходе, данные сохранены` : '' },
    demo:    { icon: 'ti-lock',         color: '#4a5260', bg: '#f3f4f6', title: 'Пробный период закончился', text: 'Сейчас видно только 5 треков в приходе, данные сохранены' }
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
      const ctry = `<select onchange="cabAdminSetField('${u.id}','country',this.value||null)" style="padding:5px 6px;border:1px solid #d5d8dd;border-radius:6px;font-size:14px;background:#fff">
          <option value="">—</option>${Object.entries(PIKSTA_COUNTRIES).map(([k, v]) => `<option value="${k}" ${u.country === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
      const ind = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="Показать пользователю тариф «Крупный / карго» (индивидуальная цена)"><input type="checkbox" ${u.individual ? 'checked' : ''} onchange="cabAdminSetField('${u.id}','individual',this.checked)" style="margin:0"> да</label>`;
      const fnd = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="Цена первых клиентов: −${PIKSTA_TARIFFS.founderDiscountPct}% (участник пилота)"><input type="checkbox" ${u.founder ? 'checked' : ''} onchange="cabAdminSetField('${u.id}','founder',this.checked)" style="margin:0"> −${PIKSTA_TARIFFS.founderDiscountPct}%</label>`;
      rows.push(`<tr>
        <td style="font-weight:500">${u.name || '—'}</td>
        <td>${u.email || u.id}</td>
        <td>${created.toLocaleDateString('ru-RU')}</td>
        <td>${ctry}</td>
        <td>${fnd}</td>
        <td>${ind}</td>
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
          <thead><tr><th>Имя</th><th>Email</th><th>Регистрация</th><th>Страна</th><th title="Цена первых клиентов (участник пилота)">Первый клиент</th><th title="Показать тариф «Крупный / карго»">Индивид.</th><th>Приходов</th><th>Доступ до</th><th>Статус</th><th></th></tr></thead>
          <tbody>${rows.join('') || '<tr><td colspan="10" style="text-align:center;color:#6b7280;padding:20px">Пользователей нет</td></tr>'}</tbody>
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

// Поле профиля пользователя из админки (страна, «первый клиент»). null — убрать поле
async function cabAdminSetField(uid, field, value) {
  try {
    await db.collection('users').doc(uid).update({ [field]: value === null ? firebase.firestore.FieldValue.delete() : value });
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
