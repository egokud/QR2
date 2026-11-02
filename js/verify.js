// ============ ПОДТВЕРЖДЕНИЕ E-MAIL (02.11.2026) ============
// Новые регистрации: без подтверждения — только экран «Подтвердите e-mail» (в приложение не пускаем).
// Зарегистрированные до запуска: пускаем, но показываем плашку «Подтвердите e-mail».
// Экран сам проверяет подтверждение каждые 4 с и при возврате на вкладку.
const PK_VERIFY_SINCE = Date.parse('2026-11-02T19:00:00Z');   // кто создан раньше — плашка, а не экран
const PK_VERIFY_CD = 60;                                        // повтор письма — не чаще раза в минуту
try { auth.languageCode = 'ru'; } catch (e) {}                  // письма и страница подтверждения — на русском
const pkVerifyAcs = () => ({ url: location.origin + '/app' });

const pkVPreview = (location.search.match(/[?&]vgate=(\w+)/) || [])[1] || '';   // админ: предпросмотр ?vgate=1 / ok / bar
function pkNeedsVerify(user, prof) {
  if (!user) return null;
  if (prof && prof.role === 'admin') return pkVPreview === 'bar' ? 'bar' : pkVPreview ? 'gate' : null;
  if (user.emailVerified) return null;
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
#pkVBar button.c{background:none;color:#8a85a0;font-size:18px;padding:2px 4px}`;
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
  pkVRender();
  clearInterval(pkVTimer); pkVTimer = setInterval(pkVCheck, 4000);
  document.addEventListener('visibilitychange', pkVOnVis);
  window.addEventListener('focus', pkVCheck);
}
function pkVOnVis() { if (!document.hidden) pkVCheck(); }

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
    <h1>${again ? 'Письмо отправлено ещё раз' : 'Подтвердите e-mail'}</h1>
    ${again ? '' : '<div class="t">Мы отправили письмо на</div>'}
    <div class="ml"><i class="ti ti-at"></i>${pkVEsc(email)}</div>
    <div class="t">${again ? 'Иногда письмо идёт 1–2 минуты.' : 'Откройте его и нажмите ссылку подтверждения. После этого Piksta откроется сама.'}</div>
    ${note ? '<div class="er">' + pkVEsc(note) + '</div>' : ''}
    <div class="wt"><span class="sp"></span>Ждём подтверждения…</div>
    <div class="ft">
      <div class="tip"><i class="ti ti-info-circle"></i><span>Нет письма? Проверьте папки <b>«Спам»</b> и <b>«Промоакции»</b>.</span></div>
      <button class="b gh" id="pkVSend" onclick="pkVResend()" ${cd ? 'disabled' : ''}>${cd ? '<i class="ti ti-clock"></i>Ещё раз — через <span id="pkVCd">' + pkVFmt(cd) + '</span>' : '<i class="ti ti-send"></i>Отправить ещё раз'}</button>
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
  try { await currentUser.sendEmailVerification(pkVerifyAcs()); pkVMark(); pkVMode = 'again'; pkVRender(); }
  catch (e) {
    if (e.code === 'auth/too-many-requests') { pkVMark(); pkVRender('Слишком много писем подряд. Подождите пару минут.'); }
    else pkVRender('Не удалось отправить: ' + (e.message || e.code));
  }
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
  try { await currentUser.sendEmailVerification(pkVerifyAcs()); pkVMark(); pkShowVerifyBar(); }
  catch (e) { btn.disabled = false; btn.textContent = e.code === 'auth/too-many-requests' ? 'Позже' : 'Ошибка'; }
}
function pkHideVerifyBar(byUser) {
  const b = document.getElementById('pkVBar'); if (b) b.style.display = 'none';
  if (byUser) { try { sessionStorage.setItem('pk_vbar_x', '1'); } catch (e) {} }
}
