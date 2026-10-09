// ============ AUTH LISTENER ============
auth.onAuthStateChanged(async (user) => {
  document.getElementById('loadingScreen').classList.add('hide');
  if (user) {
    currentUser = user;
    savedUid = user.uid;
    try { savedToken = await user.getIdToken(); } catch(e) {}
    await loadUserProfile();
    showApp();
  } else {
    currentUser = null;
    userProfile = null;
    document.getElementById('appScreen').classList.add('hide');
    document.getElementById('authScreen').classList.remove('hide');
    showScreen('login');
  }
});

// ============ AUTH SCREENS ============
function showScreen(name) {
  ['loginForm','registerForm','recoveryForm'].forEach(id => document.getElementById(id).classList.add('hide'));
  document.getElementById(name + 'Form').classList.remove('hide');
  // Clear errors
  document.querySelectorAll('.auth-error,.auth-success').forEach(e => e.classList.add('hide'));
}

function showError(id, msg) { const e = document.getElementById(id); e.textContent = msg; e.classList.remove('hide'); }

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  if (!email || !pass) { showError('loginError', 'Заполните все поля'); return; }
  document.getElementById('loginBtn').disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    const msg = e.code === 'auth/user-not-found' ? 'Пользователь не найден' :
      e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential' ? 'Неверный пароль' :
      e.code === 'auth/invalid-email' ? 'Некорректный email' : 'Ошибка входа';
    showError('loginError', msg);
  }
  document.getElementById('loginBtn').disabled = false;
}

async function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  if (!name || !email || !pass) { showError('regError', 'Заполните все поля'); return; }
  if (pass.length < 6) { showError('regError', 'Пароль минимум 6 символов'); return; }
  if (pass !== pass2) { showError('regError', 'Пароли не совпадают'); return; }
  if (!document.getElementById('regChk1').checked || !document.getElementById('regChk2').checked) {
    showError('regError', 'Необходимо принять условия и согласиться с обработкой данных');
    return;
  }
  document.getElementById('regBtn').disabled = true;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
    await db.collection('users').doc(cred.user.uid).set({
      name, email, role, created: firebase.firestore.FieldValue.serverTimestamp(),
      acceptedTerms: true, acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Задача 3: письмо подтверждения email
    try { await cred.user.sendEmailVerification(); } catch(ve) {}
  } catch(e) {
    const msg = e.code === 'auth/email-already-in-use' ? 'Email уже зарегистрирован' :
      e.code === 'auth/weak-password' ? 'Слишком простой пароль' :
      e.code === 'auth/invalid-email' ? 'Некорректный email' : e.message;
    showError('regError', msg);
  }
  document.getElementById('regBtn').disabled = false;
}

async function doRecovery() {
  const email = document.getElementById('recEmail').value.trim();
  if (!email) { showError('recError', 'Введите email'); return; }
  try {
    await auth.sendPasswordResetEmail(email);
    const s = document.getElementById('recSuccess');
    s.textContent = '✅ Письмо отправлено на ' + email;
    s.classList.remove('hide');
    document.getElementById('recError').classList.add('hide');
  } catch(e) {
    showError('recError', e.code === 'auth/user-not-found' ? 'Email не найден' : 'Ошибка отправки');
  }
}

function doLogout() { if (scanning) stopScanner(); auth.signOut(); }

// ============ USER PROFILE ============
async function loadUserProfile() {
  const uid = savedUid, email = (currentUser&&currentUser.email)||'', displayName = (currentUser&&currentUser.displayName)||'';
  const token = await currentUser.getIdToken();
  let doc;
  try { doc = await fsGet('users/' + uid, token); } catch(e) { doc = { exists: false }; }
  if (doc.exists) {
    userProfile = doc.data();
  } else {
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
    userProfile = { name: displayName || email, email, role };
    try { await db.collection('users').doc(uid).set({ ...userProfile, created: firebase.firestore.FieldValue.serverTimestamp() }); } catch(e) {}
  }
}

// ============ SHOW APP ============
// Выбор режима на экране выбора
function chooseMode(mode) {
  if (document.getElementById('rememberMode').checked) {
    localStorage.setItem('piksta_mode', mode);
  }
  document.getElementById('modeSelectScreen').classList.add('hide');
  enterMode(mode);
}

// Вход в режим (scanner = мобильный сканер, cabinet = широкий Кабинет)
function enterMode(mode) {
  document.getElementById('modeSelectScreen').classList.add('hide');
  if (mode === 'cabinet') {
    document.getElementById('cabinetScreen').classList.add('show');
    openCabinet();
  } else {
    document.getElementById('appScreen').classList.remove('hide');
  }
}

async function showApp() {
  document.getElementById('authScreen').classList.add('hide');
  // Экран выбора режима: если запомнен — сразу в него, иначе показываем выбор
  const remembered = localStorage.getItem('piksta_mode');
  if (remembered === 'scanner' || remembered === 'cabinet') {
    enterMode(remembered);
  } else {
    const hi = document.getElementById('modeSelectHi');
    if (hi) hi.textContent = 'Куда переходим, ' + (userProfile.name ? userProfile.name.split(' ')[0] : '') + '?';
    document.getElementById('modeSelectScreen').classList.remove('hide');
  }
  document.getElementById('userBadgeName').textContent = userProfile.name || currentUser.email;
  if (userProfile.role === 'admin') { const cb = document.querySelector('.contact-banner'); if (cb) cb.style.display = 'none'; }

  // Check blocked
  if (userProfile.blocked) {
    document.getElementById('blockedBanner').style.display='block';
    document.querySelectorAll('.shipment-section,.gun-section,.scanner-section,.stats,.progress-wrap,.bottom-section,.history').forEach(e=>e.style.display='none');
    return;
  }

  // Trial/Subscription banner for non-admin
  if (userProfile.role !== 'admin') {
    const banner = document.getElementById('trialBanner');
    const sub = userProfile.subscription;

    // Check paid subscription first
    if (sub && sub.endDate) {
      const subEnd = sub.endDate.toDate ? sub.endDate.toDate() : new Date(sub.endDate);
      const subDaysLeft = Math.ceil((subEnd - new Date()) / (24*60*60*1000));
      if (subDaysLeft > 0) {
        banner.style.cssText = 'display:block;margin:0 16px 14px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:12px;text-align:center;font-size:14px;color:#16a34a;font-weight:500';
        banner.innerHTML = '<i class="ti ti-license" style="font-size:16px;vertical-align:-2px;margin-right:4px"></i> Лицензия действует до ' + subEnd.toLocaleDateString('ru');
      } else {
        userProfile._demo = true;
        banner.style.cssText = 'display:block;margin:0 16px 14px;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;padding:12px;text-align:center;font-size:14px;color:#dc2626;font-weight:500';
        banner.innerHTML = '<i class="ti ti-alert-triangle" style="font-size:16px;vertical-align:-2px;margin-right:4px"></i> Подписка истекла. Демо-версия: 5 треков<br><span style="font-size:12px;font-weight:400;color:#999">Для продления обратитесь в техподдержку</span>';
      }
    } else {
      // No subscription — check trial
      const created = userProfile.created?.toDate ? userProfile.created.toDate() : new Date(userProfile.created || Date.now());
      const trialEnd = new Date(created.getTime() + 90*24*60*60*1000);
      const daysLeft = Math.ceil((trialEnd - new Date()) / (24*60*60*1000));
      if (daysLeft <= 0) {
        userProfile._demo = true;
        banner.style.cssText = 'display:block;margin:0 16px 14px;background:#f5f5f5;border:1.5px solid #d4d4d4;border-radius:12px;padding:12px;text-align:center;font-size:14px;color:#555;font-weight:500';
        banner.innerHTML = '<i class="ti ti-lock" style="font-size:16px;vertical-align:-2px;margin-right:4px"></i> Демо-версия: отображаются 5 треков<br><span style="font-size:12px;font-weight:400;color:#999">Для приобретения подписки обратитесь в техподдержку</span>';
      } else if (daysLeft <= 14) {
        banner.style.cssText = 'display:block;margin:0 16px 14px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:12px;text-align:center;font-size:14px;color:#ea580c;font-weight:500';
        banner.innerHTML = '<i class="ti ti-clock" style="font-size:16px;vertical-align:-2px;margin-right:4px"></i> Тестовый период: осталось ' + daysLeft + ' дней';
      } else {
        banner.style.cssText = 'display:block;margin:0 16px 14px;background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:12px;text-align:center;font-size:14px;color:#ea580c;font-weight:500';
        banner.innerHTML = '<i class="ti ti-hourglass" style="font-size:16px;vertical-align:-2px;margin-right:4px"></i> Тестовый период: ' + daysLeft + ' дней';
      }
    }
  }

  applyTheme();
  await loadShipments();
  startShipmentsSync();
  await loadHistory();
  renderHistory();
  renderAdminPanel();
  setTimeout(() => document.getElementById('manualInput').focus(), 300);
}

// ============ SHIPMENTS (FIRESTORE) ============
function shipmentsRef() { return db.collection('users').doc(currentUser.uid).collection('shipments'); }

// Сохранить курсы текущего прихода в Firebase
async function saveRates() {
  if (!activeShipmentId) return;
  await shipmentsRef().doc(editingShipmentId || activeShipmentId).update({ rates: currentRates });
}

// Тара процентом от веса клиентов (когда недовешенные «вес в цене» не дают посчитать тару по карго).
// 0 = обычный режим (тара = введённая или карго − вес клиентов).
let currentTarePct = 0;
const TARE_PCT_FIXED = 8;  // чекбокс «Тара 8%»
function onTarePctChange(v) {
  currentTarePct = v === true ? TARE_PCT_FIXED : v === false ? 0 : Math.max(0, parseFloat(String(v).replace(',', '.')) || 0);
  const ti = document.getElementById('tareInput'); if (ti) ti.disabled = currentTarePct > 0;
  if (typeof renderWeighList === 'function' && document.getElementById('weighList')) renderWeighList();
  const id = editingShipmentId || activeShipmentId;
  if (id) shipmentsRef().doc(id).update({ tarePct: currentTarePct });
  updateClientsWeightTotal();
}

async function saveWeights() {
  if (!activeShipmentId) return;
  await shipmentsRef().doc(editingShipmentId || activeShipmentId).update({ weights: currentWeights, tare: currentTare, priceInclWeight: currentPriceInclWeight });
}

async function saveOwners() {
  if (!activeShipmentId) return;
  await shipmentsRef().doc(editingShipmentId || activeShipmentId).update({ owners: currentOwners, costGoods: currentCostGoods, costShip: currentCostShip });
}

function toggleOwner(name) {
  currentOwners[name] = !currentOwners[name];  // явное значение (true/false) для этого прихода — перекрывает правило из карточки клиента
  saveOwners();
  renderCalc();
}

function toggleCostGoods(name) {
  currentCostGoods[name] = !currentCostGoods[name];  // явное значение (true/false) для этого прихода — перекрывает правило из карточки клиента
  saveOwners();
  renderCalc();
}

function toggleCostShip(name) {
  currentCostShip[name] = !currentCostShip[name];  // явное значение (true/false) для этого прихода — перекрывает правило из карточки клиента
  saveOwners();
  renderCalc();
}

// ============ РЕДАКТОР ЦЕН ============
function openPriceEditor() {
  if (!TABLE.length) { alert('Нет товаров в приходе'); return; }
  document.getElementById('peSearch').value = '';
  peExactWh = null;
  document.getElementById('peHints').innerHTML = '';
  renderPriceEditor();
  document.getElementById('priceEditScreen').classList.add('show');
}
function closePriceEditor() {
  document.getElementById('priceEditScreen').classList.remove('show');
  restoreActiveEditing();
}

let peExactWh = null;
let peSortMode = 'default';
function setPeSort(mode) {
  peSortMode = mode;
  document.getElementById('peSortDefault').classList.toggle('sort-active', mode === 'default');
  document.getElementById('peSortWh').classList.toggle('sort-active', mode === 'warehouse');
  renderPriceEditor();
}  // если выбран точный склад из подсказки — фильтр по нему

function onPeSearchInput() {
  peExactWh = null;  // ручной ввод сбрасывает точный выбор
  renderPeHints();
  renderPriceEditor();
}

// Подсказки: уникальные склады содержащие введённый текст (мини-чипы)
function renderPeHints() {
  const q = (document.getElementById('peSearch').value || '').toLowerCase().trim();
  const box = document.getElementById('peHints');
  if (!q || q.length < 1) { box.innerHTML = ''; return; }
  // собираем уникальные склады где встречается q
  const whSet = new Set();
  for (const r of TABLE) {
    const wh = r[1] || '';
    if (wh && wh.toLowerCase().includes(q)) whSet.add(wh);
  }
  const list = [...whSet].sort((a,b)=>a.localeCompare(b,'ru')).slice(0, 6);
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = list.map(wh => `<span class="pe-hint-chip" onclick="pePickHint('${wh.replace(/'/g,"\\'")}')">${wh}</span>`).join('');
}

// Выбор склада из подсказки — точный фильтр (100% совпадение по складу)
function pePickHint(wh) {
  peExactWh = wh;
  document.getElementById('peSearch').value = wh;
  document.getElementById('peHints').innerHTML = '';
  renderPriceEditor();
}

function renderPriceEditor() {
  const q = (document.getElementById('peSearch').value || '').toLowerCase().trim();
  let items = TABLE.map((r, i) => ({
    idx: i, track: r[0], wh: r[1]||'', img: r[2]||'',
    buy: r[3]||'', client: r[4]||'', qty: parseInt(r[5])||1
  }));
  if (peExactWh) {
    // Точное совпадение склада (выбран из подсказки)
    items = items.filter(r => r.wh === peExactWh);
  } else if (q) {
    items = items.filter(r => r.track.toLowerCase().includes(q) || r.wh.toLowerCase().includes(q));
  }

  // Сортировка "По складам" — группируем товары по клиенту (складу)
  if (peSortMode === 'warehouse') {
    items = items.slice().sort((a, b) => (a.wh || 'яяя').localeCompare(b.wh || 'яяя', 'ru'));
  }

  const list = document.getElementById('peList');
  // Предупреждение о незаполненных ценах (напр. после сверки с карго — товары другого маркетплейса без цен)
  const emptyPrices = TABLE.filter(r => !String(r[3]||'').trim()).length;
  let warnHtml = '';
  if (emptyPrices > 0) {
    warnHtml = `<div style="background:#fffaeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:13px;color:#b45309;line-height:1.5"><i class="ti ti-alert-triangle" style="margin-right:4px"></i> Не заполнены цены у <b>${emptyPrices}</b> товаров. Для достоверного отчёта заполните закупочные цены.</div>`;
  }
  const byWh = peSortMode === 'warehouse';
  let lastWh = null;
  list.innerHTML = warnHtml + items.map(r => {
    let header = '';
    // В режиме "По складам" — заголовок клиента перед сменой группы
    if (byWh) {
      const whName = r.wh || '— без склада —';
      if (whName !== lastWh) {
        lastWh = whName;
        header = `<div class="pe-wh-header">${whName}</div>`;
      }
    }
    return header + `
    <div class="pe-item ${r.qty>1?'multi':''}">
      <span class="pe-img-wrap" data-img="${r.img}"></span>
      <div class="pe-info">
        <div class="pe-track">${r.track}${r.qty>1?`<span class="pe-qty">×${r.qty}</span>`:''}</div>
        ${byWh ? '' : `<div style="position:relative"><input class="pe-wh pe-wh-input" data-idx="${r.idx}" value="${(r.wh||'').replace(/"/g,'&quot;')}" placeholder="— клиент —" onchange="onEditClientName(this)" oninput="showClientHints(this)" onfocus="showClientHints(this)" onblur="hideClientHints(this)" onclick="event.stopPropagation()" autocomplete="off"></div>`}
      </div>
      <div class="pe-prices">
        <label class="pe-price-field"><span>Закупка ¥</span><input type="number" step="0.01" inputmode="decimal" class="buy" data-idx="${r.idx}" value="${r.buy}" placeholder="—" onchange="onEditBuy(this)"></label>
        <label class="pe-price-field"><span>Клиент ¥</span><input type="number" step="0.01" inputmode="decimal" class="client" data-idx="${r.idx}" value="${r.client}" placeholder="${r.buy||'—'}" onchange="onEditClient(this)"></label>
      </div>
    </div>`;
  }).join('');

  // картинки
  list.querySelectorAll('.pe-img-wrap').forEach(wrap => {
    const url = wrap.dataset.img;
    if (url) {
      const img = document.createElement('img');
      img.className = 'pe-img'; img.src = url;
      img.addEventListener('error', () => { wrap.innerHTML = '<span class="pe-img-ph">📦</span>'; });
      img.addEventListener('click', () => img.classList.toggle('zoom'));
      wrap.appendChild(img);
    } else { wrap.innerHTML = '<span class="pe-img-ph">📦</span>'; }
  });
}

// Подсказки клиентов в редакторе цен (как в расширении) — список существующих клиентов прихода
function getUniqueClients() {
  const canon = {};
  for (const r of TABLE) {
    const wh = (r[1] || '').trim();
    if (wh) { const low = wh.toLowerCase(); canon[low] = whBetter(canon[low], wh); }
  }
  return Object.values(canon).sort((a,b)=>a.localeCompare(b,'ru'));
}

function showClientHints(input) {
  const q = (input.value || '').toLowerCase().trim();
  const all = getUniqueClients();
  // если поле пустое — показываем всех клиентов, иначе фильтруем по вхождению
  let list = q ? all.filter(n => n.toLowerCase().includes(q) && n.toLowerCase() !== q) : all;
  list = list.slice(0, 8);
  let box = input.parentElement.querySelector('.pe-client-hints');
  if (!list.length) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.className = 'pe-client-hints';
    input.parentElement.appendChild(box);
  }
  box.innerHTML = list.map(n => `<div class="pe-client-hint" onmousedown="pickClientHint(this,${input.dataset.idx})" data-name="${n.replace(/"/g,'&quot;')}">${n}</div>`).join('');
}

function hideClientHints(input) {
  setTimeout(() => { const box = input.parentElement.querySelector('.pe-client-hints'); if (box) box.remove(); }, 150);
}

function pickClientHint(el, idx) {
  const name = el.dataset.name;
  const input = el.parentElement.parentElement.querySelector('.pe-wh-input');
  if (input) { input.value = name; onEditClientName(input); }
  const box = el.parentElement; if (box) box.remove();
}

// Вариант Б: подтянуть имя клиента к уже существующему написанию (сравнение без учёта регистра)
// "Марина (marinn07)" → "Марина (Marinn07)" если такой уже есть в приходе
function resolveClientName(name) {
  const clean = (name || '').trim();
  if (!clean) return clean;
  const low = clean.toLowerCase();
  // ищем среди существующих клиентов прихода совпадение по lowercase
  let best = '';
  for (const r of TABLE) {
    const existing = (r[1] || '').trim();
    if (existing && existing.toLowerCase() === low) best = whBetter(best, existing);
  }
  return best ? whBetter(best, clean) : clean;  // одно и то же имя без учёта регистра → написание с заглавными
}

async function onEditClientName(input) {
  const idx = parseInt(input.dataset.idx);
  if (idx<0 || idx>=TABLE.length) return;
  const resolved = resolveClientName(input.value);
  TABLE[idx][1] = resolved;  // склад/клиент в TABLE[idx][1] (подтянут к существующему написанию)
  if (input.value.trim() !== resolved) input.value = resolved;  // покажем исправленное написание в поле
  await savePriceAt(idx);
  // если сортируем по складам — перерисуем чтобы товар перескочил к новому клиенту
  if (peSortMode === 'warehouse') renderPriceEditor();
}

async function onEditBuy(input) {
  const idx = parseInt(input.dataset.idx);
  if (idx<0 || idx>=TABLE.length) return;
  TABLE[idx][3] = input.value;
  const cli = document.querySelector(`.client[data-idx="${idx}"]`);
  if (cli) cli.placeholder = input.value || '—';
  await savePriceAt(idx);
}

async function onEditClient(input) {
  const idx = parseInt(input.dataset.idx);
  if (idx<0 || idx>=TABLE.length) return;
  TABLE[idx][4] = input.value;
  await savePriceAt(idx);
}

// Сохраняем цену конкретного трека обратно в приход (точечно, не трогая остальное)
async function savePriceAt(idx) {
  const shipId = editingShipmentId || activeShipmentId;  // пишем в тот приход, который сейчас редактируем
  if (!shipId || idx < 0 || idx >= TABLE.length) return;
  const ref = shipmentsRef().doc(shipId);
  // Транзакция: читаем свежий массив и меняем только одну строку — правки с другого устройства не затираются
  await db.runTransaction(async t => {
    const doc = await t.get(ref);
    if (!doc.exists) return;
    const data = doc.data().data;
    if (!data || !data[idx]) return;
    if (Array.isArray(data[idx])) {
      // старый формат-массив [t,w,img,p,pc,q]
      data[idx][1] = String(TABLE[idx][1]||'');  // склад/клиент
      data[idx][3] = String(TABLE[idx][3]||'');
      data[idx][4] = String(TABLE[idx][4]||'');
    } else {
      data[idx].w = String(TABLE[idx][1]||'');   // склад/клиент
      data[idx].p = String(TABLE[idx][3]||'');
      data[idx].pc = String(TABLE[idx][4]||'');
    }
    t.update(ref, { data });
  });
}

// ============ ВЫГРУЗКА ОТЧЁТА В PDF (через печать, табличный вид) ============
function exportCalcPDF() {
  const { clients, grandDue, grandProfit, ourWeight, tareTotal } = computeClientCalc();
  const editShip = (typeof allShipments !== 'undefined') ? allShipments.find(x => x.id === (editingShipmentId || activeShipmentId)) : null;
  const shipName = (editShip && editShip.name) || document.getElementById('shipmentSelect').selectedOptions[0]?.text || 'Приход';
  const totalWeight = (ourWeight + tareTotal);
  const dateStr = new Date().toLocaleDateString('ru-RU');
  // ВСЕГО ПРИБЫЛЬ = прибыль товаров + прибыль доставки по весу карго
  const rRep = currentRates;
  const totalProfit = grandProfit;  // grandProfit уже включает прибыль с доставки — второй раз не добавляем

  const bodyRows = clients.map(c => {
    if (c.isOwner) {
      const cost = c.goodsCost + c.shipCost;
      return `<tr class="owner">
        <td class="nm">${c.name} <span class="tag">это я</span></td>
        <td class="n">${c.count}</td>
        <td class="n">${c.yuan.toFixed(0)}</td>
        <td class="n">${(c.weight*1000).toFixed(0)}</td>
        <td class="n">${(c.shipWeight*1000).toFixed(0)}</td>
        <td class="n">${c.goodsCost.toFixed(0)}</td>
        <td class="n">${c.shipCost.toFixed(0)}</td>
        <td class="n due cost">−${cost.toFixed(0)}</td>
        <td class="n cost">−${cost.toFixed(0)}</td>
      </tr>`;
    }
    return `<tr>
      <td class="nm">${c.name}</td>
      <td class="n">${c.count}</td>
      <td class="n">${c.yuan.toFixed(0)}</td>
      <td class="n">${(c.weight*1000).toFixed(0)}</td>
      <td class="n">${(c.shipWeight*1000).toFixed(0)}</td>
      <td class="n">${c.goodsClient.toFixed(0)}</td>
      <td class="n">${c.shipClient.toFixed(0)}</td>
      <td class="n due">${c.due.toFixed(0)}</td>
      <td class="n prof">${c.profit.toFixed(0)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Отчёт — ${shipName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,'Segoe UI',Arial,sans-serif}
    body{padding:20px;color:#000}
    h1{font-size:22px;margin-bottom:2px;color:#000}
    .sub{color:#000;font-size:14px;margin-bottom:16px}
    .grand{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
    .gcard{background:#f2f2f2;border:1px solid #ccc;border-radius:8px;padding:12px 16px;flex:1;min-width:130px}
    .gcard .lbl{font-size:13px;color:#000;font-weight:600}
    .gcard .val{font-size:24px;font-weight:700;color:#000}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th{background:#000;color:#fff;padding:9px 6px;text-align:right;font-weight:700;font-size:13px}
    th:first-child{text-align:left;border-radius:6px 0 0 0}
    th:last-child{border-radius:0 6px 0 0}
    td{padding:9px 6px;border-bottom:1px solid #ccc;color:#000}
    td.nm{text-align:left;font-weight:700}
    td.n{text-align:right;font-variant-numeric:tabular-nums;color:#000}
    td.due{font-weight:800;color:#000}
    td.prof{color:#000;font-weight:700}
    td.cost{color:#000;font-weight:700}
    tr.owner td{background:#e8e8e8}
    .tag{font-size:11px;background:#000;color:#fff;border-radius:4px;padding:1px 6px;font-weight:600;vertical-align:middle}
    tr.total td{border-top:2px solid #000;border-bottom:none;font-weight:800;font-size:16px;padding-top:12px;color:#000}
    tr.total td.due{color:#000}
    tr.total td.prof{color:#000}
    @media print{body{padding:0}}
  </style></head><body>
    <h1>Финансовый отчёт</h1>
    <div class="sub">${shipName} · ${dateStr}</div>
    <div class="grand">
      <div class="gcard"><div class="lbl">Клиенты должны</div><div class="val">${grandDue.toFixed(0)} BYN</div></div>
      <div class="gcard"><div class="lbl">Всего прибыль</div><div class="val">${totalProfit.toFixed(0)} BYN</div></div>
      <div class="gcard"><div class="lbl">Общий вес</div><div class="val">${totalWeight.toFixed(2)} кг</div></div>
      <div class="gcard"><div class="lbl">Вес тары</div><div class="val">${tareTotal.toFixed(2)} кг</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Клиент</th><th>Поз.</th><th>¥</th><th>Товар,г</th><th>С тарой,г</th><th>Товар BYN</th><th>Дост. BYN</th><th>Должен BYN</th><th>Приб. BYN</th>
      </tr></thead>
      <tbody>
        ${bodyRows}
        <tr class="total"><td class="nm">Итого</td><td></td><td></td><td class="n">${(clients.reduce((s,c)=>s+c.weight,0)*1000).toFixed(0)}</td><td class="n">${(clients.reduce((s,c)=>s+c.shipWeight,0)*1000).toFixed(0)}</td><td></td><td></td><td class="n due">${grandDue.toFixed(0)}</td><td class="n">${totalProfit.toFixed(0)}</td></tr>
      </tbody>
    </table>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Разрешите всплывающие окна для выгрузки'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ============ ВЗВЕШИВАНИЕ (Этап 2) ============
// Уникальные клиенты прихода (склады). Сборные "Алеся и Яна" разбиваем на части.
// Склады/клиенты НЕ различаются по регистру: «Марина (marinn07)» = «Марина (Marinn07)».
// Каноническое написание — то, где больше заглавных букв (маленькая буква исправляется на большую).
function whCaps(s){ return (String(s).match(/[A-ZА-ЯЁ]/g) || []).length; }
function whBetter(a, b){ return !a ? b : (whCaps(b) > whCaps(a) ? b : a); }
function buildWhCanon(rows){
  const canon = {};
  for (const r of rows || []) {
    const wh = Array.isArray(r) ? r[1] : (r && (r.w !== undefined ? r.w : r.wh));
    for (const p of splitWarehouses(wh || '')) { const low = p.toLowerCase(); canon[low] = whBetter(canon[low], p); }
  }
  return canon;
}

function getClientsInShipment() {
  const canon = buildWhCanon(TABLE);   // lowercase -> каноническое написание
  const counts = {};  // каноническое имя -> число позиций
  for (const r of TABLE) {
    const wh = r[1] || '';
    const parts = splitWarehouses(wh);
    if (!parts.length) continue;
    for (const p of parts) {
      const name = canon[p.toLowerCase()];
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  const names = [...new Set(Object.values(canon))].sort((a,b)=>a.localeCompare(b,'ru'));
  return { names, counts };
}

function openWeighing() {
  if (!TABLE.length) { alert('Нет товаров в приходе'); return; }
  renderWeighList();
  document.getElementById('tareInput').value = currentTare ? Math.round(currentTare * 1000) : '';
  const tpi = document.getElementById('tarePctChk'); if (tpi) tpi.checked = currentTarePct > 0;
  document.getElementById('tareInput').disabled = currentTarePct > 0;
  const cw = document.getElementById('cargoWeightInput'); if (cw) cw.value = currentCargoWeight ? Math.round(currentCargoWeight*1000) : '';
  const dep = document.getElementById('departedChk'); if (dep) dep.checked = !!shipmentDeparted;
  document.getElementById('weighScreen').classList.add('show');
  updateClientsWeightTotal();
}

function closeWeighing() {
  document.getElementById('weighScreen').classList.remove('show');
  restoreActiveEditing();
}

function renderWeighList() {
  const { names, counts } = getClientsInShipment();
  const list = document.getElementById('weighList');
  list.innerHTML = names.map(name => {
    const w = currentWeights[name] || '';
    const incl = !!currentPriceInclWeight[name];
    return `<div class="weigh-client ${w ? 'filled' : ''} ${incl ? 'incl' : ''}" id="wc-${encodeURIComponent(name)}">
      <div class="weigh-client-left">
        <div class="weigh-client-name">${name}</div>
        <label class="weigh-incl-label"><input type="checkbox" ${incl ? 'checked' : ''} data-name="${encodeURIComponent(name)}" onchange="onInclWeightChange(this)"> вес включён в цену</label>
      </div>
      <div class="weigh-client-right">
        <input type="number" step="50" inputmode="numeric" placeholder="0" value="${w ? Math.round(w*1000) : ''}" data-name="${encodeURIComponent(name)}" onchange="onWeightChange(this)">
        <span class="weigh-unit">г</span>
      </div>
    </div>`;
  }).join('');
}

function onWeightChange(input) {
  const name = decodeURIComponent(input.dataset.name);
  const grams = parseFloat(input.value) || 0;
  const val = grams / 1000;  // храним в кг, вводим в граммах
  if (val > 0) currentWeights[name] = val;
  else delete currentWeights[name];
  const card = document.getElementById('wc-' + encodeURIComponent(name));
  if (card) card.classList.toggle('filled', val > 0);
  updateClientsWeightTotal();
  saveWeights();
}

// Общий вес товаров клиентов (сумма взвешенных) + предупреждение если взвешены не все
function updateClientsWeightTotal() {
  const { names } = getClientsInShipment();
  let total = 0, weighed = 0, needWeigh = 0;
  for (const n of names) {
    // Обычный режим: «вес в цене» тоже взвешиваются (их вес не должен уйти в тару и лечь на других).
    // Режим «Тара 8%»: тару не высчитываем, «вес в цене» можно не взвешивать.
    if (currentTarePct > 0 && currentPriceInclWeight[n] && !(currentWeights[n] > 0)) continue;
    needWeigh++;
    const w = currentWeights[n] || 0;
    if (w > 0) { total += w; weighed++; }
  }
  const el = document.getElementById('clientsWeightTotal');
  const warn = document.getElementById('clientsWeightWarn');
  const allWeighed = (weighed >= needWeigh) && needWeigh > 0;
  if (el) el.textContent = Math.round(total * 1000).toLocaleString('ru') + ' г';
  if (warn) warn.style.display = allWeighed ? 'none' : 'block';

  // АВТОРАСЧЁТ ТАРЫ: если все клиенты взвешены и есть вес карго → тара = карго − товары клиентов
  if (allWeighed && currentCargoWeight > 0 && !(currentTarePct > 0)) {
    const tare = currentCargoWeight - total;  // в кг
    if (tare >= 0) {
      currentTare = tare;
      const tareInp = document.getElementById('tareInput');
      if (tareInp) tareInp.value = Math.round(tare * 1000);
      saveWeights();
    }
  }
}

// Галочка "вес включён в цену" у клиента (при взвешивании)
function onInclWeightChange(input) {
  const name = decodeURIComponent(input.dataset.name);
  if (input.checked) currentPriceInclWeight[name] = true;
  else delete currentPriceInclWeight[name];
  saveWeights();
  renderWeighList();
  updateClientsWeightTotal();
}

function onTareChange() {
  const grams = parseFloat(document.getElementById('tareInput').value) || 0;
  currentTare = grams / 1000;  // храним в кг, вводим в граммах
  saveWeights();
}

// ============ РАСЧЁТ ПО КЛИЕНТАМ (Этап 4) ============
// Считает по каждому клиенту: юани, вес+доля тары, клиент должен, прибыль.
function computeClientCalc() {
  const { names, counts } = getClientsInShipment();
  const r = currentRates;
  // канонич. написание клиента по lowercase (чтобы Карина/карина считались одним)
  const canon = {};
  for (const n of names) canon[n.toLowerCase()] = n;

  // Собираем по клиентам: сумма закупки (юани), сумма цены клиента (юани)
  const buyYuan = {};   // клиент -> Σ цена закупки
  const clientYuan = {}; // клиент -> Σ цена клиента
  for (const row of TABLE) {
    const wh = row[1] || '';
    const parts = splitWarehouses(wh);
    if (!parts.length) continue;
    const buyPrice = parseFloat(row[3]) || 0;         // цена закупки (r[3])
    const cliPrice = parseFloat(row[4]) || buyPrice;  // цена клиента (r[4]); если нет — = закупке
    for (const p of parts) {
      const name = canon[p.toLowerCase()] || p;  // приводим к каноническому написанию
      buyYuan[name] = (buyYuan[name] || 0) + buyPrice / parts.length;      // сборный: делим
      clientYuan[name] = (clientYuan[name] || 0) + cliPrice / parts.length;
    }
  }

  // Общий вес клиентов (для распределения тары)
  let totalClientWeight = 0;
  for (const n of names) totalClientWeight += (currentWeights[n] || 0);

  // Итоговый вес для доставки: max(вес карго, наш вес). Разница если карго больше = тара.
  const ourWeight = totalClientWeight;
  const effectiveTotal = Math.max(currentCargoWeight || 0, ourWeight);
  // Тара = введённая тара ИЛИ разница карго-наш (что больше учитываем как тару сверх веса клиентов)
  // Если задана тара в % — тара = % от веса клиентов (каждому +N% к его весу), карго не учитывается
  const tareTotal = currentTarePct > 0 ? ourWeight * currentTarePct / 100
    : Math.max(currentTare || 0, (currentCargoWeight || 0) - ourWeight);

  const clients = names.map(name => {
    const w = currentWeights[name] || 0;                          // чистый вес товара клиента (кг)
    // доля тары пропорционально весу
    const tareShare = totalClientWeight > 0 ? (w / totalClientWeight) * tareTotal : 0;
    const shipWeightRaw = w + tareShare;                          // вес с тарой (точный)
    // Округляем вес с тарой ВВЕРХ до 50 г — доставка считается с округлённого
    const shipWeight = w > 0 ? Math.ceil(shipWeightRaw * 20) / 20 : 0;  // *20/20 = шаг 0.05кг=50г

    const goodsClient = (clientYuan[name] || 0) * r.clientRate;   // товар клиенту в BYN
    const goodsCost = (buyYuan[name] || 0) * r.buyRate;           // себестоимость товара в BYN
    const shipClient = shipWeight * r.shipClient;                 // доставка клиенту в BYN (с округлённого)
    const shipCost = shipWeight * r.shipCargo;                    // доставка себестоимость в BYN

    const isOwner = !!currentOwners[name];
    const inclWeight = !!currentPriceInclWeight[name];  // вес включён в цену: доставку с клиента не берём, но карго-себест вычитаем
    const costGoods = !!currentCostGoods[name];  // товары по себестоимости (без наценки)
    const costShip = !!currentCostShip[name];    // доставка по себестоимости (без наценки)
    let due, profit, profitGoods, profitShip;  // profitGoods + profitShip = profit (разбивка для итогов)
    if (isOwner) {
      // Клиент "это я" (владелец): дохода нет, товары+доставка по СЕБЕСТОИМОСТИ = затраты (минус)
      due = 0;
      profit = -(goodsCost + shipCost);  // вычитается из общей прибыли
      profitGoods = -goodsCost; profitShip = -shipCost;
    } else if (costGoods || costShip) {
      // Индивидуальная скидка: товары и/или доставка по СЕБЕСТОИМОСТИ (клиент платит, но без наценки на это)
      const goodsPart = costGoods ? goodsCost : goodsClient;  // если товары по себест — берём себестоимость
      const shipPart = costShip ? shipCost : shipClient;      // если доставка по себест — берём себестоимость
      due = goodsPart + shipPart;  // клиент должен = (товар по себест или клиент) + (доставка по себест или клиент)
      // прибыль = наценка только с того что НЕ по себестоимости
      const goodsProfit = costGoods ? 0 : (goodsClient - goodsCost);
      const shipProfit = costShip ? 0 : (shipClient - shipCost);
      profit = goodsProfit + shipProfit;
      profitGoods = goodsProfit; profitShip = shipProfit;
    } else if (inclWeight) {
      // Вес включён в фикс-цену: клиент платит только за товар (без доставки), но карго-доставка съедает прибыль
      due = goodsClient;                                     // клиент должен = только фикс-цена товара
      profit = (goodsClient - goodsCost) - shipCost;         // прибыль = наценка на товар МИНУС себест карго-доставки
      profitGoods = goodsClient - goodsCost; profitShip = -shipCost;
    } else {
      due = goodsClient + shipClient;                        // клиент должен
      profit = (goodsClient - goodsCost) + (shipClient - shipCost); // прибыль
      profitGoods = goodsClient - goodsCost; profitShip = shipClient - shipCost;
    }

    // Ручная корректировка задолженности: итог клиента заменяется, прибыль меняется на разницу
    const dueCalc = due;
    const ov = currentDueOverride[name];
    const dueEdited = !isOwner && ov !== undefined && ov !== null;
    if (dueEdited) { profit += ov - due; profitGoods += ov - due; due = ov; }  // ручная правка итога — в прибыль с товаров

    return {
      name, count: counts[name], isOwner, dueCalc, dueEdited, profitGoods, profitShip,
      yuan: clientYuan[name] || 0,
      weight: w, tareShare, shipWeight,
      goodsClient, shipClient, goodsCost, shipCost, due, profit,
      noWeight: w === 0
    };
  });

  const grandDue = clients.reduce((s,c)=>s+c.due, 0);       // сколько должны реальные клиенты
  const grandProfit = clients.reduce((s,c)=>s+c.profit, 0); // итог с учётом затрат владельца (может быть минус)
  return { clients, grandDue, grandProfit, ourWeight, effectiveTotal, tareTotal };
}

function openCalc() {
  // просто скрываем экран взвешивания БЕЗ restoreActiveEditing — остаёмся на том же приходе (editingShipmentId не сбрасываем)
  document.getElementById('weighScreen').classList.remove('show');
  if (!TABLE.length) { alert('Нет товаров в приходе'); return; }
  renderCalc();
  document.getElementById('calcScreen').classList.add('show');
}

function closeCalc() {
  document.getElementById('calcScreen').classList.remove('show');
  restoreActiveEditing();
}

function renderCalc() {
  const { clients, grandDue, grandProfit, ourWeight, tareTotal } = computeClientCalc();
  const totalWeight = ourWeight + tareTotal;
  const r = currentRates;
  // grandProfit УЖЕ полная прибыль (товары + доставка по каждому клиенту). Отдельно доставку по весу карго
  // НЕ добавляем — раньше она считалась второй раз. Показываем только разбивку.
  const profitGoodsSum = clients.reduce((s, c) => s + (c.profitGoods || 0), 0);
  const profitShipSum = clients.reduce((s, c) => s + (c.profitShip || 0), 0);
  // все ли клиенты взвешены? (для точности: если все — прибыль точная зелёная, иначе ~ фиолетовая)
  const { names: allNames } = getClientsInShipment();
  let needW = 0, doneW = 0;
  for (const n of allNames) { if (currentTarePct > 0 && currentPriceInclWeight[n] && !(currentWeights[n] > 0)) continue; needW++; if ((currentWeights[n]||0) > 0) doneW++; }
  const allWeighed = needW > 0 && doneW >= needW;

  const totalColor = allWeighed ? '#22a05c' : '#6C4DB8';  // зелёный если точно, фиолетовый если приблизительно
  const totalPrefix = allWeighed ? '' : '~';
  document.getElementById('calcGrand').innerHTML = `
    <div class="calc-grand-row"><span class="calc-grand-label">Все клиенты должны</span><span class="calc-grand-val">${grandDue.toFixed(0)}<span class="cur">BYN</span></span></div>
    <div class="calc-grand-row"><span class="calc-grand-label">Прибыль с товаров</span><span class="calc-grand-val" style="color:#6C4DB8;font-size:18px">${profitGoodsSum.toFixed(0)}<span class="cur">BYN</span></span></div>
    <div class="calc-grand-row"><span class="calc-grand-label">Прибыль с доставки</span><span class="calc-grand-val" style="color:#6C4DB8;font-size:18px">${profitShipSum.toFixed(0)}<span class="cur">BYN</span></span></div>
    <div class="calc-grand-row" style="margin-top:2px"><span class="calc-grand-label" style="font-weight:600;color:#1a1a2e">Всего прибыль</span><span class="calc-grand-val" style="color:${totalColor}">${totalPrefix}${grandProfit.toFixed(0)}<span class="cur">BYN</span></span></div>
    <div class="calc-grand-divider"></div>
    <div class="calc-grand-row"><span class="calc-grand-label">Общий вес</span><span class="calc-grand-val">${totalWeight.toFixed(2)}<span class="cur">кг</span></span></div>
    <div class="calc-grand-row"><span class="calc-grand-label">Вес тары</span><span class="calc-grand-val">${tareTotal.toFixed(2)}<span class="cur">кг</span></span></div>`;

  document.getElementById('calcList').innerHTML = clients.map(c => {
    const ownerChk = `<label class="owner-chk"><input type="checkbox" ${c.isOwner?'checked':''} onchange="toggleOwner('${c.name.replace(/'/g,"\\'")}')"> это я</label>`;
    const nm = c.name.replace(/'/g,"\\'");
    const discChk = c.isOwner ? '' : `<div class="calc-disc"><label class="calc-disc-item"><input type="checkbox" ${currentCostGoods[c.name]?'checked':''} onchange="toggleCostGoods('${nm}')"> товары по себестоимости</label><label class="calc-disc-item"><input type="checkbox" ${currentCostShip[c.name]?'checked':''} onchange="toggleCostShip('${nm}')"> доставка по себестоимости</label></div>`;
    if (c.isOwner) {
      // Владелец — затраты (красным)
      return `<div class="calc-client owner">
        <div class="calc-client-head">
          <span class="calc-client-name">${c.name} ${ownerChk}</span>
          <span class="calc-client-due owner-cost">−${(c.goodsCost+c.shipCost).toFixed(0)}<span class="cur">BYN</span></span>
        </div>
        <div class="calc-rows">
          <div class="calc-row"><span>Мои товары (${c.count} поз., ¥${c.yuan.toFixed(2)}) по себестоимости</span><span>${c.goodsCost.toFixed(0)} BYN</span></div>
          <div class="calc-row"><span>Моя доставка (товар ${(c.weight*1000).toFixed(0)} г → с тарой ${(c.shipWeight*1000).toFixed(0)} г) по себестоимости</span><span>${c.shipCost.toFixed(0)} BYN</span></div>
          <div class="calc-row total owner-cost"><span>Мои затраты (минус из прибыли)</span><span>−${(c.goodsCost+c.shipCost).toFixed(0)} BYN</span></div>
        </div>
      </div>`;
    }
    return `<div class="calc-client">
      <div class="calc-client-head">
        <span class="calc-client-name">${c.name} ${ownerChk}</span>
        <span class="calc-client-due">${c.due.toFixed(0)}<span class="cur">BYN</span></span>
      </div>
      ${c.noWeight ? '<div class="calc-noweight"><i class="ti ti-alert-triangle"></i> Вес не указан — доставка не посчитана</div>' : ''}
      <div class="calc-rows">
        <div class="calc-row"><span>Товар (${c.count} поз., ¥${c.yuan.toFixed(2)})</span><span>${c.goodsClient.toFixed(0)} BYN</span></div>
        <div class="calc-row"><span>Доставка (товар ${(c.weight*1000).toFixed(0)} г → с тарой ${(c.shipWeight*1000).toFixed(0)} г)</span><span>${c.shipClient.toFixed(0)} BYN</span></div>
        ${currentCostGoods[c.name]||currentCostShip[c.name] ? `<div class="calc-row" style="color:#6C4DB8;font-size:12px"><span>${currentCostGoods[c.name]?'товары по себест.':''}${currentCostGoods[c.name]&&currentCostShip[c.name]?' + ':''}${currentCostShip[c.name]?'доставка по себест.':''} (без наценки)</span><span></span></div>` : ''}
        <div class="calc-row total"><span>Клиент должен</span><span>${c.due.toFixed(0)} BYN</span></div>
        <div class="calc-row profit"><span>Твоя прибыль</span><span>${c.profit.toFixed(0)} BYN</span></div>
      </div>
      ${discChk}
    </div>`;
  }).join('');
}

// Показать/скрыть строку курсов, заполнить поля текущими значениями
function fillRateFields() {
  const rc = document.getElementById('rateClient'); if (!rc) return;
  rc.value = currentRates.clientRate;
  document.getElementById('rateBuy').value = currentRates.buyRate;
  document.getElementById('rateShipClient').value = currentRates.shipClient;
  document.getElementById('rateShipCargo').value = currentRates.shipCargo;

}

function openRatesModal(id) {
  // id — приход чьи курсы (для подписи). Активный уже переключён pickShipment.
  const s = allShipments.find(x => x.id === id);
  const sub = document.getElementById('ratesModalSub');
  if (s && sub) {
    const cnt = (s.data || []).length;
    const posWord = cnt % 10 === 1 && cnt % 100 !== 11 ? 'позиция' : (cnt % 10 >= 2 && cnt % 10 <= 4 && (cnt % 100 < 10 || cnt % 100 >= 20) ? 'позиции' : 'позиций');
    sub.textContent = `${s.name} · ${cnt} ${posWord}`;
  }
  fillRateFields();
  document.getElementById('ratesModal').classList.add('open');
}
function closeRatesModal() {
  document.getElementById('ratesModal').classList.remove('open');
}

// При изменении любого поля курса — обновляем currentRates и сохраняем в приход
function onRateChange() {
  currentRates = {
    clientRate: parseFloat(document.getElementById('rateClient').value) || 0,
    buyRate:    parseFloat(document.getElementById('rateBuy').value) || 0,
    shipClient: parseFloat(document.getElementById('rateShipClient').value) || 0,
    shipCargo:  parseFloat(document.getElementById('rateShipCargo').value) || 0,
  };
  saveRates();
}

function onDepartedChange() {
  shipmentDeparted = document.getElementById('departedChk').checked;
  const shipId = editingShipmentId || activeShipmentId;  // приход, который сейчас открыт, а не активный для сканирования
  if (!shipId) return;
  // Галочка "выехала" автоматически меняет статус: вкл → В дороге (transit), выкл → Формируется
  const newStatus = shipmentDeparted ? 'transit' : 'forming';
  const upd = { departed: shipmentDeparted, status: newStatus };
  shipmentsRef().doc(shipId).update(upd);
  // обновим кэш и плашки
  const s = allShipments.find(x => x.id === shipId);
  if (s) s.status = newStatus;
  if (typeof renderShipmentCards === 'function') renderShipmentCards();
}

function onCargoWeightChange() {
  const grams = parseFloat(document.getElementById('cargoWeightInput').value) || 0;
  currentCargoWeight = grams / 1000;  // храним в кг, вводим в граммах
  if (editingShipmentId || activeShipmentId) shipmentsRef().doc(editingShipmentId || activeShipmentId).update({ cargoWeight: currentCargoWeight });
}
function scannedRef(shipId) { return db.collection('users').doc(currentUser.uid).collection('scanned').doc(shipId); }
function historyRef(shipId) { return db.collection('users').doc(currentUser.uid).collection('history').doc(shipId || activeShipmentId); }

let allShipments = [];
let shipCollapsed = false;  // свёрнут ли список приходов (в режиме сканирования показываем только активный)

function toggleShipCollapse() {
  shipCollapsed = !shipCollapsed;
  const icon = document.getElementById('shipCollapseIcon');
  if (icon) icon.style.transform = shipCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  renderShipmentCards();
}  // кэш приходов для рендера плашек

// Статусы прихода: ключ → {слово, цвет}
const SHIP_STATUSES = {
  forming:   { label: 'Формируется', color: '#4a90d9', text: '#2563a8' },
  transit:   { label: 'В дороге',    color: '#f5c518', text: '#b8860b' },
  warehouse: { label: 'На складе',   color: '#3cb371', text: '#2e8b57' },
  sorted:    { label: 'Рассортирован', color: '#8b7fd4', text: '#6C4DB8' },
  done:      { label: 'Архив',       color: '#b0b4bb', text: '#9aa0ab' },
};

async function loadShipments() {
  let shipments = [];
  try {
    const docs = await fsList('users/' + savedUid + '/shipments');
    shipments = docs.map(d => ({ id: d.id, ...d.data() }));
    // сортировка по created desc
    shipments.sort((a,b) => {
      const ta = a.created ? new Date(a.created).getTime() : 0;
      const tb = b.created ? new Date(b.created).getTime() : 0;
      return tb - ta;
    });
  } catch(e) { console.warn('loadShipments REST:', e.message); }
  allShipments = shipments;
  // Скрытый select держим синхронно (некоторый код читает shipmentSelect)
  const sel = document.getElementById('shipmentSelect');
  sel.innerHTML = shipments.length === 0
    ? '<option value="">— Загрузите CSV —</option>'
    : shipments.map(s => `<option value="${s.id}">${s.name} (${s.data.length})</option>`).join('');
  if (shipments.length > 0) {
    const id = activeShipmentId && shipments.find(s => s.id === activeShipmentId) ? activeShipmentId : shipments[0].id;
    sel.value = id;
    await loadShipmentData(id);
  } else {
    TABLE = []; scanned = {}; updateStats();
  }
  renderShipmentCards();
}

// Рендер плашек приходов со статусами
function renderShipmentCards() {
  const box = document.getElementById('shipmentCards');
  if (!box) return;
  if (!allShipments.length) { box.innerHTML = '<div style="font-size:13px;color:#9aa0ab;padding:8px 0">Нет приходов. Добавьте через меню.</div>'; return; }
  // В свёрнутом режиме показываем только активный приход
  const list = shipCollapsed ? allShipments.filter(s => s.id === activeShipmentId) : allShipments;
  box.innerHTML = list.map(s => {
    const st = SHIP_STATUSES[s.status] || SHIP_STATUSES.forming;
    const active = s.id === activeShipmentId;
    const isDone = s.status === 'done';
    const count = (s.data || []).length;
    const posWord = count % 10 === 1 && count % 100 !== 11 ? 'позиция' : (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'позиции' : 'позиций');
    return `<div class="ship-card ${active?'active':''} ${isDone?'done':''}" onclick="pickShipment('${s.id}')">
      <div class="ship-card-body">
        <div class="ship-card-name">${s.name}</div>
        <div class="ship-card-line2">
          <span class="ship-card-count">${count} ${posWord}</span>
          <span class="ship-card-sep">·</span>
          <span class="ship-card-status-wrap" onclick="event.stopPropagation();openStatusPicker('${s.id}',event)">
            <span class="ship-card-dot" style="background:${st.color}"></span>
            <span class="ship-card-status" style="color:${st.text}">${st.label}</span>
          </span>
        </div>
      </div>
      <button class="ship-gear" onclick="event.stopPropagation();openShipMenu('${s.id}',event)" title="Действия"><i class="ti ti-settings" aria-hidden="true"></i></button>
    </div>`;
  }).join('');
}

// Выбрать приход активным (тап на плашку)
// Загрузить данные прихода для ДЕЙСТВИЯ (взвешивание/цены/расчёт/курсы) из шестерёнки — БЕЗ смены активного прихода
// После действий из шестерёнки НЕ активного прихода — вернуть данные активного (для сканирования)
async function restoreActiveEditing() {
  if (editingShipmentId && activeShipmentId && editingShipmentId !== activeShipmentId) {
    await loadShipmentData(activeShipmentId);  // перегружаем данные активного обратно
  }
  editingShipmentId = activeShipmentId;
}

async function loadForAction(id) {
  editingShipmentId = id;
  await loadShipmentData(id, true);  // true = не менять activeShipmentId
}

async function pickShipment(id) {
  if (id === activeShipmentId) return;
  document.getElementById('shipmentSelect').value = id;
  await loadShipmentData(id);  // меняет и активный, и editing
  renderShipmentCards();
}

// Открыть меню действий для конкретного прихода (шестерёнка)
let shipMenuTargetId = null;
async function renameShipment(id) {
  const ship = allShipments.find(s => s.id === id);
  const oldName = ship ? ship.name : '';
  const newName = prompt('Новое название прихода:', oldName);
  if (newName === null) return;  // отмена
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;  // пусто или не изменилось
  try {
    await shipmentsRef().doc(id).update({ name: trimmed });
    await loadShipments();
    await updateShipmentStats();
  } catch(e) {
    alert('Не удалось переименовать: ' + e.message);
  }
}

function openShipMenu(id, ev) {
  shipMenuTargetId = id;
  const menu = document.getElementById('shipMenu');
  menu.innerHTML = `
    <button onclick="renameShipment('${id}');closeShipMenu()"><i class="ti ti-pencil" aria-hidden="true"></i> Переименовать</button>
    <button onclick="loadForAction('${id}').then(()=>openPriceEditor());closeShipMenu()"><i class="ti ti-currency-yuan" aria-hidden="true"></i> Редактор цен</button>
    <button onclick="loadForAction('${id}').then(()=>openWeighing());closeShipMenu()"><i class="ti ti-scale" aria-hidden="true"></i> Взвешивание</button>
    <button onclick="loadForAction('${id}').then(()=>openCalc());closeShipMenu()"><i class="ti ti-calculator" aria-hidden="true"></i> Расчёт по клиентам</button>
    <button onclick="loadForAction('${id}').then(()=>openRatesModal('${id}'));closeShipMenu()"><i class="ti ti-adjustments" aria-hidden="true"></i> Курсы прихода</button>
    <button onclick="loadForAction('${id}').then(()=>cacheShipmentImages());closeShipMenu()"><i class="ti ti-cloud-download" aria-hidden="true"></i> Офлайн-режим (картинки)</button>
    <button onclick="loadForAction('${id}').then(()=>resetAll());closeShipMenu()"><i class="ti ti-refresh" aria-hidden="true"></i> Сбросить отметки</button>
    <button onclick="exportForInventory('${id}');closeShipMenu()"><i class="ti ti-file-export" aria-hidden="true"></i> Выгрузить для описи</button>
    <button onclick="openCargoCompare('${id}');closeShipMenu()"><i class="ti ti-arrows-diff" aria-hidden="true"></i> Сверка с карго</button>
    <button onclick="loadForAction('${id}').then(()=>deleteShipment());closeShipMenu()" class="danger"><i class="ti ti-trash" aria-hidden="true"></i> Удалить приход</button>`;
  // позиционируем меню под шестерёнкой
  const rect = ev.currentTarget.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
  menu.classList.add('open');
}

// Открыть оверлей выбора статуса (тап на статус)
function openStatusPicker(id, ev) {
  const s = allShipments.find(x => x.id === id);
  const curStatus = s ? (s.status || 'forming') : 'forming';
  const menu = document.getElementById('statusPicker');
  const order = ['forming','transit','warehouse','sorted','done'];
  menu.innerHTML = order.map(key => {
    const st = SHIP_STATUSES[key];
    const isCur = key === curStatus;
    return `<button onclick="setStatus('${id}','${key}')" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:${isCur?'#f7f8fa':'none'};border:none;padding:11px 14px;font-size:14px;color:#1a1a2e;cursor:pointer;font-weight:500">
      <span style="width:12px;height:12px;border-radius:50%;background:${st.color};flex-shrink:0"></span>
      <span style="color:${st.text}">${st.label}</span>
      ${isCur?'<i class="ti ti-check" style="margin-left:auto;color:#6C4DB8;font-size:16px"></i>':''}
    </button>`;
  }).join('');
  const rect = ev.currentTarget.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = Math.min(rect.left - 40, window.innerWidth - 200) + 'px';
  menu.classList.add('open');
}

// Установить конкретный статус
async function setStatus(id, key) {
  const s = allShipments.find(x => x.id === id);
  if (s) s.status = key;
  document.getElementById('statusPicker').classList.remove('open');
  renderShipmentCards();
  try { await shipmentsRef().doc(id).update({ status: key }); } catch(e) {}
}

// ПРАВИЛА КЛИЕНТА из карточки клиента (кабинет): userProfile.clientRules = { "имя в нижнем регистре": { owner, costGoods, costShip } }
// Действуют на приходы, где для клиента нет своего явного значения. При смене правила кабинет «замораживает»
// текущие значения во всех существующих приходах, поэтому правило влияет только на следующие приходы.
function clientRule(kind, name) {
  const rules = userProfile && userProfile.clientRules;
  const r = rules && rules[String(name || '').toLowerCase()];
  return r ? r[kind] : undefined;
}
function applyClientRules() {
  if (!userProfile || !userProfile.clientRules) return;
  const { names } = getClientsInShipment();
  for (const n of names) {
    for (const [kind, map] of [['owner', currentOwners], ['costGoods', currentCostGoods], ['costShip', currentCostShip]]) {
      if (!Object.prototype.hasOwnProperty.call(map, n)) {
        const v = clientRule(kind, n);
        if (v !== undefined) map[n] = !!v;
      }
    }
  }
}

// Ручная корректировка задолженности клиента в приходе: { "Олеся": 60 }
let currentDueOverride = {};

// Разложить данные документа прихода по глобальным переменным (используется при загрузке и при живой синхронизации)
function applyShipDoc(d) {
  d = d || {};
  TABLE = (d.data || []).map(r => Array.isArray(r) ? r : [r.t, r.w, r.img||'', r.p||'', r.pc||'', r.q||'1']);
  currentRates = d.rates ? { ...DEFAULT_RATES, ...d.rates } : { ...DEFAULT_RATES };
  currentWeights = d.weights ? { ...d.weights } : {};
  currentTare = d.tare || 0;
  currentOwners = d.owners ? { ...d.owners } : {};
  currentPriceInclWeight = d.priceInclWeight ? { ...d.priceInclWeight } : {};
  currentCostGoods = d.costGoods ? { ...d.costGoods } : {};
  currentCostShip = d.costShip ? { ...d.costShip } : {};
  currentCargoWeight = d.cargoWeight || 0;
  currentTarePct = d.tarePct || 0;
  shipmentDeparted = d.departed || false;
  currentDueOverride = d.dueOverride ? { ...d.dueOverride } : {};
  applyClientRules();
  // Demo mode: limit to 5 tracks
  if (userProfile && userProfile._demo) TABLE = TABLE.slice(0, 5);
}

async function loadShipmentData(id, keepActive) {
  if (!keepActive) activeShipmentId = id;
  editingShipmentId = id;  // редактируемый приход = тот что грузим
  // Проверяем статус кэша картинок для нового прихода (зелёный если уже загружены)
  const cacheBtn = document.getElementById('btnCacheImages');
  if (cacheBtn) { cacheBtn.classList.remove('caching'); }
  let doc;
  try { doc = await fsGet('users/' + savedUid + '/shipments/' + id); } catch(e) { doc = { exists: false, data:()=>({}) }; }
  applyShipDoc(doc.exists ? doc.data() : {});
  let scDoc;
  try { scDoc = await fsGet('users/' + savedUid + '/scanned/' + id); } catch(e) { scDoc = { exists: false }; }
  scanned = scDoc.exists ? (scDoc.data().items || {}) : {};
  updateStats();
  checkCacheStatus(); // проверяем загружены ли картинки этого прихода
  document.getElementById('resultBlock').innerHTML = '';
  await loadHistory();
  renderHistory();
}

async function switchShipment() {
  const id = document.getElementById('shipmentSelect').value;
  if (id) await loadShipmentData(id);
}

async function deleteShipment() {
  const delId = editingShipmentId || activeShipmentId;
  if (!delId) return;
  const ship = allShipments.find(s => s.id === delId);
  const text = ship ? ship.name : 'приход';
  if (!confirm('Удалить "' + text + '"?')) return;
  await shipmentsRef().doc(delId).delete();
  await scannedRef(delId).delete().catch(() => {});
  if (activeShipmentId === delId) activeShipmentId = null;  // если удалили активный — сбросим
  editingShipmentId = null;
  await loadShipments();
  await updateShipmentStats();
}

function openUploadModal() { document.getElementById('uploadModal').classList.add('show'); document.getElementById('shipmentName').value = ''; document.getElementById('csvFile').value = ''; }
function closeUploadModal() { document.getElementById('uploadModal').classList.remove('show'); }

async function uploadCSV() {
  const name = document.getElementById('shipmentName').value.trim() || 'Партия ' + new Date().toLocaleDateString('ru');
  const file = document.getElementById('csvFile').files[0];
  if (!file) { alert('Выбери CSV файл'); return; }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const data = [];
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const track = parts[0].trim();
          const wh = parts.slice(1).join(',').trim();
          if (track && wh && !track.toLowerCase().startsWith('тр') && !track.toLowerCase().startsWith('track')) data.push({t: track, w: wh});
        }
      }
      if (data.length === 0) { alert('Данные не найдены в CSV'); return; }
      // Курсы нового прихода копируются с ПОСЛЕДНЕГО прихода (или дефолт если первый)
      let newRates = { ...DEFAULT_RATES };
      try {
        const lastSnap = await shipmentsRef().orderBy('created', 'desc').limit(1).get();
        if (!lastSnap.empty && lastSnap.docs[0].data().rates) newRates = { ...DEFAULT_RATES, ...lastSnap.docs[0].data().rates };
      } catch(e) {}
      const ref = await shipmentsRef().add({ name, data, rates: newRates, status: "forming", created: firebase.firestore.FieldValue.serverTimestamp() });
      closeUploadModal();
      activeShipmentId = ref.id;
      await loadShipments();
      await updateShipmentStats();
      alert('Загружено ' + data.length + ' треков!');
    } catch(err) {
      alert('Ошибка: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ============ ВЫГРУЗКА ДЛЯ ОПИСИ ============
// Скачивает картинки товаров прихода (имя файла = трек), пакует в ZIP + таблицу CSV
async function exportForInventory(shipId) {
  if (typeof JSZip === 'undefined') { alert('Библиотека архивации не загрузилась, обновите страницу'); return; }
  // берём данные прихода
  let doc;
  try { doc = await fsGet('users/' + savedUid + '/shipments/' + shipId); }
  catch(e) { alert('Не удалось загрузить приход'); return; }
  if (!doc.exists) { alert('Приход не найден'); return; }
  const d = doc.data();
  const shipName = d.name || 'приход';
  const rows = (d.data || []).map(r => Array.isArray(r) ? {t:r[0],w:r[1]||'',img:r[2]||'',p:r[3]||'',pc:r[4]||'',q:r[5]||'1'} : r);
  if (!rows.length) { alert('В приходе нет товаров'); return; }

  // индикатор прогресса
  const prog = document.createElement('div');
  prog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  prog.innerHTML = '<div style="background:#fff;border-radius:14px;padding:24px 32px;text-align:center;min-width:260px"><div style="font-size:16px;font-weight:600;color:#1a1a2e;margin-bottom:12px">Выгрузка для описи</div><div id="expProgText" style="font-size:14px;color:#6b7280">Скачиваю картинки...</div><div style="height:8px;background:#f0f1f4;border-radius:4px;margin-top:14px;overflow:hidden"><div id="expProgBar" style="height:100%;width:0%;background:#6C4DB8;transition:width 0.2s"></div></div></div>';
  document.body.appendChild(prog);
  const setProg = (txt, pct) => { const t=document.getElementById('expProgText'); const b=document.getElementById('expProgBar'); if(t)t.textContent=txt; if(b)b.style.width=pct+'%'; };

  const zip = new JSZip();
  const imgFolder = zip.folder('картинки');
  // таблица CSV: трек, клиент, цена закупки, цена клиента, кол-во, есть_картинка
  let csv = 'Трек;Клиент;Цена закупки;Цена клиента;Кол-во;Картинка\n';
  let imgOk = 0, imgFail = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const track = (r.t || 'item' + i).replace(/[\/:*?"<>|]/g, '_');  // безопасное имя файла
    let hasImg = 'нет';
    if (r.img && r.img.startsWith('http')) {
      try {
        // качаем через свой прокси (обходит CORS Pinduoduo)
        const proxyUrl = '/api/img?url=' + encodeURIComponent(r.img);
        const resp = await fetch(proxyUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          imgFolder.file(track + '.jpg', blob);
          hasImg = 'да';
          imgOk++;
        } else { imgFail++; }
      } catch(e) { imgFail++; }
    }
    csv += [r.t, r.w, r.p, r.pc, r.q, hasImg].map(x => '"' + String(x||'').replace(/"/g,'""') + '"').join(';') + '\n';
    setProg('Картинок: ' + (i+1) + ' из ' + rows.length, Math.round((i+1)/rows.length*100));
  }

  // добавляем таблицу (с BOM для кириллицы в Excel)
  zip.file('таблица.csv', '\ufeff' + csv);
  setProg('Упаковываю архив...', 100);

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'опись_' + shipName.replace(/[\/:*?"<>|]/g, '_') + '.zip';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  prog.remove();
  alert('Выгрузка готова!\nКартинок скачано: ' + imgOk + (imgFail ? '\nБез картинки: ' + imgFail : '') + '\nВсего товаров: ' + rows.length);
}

// ============ СВЕРКА С КАРГО ============
// Скрытый input для файла карго
let cargoCompareShipId = null;

function openCargoCompare(shipId) {
  cargoCompareShipId = shipId;
  let inp = document.getElementById('cargoFileInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'cargoFileInput';
    inp.accept = '.xlsx,.xls';
    inp.style.display = 'none';
    inp.addEventListener('change', handleCargoFile);
    document.body.appendChild(inp);
  }
  inp.value = '';
  inp.click();  // СИНХРОННО в жесте клика — Safari разрешает открыть выбор файла только так
}

// Нормализация трека: нижний регистр + убрать суффиксы после первого дефиса
function normTrack(t) {
  return String(t || '').toLowerCase().trim().split('-')[0];
}

async function handleCargoFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Загружаем данные нужного прихода ПОСЛЕ выбора файла (раньше это делал loadForAction до клика,
  // но Safari блокировал открытие файла после await — теперь грузим тут)
  try { await loadForAction(cargoCompareShipId); } catch(err) {}
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      // читаем xlsx через SheetJS
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      // треки в колонке B (индекс 1)
      const cargoTracks = [];
      for (const r of rows) {
        const b = r[1];
        if (b && String(b).trim()) cargoTracks.push(String(b).trim());
      }
      if (cargoTracks.length === 0) { alert('В файле карго не найдено треков (колонка B пуста)'); return; }
      // нормализованное множество карго
      const cargoNorm = new Set(cargoTracks.map(normTrack));

      // текущий приход
      const doc = await shipmentsRef().doc(cargoCompareShipId).get();
      if (!doc.exists) { alert('Приход не найден'); return; }
      const shipData = doc.data().data || [];
      // нормализуем товары прихода в объекты
      const items = shipData.map(r => Array.isArray(r) ? {t:r[0],w:r[1]||'',img:r[2]||'',p:r[3]||'',pc:r[4]||'',q:r[5]||'1'} : r);
      const shipNorm = new Set(items.map(it => normTrack(it.t)));

      // ПРАВИЛО 1: в приходе НЕТ в карго → недоехали → в новый приход
      const notInCargo = items.filter(it => !cargoNorm.has(normTrack(it.t)));
      // остаются в текущем: те что есть в карго
      const staying = items.filter(it => cargoNorm.has(normTrack(it.t)));
      // ПРАВИЛО 2: в карго НЕТ в приходе → другой маркетплейс → в конец текущего блоком
      const notInShip = cargoTracks.filter(t => !shipNorm.has(normTrack(t)));

      // Показываем итоговое окно сверки
      showCargoResult(notInCargo, staying, notInShip, cargoTracks.length);
    } catch(err) {
      alert('Ошибка чтения файла карго: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Результат сверки — окно с итогами и подтверждением
let cargoResult = null;
function showCargoResult(notInCargo, staying, notInShip, cargoTotal) {
  cargoResult = { notInCargo, staying, notInShip };
  const modal = document.getElementById('cargoResultModal');
  const body = document.getElementById('cargoResultBody');
  body.innerHTML = `
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px;line-height:1.6">Файл карго: <b>${cargoTotal}</b> треков. Приход: <b>${staying.length + notInCargo.length}</b> товаров.</div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="background:#ecfdf3;border:1px solid #a7f3d0;border-radius:10px;padding:12px"><div style="font-size:14px;font-weight:600;color:#22a05c;margin-bottom:2px"><i class="ti ti-check"></i> Совпали: ${staying.length}</div><div style="font-size:12px;color:#6b7280">Остаются в этом приходе</div></div>
      <div style="background:#fffaeb;border:1px solid #fde68a;border-radius:10px;padding:12px"><div style="font-size:14px;font-weight:600;color:#b45309;margin-bottom:2px"><i class="ti ti-arrow-right"></i> Не доехали: ${notInCargo.length}</div><div style="font-size:12px;color:#6b7280">Нет в карго → переедут в НОВЫЙ приход (со всеми данными)</div></div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px"><div style="font-size:14px;font-weight:600;color:#2563a8;margin-bottom:2px"><i class="ti ti-plus"></i> Другой маркетплейс: ${notInShip.length}</div><div style="font-size:12px;color:#6b7280">Есть в карго, нет в приходе → добавятся в конец блоком (цены вручную)</div></div>
    </div>
    ${notInCargo.length > 0 ? '<div style="margin-top:16px"><div style="font-size:12px;color:#9aa0ab;margin-bottom:6px">Название нового прихода (для не доехавших):</div><input id="cargoNewShipName" placeholder="Партия ' + new Date().toLocaleDateString('ru') + '" style="width:100%;border:1px solid #d5d8dd;border-radius:8px;padding:10px;font-size:14px;outline:none;box-sizing:border-box"></div>' : ''}
  `;
  modal.classList.add('show');
}

async function applyCargoCompare() {
  if (!cargoResult) return;
  const { notInCargo, staying, notInShip } = cargoResult;
  const btn = document.getElementById('cargoApplyBtn');
  btn.disabled = true; btn.textContent = 'Применяю...';
  try {
    // 1. Текущий приход = совпавшие + новые с другого маркетплейса (блоком в конец, только трек)
    const newItemsForShip = notInShip.map(t => ({ t: t, w:'', img:'', p:'', pc:'', q:'1' }));
    const updatedCurrent = [...staying, ...newItemsForShip];
    await shipmentsRef().doc(cargoCompareShipId).update({ data: updatedCurrent });

    // 2. Не доехавшие → новый приход (со всеми данными)
    if (notInCargo.length > 0) {
      const name = (document.getElementById('cargoNewShipName')?.value || '').trim() || ('Партия ' + new Date().toLocaleDateString('ru'));
      let newRates = { ...DEFAULT_RATES };
      try {
        const curDoc = await shipmentsRef().doc(cargoCompareShipId).get();
        if (curDoc.exists && curDoc.data().rates) newRates = { ...DEFAULT_RATES, ...curDoc.data().rates };
      } catch(e) {}
      await shipmentsRef().add({ name, data: notInCargo, rates: newRates, status: "forming", created: firebase.firestore.FieldValue.serverTimestamp() });
    }

    closeCargoResult();
    await loadShipmentData(cargoCompareShipId);
    await loadShipments();
    await updateShipmentStats();
    let msg = 'Сверка выполнена!\n';
    msg += '• Совпало: ' + staying.length + '\n';
    if (notInCargo.length) msg += '• Не доехали (в новый приход): ' + notInCargo.length + '\n';
    if (notInShip.length) msg += '• С другого маркетплейса (в конец): ' + notInShip.length;
    alert(msg);
  } catch(err) {
    alert('Ошибка применения: ' + err.message);
  }
  btn.disabled = false; btn.textContent = 'Применить сверку';
}

function closeCargoResult() { document.getElementById('cargoResultModal').classList.remove('show'); cargoResult = null; }

// ============ SHIPMENT STATS ============
async function updateShipmentStats() {
  const snap = await shipmentsRef().get();
  const shipments = [];
  snap.forEach(doc => { const d = doc.data(); shipments.push({ name: d.name, count: (d.data||[]).length }); });
  await db.collection('users').doc(currentUser.uid).update({ shipmentStats: shipments });
}

// ============ SAVE SCANNED ============
async function saveScanned() {
  if (!activeShipmentId) return;
  await scannedRef(activeShipmentId).set({ items: scanned });
}

// ============ HISTORY (FIRESTORE) ============
async function loadHistory() {
  try {
    const doc = await fsGet('users/' + savedUid + '/history/' + (activeShipmentId || 'main'));
    scanHistory = doc.exists ? (doc.data().items || []) : [];
  } catch(e) { scanHistory = []; }
}
async function saveHistory() {
  await historyRef().set({ items: scanHistory.slice(0, 30) });
}

// ============ LEVENSHTEIN ============
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length:m+1},(_,i) => Array.from({length:n+1},(_,j) => i===0?j:j===0?i:0));
  for (let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

// ============ LOOKUP ============
function lookup(code) {
  code = code.trim(); if (!code || !TABLE.length) return;
  const isP = code.length <= 6, cl = code.toLowerCase();
  // Частичный код ищем по вхождению в любом месте трека (includes), полный — точное совпадение
  let rows = TABLE.map((r,i) => ({i,t:r[0],w:r[1]})).filter(r => isP ? r.t.toLowerCase().includes(cl) : r.t.toLowerCase()===cl);
  if (!rows.length && !isP) {
    const l4 = cl.slice(-4);
    const by4 = TABLE.map((r,i)=>({i,t:r[0],w:r[1]})).filter(r=>r.t.toLowerCase().includes(l4));
    if (by4.length) { const ut=[...new Set(by4.map(r=>r.t))]; showResult('fuzzy',code,null,null,ut,'По последним 4 цифрам:'); return; }
    const fz = TABLE.map((r,i)=>({i,t:r[0],w:r[1],d:levenshtein(cl,r[0].toLowerCase())})).filter(r=>r.d<=3).sort((a,b)=>a.d-b.d);
    if (fz.length) { showResult('fuzzy',code,null,null,[...new Set(fz.slice(0,4).map(r=>r.t))],'Похожие варианты:'); return; }
    showResult('error',code,null,'Не найден'); return;
  }
  if (!rows.length) { showResult('error',code,null,'«'+code+'» не найден'); return; }
  const ut=[...new Set(rows.map(r=>r.t))];
  if (isP && ut.length>1) { showResult('multi',code,null,null,ut); return; }
  const free = rows.find(r => !scanned[r.i]);
  if (!free) { showResult('already',rows[0].t,[...new Set(rows.map(r=>r.w))].join(', ')); return; }
  scanned[free.i] = true;
  saveScanned();
  const wh = [...new Set(rows.map(r=>r.w))].join(' + ');
  showResult('success',rows[0].t,wh);
  addHistory(rows[0].t,free.w);
  updateStats(); beep(); vibrate();
}

// ============ SHOW RESULT ============
function showResult(type, track, wh, msg, tracks, fMsg) {
  if (type==='success'||type==='multi'||type==='fuzzy') showOverlay(type,track,wh,tracks,fMsg);
  const b = document.getElementById('resultBlock');
  if (type==='success') b.innerHTML=`<div class="result-card success"><div class="result-label">✅ Отмечено</div><div class="result-track">${track}</div><div class="result-warehouse"><i class="ti ti-package" style="font-size:36px;vertical-align:-5px;margin-right:6px;color:#6C4DB8"></i> ${wh}</div></div>`;
  else if (type==='already') b.innerHTML=`<div class="result-card already"><div class="result-label">⚠️ Уже отмечено</div><div class="result-track">${track}</div><div class="result-message">Склад: ${wh}</div></div>`;
  else if (type==='fuzzy') { const btns=tracks.map(t=>`<button onclick="lookup('${t}')" style="display:block;width:100%;text-align:left;background:#fff;border:1px solid #6C4DB8;border-radius:8px;padding:9px;margin-bottom:4px;font-size:13px;cursor:pointer">${t}</button>`).join('');
    b.innerHTML=`<div class="result-card already" style="border-color:#a5b4fc;background:#f5f3ff"><div class="result-label" style="color:#6d28d9">${fMsg||''}</div><div class="result-track">Считано: ${track}</div>${btns}</div>`; }
  else if (type==='multi') { const btns=tracks.map(t=>`<button onclick="lookup('${t}')" style="display:block;width:100%;text-align:left;background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:9px;margin-bottom:4px;font-size:13px;cursor:pointer">${t}</button>`).join('');
    b.innerHTML=`<div class="result-card already"><div class="result-label">Несколько вариантов</div>${btns}</div>`; }
  else b.innerHTML=`<div class="result-card error"><div class="result-label">❌ Не найдено</div><div class="result-track">${track}</div><div class="result-message">${msg}</div></div>`;
}

// ============ OVERLAY ============
function showOverlay(type,track,wh,tracks,fMsg) {
  if (scanner) try{scanner.pause(true)}catch(e){}
  const ov=document.getElementById('scanOverlay'), card=document.getElementById('overlayCard'),
    ic=document.getElementById('overlayIcon'), w=document.getElementById('overlayWarehouse'), tr=document.getElementById('overlayTrack');
  card.className='overlay-card'; card.style=''; w.style.color=''; w.style.fontSize='';
  let mw=card.querySelector('.multi-warn'); if(mw) mw.remove();
  let mb=card.querySelector('.multi-btns'); if(mb) mb.remove();
  // Показываем картинку товара
  const imgDiv = document.getElementById('overlayImg');
  const trackRow = TABLE.find(r => r[0] === track);
  const imgUrl = trackRow && trackRow[2] ? trackRow[2] : '';
  if (imgUrl && imgDiv) {
    imgDiv.style.display = 'block';
    const oImg = document.createElement('img');
    oImg.className = 'overlay-img';
    oImg.src = imgUrl;
    oImg.addEventListener('error', () => { imgDiv.style.display='none'; });
    imgDiv.innerHTML = '';
    imgDiv.appendChild(oImg);
  } else if (imgDiv) {
    imgDiv.style.display = 'none';
  }

  if (type==='success') {
    card.className='overlay-card success-card'; ic.innerHTML='<i class="ti ti-circle-check" style="font-size:56px;color:#16a34a"></i>'; tr.textContent=track;
    if (wh && wh.includes(' и ')) {
      w.innerHTML = wh.split(' и ').map(x=>'<i class="ti ti-package" style="font-size:32px;vertical-align:-5px;margin-right:6px;color:#6C4DB8"></i> '+x.trim()).join('<br>'); w.style.fontSize='22px';
      const d=document.createElement('div'); d.className='multi-warn';
      d.textContent='⚠️ Товаров может быть несколько!';
      d.style.cssText='background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px;font-size:13px;font-weight:600;color:#ea580c;margin:6px 0 12px';
      card.insertBefore(d,card.querySelector('.overlay-ok'));
    } else { w.innerHTML='<i class="ti ti-package" style="font-size:36px;vertical-align:-5px;margin-right:6px;color:#6C4DB8"></i> '+(wh||''); }
  } else if (type==='fuzzy'||type==='multi') {
    card.style.border='2px solid '+(type==='fuzzy'?'#a5b4fc':'#e0e0e0');
    if(type==='fuzzy') card.style.background='#f5f3ff';
    ic.innerHTML='<i class="ti ti-search" style="font-size:56px;color:#6C4DB8"></i>'; w.innerHTML=fMsg||'Несколько'; w.style.color=type==='fuzzy'?'#6d28d9':'#6C4DB8'; w.style.fontSize='15px';
    tr.textContent=(type==='fuzzy'?'Считано: ':'')+track;
    const div=document.createElement('div'); div.className='multi-btns'; div.style.marginBottom='10px';
    (tracks||[]).forEach(t=>{ const b=document.createElement('button'); b.textContent=t;
      b.style.cssText='display:block;width:100%;text-align:left;background:#fff;border:1px solid '+(type==='fuzzy'?'#6C4DB8':'#e0e0e0')+';border-radius:8px;padding:9px;margin-bottom:4px;font-size:13px;cursor:pointer;font-weight:600';
      b.onclick=()=>{overlayOk();lookup(t)}; div.appendChild(b); });
    card.insertBefore(div,card.querySelector('.overlay-ok'));
  }
  ov.classList.add('show');
}
function overlayOk() {
  document.getElementById('scanOverlay').classList.remove('show');
  let mb=document.querySelector('.multi-btns'); if(mb)mb.remove();
  let mw=document.querySelector('.multi-warn'); if(mw)mw.remove();
  if (scanner) try{scanner.resume()}catch(e){}
  setTimeout(()=>document.getElementById('manualInput').focus(),200);
  // Всё отсканировано (осталось 0) → предлагаем взвешивание
  const total = TABLE.length, done = Object.keys(scanned).length;
  if (total > 0 && done >= total) {
    setTimeout(() => document.getElementById('weighPrompt').classList.add('show'), 400);
  }
}



// ============ МЕНЮ ПРИХОДА (три точки) ============
function toggleShipMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('shipMenu');
  menu.classList.toggle('open');
}
function closeShipMenu() {
  const menu = document.getElementById('shipMenu');
  if (menu) menu.classList.remove('open');
}
// Закрываем меню при клике вне его
document.addEventListener('click', (e) => {
  const menu = document.getElementById('shipMenu');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target) && !e.target.closest('.ship-gear')) {
    menu.classList.remove('open');
  }
  const sp = document.getElementById('statusPicker');
  if (sp && sp.classList.contains('open') && !sp.contains(e.target) && !e.target.closest('.ship-card-status-wrap')) {
    sp.classList.remove('open');
  }
});

// ============ ОФЛАЙН-КЭШ КАРТИНОК ============
// Проверяет закэшированы ли картинки текущего прихода — вызывается при загрузке и смене прихода
async function checkCacheStatus() {
  const btn = document.getElementById('btnCacheImages');
  if (!btn || typeof TABLE === 'undefined') return;
  const urls = [...new Set(TABLE.map(r => r[2]).filter(Boolean))];
  if (urls.length === 0) {
    btn.classList.remove('cached');
    btn.title = 'В этом приходе нет картинок';
    return;
  }
  if (!('caches' in window)) return;
  try {
    const inCache = await countCachedForShipment(urls);
    // Загружено если 90%+ картинок в кэше
    if (inCache >= urls.length * 0.9) {
      btn.classList.add('cached');
      btn.title = `Картинки загружены (${inCache} из ${urls.length}) — работают без интернета`;
    } else {
      btn.classList.remove('cached');
      btn.title = 'Загрузить картинки заранее (для надёжности при плохом интернете)';
    }
  } catch(e) {}
}


async function cacheShipmentImages() {
  const btn = document.getElementById('btnCacheImages');
  const urls = [...new Set(TABLE.map(r => r[2]).filter(Boolean))];
  if (urls.length === 0) {
    showToast('В этом приходе нет картинок');
    return;
  }
  if (!('caches' in window)) {
    showToast('Ваш браузер не поддерживает офлайн-режим');
    return;
  }

  btn.classList.add('caching');
  btn.classList.remove('cached');
  const icon = btn.querySelector('i');
  const origClass = icon.className;
  icon.className = 'ti ti-loader-2';

  const cache = await caches.open('piksta-images-v1');

  // Чистим кэш от картинок ДРУГИХ приходов (Safari жёстко лимитирует opaque-картинки)
  try {
    const urlSet = new Set(urls);
    const cachedKeys = await cache.keys();
    for (const req of cachedKeys) {
      if (!urlSet.has(req.url)) await cache.delete(req);
    }
  } catch(e) {}

  let loaded = 0;

  // Загружаем параллельно батчами по 8, каждую картинку кладём в Cache API
  const batchSize = 8;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    await Promise.all(batch.map(async (url) => {
      try {
        // Проверяем — может уже в кэше
        const existing = await cache.match(url);
        if (existing) { loaded++; return; }
        // Загружаем и кладём в кэш (opaque response нормально кэшируется)
        const resp = await fetch(url, { mode: 'no-cors', cache: 'force-cache' });
        try {
          await cache.put(url, resp);
        } catch(quotaErr) {
          const allKeys = await cache.keys();
          for (const k of allKeys) await cache.delete(k);
          const resp2 = await fetch(url, { mode: 'no-cors', cache: 'force-cache' });
          await cache.put(url, resp2);
        }
        loaded++;
      } catch(e) {
        // одна картинка не загрузилась — не страшно, продолжаем
      }
    }));
    btn.title = `Загружаю картинки: ${loaded}/${urls.length}`;
  }

  btn.classList.remove('caching');
  icon.className = origClass;

  // Проверяем реально сколько в кэше
  const finalCount = await countCachedForShipment(urls);
  if (finalCount >= urls.length * 0.9) {
    btn.classList.add('cached');
    btn.title = `Картинки загружены (${finalCount} из ${urls.length}) — работают без интернета`;
    showToast(`✅ Загружено ${finalCount} картинок для работы офлайн`);
  } else {
    btn.title = `Загружено ${finalCount} из ${urls.length}. Нажмите ещё раз чтобы догрузить`;
    showToast(`Загружено ${finalCount} из ${urls.length}. Проверьте интернет и нажмите ещё раз`);
  }
}

async function countCachedForShipment(urls) {
  if (!('caches' in window)) return 0;
  const cache = await caches.open('piksta-images-v1');
  let n = 0;
  for (const url of urls) {
    const m = await cache.match(url);
    if (m) n++;
  }
  return n;
}


function showToast(msg) {
  let toast = document.getElementById('pikstaToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pikstaToast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:90%;text-align:center;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ============ STATS ============
function updateStats() {
  const t=TABLE.length, d=Object.keys(scanned).length;
  document.getElementById('statScanned').textContent=d;
  document.getElementById('statTotal').textContent=t-d;
  document.getElementById('progressBar').style.width=(t>0?Math.round(d/t*100):0)+'%';
  document.getElementById('unscannedCount').textContent=t-d;
  if(document.getElementById('statScannedBtn')) document.getElementById('statScannedBtn').textContent=d;
  document.getElementById('fullListCount').textContent=t;
}

// ============ HISTORY ============
async function addHistory(track,wh) {
  const time=new Date().getHours()+':'+String(new Date().getMinutes()).padStart(2,'0');
  scanHistory.unshift({track,wh,time}); if(scanHistory.length>30) scanHistory=scanHistory.slice(0,30);
  renderHistory(); saveHistory();
}
function renderHistory() {
  if(!scanHistory.length) return;
  document.getElementById('historySection').style.display='block';
  document.getElementById('historyList').innerHTML=scanHistory.slice(0,10).map(h=>
    `<div class="history-item"><span class="history-track">${h.track}</span><span class="history-wh">${h.wh}</span><span class="history-time">${h.time}</span></div>`).join('');
}
async function clearHistory() { if(!confirm('Очистить?'))return; scanHistory=[]; await saveHistory(); document.getElementById('historySection').style.display='none'; }

// ============ UNSCANNED ============
function toggleFullList() {
  const w = document.getElementById('fullListWrap');
  w.style.display = w.style.display === 'none' ? 'block' : 'none';
  if (w.style.display === 'block') renderFullList();
}

// ── Работа со складами: капитализация и поиск по полному слову ──
// Склад "Алеся и Яна" = сборный (два склада), ищется по любой части.
// Склад "Денис Петров" = один склад (имя+фамилия одного получателя).
const WH_CONJ = new Set(['и','с','в','на','для','от','до','по','за','из','у','о','к']);
function capitalizeWh(str){
  if(!str) return str;
  return str.trim().split(/\s+/).map((w,i)=>{
    const l=w.toLowerCase();
    if(i>0 && WH_CONJ.has(l)) return l;
    return w.charAt(0).toUpperCase()+w.slice(1);
  }).join(' ');
}
// Разбивает склад на отдельные склады-получатели ПО СОЮЗУ "и".
// "Алеся и Яна" → ["Алеся","Яна"]; "Денис Петров" → ["Денис Петров"] (один склад).
function splitWarehouses(wh){
  if(!wh) return [];
  // делим только по " и " (союз-разделитель складов), остальное — цельное имя склада
  return wh.split(/\s+и\s+/i).map(s=>s.trim()).filter(Boolean);
}
// Совпадает ли запрос с любым складом-получателем ПО ПОЛНОМУ СЛОВУ.
// query="яна" совпадёт с "Алеся и Яна" (часть "Яна"). query="ян" НЕ совпадёт.
function whMatchesQuery(wh, query){
  if(!query) return true;
  const parts = splitWarehouses(wh).map(p=>p.toLowerCase());
  return parts.includes(query);
}

let listSortMode = 'default';

function setListSort(mode) {
  listSortMode = mode;
  document.getElementById('sortDefaultBtn').classList.toggle('sort-active', mode === 'default');
  document.getElementById('sortWhBtn').classList.toggle('sort-active', mode === 'warehouse');
  renderFullList();
}

function computeWarehouseStats(items) {
  const groups = {};
  const canon = buildWhCanon(TABLE.concat((items || []).map(r => [r.track, r.wh])));
  for (const r of items) {
    const parts = splitWarehouses(r.wh).map(p => canon[p.toLowerCase()] || p);
    const price = parseFloat(r.price) || 0;
    if (!parts.length) {
      const key = '— без склада —';
      if (!groups[key]) groups[key] = { count: 0, sum: 0, items: [] };
      groups[key].count += 1; groups[key].sum += price; groups[key].items.push(r);
      continue;
    }
    const share = price / parts.length;
    for (const wh of parts) {
      if (!groups[wh]) groups[wh] = { count: 0, sum: 0, items: [] };
      groups[wh].count += 1; groups[wh].sum += share; groups[wh].items.push(r);
    }
  }
  return groups;
}

function renderWarehouseGrouped(items, container) {
  const groups = computeWarehouseStats(items);
  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ru'));
  let grandCount = 0, grandSum = 0;
  for (const n of names) { grandCount += groups[n].count; grandSum += groups[n].sum; }
  let html = `<div class="wh-grand-total"><span>Складов: ${names.length}</span><span>${grandCount} поз. · ¥${grandSum.toFixed(2)}</span></div>`;
  for (const name of names) {
    const g = groups[name];
    html += `<div class="wh-group-header"><span>${name}</span><span class="wh-group-total">${g.count} поз. · ¥${g.sum.toFixed(2)}</span></div>`;
    html += g.items.map(r => `<div class="fulllist-item">
        <span class="fulllist-status">${r.done ? '✅' : '⬜'}</span>
        <span class="fulllist-img-wrap" data-img="${r.img}" data-idx="${r.idx}"></span>
        <span class="fulllist-track">${r.track}${(r.qty && r.qty>1)?` <span class="qty-b">×${r.qty}</span>`:''}</span>
        <span class="fulllist-price">¥${(parseFloat(r.price)||0).toFixed(2)}</span>
      </div>`).join('');
  }
  container.innerHTML = html;
  container.querySelectorAll('.fulllist-img-wrap').forEach(wrap => {
    const img_url = wrap.dataset.img;
    if (img_url) {
      const img = document.createElement('img');
      img.className = 'fulllist-img'; img.src = img_url;
      img.addEventListener('error', () => { wrap.innerHTML = '<span class="fulllist-img-ph">📦</span>'; });
      img.addEventListener('click', () => img.classList.toggle('expanded'));
      wrap.appendChild(img);
    } else { wrap.innerHTML = '<span class="fulllist-img-ph">📦</span>'; }
  });
}

function renderFullList() {
  const query = (document.getElementById('fullListSearch').value || '').toLowerCase().trim();
  const container = document.getElementById('fullListContainer');
  let items = TABLE.map((r, i) => ({ idx: i, track: r[0], wh: r[1], img: r[2]||'', price: r[3]||'', qty: parseInt(r[5])||1, done: !!scanned[i] }));
  if (query) items = items.filter(r => r.track.toLowerCase().includes(query) || whMatchesQuery(r.wh, query));
  if (listSortMode === 'warehouse') { renderWarehouseGrouped(items, container); return; }
  container.innerHTML = items.length === 0
    ? '<div style="padding:14px;text-align:center;color:#999">Ничего не найдено</div>'
    : items.map(r => `<div class="fulllist-item">
        <span class="fulllist-idx">${r.idx + 1}</span>
        <span class="fulllist-status">${r.done ? '✅' : '⬜'}</span>
        <span class="fulllist-img-wrap" data-img="${r.img}" data-idx="${r.idx}"></span>
        <span class="fulllist-track">${r.track}${(r.qty && r.qty>1)?` <span class="qty-b">×${r.qty}</span>`:''}</span>
        <span class="fulllist-wh"><input value="${r.wh}" onchange="editWarehouse(${r.idx}, this.value)" /></span>
      </div>`).join('');
  // Инициализируем картинки в списке через JS (избегаем inline handlers)
  document.querySelectorAll('.fulllist-img-wrap').forEach(wrap => {
    const img_url = wrap.dataset.img;
    const idx = wrap.dataset.idx;
    if (img_url) {
      const img = document.createElement('img');
      img.className = 'fulllist-img';
      img.src = img_url;
      img.addEventListener('error', () => { wrap.innerHTML = '<span class="fulllist-img-ph">📦</span>'; });
      img.addEventListener('click', () => img.classList.toggle('expanded'));
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = '<span class="fulllist-img-ph">📦</span>';
    }
  });
}

async function editWarehouse(idx, newWh) {
  if (!activeShipmentId || idx < 0 || idx >= TABLE.length) return;
  const clean = resolveClientName(capitalizeWh(newWh.trim()));  // авто-заглавная, союзы маленькими; без учёта регистра — к существующему
  TABLE[idx][1] = clean;
  // Update in Firestore
  const doc = await shipmentsRef().doc(activeShipmentId).get();
  if (doc.exists) {
    const data = doc.data().data;
    if (data[idx]) {
      if (Array.isArray(data[idx])) data[idx][1] = clean;
      else data[idx].w = clean;
      await shipmentsRef().doc(activeShipmentId).update({ data });
    }
  }
  renderFullList();  // перерисуем чтобы показать склад с заглавной
}

function toggleScannedList() {
  const l=document.getElementById('scannedListWrap');
  l.style.display=l.style.display==='none'?'block':'none';
  if(l.style.display==='block') {
    const done=TABLE.map((r,i)=>({t:r[0],w:r[1],i})).filter(r=>scanned[r.i]);
    l.innerHTML=done.length===0?'<div style="padding:14px;text-align:center;color:#999">Пока ничего</div>'
      :done.map(r=>'<div class="unscanned-item"><span class="unscanned-track">'+r.t+'</span><span class="unscanned-wh">'+r.w+'</span></div>').join('');
  }
}

function toggleRemainingList() {
  const w = document.getElementById('fullListWrapper');
  if (w.style.display === 'block') { w.style.display = 'none'; return; }
  w.style.display = 'block';
  const container = document.getElementById('fullListContainer');
  const items = TABLE.map((r, i) => ({ idx: i, track: r[0], wh: r[1], img: r[2]||'', done: !!scanned[i] }))
    .filter(r => !r.done);
  container.innerHTML = items.length === 0
    ? '<div style="padding:14px;text-align:center;color:#999">Всё отсканировано!</div>'
    : items.map(r => `<div class="fulllist-item">
        <span class="fulllist-idx">${r.idx + 1}</span>
        <span class="fulllist-status">⬜</span>
        <span class="fulllist-img-wrap" data-img="${r.img}" data-idx="${r.idx}"></span>
        <span class="fulllist-track">${r.track}${(r.qty && r.qty>1)?` <span class="qty-b">×${r.qty}</span>`:''}</span>
        <span class="fulllist-wh"><input value="${r.wh}" data-idx="${r.idx}" /></span>
      </div>`).join('');
  document.querySelectorAll('.fulllist-img-wrap').forEach(wrap => {
    const img_url = wrap.dataset.img;
    if (img_url) {
      const img = document.createElement('img');
      img.className = 'fulllist-img';
      img.src = img_url;
      img.addEventListener('error', () => { wrap.innerHTML = '<span class="fulllist-img-ph">📦</span>'; });
      img.addEventListener('click', () => img.classList.toggle('expanded'));
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = '<span class="fulllist-img-ph">📦</span>';
    }
  });
  document.querySelectorAll('.fulllist-wh input').forEach(inp => {
    inp.addEventListener('change', () => editWarehouse(parseInt(inp.dataset.idx), inp.value));
  });
}


function toggleUnscanned() { const l=document.getElementById('unscannedList'); l.style.display=l.style.display==='none'?'block':'none'; if(l.style.display==='block') showUnscanned(); }
function showUnscanned() {
  const rem=TABLE.map((r,i)=>({t:r[0],w:r[1],i})).filter(r=>!scanned[r.i]);
  document.getElementById('unscannedList').innerHTML=rem.length===0?'<div style="padding:14px;text-align:center;color:#999">Всё отсканировано!</div>'
    :rem.map(r=>`<div class="unscanned-item"><span class="unscanned-track">${r.t}</span><span class="unscanned-wh">${r.w}</span></div>`).join('');
}

// ============ RESET / EXPORT ============
async function resetAll() {
  if(!confirm('Сбросить все отметки?'))return;
  const shipId = editingShipmentId || activeShipmentId;  // сбрасываем отметки именно открытого прихода
  scanned={};
  await scannedRef(shipId).set({ items: {} });
  updateStats(); document.getElementById('resultBlock').innerHTML='';
}
function exportScanned() {
  const rows=TABLE.map((r,i)=>({t:r[0],w:r[1],d:!!scanned[i]})).filter(r=>r.d).map(r=>r.t+','+r.w).join('\n');
  const blob=new Blob(['\uFEFF'+'Трек,Склад\n'+rows],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='отсканированные.csv'; a.click();
}

// ============ ADMIN ============
async function renderAdminPanel() {
  if(!userProfile||userProfile.role!=='admin'){document.getElementById('adminPanel').style.display='none';return;}
  document.getElementById('adminPanel').style.display='block';
  try {
    let snapDocs;
    try {
      const snap = await Promise.race([
        db.collection('users').get(),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('sdk-timeout')),5000))
      ]);
      snapDocs = snap.docs;
    } catch(sdkErr) {
      snapDocs = await fsList('users');  // SDK упал — читаем всех через REST
    }
    let html='';
    let userCount = 0;
    for (const doc of snapDocs) {
      const u=doc.data();
      const uid=doc.id;
      const isAdmin=u.role==='admin';
      if (isAdmin) continue;
      userCount++;
      const blocked=u.blocked||false;
      const created=u.created?.toDate?u.created.toDate():new Date(u.created||Date.now());
      const trialEnd=new Date(created.getTime()+90*24*60*60*1000);
      const daysLeft=Math.max(0,Math.ceil((trialEnd-new Date())/(24*60*60*1000)));
      const trialText=isAdmin?'∞':'тест '+daysLeft+' дн.';

      // Read shipments directly
      let shipLines = 'нет партий';
      try {
        const shSnap = await db.collection('users').doc(uid).collection('shipments').get();
        if (shSnap.size > 0) {
          const items = [];
          shSnap.forEach(s => { const d = s.data(); items.push('• ' + (d.name||'Без названия') + ' — ' + (d.data||[]).length + ' треков'); });
          shipLines = items.join('<br>');
        }
      } catch(e) {
        const stats = u.shipmentStats || [];
        if (stats.length > 0) shipLines = stats.map(s => '• ' + s.name + ' — ' + s.count + ' треков').join('<br>');
      }

      html+=`<div>
        <div class="admin-user-header" onclick="toggleAdminUser('${uid}')">
          <div>
            <b>${u.name||u.email}</b> ${blocked?'<span style="color:#dc2626;font-size:10px"><i class="ti ti-lock" style="font-size:12px"></i> БЛОК</span>':''}
            <div style="font-size:12px;color:#aaa">${u.email} · тест ${daysLeft} дн.</div>
          </div>
          <span class="admin-user-toggle" id="toggle_${uid}">▼</span>
        </div>
        <div class="admin-user-details" id="details_${uid}">
          <div style="margin-bottom:8px"><b>Партии:</b><br>${shipLines}</div>
          <div style="margin-bottom:8px"><b>Регистрация:</b> ${created.toLocaleDateString('ru')}</div>
          <div style="margin-bottom:8px"><b>Завершение тестового периода:</b> ${trialEnd.toLocaleDateString('ru')}</div>
          <div style="margin-bottom:8px"><b>Подписка:</b> ${u.subscription&&u.subscription.endDate?'✅ до '+(u.subscription.endDate.toDate?u.subscription.endDate.toDate():new Date(u.subscription.endDate)).toLocaleDateString('ru'):'❌ нет'}</div>
          <div style="display:flex;gap:6px;margin-top:6px">
            ${blocked
              ?`<button class="admin-btn admin-btn-unblock" onclick="adminToggleBlock('${uid}',false)">Разблокировать</button>`
              :`<button class="admin-btn admin-btn-block" onclick="adminToggleBlock('${uid}',true)">Заблокировать</button>`}
            <button class="admin-btn" style="background:#f0fdf4;color:#16a34a;border:1px solid #86efac" onclick="adminSetSubscription('${uid}','${(u.name||u.email).replace(/'/g,'')}')">Подписка</button>
          </div>
        </div>
      </div>`;
    }
    document.getElementById('adminUserList').innerHTML=html;
    document.getElementById('adminStats').textContent='Пользователей: '+userCount;
  } catch(e) { document.getElementById('adminUserList').innerHTML='<p style="font-size:12px;color:#999">Нет доступа</p>'; }
}

async function adminSetSubscription(uid, name) {
  const months = prompt('Подписка для ' + name + '\nВведите количество месяцев (1, 3, 6, 12):');
  if (!months || isNaN(months) || parseInt(months) <= 0) return;
  const m = parseInt(months);
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + m);
  if (!confirm('Активировать подписку до ' + endDate.toLocaleDateString('ru') + '?')) return;
  try {
    await db.collection('users').doc(uid).update({
      subscription: { endDate: firebase.firestore.Timestamp.fromDate(endDate), months: m, activatedAt: firebase.firestore.FieldValue.serverTimestamp() }
    });
    alert('Подписка активирована до ' + endDate.toLocaleDateString('ru'));
    renderAdminPanel();
  } catch(e) { alert('Ошибка: ' + e.message); }
}

async function adminSetSubscription(uid, name) {
  const months = prompt('Подписка для ' + name + '\nВведите количество месяцев (1, 3, 6, 12):');
  if (!months || isNaN(months) || parseInt(months) <= 0) return;
  const m = parseInt(months);
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + m);
  if (!confirm('Активировать подписку до ' + endDate.toLocaleDateString('ru') + '?')) return;
  try {
    await db.collection('users').doc(uid).update({
      subscription: { endDate: firebase.firestore.Timestamp.fromDate(endDate), months: m, activatedAt: firebase.firestore.FieldValue.serverTimestamp() }
    });
    alert('Подписка активирована до ' + endDate.toLocaleDateString('ru'));
    renderAdminPanel();
  } catch(e) { alert('Ошибка: ' + e.message); }
}

function toggleAdminUser(uid) {
  const det=document.getElementById('details_'+uid);
  const tog=document.getElementById('toggle_'+uid);
  det.classList.toggle('show');
  tog.classList.toggle('open');
}

async function adminToggleBlock(uid,block) {
  const action=block?'заблокировать':'разблокировать';
  if(!confirm('Точно '+action+'?'))return;
  await db.collection('users').doc(uid).update({blocked:block});
  renderAdminPanel();
}

// ============ ЖИВАЯ СИНХРОНИЗАЦИЯ (мобильная ↔ десктоп) ============
// Подписка onSnapshot на users/{uid}/shipments: правка с другого устройства сразу появляется здесь.
let shipSyncUnsub = null;
let shipSyncPending = false;
function snapDocToObj(d) {
  const o = d.data() || {};
  for (const k in o) if (o[k] && typeof o[k].toDate === 'function') o[k] = o[k].toDate();
  return o;
}
function syncIsTyping() {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
}
function isShownEl(id) { const e = document.getElementById(id); return !!e && e.classList.contains('show'); }
function startShipmentsSync() {
  if (shipSyncUnsub || !currentUser) return;
  let first = true;
  try {
    shipSyncUnsub = shipmentsRef().onSnapshot(snap => {
      if (first) { first = false; return; }               // первый снимок = то, что уже загружено
      if (snap.metadata.hasPendingWrites) return;          // наше собственное изменение — уже на экране
      const list = snap.docs.map(d => ({ id: d.id, ...snapDocToObj(d) }));
      list.sort((a, b) => (b.created ? new Date(b.created).getTime() : 0) - (a.created ? new Date(a.created).getTime() : 0));
      allShipments = list;
      const sel = document.getElementById('shipmentSelect');
      if (sel) { const v = sel.value; sel.innerHTML = list.map(x => `<option value="${x.id}">${x.name} (${(x.data || []).length})</option>`).join(''); sel.value = v; }
      if (typeof cabShipmentsCache !== 'undefined') cabShipmentsCache = list.map(x => ({ ...x }));
      const openId = editingShipmentId || activeShipmentId;
      const changedOpen = snap.docChanges().some(c => c.doc.id === openId && c.type === 'modified');
      if (changedOpen) { const cur = list.find(x => x.id === openId); if (cur) applyShipDoc(cur); }
      syncRefreshScreens();
    }, err => console.warn('shipments sync:', err.message));
  } catch (e) { console.warn('shipments sync start:', e.message); }
}
// Перерисовать открытые экраны. Если пользователь сейчас печатает в поле — отложить до выхода из поля.
function syncRefreshScreens() {
  if (syncIsTyping()) { shipSyncPending = true; return; }
  shipSyncPending = false;
  try { renderShipmentCards(); } catch (e) {}
  try { updateStats(); } catch (e) {}
  if (isShownEl('calcScreen')) renderCalc();
  if (isShownEl('weighScreen')) {
    renderWeighList();
    const ti = document.getElementById('tareInput'); if (ti) ti.value = currentTare ? Math.round(currentTare * 1000) : '';
    const tp = document.getElementById('tarePctChk'); if (tp) tp.checked = currentTarePct > 0;
    if (ti) ti.disabled = currentTarePct > 0;
    const cw = document.getElementById('cargoWeightInput'); if (cw) cw.value = currentCargoWeight ? Math.round(currentCargoWeight * 1000) : '';
    const dep = document.getElementById('departedChk'); if (dep) dep.checked = !!shipmentDeparted;
    updateClientsWeightTotal();
  }
  if (isShownEl('priceEditScreen')) renderPriceEditor();
  if (isShownEl('cabinetScreen') && typeof cabRerender === 'function') cabRerender();
}
document.addEventListener('focusout', () => { if (shipSyncPending) setTimeout(() => { if (!syncIsTyping()) syncRefreshScreens(); }, 50); });

// ============ PWA ============
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

// ============ PROFILE ============
function toggleTheme() {
  const dark = document.getElementById('themeToggle').checked;
  document.body.classList.toggle('dark', dark);
  // Save to Firebase
  db.collection('users').doc(currentUser.uid).update({ theme: dark ? 'dark' : 'light' }).catch(()=>{});
}

function applyTheme() {
  if (userProfile && userProfile.theme === 'dark') {
    document.body.classList.add('dark');
  }
}

function openProfile() {
  document.getElementById('profileOverlay').classList.add('show');
  renderAdminPanel();
  document.getElementById('profileEmail').value = currentUser.email;
  document.getElementById('themeToggle').checked = document.body.classList.contains('dark');
  document.getElementById('profileName').value = userProfile.name || '';
  const curSel = document.getElementById('profileCurrency');
  if (curSel) curSel.value = userProfile.currency || 'BYN';
  document.getElementById('profileRole').textContent = userProfile.role === 'admin' ? 'Администратор' : 'Пользователь';
  const created = userProfile.created?.toDate ? userProfile.created.toDate() : new Date(userProfile.created || Date.now());
  document.getElementById('profileCreated').textContent = created.toLocaleDateString('ru');
  if (userProfile.role === 'admin') {
    document.getElementById('profileTrialRow').style.display = 'none';
  } else {
    const trialEnd = new Date(created.getTime() + 90*24*60*60*1000);
    document.getElementById('profileTrial').textContent = trialEnd.toLocaleDateString('ru');
  }
  document.getElementById('nameMsg').style.display = 'none';
  document.getElementById('passMsg').style.display = 'none';
}

function closeProfile() {
  document.getElementById('profileOverlay').classList.remove('show');
}

async function saveCurrency() {
  const cur = document.getElementById('profileCurrency').value;
  userProfile.currency = cur;
  try {
    await db.collection('users').doc(currentUser.uid).update({ currency: cur });
    const msg = document.getElementById('currencyMsg');
    msg.textContent = '✅ Валюта сохранена: ' + cur;
    msg.style.display = 'block'; msg.style.color = '#22a05c';
    setTimeout(() => msg.style.display = 'none', 2000);
  } catch(e) {}
}

async function saveName() {
  const name = document.getElementById('profileName').value.trim();
  if (!name) return;
  try {
    await currentUser.updateProfile({ displayName: name });
    await db.collection('users').doc(currentUser.uid).update({ name });
    userProfile.name = name;
    document.getElementById('userBadgeName').textContent = name;
    const msg = document.getElementById('nameMsg');
    msg.className = 'profile-msg profile-msg-ok';
    msg.textContent = 'Имя сохранено';
    msg.style.display = 'block';
  } catch(e) {
    const msg = document.getElementById('nameMsg');
    msg.className = 'profile-msg profile-msg-err';
    msg.textContent = 'Ошибка: ' + e.message;
    msg.style.display = 'block';
  }
}

async function changePassword() {
  const p1 = document.getElementById('profileNewPass').value;
  const p2 = document.getElementById('profileNewPass2').value;
  const msg = document.getElementById('passMsg');
  if (p1.length < 6) { msg.className='profile-msg profile-msg-err'; msg.textContent='Минимум 6 символов'; msg.style.display='block'; return; }
  if (p1 !== p2) { msg.className='profile-msg profile-msg-err'; msg.textContent='Пароли не совпадают'; msg.style.display='block'; return; }
  try {
    await currentUser.updatePassword(p1);
    msg.className = 'profile-msg profile-msg-ok';
    msg.textContent = 'Пароль изменён';
    msg.style.display = 'block';
    document.getElementById('profileNewPass').value = '';
    document.getElementById('profileNewPass2').value = '';
  } catch(e) {
    msg.className = 'profile-msg profile-msg-err';
    msg.textContent = e.code === 'auth/requires-recent-login' ? 'Перезайдите в аккаунт для смены пароля' : 'Ошибка: ' + e.message;
    msg.style.display = 'block';
  }
}

// ============ MANUAL INPUT ============
function manualSearch() {
  const v=document.getElementById('manualInput').value.trim(); if(!v)return;
  lookup(v); document.getElementById('manualInput').value='';
  setTimeout(()=>{document.getElementById('manualInput').focus();document.getElementById('gunHint').textContent='Наведи пистолет или введи код вручную'},300);
}
// Автоконвертация русской раскладки в английскую ТОЛЬКО в поле сканера.
// Пистолет шлёт коды латинских клавиш; если на устройстве русская раскладка,
// печатаются русские буквы с тех же клавиш. Возвращаем их в латиницу по позиции клавиши.
const RU2EN = {
  'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']',
  'ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':"'",
  'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.',
  'Й':'Q','Ц':'W','У':'E','К':'R','Е':'T','Н':'Y','Г':'U','Ш':'I','Щ':'O','З':'P','Х':'[','Ъ':']',
  'Ф':'A','Ы':'S','В':'D','А':'F','П':'G','Р':'H','О':'J','Л':'K','Д':'L','Ж':';','Э':"'",
  'Я':'Z','Ч':'X','С':'C','М':'V','И':'B','Т':'N','Ь':'M','Б':',','Ю':'.'
};
function convertRuToEn(str){
  let out='';
  for(const ch of str){ out += (RU2EN[ch] !== undefined ? RU2EN[ch] : ch); }
  return out.toUpperCase();  // треки латиницей в верхнем регистре
}
document.getElementById('manualInput').addEventListener('input',function(e){
  const converted = convertRuToEn(this.value);
  if(converted !== this.value){
    const pos = this.selectionStart;
    this.value = converted;
    try { this.setSelectionRange(pos, pos); } catch(_){}
  }
});
document.getElementById('manualInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();manualSearch()}});
document.addEventListener('click',e=>{if(!e.target.closest('button')&&!e.target.closest('input')&&!e.target.closest('select')&&!e.target.closest('.overlay-card')&&!e.target.closest('.modal-card')&&document.getElementById('appScreen').style.display!=='none')document.getElementById('manualInput').focus()});

// ============ CAMERA ============
function toggleScanner(){scanning?stopScanner():startScanner()}
async function startScanner(){
  document.getElementById('cameraSection').style.display='block';document.getElementById('zoomSection').style.display='block';
  document.getElementById('scanBtn').innerHTML='<i class="ti ti-player-stop" aria-hidden="true" style="font-size:22px"></i> Стоп';document.getElementById('scanBtn').style.background='#6C4DB8';document.getElementById('scanBtn').style.color='#fff';scanning=true;
  try{allCameras=await Html5Qrcode.getCameras()}catch(e){allCameras=[]}
  const bc=document.getElementById('cameraButtons');bc.innerHTML='';
  const backs=allCameras.filter(d=>{const l=d.label.toLowerCase();return!l.includes('front')&&!l.includes('face')});
  const cams=backs.length?backs:allCameras;
  const named=cams.map((c,i)=>{const l=c.label.toLowerCase();let n=''+(i+1);
    if(l.includes('ultra')&&l.includes('wide'))n='0.5x';else if(l.includes('telephoto')||l.includes('tele'))n='3x';
    else if(l.includes('wide')&&!l.includes('ultra'))n='1x';return{...c,dn:n}});
  allCameras=named;
  if(named.length>1)named.forEach((c,i)=>{const b=document.createElement('button');b.id='camBtn'+i;b.textContent=c.dn;
    b.style.cssText='min-width:44px;flex-shrink:0;border:1.5px solid #e0e0e0;background:#f5f5f5;border-radius:8px;padding:7px;font-size:13px;font-weight:700;cursor:pointer;color:#555';
    b.onclick=()=>switchCam(c.id,i);bc.appendChild(b)});
  const def=named.find(d=>d.dn==='1x')||named[0]; await startWithCam(def?.id); highlightCam(named.indexOf(def));
}
async function switchCam(id,i){if(activeCameraId===id)return;if(scanner){try{await scanner.stop()}catch(e){}scanner=null}await startWithCam(id);highlightCam(i)}
function highlightCam(ai){allCameras.forEach((_,i)=>{const b=document.getElementById('camBtn'+i);if(!b)return;
  b.style.background=i===ai?'#6C4DB8':'#f5f5f5';b.style.color=i===ai?'#fff':'#555';b.style.borderColor=i===ai?'#6C4DB8':'#e0e0e0'})}
async function startWithCam(id){activeCameraId=id;scanner=new Html5Qrcode("reader");
  try{await scanner.start(id?{deviceId:{exact:id}}:{facingMode:"environment"},
    {fps:30,disableFlip:true,formatsToSupport:[Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.CODE_93,Html5QrcodeSupportedFormats.ITF]},
    c=>lookup(c.trim()),()=>{});setTimeout(()=>setZoom(1.5),500)}catch(e){stopScanner()}}
function setZoom(v){document.getElementById('zoomVal').textContent=v+'x';if(!scanner)return;
  try{const t=scanner.getRunningTrackCameraCapabilities();if(t&&t.zoomFeature().isSupported())t.zoomFeature().apply(parseFloat(v))}catch(e){}}
function stopScanner(){if(scanner){scanner.stop().catch(()=>{});scanner=null}
  document.getElementById('cameraSection').style.display='none';document.getElementById('zoomSection').style.display='none';
  document.getElementById('scanBtn').innerHTML='<i class="ti ti-camera" aria-hidden="true" style="font-size:22px"></i> Камера';document.getElementById('scanBtn').style.background='';document.getElementById('scanBtn').style.color='';scanning=false}

// ============ BEEP & VIBRATE ============
function beep(){try{const c=new(window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();
  o.connect(g);g.connect(c.destination);o.frequency.value=1800;o.type='sine';
  g.gain.setValueAtTime(.3,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.15);
  o.start(c.currentTime);o.stop(c.currentTime+.15)}catch(e){}}
function vibrate(){if(navigator.vibrate)navigator.vibrate(100)}
