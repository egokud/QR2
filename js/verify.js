// ============ ПОДТВЕРЖДЕНИЕ E-MAIL (02.11.2026) ============
// Новые регистрации: без подтверждения — только экран «Подтвердите e-mail» (в приложение не пускаем).
// Зарегистрированные до запуска: пускаем, но показываем плашку «Подтвердите e-mail».
// Экран сам проверяет подтверждение каждые 4 с и при возврате на вкладку.
const PK_VERIFY_SINCE = Date.parse('2026-11-02T19:00:00Z');   // кто создан раньше — плашка, а не экран
const PK_VERIFY_CD = 60;                                        // повтор письма — не чаще раза в минуту
try { auth.languageCode = 'ru'; } catch (e) {}                  // письма и страница подтверждения — на русском
const pkVerifyAcs = () => ({ url: location.origin + '/app' });
// Журнал отправок письма подтверждения в профиле (verifyMail) — админка видит, ушло ли письмо и что ответил Google
function pkVLog(ok, err, uid) {
  try {
    const id = uid || (currentUser && currentUser.uid); if (!id) return;
    const FV = firebase.firestore.FieldValue;
    db.collection('users').doc(id).update({ 'verifyMail.n': FV.increment(1), 'verifyMail.at': FV.serverTimestamp(), 'verifyMail.ok': !!ok, 'verifyMail.err': ok ? '' : String(err || '').slice(0, 120) }).catch(() => {});
  } catch (e) {}
}
function pkVErrText(code) {
  if (code === 'auth/too-many-requests') return 'Google временно ограничил отправку: слишком много писем подряд. Подождите 10–15 минут и нажмите «Отправить ещё раз».';
  if (code === 'auth/network-request-failed') return 'Нет связи с интернетом — письмо не ушло. Проверьте интернет и нажмите «Отправить ещё раз».';
  return 'Письмо не ушло (' + code + '). Нажмите «Отправить ещё раз».';
}

const pkVPreview = (location.search.match(/[?&]vgate=(\w+)/) || [])[1] || '';   // админ: предпросмотр ?vgate=1 / ok / bar
function pkNeedsVerify(user, prof) {
  if (!user) return null;
  if (prof && prof.role === 'admin') return pkVPreview === 'bar' ? 'bar' : pkVPreview ? 'gate' : null;
  if (user.emailVerified) { if (prof && prof.emailVerified !== true) setTimeout(() => { try { pkVSync(); } catch (e) {} }, 2000); return null; }
  const born = Date.parse((user.metadata && user.metadata.creationTime) || '') || Date.now();
  return born >= PK_VERIFY_SINCE ? 'gate' : 'bar';
}

(function () {
  const css = `
#pkVGate{position:fixed;inset:0;z-index:300;background:#f6f5fa;display:flex;align-items:center;justify-content:center;overflow:auto;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#17142a}
#pkVGate *,#pkVBar *{box-sizing:border-box}
#pkVGate .vc{width:100%;max-width:420px;min-height:100%;display:flex;flex-direction:column;align-items:center;text-align:center;gap:11px;padding:26px 20px calc(18px + env(safe-area-inset-bottom,0px))}
@media(min-width:700px){#pkVGate .vc{min-height:0;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(23,20,42,.10);padding:30px 32px}}
#pkVGate .lg{display:flex;align-items:center;gap:8px;font-weight:800;color:#6C4DB8;font-size:17px}#pkVGate .lg img{width:30px;height:30px;border-radius:8px}
#pkVGate .env{width:80px;height:80px;border-radius:40px;background:#efeafb;display:flex;align-items:center;justify-content:center;margin-top:8px;flex:none}
#pkVGate .env i{font-size:42px;color:#6C4DB8}#pkVGate .env.ok{background:#e7f8ee}#pkVGate .env.ok i{color:#15803d}
#pkVGate h1{font-size:23px;margin:4px 0 0;line-height:1.15;font-weight:800}
#pkVGate .t{font-size:14.5px;color:#4a4560;line-height:1.45}#pkVGate .t b{color:#17142a}
#pkVGate .ml{background:#fff;border:1px solid #ebe7f3;border-radius:12px;padding:9px 12px;font-weight:700;font-size:15px;display:flex;gap:7px;align-items:center;justify-content:center;width:100%;word-break:break-all}
#pkVGate .ml i{color:#6C4DB8;font-size:18px;flex:none}
#pkVGate .wt{font-size:12.5px;color:#6b6780;display:flex;gap:6px;align-items:center}
#pkVGate .sp{width:13px;height:13px;border-radius:7px;border:2px solid #d9d1f1;border-top-color:#6C4DB8;animation:pkvs 1s linear infinite}@keyframes pkvs{to{transform:rotate(360deg)}}
#pkVGate .tip{background:#fef3c7;color:#92400e;border-radius:11px;padding:9px 11px;font-size:13px;display:flex;gap:8px;text-align:left;line-height:1.35;width:100%}#pkVGate .tip i{font-size:17px;flex:none}
#pkVGate .ft{margin-top:auto;display:flex;flex-direction:column;gap:9px;align-items:center;width:100%;padding-top:14px}
@media(min-width:700px){#pkVGate .ft{margin-top:6px}}
#pkVGate button.b{width:100%;height:46px;border-radius:13px;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;gap:7px;background:#6C4DB8;color:#fff;border:none;cursor:pointer;font-family:inherit}
#pkVGate button.b.gh{background:#fff;color:#6C4DB8;border:1.5px solid #ebe7f3}#pkVGate button.b:disabled{color:#a8a3b8;cursor:default}
#pkVGate .lk{font-size:13.5px;color:#6C4DB8;font-weight:600;background:none;border:none;cursor:pointer;font-family:inherit;padding:2px}#pkVGate .lk.m{color:#6b6780;font-weight:500}
#pkVGate input{width:100%;border:1.5px solid #ddd5f3;border-radius:12px;padding:11px 12px;font-size:15px;font-family:inherit;outline:none}#pkVGate input:focus{border-color:#6C4DB8}
#pkVGate .er{color:#b91c1c;font-size:13px;min-height:0}
#pkVBar{position:fixed;z-index:120;left:12px;right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px));background:#fff;border:1.5px solid #fcd34d;border-radius:14px;box-shadow:0 8px 24px rgba(23,20,42,.14);padding:10px 12px;display:flex;gap:10px;align-items:center;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:13.5px;color:#17142a;line-height:1.35}
@media(min-width:700px){#pkVBar{left:auto;right:20px;bottom:20px;width:380px}}
body.pk-m #pkVBar{left:50%;right:auto;width:min(536px,calc(100% - 24px));transform:translateX(-50%);bottom:calc(88px + env(safe-area-inset-bottom,0px))}
@media(min-width:700px){body:has(#cabinetScreen.show) #pkVBar{left:auto;right:20px;bottom:20px;width:380px;transform:none}}
#pkVBar b{white-space:nowrap}#pkVBar>i{font-size:24px;color:#f59e0b;flex:none}#pkVBar .x{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}
#pkVBar button{border:none;border-radius:9px;font-weight:700;font-size:12.5px;padding:7px 10px;cursor:pointer;font-family:inherit;background:#6C4DB8;color:#fff;white-space:nowrap}
#pkVBar button.c{background:none;color:#8a85a0;font-size:18px;padding:2px 4px}
.pk-vcard{display:flex;gap:11px;background:#f9f7ff;border:1.5px solid #e4dcfb;border-radius:14px;padding:12px 13px;margin:0 0 12px;align-items:flex-start;text-align:left;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#17142a}
.pk-vcard *{box-sizing:border-box}
.pk-vcard .vic{width:38px;height:38px;border-radius:11px;background:#ede7fd;display:flex;align-items:center;justify-content:center;flex:none}
.pk-vcard .vic i{font-size:20px;color:#6C4DB8}
.pk-vcard .vb{min-width:0;flex:1}
.pk-vcard .vt{font-size:14.5px;font-weight:800;line-height:1.25}
.pk-vcard .va{font-size:12.5px;font-weight:700;color:#6C4DB8;margin-top:3px;word-break:break-all}
.pk-vcard .vs{font-size:13px;color:#4a4560;line-height:1.4;margin-top:3px}
.pk-vcard .vs i{font-size:14px;vertical-align:-2px}
.pk-vcard .vw{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap}
.pk-vcard .vb2{font-size:12.5px;font-weight:700;padding:7px 12px;border-radius:9px;border:none;background:#6C4DB8;color:#fff;font-family:inherit;cursor:pointer}
.pk-vcard .vb2.gh{background:#fff;color:#6C4DB8;border:1.5px solid #e4dcfb}
.pk-vcard .vb2:disabled{color:#a8a3b8;cursor:default}
.pk-vcard input{width:100%;border:1.5px solid #ddd5f3;border-radius:10px;padding:9px 11px;font-size:14px;font-family:inherit;outline:none;margin-top:8px}
.pk-vcard input:focus{border-color:#6C4DB8}
.pk-vcard .ver{color:#b91c1c;font-size:12.5px;margin-top:6px;line-height:1.35}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();

let pkVTimer = null, pkVCdTimer = null, pkVDone = null, pkVMode = 'wait';
const pkVEsc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function pkVCdLeft() { let t = 0; try { t = +localStorage.getItem('pk_vsent') || 0; } catch (e) {} return Math.max(0, PK_VERIFY_CD - Math.floor((Date.now() - t) / 1000)); }
function pkVMark() { try { localStorage.setItem('pk_vsent', String(Date.now())); } catch (e) {} }

// Показать экран; onDone — что делать после подтверждения (обычно showApp)
function pkShowVerifyGate(onDone) {
  pkVDone = onDone; pkVMode = pkVPreview === 'ok' ? 'ok' : 'wait';
  let g = document.getElementById('pkVGate');
  if (!g) { g = document.createElement('div'); g.id = 'pkVGate'; document.body.appendChild(g); }
  g.style.display = 'flex';
  let fail = ''; try { fail = localStorage.getItem('pk_vfail') || ''; } catch (e) {}
  if (fail) { try { localStorage.removeItem('pk_vsent'); } catch (e) {} pkVMode = 'fail'; pkVRender(pkVErrText(fail)); }
  else pkVRender();
  pkVNudge();
  clearInterval(pkVTimer); pkVTimer = setInterval(pkVCheck, 4000);
  document.addEventListener('visibilitychange', pkVOnVis);
  window.addEventListener('focus', pkVCheck);
}
function pkVOnVis() { if (!document.hidden) pkVCheck(); }

// 22.11.2026: «Подтвердить позже» — не запираем. Сутки окно не показываем, в кабинете напоминает карточка.
const PK_VERIFY_LATER = 24 * 36e5;
function pkVPostponed() { try { const t = +localStorage.getItem('pk_vlater') || 0; return !t ? false : (Date.now() - t < PK_VERIFY_LATER); } catch (e) { return false; } }
function pkVSkip() {
  try { localStorage.setItem('pk_vlater', String(Date.now())); } catch (e) {}
  pkVStop();
  const g = document.getElementById('pkVGate'); if (g) g.style.display = 'none';
  if (typeof pkVDone === 'function' && pkVDone) pkVDone();
}

function pkVRender(note) {
  const g = document.getElementById('pkVGate'); if (!g || !currentUser) return;
  let pend = ''; try { pend = localStorage.getItem('pk_vnew') || ''; } catch (e) {}
  const email = pend || currentUser.email;
  const head = '<div class="lg"><img src="/icons/icon-72x72.png" alt="">Piksta</div>';
  if (pkVMode === 'ok') {
    g.innerHTML = `<div class="vc">${head}<div class="env ok"><i class="ti ti-circle-check"></i></div><h1>E-mail подтверждён</h1>
      <div class="t">Спасибо! Теперь на этот адрес будут приходить напоминания об оплате и ответы поддержки.</div>
      <div class="ft"><button class="b" onclick="pkVFinish()"><i class="ti ti-arrow-right"></i>Начать работу</button></div></div>`;
    return;
  }
  if (pkVMode === 'edit') {
    g.innerHTML = `<div class="vc">${head}<div class="env"><i class="ti ti-pencil"></i></div><h1>Новый адрес</h1>
      <div class="t">Впишите правильный e-mail — отправим письмо туда. Адрес сменится, когда нажмёте ссылку в письме.</div>
      <input id="pkVNew" type="email" inputmode="email" autocomplete="email" placeholder="name@mail.ru" value="">
      <div class="er" id="pkVErr">${pkVEsc(note || '')}</div>
      <div class="ft"><button class="b" id="pkVNewBtn" onclick="pkVChange()"><i class="ti ti-send"></i>Отправить на новый адрес</button>
      <button class="lk m" onclick="pkVMode='wait';pkVRender()">Отмена</button></div></div>`;
    setTimeout(() => { const i = document.getElementById('pkVNew'); if (i) i.focus(); }, 50);
    return;
  }
  const cd = pkVCdLeft(), again = pkVMode === 'again';
  g.innerHTML = `<div class="vc">${head}<div class="env"><i class="ti ${again ? 'ti-mail-forward' : 'ti-mail'}"></i></div>
    <h1>${again ? 'Письмо отправлено ещё раз' : pkVMode === 'fail' ? 'Письмо не ушло' : 'Подтвердите e-mail'}</h1>
    ${again ? '' : `<div class="t">${pkVMode === 'fail' ? 'Нажмите «Отправить ещё раз» — отправим письмо на' : 'Мы отправили письмо на'}</div>`}
    <div class="ml"><i class="ti ti-at"></i>${pkVEsc(email)}</div>
    <div class="t">${again ? 'Иногда письмо идёт 1–2 минуты.' : pkVMode === 'fail' ? 'Когда письмо придёт — нажмите в нём ссылку, Piksta откроется сама.' : 'Откройте его и нажмите ссылку подтверждения. После этого Piksta откроется сама.'}</div>
    ${note ? '<div class="er">' + pkVEsc(note) + '</div>' : ''}
    <div class="wt"><span class="sp"></span>Ждём подтверждения…</div>
    <div class="ft">
      <div class="tip"><i class="ti ti-info-circle"></i><span>Нет письма? Проверьте папки <b>«Спам»</b> и <b>«Промоакции»</b>.</span></div>
      <button class="b gh" id="pkVSend" onclick="pkVResend()" ${cd ? 'disabled' : ''}>${cd ? '<i class="ti ti-clock"></i>Ещё раз — через <span id="pkVCd">' + pkVFmt(cd) + '</span>' : '<i class="ti ti-send"></i>Отправить ещё раз'}</button>
      <button class="lk" onclick="pkVSkip()" style="color:#6b6780;font-weight:600">Подтвердить позже</button>
      <button class="lk" onclick="pkVMode='edit';pkVRender()">Ошиблись в адресе? Изменить</button>
      <button class="lk m" onclick="pkVLogout()">Выйти</button>
    </div></div>`;
  clearInterval(pkVCdTimer);
  if (cd) pkVCdTimer = setInterval(() => { const l = pkVCdLeft(), e = document.getElementById('pkVCd'); if (!l) { clearInterval(pkVCdTimer); if (pkVMode !== 'edit') pkVRender(); } else if (e) e.textContent = pkVFmt(l); }, 1000);
}
const pkVFmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

async function pkVResend() {
  if (pkVCdLeft() || !currentUser) return;
  const b = document.getElementById('pkVSend'); if (b) b.disabled = true;
  try { await currentUser.sendEmailVerification(pkVerifyAcs()); pkVMark(); try { localStorage.removeItem('pk_vfail'); } catch (e) {} pkVLog(true); pkVMode = 'again'; pkVRender(); }
  catch (e) {
    pkVLog(false, e.code || e.message);
    if (e.code === 'auth/too-many-requests') pkVMark();
    pkVRender(pkVErrText(e.code || e.message));
  }
}
// Администратор нажал «Подтверждение» в админке → при следующем открытии сами отправляем свежее письмо (один раз на каждое нажатие)
async function pkVNudge() {
  try {
    const n = userProfile && userProfile.verifyNudge; if (!n || !currentUser || currentUser.emailVerified) return;
    const at = n.toMillis ? n.toMillis() : +new Date(n); let done = 0; try { done = +localStorage.getItem('pk_vnudge') || 0; } catch (e) {}
    if (at <= done) return;
    try { localStorage.setItem('pk_vnudge', String(at)); } catch (e) {}
    await currentUser.sendEmailVerification(pkVerifyAcs()); pkVMark(); pkVLog(true); pkVMode = 'again';
    pkVRender('Поддержка Piksta отправила вам новое письмо подтверждения — проверьте почту.');
  } catch (e) { pkVLog(false, e.code || e.message); }
}

async function pkVChange() {
  const v = ((document.getElementById('pkVNew') || {}).value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { pkVRender('Проверьте адрес'); const i = document.getElementById('pkVNew'); if (i) i.value = v; return; }
  const b = document.getElementById('pkVNewBtn'); if (b) b.disabled = true;
  try {
    await currentUser.verifyBeforeUpdateEmail(v, pkVerifyAcs());
    try { localStorage.setItem('pk_vnew', v); } catch (e) {}
    pkVMark(); pkVMode = 'again'; pkVRender();
  } catch (e) {
    const m = e.code === 'auth/email-already-in-use' ? 'Этот адрес уже зарегистрирован — войдите с ним.' :
      e.code === 'auth/invalid-email' ? 'Проверьте адрес' :
      e.code === 'auth/requires-recent-login' ? 'Из соображений безопасности выйдите и войдите снова, затем смените адрес.' :
      e.code === 'auth/too-many-requests' ? 'Слишком много попыток. Подождите пару минут.' : ('Не получилось: ' + (e.message || e.code));
    pkVRender(m); const i = document.getElementById('pkVNew'); if (i) i.value = v;
  }
}

async function pkVCheck() {
  if (!currentUser || pkVMode === 'ok' || pkVPreview) return;
  const g = document.getElementById('pkVGate'); if (!g || g.style.display === 'none') return;
  try { await currentUser.reload(); }
  catch (e) {
    // после смены адреса Firebase завершает старые входы — просим войти с новым адресом
    if (/user-token-expired|user-not-found|user-disabled|invalid-user-token/.test(e.code || '')) {
      try { localStorage.removeItem('pk_vnew'); } catch (x) {}
      alert('Адрес изменён. Войдите заново с новым e-mail.'); pkVLogout();
    }
    return;
  }
  if (auth.currentUser && auth.currentUser.emailVerified) {
    currentUser = auth.currentUser;
    try { await currentUser.getIdToken(true); savedToken = await currentUser.getIdToken(); } catch (e) {}
    pkVSync();
    pkVMode = 'ok'; pkVStop(); pkVRender();
  }
}
// почта в профиле = почта входа (после смены адреса) + отметка подтверждения
function pkVSync() {
  try { localStorage.removeItem('pk_vnew'); } catch (e) {}
  if (!currentUser || !userProfile) return;
  const upd = { emailVerified: true };
  if (currentUser.email && userProfile.email !== currentUser.email) upd.email = currentUser.email;
  Object.assign(userProfile, upd);
  db.collection('users').doc(currentUser.uid).update(upd).catch(() => {});
  pkVWelcome();
}
// приветственное письмо (03.11.2026): сервер сам проверит, что почта подтверждена, аккаунт свежий и письмо ещё не уходило
function pkVWelcome() {
  try {
    if (!currentUser) return;
    currentUser.getIdToken().then(t => fetch('/api/welcome', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: t }) })).catch(() => {});
  } catch (e) {}
}
function pkVStop() { clearInterval(pkVTimer); clearInterval(pkVCdTimer); document.removeEventListener('visibilitychange', pkVOnVis); window.removeEventListener('focus', pkVCheck); }
function pkVFinish() {
  const g = document.getElementById('pkVGate'); if (g) g.style.display = 'none';
  const f = pkVDone; pkVDone = null; if (f) f();
}
function pkVLogout() {
  pkVStop(); const g = document.getElementById('pkVGate'); if (g) g.style.display = 'none';
  try { localStorage.removeItem('pk_vnew'); } catch (e) {}
  auth.signOut();
}

// Плашка для тех, кто зарегистрирован до запуска
function pkShowVerifyBar() {
  try { if (sessionStorage.getItem('pk_vbar_x')) return; } catch (e) {}
  let b = document.getElementById('pkVBar');
  if (!b) { b = document.createElement('div'); b.id = 'pkVBar'; document.body.appendChild(b); }
  const cd = pkVCdLeft();
  b.innerHTML = `<i class="ti ti-mail-exclamation"></i><div><b>Подтвердите e-mail</b><br><span style="color:#6b6780">${cd ? 'Письмо отправлено на ' + pkVEsc(currentUser.email) : 'Так мы сможем связаться с вами'}</span></div>
    <div class="x">${cd ? '' : '<button onclick="pkVBarSend(this)">Отправить письмо</button>'}<button class="c" onclick="pkHideVerifyBar(1)" title="Скрыть">×</button></div>`;
  b.style.display = 'flex';
  clearInterval(pkVTimer);
  if (!pkVPreview) pkVTimer = setInterval(async () => {
    try { await currentUser.reload(); } catch (e) { return; }
    if (auth.currentUser && auth.currentUser.emailVerified) { currentUser = auth.currentUser; clearInterval(pkVTimer); pkVSync(); pkHideVerifyBar(); }
  }, 15000);
}
async function pkVBarSend(btn) {
  btn.disabled = true;
  try { await currentUser.sendEmailVerification(pkVerifyAcs()); pkVMark(); pkVLog(true); pkShowVerifyBar(); }
  catch (e) { pkVLog(false, e.code || e.message); btn.disabled = false; btn.textContent = e.code === 'auth/too-many-requests' ? 'Позже' : 'Ошибка'; }
}
function pkHideVerifyBar(byUser) {
  const b = document.getElementById('pkVBar'); if (b) b.style.display = 'none';
  if (byUser) { try { sessionStorage.setItem('pk_vbar_x', '1'); } catch (e) {} }
}

// ============ КАРТОЧКА «ПОДТВЕРДИТЕ ПОЧТУ» НА ГЛАВНОЙ (22.11.2026) ============
// Никого не запираем: человек работает как обычно, карточка только напоминает.
// Полноэкранное окно (pkVGate) больше не показывается само — осталось для смены адреса.
let pkVerifyCardMode = '';     // '' | 'sent' | 'edit' | 'ok'
let pkVerifyCardErr = '';
let pkVerifyCardAt = 0;

function pkVerifyNeed() {
  if (!currentUser || !currentUser.email) return false;
  if (currentUser.emailVerified) return false;
  if (userProfile && userProfile.role === 'admin') return false;
  return true;
}

function pkVerifyTime(ms) {
  const d = new Date(ms), n = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return d.toDateString() === n.toDateString() ? 'сегодня ' + hm : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

// HTML карточки. Слоты на страницах помечены data-vcard — заполняются все сразу.
function pkVerifyCardHtml() {
  if (!pkVerifyNeed()) return '';
  const cd = pkVCdLeft();
  const em = pkVEsc(currentUser.email);
  const head = `<div class="vic"><i class="ti ti-mail-check"></i></div>`;
  if (pkVerifyCardMode === 'edit') {
    return `<div class="pk-vcard">${head}<div class="vb">
      <div class="vt">Новый адрес почты</div>
      <div class="vs">Впишите правильный — отправим письмо туда. Адрес сменится, когда нажмёте ссылку в письме.</div>
      <input id="pkVCardInp" type="email" inputmode="email" autocomplete="email" placeholder="name@mail.ru" onkeydown="if(event.key==='Enter')pkVerifyEditSave()">
      ${pkVerifyCardErr ? '<div class="ver">' + pkVEsc(pkVerifyCardErr) + '</div>' : ''}
      <div class="vw"><button class="vb2" id="pkVCardSave" onclick="pkVerifyEditSave()">Отправить на новый адрес</button>
      <button class="vb2 gh" onclick="pkVerifyEditClose()">Отмена</button></div></div></div>`;
  }
  const sentLine = pkVerifyCardMode === 'sent' && pkVerifyCardAt
    ? `<div class="vs" style="color:#15803d;font-weight:700"><i class="ti ti-circle-check"></i> Письмо отправлено · ${pkVerifyTime(pkVerifyCardAt)}</div>`
    : `<div class="vs">Иначе мы не сможем написать вам об оплате и ответить на письма.</div>`;
  return `<div class="pk-vcard">${head}<div class="vb">
    <div class="vt">Подтвердите почту</div>
    <div class="va">${em}</div>
    ${sentLine}
    ${pkVerifyCardErr ? '<div class="ver">' + pkVEsc(pkVerifyCardErr) + '</div>' : ''}
    <div class="vw">
      <button class="vb2" id="pkVCardSend" onclick="pkVerifySend()" ${cd ? 'disabled' : ''}>${cd ? 'Ещё раз через ' + pkVFmt(cd) : (pkVerifyCardMode === 'sent' ? 'Отправить ещё раз' : 'Отправить письмо')}</button>
      <button class="vb2 gh" onclick="pkVerifyRecheck()">Я подтвердил</button>
      <button class="vb2 gh" onclick="pkVerifyEditOpen()">Изменить</button>
    </div>
    <div class="vs" style="font-size:12px;color:#8a85a0;margin-top:7px">Письмо от noreply@piksta.online. Если не видно — проверьте «Спам» и «Промоакции».</div>
  </div></div>`;
}

// Заполнить все слоты на странице (данные-атрибут data-vcard). Карточек может быть две — телефон и Кабинет.
function pkVerifyPaint() {
  const slots = document.querySelectorAll('[data-vcard]');
  if (!slots.length) return;
  const html = pkVerifyCardHtml();
  slots.forEach(s => { s.innerHTML = html; });
  if (pkVerifyCardMode === 'edit') { const i = document.getElementById('pkVCardInp'); if (i) { i.focus(); try { i.value = ''; } catch (e) {} } }
}

async function pkVerifySend() {
  if (!currentUser || pkVCdLeft()) return;
  pkVerifyCardErr = '';
  document.querySelectorAll('#pkVCardSend').forEach(b => { b.disabled = true; });
  try {
    await currentUser.sendEmailVerification(pkVerifyAcs());
    pkVMark(); pkVLog(true);
    pkVerifyCardMode = 'sent'; pkVerifyCardAt = Date.now();
    pkVerifyPaint();
    clearInterval(pkVCdTimer);
    pkVCdTimer = setInterval(() => {
      const left = pkVCdLeft();
      document.querySelectorAll('#pkVCardSend').forEach(b => {
        if (left) { b.disabled = true; b.textContent = 'Ещё раз через ' + pkVFmt(left); }
        else { b.disabled = false; b.textContent = 'Отправить ещё раз'; clearInterval(pkVCdTimer); }
      });
    }, 1000);
  } catch (e) {
    pkVLog(false, e.code || e.message);
    if (e.code === 'auth/too-many-requests') pkVMark();
    pkVerifyCardErr = pkVErrText(e.code || e.message);
    pkVerifyPaint();
  }
}

async function pkVerifyRecheck() {
  if (!currentUser) return;
  pkVerifyCardErr = '';
  try {
    await currentUser.reload();
  } catch (e) {
    pkVerifyCardErr = 'Нет связи. Попробуйте ещё раз.';
    pkVerifyPaint(); return;
  }
  if (auth.currentUser && auth.currentUser.emailVerified) {
    currentUser = auth.currentUser;
    try { await currentUser.getIdToken(true); savedToken = await currentUser.getIdToken(); } catch (e) {}
    try { pkVSync(); } catch (e) {}
    pkVerifyCardMode = 'ok';
    pkVerifyPaint();
    return;
  }
  pkVerifyCardErr = 'Пока не подтверждена. Откройте письмо и нажмите ссылку — сразу после этого нажмите «Я подтвердил».';
  pkVerifyPaint();
}

function pkVerifyEditOpen() { pkVerifyCardMode = 'edit'; pkVerifyCardErr = ''; pkVerifyPaint(); }
function pkVerifyEditClose() { pkVerifyCardMode = ''; pkVerifyCardErr = ''; pkVerifyPaint(); }

async function pkVerifyEditSave() {
  const inp = document.getElementById('pkVCardInp');
  const v = ((inp && inp.value) || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { pkVerifyCardErr = 'Проверьте адрес'; pkVerifyPaint(); if (inp) inp.value = v; return; }
  const b = document.getElementById('pkVCardSave'); if (b) b.disabled = true;
  try {
    await currentUser.verifyBeforeUpdateEmail(v, pkVerifyAcs());
    try { localStorage.setItem('pk_vnew', v); } catch (e) {}
    pkVMark(); pkVLog(true);
    pkVerifyCardMode = 'sent'; pkVerifyCardAt = Date.now(); pkVerifyCardErr = '';
    pkVerifyPaint();
  } catch (e) {
    pkVerifyCardErr = e.code === 'auth/email-already-in-use' ? 'Этот адрес уже зарегистрирован — войдите с ним.'
      : e.code === 'auth/invalid-email' ? 'Проверьте адрес'
      : e.code === 'auth/requires-recent-login' ? 'Выйдите и войдите снова, затем смените адрес.'
      : e.code === 'auth/too-many-requests' ? 'Слишком много попыток. Подождите пару минут.'
      : pkVErrText(e.code || e.message);
    pkVerifyPaint();
  }
}
