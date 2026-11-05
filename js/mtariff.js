// Piksta мобильная: «Тариф и оплата», предложение для «Старта», оплата тарифа прямо в приложении (01.11.2026).
// Оплата: клиент выбирает срок и способ → реквизиты → скрин → /api/tg-admin?pay=1 → админ-бот присылает Егору
// скрин с кнопками «Подтвердить / Отклонить» → бот продлевает subscription (plan, endDate, history).
// Пока ждём — subscription.pending; отклонено — subscription.rejected.

// Цены тарифов (решение Егора 01.11.2026): основа — цена в BYN (месяц / год).
// Россия, Казахстан и остальные — BYN + 10%, по официальному курсу НБРБ на сегодня, ₽ и ₸ вверх до 100.
// Суммы к оплате: от той же основы (Беларусь — BYN, остальные — BYN + 10%): ₽ вверх до 100, ¥ и USDT вверх до целого.
// Курс берём с api.nbrb.by раз в день, запасной — на 01.11.2026. Та же формула — на лендинге (index.html).
const PK_BYN = { start: [15, 155], main: [25, 230], pro: [45, 400] };
const PK_MARKUP = 1.1;
const PK_SYM = { BYN: 'BYN', RUB: '₽', KZT: '₸', CNY: '¥', USDT: 'USDT' };
let PK_RATES = { d: '2026-11-01', USD: 2.9462, CNY: 0.44286, RUB: 0.036624, KZT: 0.0064906 };   // BYN за 1 единицу
const pkUp = (x, step) => Math.ceil((x - 1e-6) / step) * step;
// Сколько выходит в месяц при оплате за год (05.11.2026: так показываем «За год» — крупно в месяц, ниже сумма за год)
const pkMo = (yr, cur) => cur === 'BYN' ? Math.round(yr / 12) : Math.round(yr / 120) * 10;
// Цены тарифов в валюте cur: { s, start: [месяц, год], main, pro }
function pkTP(cur) {
  const o = { s: PK_SYM[cur] || cur };
  for (const k in PK_BYN) o[k] = PK_BYN[k].map(v => cur === 'BYN' ? v : pkUp(v * PK_MARKUP / (PK_RATES[cur] || PK_RATES.RUB), 100));
  return o;
}
function pkLoadRates() {
  const today = new Date().toISOString().slice(0, 10);
  try { const c = JSON.parse(localStorage.getItem('pk_nbrb') || 'null'); if (c && c.USD && c.KZT) { PK_RATES = c; if (c.t === today) return Promise.resolve(c); } } catch (e) {}
  return fetch('https://api.nbrb.by/exrates/rates?periodicity=0').then(r => r.json()).then(L => {
    const R = { t: today };
    for (const x of L) if (['USD', 'CNY', 'RUB', 'KZT'].includes(x.Cur_Abbreviation)) { R[x.Cur_Abbreviation] = x.Cur_OfficialRate / x.Cur_Scale; R.d = String(x.Date).slice(0, 10); }
    if (R.USD && R.CNY && R.RUB && R.KZT) { PK_RATES = R; try { localStorage.setItem('pk_nbrb', JSON.stringify(R)); } catch (e) {} }
    return PK_RATES;
  }).catch(() => PK_RATES);
}
// Основа суммы в BYN: Беларусь — цена в BYN, остальные — BYN + 10%
function pkPayBase(plan, per) { const v = PK_BYN[plan][per === 'y' ? 1 : 0]; return pkGeoCur() === 'BYN' ? v : v * PK_MARKUP; }
// Сумма к оплате способом с валютой cur
function pkPayAmount(cur, plan, per) {
  const base = pkPayBase(plan, per);
  if (cur === 'BYN') return base;
  const rate = PK_RATES[cur === 'USDT' ? 'USD' : cur]; if (!rate) return 0;
  return pkUp(base / rate, cur === 'RUB' || cur === 'KZT' ? 100 : 1);
}
const pkRateNote = () => { const d = PK_RATES.d ? PK_RATES.d.split('-').reverse().join('.') : ''; return 'по курсу НБРБ' + (d ? ' на ' + d : ''); };
const PK_PLANS = {
  start: { n: 'Старт', lim: 300, d: 'Только телефон · до 300 треков в месяц' },
  main: { n: 'Основной', lim: 1500, d: 'Телефон + Кабинет · до 1 500 треков' },
  pro: { n: 'Профи', lim: Infinity, d: 'Всё + аналитика и бот · без лимита' }
};
// Способы оплаты. Карты появятся, когда Егор пришлёт реквизиты (пустой card — способ скрыт).
const PK_PAY = [
  { id: 'bnb', n: 'ЕРИП · БНБ-Банк', sub: 'из любого банка Беларуси', cur: 'BYN', ic: 'ti-building-bank', iban: 'BY23 BLNB 3014 1001 0093 3013 9602', geo: 'BY',
    erip: ['Банковские, финансовые услуги', 'Банки, НКФО', 'БНБ-Банк', 'Пополнение счёта'], qr: '/img/pay/erip.svg',
    link: 'https://pay.raschet.by/#00020132570010by.raschet010744686011028BY23BLNB3014100100933013960253039335802BY6304358B' },
  { id: 'tbank', n: 'Карта Т-Банка', sub: 'перевод на карту «Мир»', cur: 'RUB', ic: 'ti-credit-card', card: '2200 7006 2876 1990', holder: 'Егор К.', phone: '', geo: 'RU' },
  { id: 'alipay', n: 'Alipay', sub: 'по QR-коду, юани', cur: 'CNY', ic: 'ti-brand-alipay', qr: '/img/pay/alipay.svg', link: 'https://qr.alipay.com/120138250lky5x8hw9n96ed' },
  { id: 'trc20', n: 'USDT · сеть Tron (TRC20)', sub: 'криптовалюта', cur: 'USDT', ic: 'ti-currency-bitcoin', qr: '/img/pay/usdt-trc20.svg', addr: 'TN3nxuCZGat1CVLDUXpaBwVULjFsftygoB', net: 'Tron (TRC20)' },
  { id: 'bep20', n: 'USDT · сеть BNB Smart Chain (BEP20)', sub: 'криптовалюта', cur: 'USDT', ic: 'ti-currency-bitcoin', qr: '/img/pay/usdt-bep20.svg', addr: '0xbd393d1500Da0e61a64b61d8078bB29a253fEFcb', net: 'BNB Smart Chain (BEP20)' },
  { id: 'other', n: 'Другой способ', sub: 'напишите в поддержку', cur: '', ic: 'ti-message-circle' }
];
const PK_GEO_CUR = { BY: 'BYN', RU: 'RUB', KZ: 'KZT' };
let pkGeo = null, pkTPer = 'y', pkPayS = null, pkTfSel = null;

const pkN = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pkD = d => d ? d.toLocaleDateString('ru-RU') : '';
function pkGeoCur() {
  try { const s = localStorage.getItem('pk_cur'); if (PK_SYM[s] && s !== 'CNY' && s !== 'USDT') return s; } catch (e) {}
  const P = typeof userProfile !== 'undefined' && userProfile ? userProfile : {};
  if (PK_GEO_CUR[P.country]) return PK_GEO_CUR[P.country];
  if (P.country === 'OT' && PK_SYM[P.countryCur]) return P.countryCur;
  return PK_GEO_CUR[pkGeo] || 'RUB';
}
function pkLoadGeo() {
  if (pkGeo !== null) return Promise.resolve(pkGeo);
  return fetch('/api/geo').then(r => r.json()).then(j => (pkGeo = (j && j.c) || '')).catch(() => (pkGeo = ''));
}
function pkPlanNow() {
  const A = typeof pkAccess === 'function' ? pkAccess() : { kind: 'trial' };
  const sub = (userProfile && userProfile.subscription) || {};
  const plan = A.from === 'sub' ? (PK_PLANS[sub.plan] ? sub.plan : 'main') : null;
  return { A, sub, plan };
}
// Треков за этот и прошлый месяц — по дате импорта строки или закупки
function pkTracks() {
  const now = new Date(), key = d => d.getFullYear() * 12 + d.getMonth(), cur = key(now);
  let a = 0, b = 0;
  for (const s of (allShipments || [])) {
    const sc = s.created ? new Date(s.created && s.created.toDate ? s.created.toDate() : s.created) : null;
    for (const r of (s.data || [])) {
      const ts = !Array.isArray(r) && r && r.ts ? Number(r.ts) : 0;
      const d = ts ? new Date(ts * 1000) : sc;
      if (!d || isNaN(d)) continue;
      const k = key(d); if (k === cur) a++; else if (k === cur - 1) b++;
    }
  }
  return { cur: a, prev: b };
}
function pkFitPlan(n) { return n <= 300 ? 'start' : n <= 1500 ? 'main' : 'pro'; }

// ---------- экран (на весь телефон, со стрелкой назад) ----------
let pkScrBack = null;
function pkScr(title, html, back) {
  let el = document.getElementById('pkScr');
  if (!el) { el = document.createElement('div'); el.id = 'pkScr'; el.className = 'pk-man pk-scr'; el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
  pkScrBack = back || null;
  el.innerHTML = `<div class="pk-man-top"><button type="button" class="pk-man-bk" onclick="pkScrGoBack()" aria-label="Назад"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
    <div class="tt"><b>${title}</b></div></div><div class="pk-man-body pk-scr-body">${html}</div>`;
  document.body.classList.add('pk-man-on');
  requestAnimationFrame(() => el.classList.add('on'));
  const b = el.querySelector('.pk-scr-body'); if (b) b.scrollTop = 0;
}
function pkScrGoBack() { if (pkScrBack) { const f = pkScrBack; f(); } else pkScrClose(); }
function pkScrClose() {
  const el = document.getElementById('pkScr'); if (el) el.classList.remove('on');
  document.body.classList.remove('pk-man-on'); pkScrBack = null;
}

// ---------- «Тариф и оплата» ----------
function pkTariffs() {
  if (document.body.classList.contains('pk-cabpay') && typeof cabTfPayClose === 'function') return cabTfPayClose();   // оплата из Кабинета — назад в Кабинет
  pkTariffRender();
  Promise.all([pkLoadGeo(), pkLoadRates()]).then(() => { if (document.getElementById('pkTfList')) pkTariffRender(); });
  // свежий профиль: вдруг оплату уже подтвердили
  try {
    if (currentUser) db.collection('users').doc(currentUser.uid).get().then(d => {
      if (!d.exists) return; const p = d.data();
      const was = JSON.stringify(userProfile && userProfile.subscription || null), now = JSON.stringify(p.subscription || null);
      userProfile = Object.assign(userProfile || {}, { subscription: p.subscription, blocked: p.blocked, founder: p.founder });
      if (!p.subscription) delete userProfile.subscription;
      if (was !== now && document.getElementById('pkTfList')) pkTariffRender();
    }).catch(() => {});
  } catch (e) {}
}
function pkTfCards(cur, onPick, rec, curPlan) {
  const P = pkTP(cur), y = pkTPer === 'y', sel = pkTfSel || rec;
  return ['start', 'main', 'pro'].map(k => {
    const [m, yr] = P[k], save = m * 12 - yr, isRec = k === rec, isCur = k === curPlan;
    // (05.11.2026, Егор) «За год»: крупно — сколько выходит в месяц при оплате за год, ниже — сумма за год и выгода
    const price = y ? `<span class="pk-tf-pr">${pkN(pkMo(yr, cur))} <small>${P.s} / мес</small></span>` : `<span class="pk-tf-pr">${pkN(m)} <small>${P.s} / мес</small></span>`;
    const yl = y ? `<span class="pk-tf-y">при оплате за год — ${pkN(yr)}&nbsp;${P.s}<br>выгода ${pkN(save)}&nbsp;${P.s}</span>` : `<span class="pk-tf-y" style="color:var(--pk-muted);font-weight:500">или ${pkN(yr)} ${P.s} за год — выгода ${pkN(save)} ${P.s}</span>`;
    // Нажатие на карточку только выделяет её (рамка + кнопка), к оплате ведёт кнопка
    return `<div class="pk-tf ${k === sel ? 'sel' : ''}" data-k="${k}" onclick="pkTfPick('${k}')" role="button" tabindex="0" aria-pressed="${k === sel}">${isCur ? '<span class="pk-tf-tag cur">Ваш тариф</span>' : isRec ? '<span class="pk-tf-tag">Подходит вам</span>' : ''}
      <div class="pk-tf-r"><b>${PK_PLANS[k].n}</b>${price}</div>${yl}<span class="pk-tf-d">${PK_PLANS[k].d}</span>
      <div class="pk-tf-go"><button type="button" class="pk-btn" tabindex="${k === sel ? 0 : -1}" onclick="event.stopPropagation();${onPick}('${k}')">${isCur ? 'Продлить' : 'Оплатить'} «${PK_PLANS[k].n}»</button></div></div>`;
  }).join('');
}
function pkTfPick(k) {
  pkTfSel = k;
  document.querySelectorAll('#pkTfList .pk-tf').forEach(el => {
    const on = el.dataset.k === k;
    el.classList.toggle('sel', on); el.setAttribute('aria-pressed', String(on));
    const b = el.querySelector('.pk-tf-go button'); if (b) b.tabIndex = on ? 0 : -1;
  });
}
function pkTariffRender() {
  if (document.body.classList.contains('pk-cabpay') && typeof cabTfPayClose === 'function') return cabTfPayClose();
  const { A, sub, plan } = pkPlanNow();
  const T = pkTracks(), vol = Math.max(T.cur, T.prev);
  const cur = pkGeoCur();
  const rec = plan && PK_PLANS[plan].lim >= vol ? plan : pkFitPlan(vol);
  let head;
  if (A.kind === 'admin') head = `<div class="pk-tfnow"><small>Сейчас</small><b>Администратор</b><small>Тарифы не действуют. Проверять оплату — с тестового аккаунта.</small></div>`;
  else if (A.kind === 'trial') {
    const tot = (userProfile && userProfile.founder) ? 90 : 30, pct = Math.max(4, Math.min(100, A.left / tot * 100));
    head = `<div class="pk-tfnow"><small>Сейчас</small><b>Пробный период · осталось ${A.left} ${pkPl(A.left, 'день', 'дня', 'дней')}</b><div class="pk-bar"><span style="width:${pct}%"></span></div><small>Открыто всё, как в «Основном». Треков в ${PK_MON_IN[new Date().getMonth()]}: ${pkN(T.cur)}</small></div>`;
  } else if (A.kind === 'sub') {
    const U = pkUsage(), lim = U.lim, pct = lim === Infinity ? 0 : Math.min(100, U.n / lim * 100);
    const per = `${U.P.start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}–${U.P.last.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`;
    head = `<div class="pk-tfnow"><small>Ваш тариф</small><b>${PK_PLANS[plan].n} · до ${pkD(A.end)}</b>${lim === Infinity ? '' : `<div class="pk-bar${U.state === 'ok' ? '' : ' ' + (U.state === 'warn' ? 'warn' : 'bad')}"><span style="width:${Math.max(3, pct)}%"></span></div>`}<small>Треков за ${per}: ${pkN(U.n)}${lim === Infinity ? '' : ' из ' + pkN(lim)} · осталось ${A.left} ${pkPl(A.left, 'день', 'дня', 'дней')}</small></div>`;
  } else if (A.kind === 'grace') head = `<div class="pk-tfnow warn"><small>${A.from === 'sub' ? 'Подписка закончилась' : 'Пробный период закончился'} ${pkD(A.end)}</small><b>Ещё ${A.left} ${pkPl(A.left, 'день', 'дня', 'дней')} всё работает</b><small>Потом — только просмотр. Данные никуда не денутся.</small></div>`;
  else if (A.kind === 'readonly') head = `<div class="pk-tfnow bad"><small>Сейчас</small><b>Только просмотр</b><small>Оплатите тариф — и всё снова заработает. Данные сохранены.</small></div>`;
  else head = `<div class="pk-tfnow bad"><small>Сейчас</small><b>Доступ ограничен</b><small>Напишите в поддержку.</small></div>`;
  const pend = sub.pending, rej = sub.rejected;
  if (pend) head = `<div class="pk-tfwait"><small>Оплата на проверке</small><b>«${PK_PLANS[pend.plan] ? PK_PLANS[pend.plan].n : ''}» · ${pend.period === 'y' ? 'год' : 'месяц'} · ${pkN(pend.amount)} ${pkEsc(pend.cur)}</b><small>Отправлено ${pkD(pkToDate(pend.at))}. Пока проверяем — всё работает как раньше</small></div>` + head;
  else if (rej && (!sub.history || !sub.history.length || pkToDate(rej.rejectedAt) > pkToDate(sub.history[sub.history.length - 1].at)))
    head = `<div class="pk-tfnow bad"><small>Оплата от ${pkD(pkToDate(rej.at))} не подтверждена</small><b>Напишите в поддержку</b><small><a href="https://t.me/piksta_support_bot" target="_blank" rel="noopener" style="color:inherit">@piksta_support_bot</a> — разберёмся</small></div>` + head;
  const hist = (sub.history || []).slice().reverse().slice(0, 12);
  pkScr('Тариф и оплата', `${head}
    <div class="pk-seg" role="tablist"><button type="button" class="${pkTPer === 'm' ? 'on' : ''}" onclick="pkTPer='m';pkTariffRender()">Помесячно</button><button type="button" class="${pkTPer === 'y' ? 'on' : ''}" onclick="pkTPer='y';pkTariffRender()">За год · выгоднее</button></div>
    <div id="pkTfList" style="display:flex;flex-direction:column;gap:10px">${pkTfCards(cur, 'pkPayStart', rec, plan)}</div>
    ${hist.length ? `<div class="pk-lbl" style="margin-top:4px">История оплат</div><div class="pk-list">${hist.map(h => `<div class="pk-hist"><span>${pkD(pkToDate(h.at))} · ${PK_PLANS[h.plan] ? PK_PLANS[h.plan].n : ''}, ${h.period === 'y' ? 'год' : 'месяц'}</span><b>${pkHistAmt(h)}</b></div>`).join('')}</div>` : ''}
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:2px 0 0">Цены — в валюте вашей страны · <button type="button" class="pk-lnk" onclick="pkCurPick()">${PK_SYM[cur]}</button> · вопросы — <a href="https://t.me/piksta_support_bot" target="_blank" rel="noopener" class="pk-lnk">@piksta_support_bot</a></p>`);
}
const pkHistAmt = h => h.gift || h.method === 'gift' ? 'подарок' : h.amount > 0 ? pkN(h.amount) + ' ' + pkEsc(h.cur || '') : 'продлено';
function pkCurPick() {
  const c = pkGeoCur();
  pkSheet(`<h3>Валюта цен</h3><div class="pk-menu" style="margin-top:12px">${['BYN', 'RUB', 'KZT'].map(k => `<button onclick="try{localStorage.setItem('pk_cur','${k}')}catch(e){};pkSheetClose();pkTariffRender()"><span>${{ BYN: 'Белорусские рубли', RUB: 'Российские рубли', KZT: 'Тенге' }[k]}</span><small>${c === k ? '✓' : PK_SYM[k]}</small></button>`).join('')}</div>`);
}

// ---------- «Кабинет» на тарифе «Старт» ----------
function pkCabinetGate(section) {
  const { plan } = pkPlanNow();
  if (plan === 'start' && section !== 'admin') return pkUpgrade(), true;
  return false;
}
function pkUpgrade() {
  Promise.all([pkLoadGeo(), pkLoadRates()]).then(() => { if (document.getElementById('pkUpg')) pkUpgradeRender(); });
  pkUpgradeRender();
}
function pkUpgradeRender() {
  const cur = pkGeoCur(), P = pkTP(cur), [m, y] = P.main;
  pkScr('', `<div class="pk-upg" id="pkUpg"><div class="ic"><i class="ti ti-device-desktop" aria-hidden="true"></i></div><h2>Кабинет — с тарифа «Основной»</h2>
      <p>У вас «Старт»: Piksta работает на телефоне. Кабинет на компьютере открывается на «Основном».</p>
      <div class="ul"><div><i class="ti ti-check" aria-hidden="true"></i>Все закупки и клиенты на большом экране</div><div><i class="ti ti-check" aria-hidden="true"></i>Цены, курсы и расчёты в таблицах</div><div><i class="ti ti-check" aria-hidden="true"></i>До 1 500 треков в месяц вместо 300</div></div></div>
    <div class="pk-tf rec" onclick="pkPayStart('main')" role="button" tabindex="0"><div class="pk-tf-r"><b>Основной</b><span class="pk-tf-pr">${pkN(y)} <small>${P.s} / год</small></span></div><span class="pk-tf-y">выгода ${pkN(m * 12 - y)} ${P.s} против помесячной оплаты</span><span class="pk-tf-d">или ${pkN(m)} ${P.s} помесячно</span></div>
    <button type="button" class="pk-btn" onclick="pkTPer='y';pkPayStart('main')">Перейти на «Основной»</button>
    <button type="button" class="pk-btn ghost" onclick="pkTariffs()">Сравнить все тарифы</button>
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:2px 0 0">Данные никуда не денутся — всё, что вы ведёте в телефоне, сразу появится в Кабинете</p>`);
}

// ---------- оплата: шаг 1 — срок и способ ----------
function pkPayMethods() {
  const g = pkGeo || '';
  // ЕРИП — только тем, у кого цены в BYN (Беларусь); России, Казахстану и остальным — Т-Банк, Alipay, USDT
  const byn = pkGeoCur() === 'BYN';
  const L = PK_PAY.filter(x => (x.id === 'other' || x.qr || x.card || x.phone || x.iban) && (x.id !== 'bnb' || byn));
  return L.sort((a, b) => (b.geo === g) - (a.geo === g));
}
function pkPayStart(plan) {
  pkLoadRates().then(() => { if (pkPayS && document.querySelector('#pkScr .pk-mt')) pkPayRender1(); });
  const L = pkPayMethods();
  pkPayS = { plan, method: (pkPayS && pkPayS.plan === plan && pkPayS.method) || L[0].id, img: '' };
  pkPayRender1();
}
function pkPayEnd() {
  const { A } = pkPlanNow();
  const base = A.kind === 'sub' && A.end > new Date() ? new Date(A.end) : new Date();
  base.setMonth(base.getMonth() + (pkTPer === 'y' ? 12 : 1)); return base;
}
function pkPayRender1() {
  const S = pkPayS, cur = pkGeoCur(), P = pkTP(cur), [m, y] = P[S.plan];
  const L = pkPayMethods();
  const amt = x => x.cur ? pkN(pkPayAmount(x.cur, S.plan, pkTPer)) + ' ' + PK_SYM[x.cur] : '';
  pkScr(`Оплата «${PK_PLANS[S.plan].n}»`, `
    <div class="pk-seg"><button type="button" class="${pkTPer === 'm' ? 'on' : ''}" onclick="pkTPer='m';pkPayRender1()">Помесячно · ${pkN(m)}</button><button type="button" class="${pkTPer === 'y' ? 'on' : ''}" onclick="pkTPer='y';pkPayRender1()">За год · ${pkN(y)}</button></div>
    <p class="pk-muted" style="font-size:13px;text-align:center;margin:-2px 0 0">${pkTPer === 'y' ? `${pkN(y)} ${P.s} раз в год · выгода ${pkN(m * 12 - y)} ${P.s}` : `${pkN(m)} ${P.s} в месяц`} · до ${pkD(pkPayEnd())}</p>
    <div class="pk-lbl">Чем платите</div>
    <div class="pk-mt">${L.map(x => `<button type="button" class="${x.id === S.method ? 'on' : ''}" onclick="pkPayS.method='${x.id}';pkPayRender1()"><i class="ti ${x.ic}" aria-hidden="true"></i><span>${x.n}<small>${x.sub}${x.cur ? ' · ' + amt(x) : ''}</small></span><i class="rd" aria-hidden="true"></i></button>`).join('')}</div>
    <button type="button" class="pk-btn" onclick="pkPayRender2()">Далее</button>`, pkTariffs);
}

// ---------- шаг 2 — реквизиты и скрин ----------
function pkCopy(t, what) {
  const done = () => showToast((what || 'Скопировано') + ' — скопировано');
  try { navigator.clipboard.writeText(t).then(done, () => prompt('Скопируйте:', t)); } catch (e) { prompt('Скопируйте:', t); }
}
function pkPayRender2() {
  const S = pkPayS, x = PK_PAY.find(p => p.id === S.method);
  if (!x || x.id === 'other') {
    pkScr('Другой способ', `<div class="pk-card" style="font-size:15px;line-height:1.5">Напишите в поддержку, каким способом удобно заплатить за «${PK_PLANS[S.plan].n}» на ${pkTPer === 'y' ? 'год' : 'месяц'} — пришлём реквизиты и включим тариф вручную.</div>
      <a class="pk-btn" href="https://t.me/piksta_support_bot" target="_blank" rel="noopener"><i class="ti ti-brand-telegram" aria-hidden="true"></i> Написать в поддержку</a>`, pkPayRender1);
    return;
  }
  const amount = pkPayAmount(x.cur, S.plan, pkTPer), s = PK_SYM[x.cur], vc = pkGeoCur(), vp = pkTP(vc)[S.plan][pkTPer === 'y' ? 1 : 0];
  S.amount = amount; S.cur = s;
  let req = `<div><small>Сумма</small><span class="pk-pay-big">${pkN(amount)} <small>${s}</small></span>${x.cur !== vc ? `<small>= ${pkN(vp)} ${PK_SYM[vc]} ${pkRateNote()}, округлено вверх</small>` : ''}</div>`;
  if (x.addr) req += `<div class="pk-qr"><img src="${x.qr}" alt="QR-код адреса ${pkEsc(x.net)}" width="200" height="200"></div>
      <div class="pk-rq"><span><small>Адрес USDT · ${pkEsc(x.net)}</small><b class="mono">${pkEsc(x.addr)}</b></span><button type="button" class="cp" onclick="pkCopy('${x.addr}','Адрес')" aria-label="Скопировать адрес"><i class="ti ti-copy" aria-hidden="true"></i></button></div>
      <div class="pk-pay-warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>Отправляйте только USDT в сети <b>${pkEsc(x.net)}</b>. В другой сети деньги пропадут. Комиссию сети платит отправитель — до нас должно дойти ${pkN(amount)} USDT.</span></div>`;
  else if (x.id === 'alipay') req += `<div class="pk-qr"><img src="${x.qr}" alt="QR-код Alipay" width="200" height="200"></div>
      <p class="pk-muted" style="font-size:13px;margin:0;line-height:1.45">Отсканируйте в Alipay. Если открыли Piksta на этом же телефоне — нажмите кнопку ниже или сохраните QR и выберите его в Alipay из галереи.</p>
      <a class="pk-btn ghost" href="${x.link}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Открыть в Alipay</a>`;
  else if (x.erip) {
    req += `<div class="pk-qr"><img src="${x.qr}" alt="QR-код ЕРИП для пополнения счёта" width="200" height="200"></div>
      <a class="pk-btn ghost" href="${x.link}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i> Оплатить через ЕРИП</a>
      <div><small>Или вручную в приложении любого банка Беларуси</small><div class="pk-erip"><b>ЕРИП</b>${x.erip.map(t => ` → <b>${pkEsc(t)}</b>`).join('')}</div></div>
      <div class="pk-rq"><span><small>Номер пополнения через ЕРИП</small><b class="mono">${pkEsc(x.iban)}</b></span><button type="button" class="cp" onclick="pkCopy('${pkEsc(x.iban.replace(/\s/g, ''))}','Номер счёта')" aria-label="Скопировать номер счёта"><i class="ti ti-copy" aria-hidden="true"></i></button></div>
      ${x.holder ? `<div class="pk-rq"><span><small>Получатель</small><b>${pkEsc(x.holder)}</b></span></div>` : ''}
      <div class="pk-pay-warn" style="background:var(--pk-acc-soft);color:var(--pk-acc)"><i class="ti ti-info-circle" aria-hidden="true"></i><span>Сумму впишите сами — ${pkN(amount)} BYN. В комментарии ничего не пишите: достаточно прикрепить чек ниже.</span></div>`;
  } else {
    if (x.phone) req += `<div class="pk-rq"><span><small>${x.id === 'tbank' ? 'СБП · номер телефона · Т-Банк' : 'Номер телефона'}</small><b>${pkEsc(x.phone)}</b></span><button type="button" class="cp" onclick="pkCopy('${pkEsc(x.phone)}','Номер')" aria-label="Скопировать номер"><i class="ti ti-copy" aria-hidden="true"></i></button></div>`;
    if (x.card) req += `<div class="pk-rq"><span><small>Номер карты</small><b class="mono">${pkEsc(x.card)}</b></span><button type="button" class="cp" onclick="pkCopy('${pkEsc(x.card.replace(/\s/g, ''))}','Номер карты')" aria-label="Скопировать номер карты"><i class="ti ti-copy" aria-hidden="true"></i></button></div>`;
    if (x.holder) req += `<div class="pk-rq"><span><small>Получатель</small><b>${pkEsc(x.holder)}</b></span></div>`;
  }
  pkScr(x.n, `<div class="pk-card pk-req">${req}</div>
    <div class="pk-lbl">После оплаты</div>
    <label class="pk-drop" id="pkPayDrop"><input type="file" accept="image/*" hidden onchange="pkPayImg(this)"><span id="pkPayDropIn"><i class="ti ti-photo-plus" aria-hidden="true"></i><b>Прикрепите скрин оплаты</b><small>чек из банка или кошелька</small></span></label>
    <label class="pk-offer"><input type="checkbox" id="pkPayOffer" onchange="pkPayReady()"><span>Принимаю условия <a href="/offer" target="_blank" rel="noopener">публичной оферты</a>. Скрин чека нужен только для проверки оплаты — <a href="/privacy" target="_blank" rel="noopener">как мы храним данные</a></span></label>
    <button type="button" class="pk-btn ok" id="pkPaySend" onclick="pkPaySend()" disabled>Я оплатил</button>
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:0">Проверим и включим тариф — обычно в течение пары часов</p>`, pkPayRender1);
}
function pkPayImg(inp) {
  const f = inp.files && inp.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      pkPayS.img = c.toDataURL('image/jpeg', 0.82);
      document.getElementById('pkPayDropIn').innerHTML = `<span class="th" style="background-image:url('${pkPayS.img}')"></span><span style="text-align:left"><b style="color:var(--pk-ok)">Скрин добавлен</b><small>нажмите, чтобы заменить</small></span>`;
      document.getElementById('pkPayDrop').classList.add('ok');
      pkPayReady();
    };
    im.onerror = () => showToast('Не получилось открыть картинку');
    im.src = fr.result;
  };
  fr.readAsDataURL(f);
}
function pkPayReady() {
  const b = document.getElementById('pkPaySend'), o = document.getElementById('pkPayOffer');
  if (b) b.disabled = !(pkPayS && pkPayS.img && o && o.checked);
}
async function pkPaySend() {
  const S = pkPayS, b = document.getElementById('pkPaySend'), o = document.getElementById('pkPayOffer');
  if (!S || !S.img) return showToast('Прикрепите скрин оплаты');
  if (!o || !o.checked) return showToast('Отметьте согласие с офертой');
  b.disabled = true; b.textContent = 'Отправляю…';
  try {
    const idToken = await firebase.auth().currentUser.getIdToken();
    const r = await fetch('/api/tg-admin?pay=1', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken, plan: S.plan, period: pkTPer, method: S.method, amount: S.amount, cur: S.cur, img: S.img, offer: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('ошибка ' + r.status));
    userProfile.subscription = Object.assign({}, userProfile.subscription || {}, { pending: { plan: S.plan, period: pkTPer, amount: S.amount, cur: S.cur, method: S.method, at: new Date() } });
    pkPayS = null;
    showToast('Оплата отправлена на проверку');
    pkTariffRender();
  } catch (e) { b.disabled = false; b.textContent = 'Я оплатил'; showToast('Не отправилось: ' + (e.message || e)); }
}

// ---------- Лимит треков (решение Егора 02.11.2026) ----------
// Период — месяц от даты оплаты: окна по дню окончания подписки (оплатил 15-го → 15.10–14.11, 15.11–14.12…).
// Позиции считаем по дате строки (ts) или дате создания закупки. На пробном — лимита нет, только счётчик за календарный месяц.
// Удалить закупку можно всегда. Пока она «Формируется», место в лимите возвращается; после отправки — нет:
// её позиции этого периода копятся в users/{uid}.usage.del. Там же n и lim — для админки и бота.
// 80% — предупреждение, после 100% ещё 10% запаса, дальше новые позиции не добавляются. Сканирование и остальное работают.
const PK_LIM_WARN = 0.8, PK_LIM_GRACE = 1.1;
const pkIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function pkPeriodOf(u) {
  const now = new Date(), A = pkAccess(u || {}), sub = (u && u.subscription) || {};
  const endD = A.from === 'sub' ? pkToDate(sub.endDate) : null;
  let start, end;
  if (endD) {
    const day = endD.getDate(), mk = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
    start = mk(now.getFullYear(), now.getMonth());
    if (start > now) start = mk(now.getFullYear(), now.getMonth() - 1);
    end = mk(start.getFullYear(), start.getMonth() + 1);
  } else { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 1); }
  return { start, end, last: new Date(end.getTime() - 864e5), k: pkIso(start), cal: !endD };
}
function pkShipRowsIn(s, P) {
  const sc = pkToDate(s.created) || new Date();
  let n = 0;
  for (const r of (s.data || [])) {
    const ts = !Array.isArray(r) && r && r.ts ? Number(r.ts) : 0;
    const d = ts ? new Date(ts * 1000) : sc;
    if (d >= P.start && d < P.end) n++;
  }
  return n;
}
function pkUsageOf(u, ships) {
  u = u || {};
  const A = pkAccess(u), P = pkPeriodOf(u), sub = u.subscription || {};
  const plan = A.kind !== 'admin' && A.from === 'sub' ? (PK_PLANS[sub.plan] ? sub.plan : 'main') : null;
  let n = 0; for (const s of (ships || [])) n += pkShipRowsIn(s, P);
  const us = u.usage || {}; if (us.k === P.k && us.del > 0) n += us.del;
  const lim = plan ? PK_PLANS[plan].lim : Infinity, cap = lim === Infinity ? Infinity : Math.floor(lim * PK_LIM_GRACE);
  const state = lim === Infinity ? 'none' : n >= cap ? 'block' : n > lim ? 'over' : n >= lim * PK_LIM_WARN ? 'warn' : 'ok';
  return { n, lim, cap, plan, P, state };
}
const pkUsage = () => pkUsageOf(userProfile, (typeof allShipments !== 'undefined' && allShipments) || []);
const pkNextPlan = p => p === 'start' ? 'main' : 'pro';
// счётчик в профиль — чтобы админка и бот видели его без чтения закупок
let pkUsageKey = '';
function pkUsageSync() {
  if (!userProfile || !currentUser || userProfile.role === 'admin' || userProfile._readonly || userProfile.blocked) return;
  const U = pkUsage(), us = userProfile.usage || {};
  const next = { k: U.P.k, n: U.n, lim: U.lim === Infinity ? 0 : U.lim, del: us.k === U.P.k ? (us.del || 0) : 0 };
  const key = JSON.stringify(next);
  if (key === pkUsageKey) return;
  pkUsageKey = key;
  if (us.k === next.k && us.n === next.n && (us.lim || 0) === next.lim && (us.del || 0) === next.del) return;
  userProfile.usage = next;
  db.collection('users').doc(currentUser.uid).update({ usage: next }).catch(() => {});
}
// удалили отправленную закупку — её позиции этого периода остаются в счётчике
function pkLimDeleted(ship) {
  if (!ship || (ship.status || 'forming') === 'forming' || !userProfile || !currentUser) return;
  const P = pkPeriodOf(userProfile), n = pkShipRowsIn(ship, P); if (!n) return;
  const us = userProfile.usage || {}, del = (us.k === P.k ? (us.del || 0) : 0) + n;
  userProfile.usage = Object.assign({}, us, { k: P.k, del });
  pkUsageKey = '';
  return db.collection('users').doc(currentUser.uid).update({ 'usage.k': P.k, 'usage.del': del }).catch(() => {});
}
// подсказка к подтверждению удаления закупки
function pkLimDelNote(ship) {
  if (!ship || (ship.status || 'forming') === 'forming') return '';
  const U = pkUsage(); if (U.state === 'none' || !pkShipRowsIn(ship, U.P)) return '';
  return '\n\nЗакупка уже отправлена — её треки засчитаны в лимит тарифа. После удаления место в лимите не освободится (до ' + pkD(U.P.last) + ').';
}
// можно ли добавить add позиций; если нет — экран «Лимит исчерпан»
function pkLimitCheck(add) {
  const U = pkUsage();
  if (U.state === 'none' || U.n + (add || 1) <= U.cap) return true;
  pkLimitScreen(U, add || 1);
  return false;
}
function pkLimitScreen(U, add) {
  U = U || pkUsage();
  const nx = pkNextPlan(U.plan), left = Math.max(0, U.cap - U.n), from = pkD(U.P.end);
  const txt = left > 0
    ? `<b>Не хватает лимита: свободно ${pkN(left)} из ${pkN(add)}.</b> Использовано ${pkN(U.n)} из ${pkN(U.lim)} треков (с запасом 10% — ${pkN(U.cap)}).`
    : `<b>Лимит тарифа исчерпан: ${pkN(U.n)} из ${pkN(U.lim)}</b> (с запасом 10%).`;
  pkScr('Лимит треков', `<div class="pk-limc bad"><i class="ti ti-ban" aria-hidden="true"></i><span>${txt} Новые позиции — с ${from} или на тарифе выше. Сканирование, клиенты и расчёты работают.</span></div>
    <button type="button" class="pk-btn" onclick="pkTPer='y';pkPayStart('${nx}')">Перейти на «${PK_PLANS[nx].n}»</button>
    <button type="button" class="pk-btn ghost" onclick="pkTariffs()">Все тарифы</button>
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:2px 0 0">«${PK_PLANS[nx].n}» — ${PK_PLANS[nx].lim === Infinity ? 'без лимита по трекам' : 'до ' + pkN(PK_PLANS[nx].lim) + ' треков в месяц'}</p>`);
}
// плашка над списком закупок: 80% — жёлтая, после лимита — красная
function pkLimitBanner() {
  const U = pkUsage();
  if (U.state === 'none' || U.state === 'ok') return '';
  const pct = Math.min(100, U.n / U.lim * 100), nx = PK_PLANS[pkNextPlan(U.plan)];
  const tail = nx.lim === Infinity ? `перейдите на «${nx.n}», там без лимита` : `перейдите на «${nx.n}» — до ${pkN(nx.lim)} треков`;
  const msg = U.state === 'block'
    ? `<b>Лимит исчерпан: ${pkN(U.n)} из ${pkN(U.lim)}</b> (с запасом 10%). Новые позиции — с ${pkD(U.P.end)} или ${tail}.`
    : U.state === 'over'
      ? `<b>Лимит превышен: ${pkN(U.n)} из ${pkN(U.lim)} треков</b> до ${pkD(U.P.last)}. Осталось ${pkN(U.cap - U.n)} в запасе — дальше ${tail}.`
      : `<b>Использовано ${pkN(U.n)} из ${pkN(U.lim)} треков</b> до ${pkD(U.P.last)}. Если не хватит — ${tail}.`;
  return `<div class="pk-limc ${U.state === 'warn' ? 'warn' : 'bad'}" onclick="pkTariffs()" role="button" tabindex="0"><i class="ti ${U.state === 'warn' ? 'ti-alert-triangle' : 'ti-ban'}" aria-hidden="true"></i><span>${msg}</span></div>
    <div class="pk-limbar ${U.state === 'warn' ? 'warn' : 'bad'}"><span style="width:${Math.max(3, pct)}%"></span></div>`;
}

// ---------- «Старт» на компьютере: та же мобильная версия по центру, сверху полоса ----------
function pkStartOnly() { const { plan } = pkPlanNow(); return plan === 'start'; }
function pkStartBand() {
  let b = document.getElementById('pkPcBand');
  const on = pkStartOnly() && !pkIsPhone() && document.body.classList.contains('pk-m');
  document.body.classList.toggle('pk-pcb', on);
  if (!on) { if (b) b.remove(); return; }
  if (b) return;
  b = document.createElement('div'); b.id = 'pkPcBand'; b.className = 'pk-pcband';
  b.innerHTML = `<i class="ti ti-device-desktop" aria-hidden="true"></i><span>У вас «Старт» — Piksta работает в мобильной версии. <b>Кабинет на компьютере — с тарифа «Основной».</b></span><button type="button" onclick="pkUpgrade()">Перейти</button>`;
  document.body.insertBefore(b, document.body.firstChild);
}
(function () {
  const o = window.enterMode;
  if (typeof o === 'function') window.enterMode = function (mode) {
    if (mode === 'cabinet' && userProfile && pkStartOnly()) mode = 'scanner';
    const r = o.call(this, mode);
    try { pkStartBand(); } catch (e) {}
    return r;
  };
  const rs = window.renderShipmentCards;
  if (typeof rs === 'function') window.renderShipmentCards = function () {
    const r = rs.apply(this, arguments);
    clearTimeout(window.__pkUseT); window.__pkUseT = setTimeout(() => { try { pkUsageSync(); } catch (e) {} }, 1500);
    return r;
  };
})();
