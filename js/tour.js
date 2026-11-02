// ============ ОБУЧАЛКА ПРИ ПЕРВОМ ВХОДЕ (02.11.2026) ============
// Затемнение + подсвеченная кнопка + пара слов. Отдельно для телефона (m) и Кабинета (c).
// Показывается один раз — отметка в профиле (users/{uid}.tour.m / .tour.c), поэтому не всплывёт на другом устройстве.
// Кому: новые регистрации (с запуска подтверждения e-mail). Заново — пункт «Подсказки по интерфейсу» в «Ещё» / в меню Кабинета.
// Пункт виден первые PK_TOUR_MENU_DAYS дней после регистрации (админу — всегда), потом исчезает.
// Предпросмотр: /app?tour=1
const PK_TOUR_SINCE = Date.parse('2026-11-02T19:00:00Z');
const PK_TOUR_MENU_DAYS = 60;
const PK_TOUR = {
  m: [
    { sel: '#pkT-scan', t: 'Сканер', d: 'Наведите камеру или сканер-пистолет на штрихкод — сразу видно фото товара и чья это посылка.' },
    { sel: '#pkT-ships', t: 'Закупки', d: 'Ваши закупки: создание, импорт заказов из Pinduoduo, статусы «В дороге» и «На складе».' },
    { sel: '#pkT-clients', t: 'Клиенты', d: 'Кто что заказал, контакты и долг каждого клиента.' },
    { sel: '#pkT-money', t: 'Деньги', d: 'Кто сколько должен и кто уже оплатил.' },
    { sel: '#pkT-more', t: 'Ещё', d: 'Тариф, настройки, помощь. Здесь же — «Подсказки по интерфейсу», если захотите пройти их заново.' }
  ],
  c: [
    { sel: '.cab-nav-item[data-section="overview"]', pre: 'overview', t: 'Обзор', d: 'Сводка: что в пути, что приехало, сколько вам должны.' },
    { sel: '#cabMain .cab-help', t: 'Значок «?»', d: 'Есть почти у каждого блока. Нажмите на него — появится подробное пояснение, что здесь показано и как этим пользоваться.' },
    { sel: '.cab-nav-item[data-section="shipments"]', t: 'Закупки', d: 'Создавайте и редактируйте закупки, импортируйте заказы из Pinduoduo, задавайте курсы конвертации, ведите взаиморасчёты с клиентами и вносите данные взвешивания.' },
    { sel: '.cab-nav-item[data-section="clients"]', t: 'Клиенты', d: 'Работа с клиентской базой: карточка и индивидуальные настройки каждого клиента, забытые и разовые клиенты.' },
    { sel: '.cab-nav-item[data-section="calc"]', t: 'Расчёты', d: 'Вес, доставка и кто сколько должен по каждой закупке.' },
    { sel: '.cab-nav-item[data-section="analytics"]', t: 'Аналитика', d: 'Главные экономические показатели вашего бизнеса: что приносит прибыль, а что убыточно. Здесь будут появляться новые инструменты.' },
    { sel: '.cab-nav-item[data-section="tariffs"]', t: 'Тариф', d: 'Выберите тариф под свои задачи: Старт, Основной или Профи.' },
    { sel: '#cabTourBtn', t: 'Подсказки', d: 'Захотите пройти обучение заново — оно здесь.' }
  ]
};

(function () {
  const css = `
#pkTour{position:fixed;inset:0;z-index:250;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#17142a}
#pkTour *{box-sizing:border-box}
#pkTour .bk{position:absolute;inset:0;background:rgba(15,12,30,.62)}
#pkTour .hole{position:absolute;border-radius:14px;box-shadow:0 0 0 3px #a78bfa,0 0 18px rgba(167,139,250,.6);pointer-events:none}
#pkTour svg.dm{position:absolute;inset:0;width:100%;height:100%}
#pkTour .tip{position:absolute;width:min(320px,calc(100vw - 24px));background:#fff;border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.28);padding:15px 16px 13px;transition:top .28s ease,left .28s ease}
#pkTour .tip.c{left:50%!important;top:50%!important;transform:translate(-50%,-50%);width:min(340px,calc(100vw - 32px));text-align:center;padding:22px 20px 16px}
#pkTour .ar{position:absolute;width:14px;height:14px;background:#fff;transform:rotate(45deg);border-radius:2px}
#pkTour .n{font-size:11.5px;font-weight:700;color:#6C4DB8;text-transform:uppercase;letter-spacing:.05em}
#pkTour h3{margin:3px 0 4px;font-size:18px;font-weight:800;line-height:1.2}
#pkTour p{margin:0;font-size:14px;line-height:1.45;color:#4a4560}
#pkTour .row{display:flex;align-items:center;gap:8px;margin-top:13px}
#pkTour .dots{display:flex;gap:5px;margin:0 auto}#pkTour .dots i{width:6px;height:6px;border-radius:3px;background:#ddd5f3}#pkTour .dots i.on{background:#6C4DB8;width:16px}
#pkTour button{border:none;border-radius:11px;font-weight:700;font-size:14px;padding:9px 14px;cursor:pointer;font-family:inherit}
#pkTour .go{background:#6C4DB8;color:#fff}#pkTour .sk{background:none;color:#8a85a0;font-weight:600;padding:9px 4px}
#pkTour .wl{width:64px;height:64px;border-radius:18px;margin:0 auto 10px;display:block}
#pkTour .tip.c .row{flex-direction:column;gap:6px}#pkTour .tip.c .go{width:100%;height:44px;font-size:15px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();

let pkTourS = null;   // { mode, i, steps }
const pkTourForce = /[?&]tour=1/.test(location.search);
const pkTourMode = () => document.getElementById('cabinetScreen') && document.getElementById('cabinetScreen').classList.contains('show') ? 'c' : (document.body.classList.contains('pk-m') ? 'm' : null);

// Пункт меню «Подсказки по интерфейсу»: первые 60 дней после регистрации
function pkTourMenuOn() {
  if (!currentUser || !userProfile) return false;
  if (userProfile.role === 'admin') return true;
  const born = Date.parse((currentUser.metadata && currentUser.metadata.creationTime) || '') || 0;
  return Date.now() - born < PK_TOUR_MENU_DAYS * 864e5;
}
function pkTourMenuSync() { const b = document.getElementById('cabTourBtn'); if (b) b.style.display = pkTourMenuOn() ? '' : 'none'; }

function pkTourMaybe() {
  pkTourMenuSync();
  if (pkTourS || !currentUser || !userProfile || userProfile.blocked) return;
  const g = document.getElementById('pkVGate'); if (g && g.style.display !== 'none') return;
  const mode = pkTourMode(); if (!mode) return;
  if (!pkTourForce) {
    if (userProfile.role === 'admin') return;
    const born = Date.parse((currentUser.metadata && currentUser.metadata.creationTime) || '') || 0;
    if (born < PK_TOUR_SINCE) return;
    if ((userProfile.tour || {})[mode]) return;
    try { if (localStorage.getItem('pk_tour_' + mode)) return; } catch (e) {}
  }
  pkTourStart(mode);
}

function pkTourStart(mode) {
  mode = mode || pkTourMode(); if (!mode) return;
  if (typeof pkSheetClose === 'function') try { pkSheetClose(); } catch (e) {}
  pkTourS = { mode, i: -1, steps: PK_TOUR[mode] };
  let o = document.getElementById('pkTour');
  if (!o) { o = document.createElement('div'); o.id = 'pkTour'; document.body.appendChild(o); }
  o.style.display = 'block';
  pkTourDraw();
  window.addEventListener('resize', pkTourDraw);
}

function pkTourDraw() {
  const S = pkTourS, o = document.getElementById('pkTour'); if (!S || !o) return;
  if (S.i < 0) {   // приветствие
    o.innerHTML = `<div class="bk"></div><div class="tip c"><img class="wl" src="/icons/icon-72x72.png" alt="">
      <h3>Добро пожаловать в Piksta!</h3><p>Покажем главное за полминуты — ${S.steps.length} коротких подсказок.</p>
      <div class="row"><button class="go" onclick="pkTourNext()">Показать</button><button class="sk" onclick="pkTourEnd()">Пропустить</button></div></div>`;
    return;
  }
  const st = S.steps[S.i];
  if (st.pre && !S.preDone) {   // сначала открыть нужный раздел, потом подсвечивать
    S.preDone = 1;
    try { if (typeof cabNav === 'function') cabNav(st.pre); } catch (e) {}
    return setTimeout(pkTourDraw, 450);
  }
  const el = [...document.querySelectorAll(st.sel)].find(e => e.offsetParent !== null || e.getClientRects().length);
  if (!el) { if (S.i < S.steps.length - 1) { S.i++; return pkTourDraw(); } return pkTourEnd(); }
  try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  const r = el.getBoundingClientRect(), pad = 5, W = innerWidth, H = innerHeight;
  const last = S.i === S.steps.length - 1;
  o.innerHTML = `<svg class="dm"><path fill="rgba(15,12,30,.62)" fill-rule="evenodd"/></svg><div class="hole"></div><div class="tip"><div class="ar"></div><div class="n">${S.i + 1} из ${S.steps.length}</div><h3>${st.t}</h3><p>${st.d}</p>
    <div class="row"><button class="sk" onclick="pkTourEnd()">${last ? '' : 'Пропустить'}</button><div class="dots">${S.steps.map((_, k) => `<i class="${k === S.i ? 'on' : ''}"></i>`).join('')}</div><button class="go" onclick="pkTourNext()">${last ? 'Готово' : 'Дальше'}</button></div></div>`;
  const h = o.querySelector('.hole'), tip = o.querySelector('.tip'), ar = o.querySelector('.ar');
  const hx = r.left - pad, hy = r.top - pad, hw = r.width + pad * 2, hh = r.height + pad * 2;
  const rad = Math.min(14, hh / 2, hw / 2);
  Object.assign(h.style, { left: hx + 'px', top: hy + 'px', width: hw + 'px', height: hh + 'px', borderRadius: rad + 'px' });
  // затемнение с закруглённым «окном» точно по рамке
  const q = rad, x2 = hx + hw, y2 = hy + hh;
  o.querySelector('svg.dm path').setAttribute('d', `M0 0H${W}V${H}H0Z M${hx + q} ${hy}H${x2 - q}A${q} ${q} 0 0 1 ${x2} ${hy + q}V${y2 - q}A${q} ${q} 0 0 1 ${x2 - q} ${y2}H${hx + q}A${q} ${q} 0 0 1 ${hx} ${y2 - q}V${hy + q}A${q} ${q} 0 0 1 ${hx + q} ${hy}Z`);
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
  let left, top, side;
  if (S.mode === 'c' && r.right + gap + tw < W - 8 && r.width < W * 0.4 && r.left < W * 0.3) {   // меню слева (Кабинет) — подсказка справа
    left = r.right + gap; top = Math.min(Math.max(8, r.top + r.height / 2 - th / 2), H - th - 8); side = 'l';
  } else if (r.top + r.height / 2 > H / 2) {                                    // кнопка внизу — подсказка над ней
    top = r.top - pad - gap - th; left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), W - tw - 12); side = 'b';
  } else {
    top = r.bottom + pad + gap; left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), W - tw - 12); side = 't';
  }
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
  if (side === 'l') Object.assign(ar.style, { left: '-6px', top: (r.top + r.height / 2 - top - 7) + 'px' });
  else Object.assign(ar.style, { left: Math.min(Math.max(14, r.left + r.width / 2 - left - 7), tw - 28) + 'px', [side === 'b' ? 'bottom' : 'top']: '-6px' });
}

function pkTourNext() {
  const S = pkTourS; if (!S) return;
  if (S.i >= S.steps.length - 1) return pkTourEnd();
  S.i++; S.preDone = 0; pkTourDraw();
}

function pkTourEnd() {
  const S = pkTourS; pkTourS = null;
  window.removeEventListener('resize', pkTourDraw);
  const o = document.getElementById('pkTour'); if (o) { o.style.display = 'none'; o.innerHTML = ''; }
  if (!S || pkTourForce) return;
  try { localStorage.setItem('pk_tour_' + S.mode, '1'); } catch (e) {}
  if (currentUser && userProfile && !(userProfile.tour || {})[S.mode]) {
    userProfile.tour = { ...(userProfile.tour || {}), [S.mode]: true };
    db.collection('users').doc(currentUser.uid).update({ ['tour.' + S.mode]: true }).catch(() => {});
  }
}

// Запуск: после входа и при переключении телефон ↔ Кабинет
(function () {
  const f = window.enterMode;
  if (typeof f === 'function') window.enterMode = function (mode) { const r = f.apply(this, arguments); setTimeout(pkTourMaybe, 900); return r; };
})();
