// Piksta мобильная: «Тариф и оплата», предложение для «Старта», оплата тарифа прямо в приложении (01.11.2026).
// Оплата: клиент выбирает срок и способ → реквизиты → скрин → /api/tg-admin?pay=1 → админ-бот присылает Егору
// скрин с кнопками «Подтвердить / Отклонить» → бот продлевает subscription (plan, endDate, history).
// Пока ждём — subscription.pending; отклонено — subscription.rejected.

// Цены тарифов: месяц / год. BYN, RUB, KZT утверждены 01.11.2026.
// Суммы к оплате любым способом считаются от цены в BYN по официальному курсу НБРБ на сегодня (решение Егора 01.11.2026):
// ₽ — вверх до 100, ¥ и USDT — вверх до целого. Курс берём с api.nbrb.by раз в день, запасной — на 01.11.2026.
const PK_TP = {
  BYN: { s: 'BYN', start: [15, 155], main: [25, 230], pro: [45, 400] },
  RUB: { s: '₽', start: [590, 5980], main: [990, 9000], pro: [1690, 15480] },
  KZT: { s: '₸', start: [2490, 25380], main: [4190, 38280], pro: [6990, 63480] },
};
const PK_SYM = { BYN: 'BYN', RUB: '₽', KZT: '₸', CNY: '¥', USDT: 'USDT' };
let PK_RATES = { d: '2026-11-01', USD: 2.9462, CNY: 0.44286, RUB: 0.036624 };   // BYN за 1 единицу
function pkLoadRates() {
  const today = new Date().toISOString().slice(0, 10);
  try { const c = JSON.parse(localStorage.getItem('pk_nbrb') || 'null'); if (c && c.USD) { PK_RATES = c; if (c.t === today) return Promise.resolve(c); } } catch (e) {}
  return fetch('https://api.nbrb.by/exrates/rates?periodicity=0').then(r => r.json()).then(L => {
    const R = { t: today };
    for (const x of L) if (['USD', 'CNY', 'RUB'].includes(x.Cur_Abbreviation)) { R[x.Cur_Abbreviation] = x.Cur_OfficialRate / x.Cur_Scale; R.d = String(x.Date).slice(0, 10); }
    if (R.USD && R.CNY && R.RUB) { PK_RATES = R; try { localStorage.setItem('pk_nbrb', JSON.stringify(R)); } catch (e) {} }
    return PK_RATES;
  }).catch(() => PK_RATES);
}
// Сумма к оплате способом с валютой cur: от цены в BYN по курсу НБРБ
function pkPayAmount(cur, plan, per) {
  const byn = PK_TP.BYN[plan][per === 'y' ? 1 : 0];
  if (cur === 'BYN') return byn;
  const rate = PK_RATES[cur === 'USDT' ? 'USD' : cur]; if (!rate) return 0;
  const x = byn / rate - 1e-6;
  return cur === 'RUB' ? Math.ceil(x / 100) * 100 : Math.ceil(x);
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
  try { const s = localStorage.getItem('pk_cur'); if (PK_TP[s]) return s; } catch (e) {}
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
  pkTariffRender();
  pkLoadGeo().then(() => { if (document.getElementById('pkTfList')) pkTariffRender(); });
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
  const P = PK_TP[cur], y = pkTPer === 'y', sel = pkTfSel || rec;
  return ['start', 'main', 'pro'].map(k => {
    const [m, yr] = P[k], save = m * 12 - yr, isRec = k === rec, isCur = k === curPlan;
    const price = y ? `<span class="pk-tf-pr"><small>≈</small>${pkN(yr / 12)} <small>${P.s} / мес</small></span>` : `<span class="pk-tf-pr">${pkN(m)} <small>${P.s} / мес</small></span>`;
    const yl = y ? `<span class="pk-tf-y">${pkN(yr)} ${P.s} раз в год · выгода ${pkN(save)}</span>` : `<span class="pk-tf-y" style="color:var(--pk-muted);font-weight:500">или ≈${pkN(yr / 12)} ${P.s} в месяц при оплате за год</span>`;
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
    const lim = PK_PLANS[plan].lim, pct = lim === Infinity ? 0 : Math.min(100, T.cur / lim * 100);
    head = `<div class="pk-tfnow"><small>Ваш тариф</small><b>${PK_PLANS[plan].n} · до ${pkD(A.end)}</b>${lim === Infinity ? '' : `<div class="pk-bar"><span style="width:${Math.max(3, pct)}%"></span></div>`}<small>Треков в этом месяце: ${pkN(T.cur)}${lim === Infinity ? '' : ' из ' + pkN(lim)} · осталось ${A.left} ${pkPl(A.left, 'день', 'дня', 'дней')}</small></div>`;
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
    ${hist.length ? `<div class="pk-lbl" style="margin-top:4px">История оплат</div><div class="pk-list">${hist.map(h => `<div class="pk-hist"><span>${pkD(pkToDate(h.at))} · ${PK_PLANS[h.plan] ? PK_PLANS[h.plan].n : ''}, ${h.period === 'y' ? 'год' : 'месяц'}</span><b>${pkN(h.amount)} ${pkEsc(h.cur)}</b></div>`).join('')}</div>` : ''}
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:2px 0 0">Цены — в валюте вашей страны · <button type="button" class="pk-lnk" onclick="pkCurPick()">${PK_TP[cur].s}</button> · вопросы — <a href="https://t.me/piksta_support_bot" target="_blank" rel="noopener" class="pk-lnk">@piksta_support_bot</a></p>`);
}
function pkCurPick() {
  const c = pkGeoCur();
  pkSheet(`<h3>Валюта цен</h3><div class="pk-menu" style="margin-top:12px">${['BYN', 'RUB', 'KZT'].map(k => `<button onclick="try{localStorage.setItem('pk_cur','${k}')}catch(e){};pkSheetClose();pkTariffRender()"><span>${{ BYN: 'Белорусские рубли', RUB: 'Российские рубли', KZT: 'Тенге' }[k]}</span><small>${c === k ? '✓' : PK_TP[k].s}</small></button>`).join('')}</div>`);
}

// ---------- «Кабинет» на тарифе «Старт» ----------
function pkCabinetGate(section) {
  const { plan } = pkPlanNow();
  if (plan === 'start' && section !== 'admin') return pkUpgrade(), true;
  return false;
}
function pkUpgrade() {
  pkLoadGeo().then(() => { if (document.getElementById('pkUpg')) pkUpgradeRender(); });
  pkUpgradeRender();
}
function pkUpgradeRender() {
  const P = PK_TP[pkGeoCur()], [m, y] = P.main;
  pkScr('', `<div class="pk-upg" id="pkUpg"><div class="ic"><i class="ti ti-device-desktop" aria-hidden="true"></i></div><h2>Кабинет — с тарифа «Основной»</h2>
      <p>У вас «Старт»: Piksta работает на телефоне. Кабинет на компьютере открывается на «Основном».</p>
      <div class="ul"><div><i class="ti ti-check" aria-hidden="true"></i>Все закупки и клиенты на большом экране</div><div><i class="ti ti-check" aria-hidden="true"></i>Цены, курсы и расчёты в таблицах</div><div><i class="ti ti-check" aria-hidden="true"></i>До 1 500 треков в месяц вместо 300</div></div></div>
    <div class="pk-tf rec" onclick="pkPayStart('main')" role="button" tabindex="0"><div class="pk-tf-r"><b>Основной</b><span class="pk-tf-pr"><small>≈</small>${pkN(y / 12)} <small>${P.s} / мес</small></span></div><span class="pk-tf-y">при оплате за год — ${pkN(y)} ${P.s} · выгода ${pkN(m * 12 - y)}</span><span class="pk-tf-d">или ${pkN(m)} ${P.s} помесячно</span></div>
    <button type="button" class="pk-btn" onclick="pkTPer='y';pkPayStart('main')">Перейти на «Основной»</button>
    <button type="button" class="pk-btn ghost" onclick="pkTariffs()">Сравнить все тарифы</button>
    <p class="pk-muted" style="font-size:12.5px;text-align:center;margin:2px 0 0">Данные никуда не денутся — всё, что вы ведёте в телефоне, сразу появится в Кабинете</p>`);
}

// ---------- оплата: шаг 1 — срок и способ ----------
function pkPayMethods() {
  const g = pkGeo || '';
  const L = PK_PAY.filter(x => x.id === 'other' || x.qr || x.card || x.phone || x.iban);
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
  const S = pkPayS, cur = pkGeoCur(), P = PK_TP[cur], [m, y] = P[S.plan];
  const L = pkPayMethods();
  const amt = x => x.cur ? pkN(pkPayAmount(x.cur, S.plan, pkTPer)) + ' ' + PK_SYM[x.cur] : '';
  pkScr(`Оплата «${PK_PLANS[S.plan].n}»`, `
    <div class="pk-seg"><button type="button" class="${pkTPer === 'm' ? 'on' : ''}" onclick="pkTPer='m';pkPayRender1()">Помесячно · ${pkN(m)}</button><button type="button" class="${pkTPer === 'y' ? 'on' : ''}" onclick="pkTPer='y';pkPayRender1()">За год · ≈${pkN(y / 12)} в мес</button></div>
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
  const amount = pkPayAmount(x.cur, S.plan, pkTPer), s = PK_SYM[x.cur], byn = PK_TP.BYN[S.plan][pkTPer === 'y' ? 1 : 0];
  S.amount = amount; S.cur = s;
  let req = `<div><small>Сумма</small><span class="pk-pay-big">${pkN(amount)} <small>${s}</small></span>${x.cur !== 'BYN' ? `<small>= ${pkN(byn)} BYN ${pkRateNote()}, округлено вверх</small>` : ''}</div>`;
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
