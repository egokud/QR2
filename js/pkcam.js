// ============ КАМЕРА-СКАНЕР (06.11.2026) ============
// Заменяет распознавание через html5-qrcode (камера давала 480×640, длинные треки читались по 5–15 секунд).
// Проверено на тестовой странице /scan-test.html на iPhone и Android (Redmi):
//  • где в браузере есть встроенный распознаватель (Android/Chrome, Mac/Chrome) — он, качество 720p
//    (в 1080p средний Android разбирает втрое меньше кадров);
//  • иначе (iPhone) — ZXing на WebAssembly, качество 1080p. Файл распознавателя: /js/zxing_reader.wasm, обёртка /js/scan-bd.js.
// Код ищем только в центральной полосе кадра. Если ни один способ недоступен — app.js включает старый html5-qrcode.
// Снаружи объект ведёт себя как прежний scanner: pause(), resume(), stop() — на них завязаны app.js и mobile.js.
const PkCam = (() => {
  const FORMATS = ['code_128', 'code_39', 'code_93', 'itf', 'ean_13', 'codabar'];
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let nativeOk = null, zx = null;

  async function hasNative() {
    if (nativeOk !== null) return nativeOk;
    nativeOk = false;
    try { if ('BarcodeDetector' in window) nativeOk = (await BarcodeDetector.getSupportedFormats()).includes('code_128'); } catch (e) {}
    return nativeOk;
  }
  function zxing() {
    if (zx) return zx;
    if (!window.BarcodeDetectionAPI || typeof WebAssembly !== 'object') return null;
    BarcodeDetectionAPI.prepareZXingModule({ overrides: { locateFile: (p, pre) => p.endsWith('.wasm') ? '/js/zxing_reader.wasm' : pre + p }, fireImmediately: true });
    zx = new BarcodeDetectionAPI.BarcodeDetector({ formats: FORMATS });
    return zx;
  }
  async function available() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && ((await hasNative()) || !!window.BarcodeDetectionAPI && typeof WebAssembly === 'object'); }

  const norm = t => String(t || '').replace(/\s+/g, '').toLowerCase();
  // это трек из закупки или хотя бы похоже на трек? Остальные коды на наклейке (внутренние коды карго и т.п.) молча пропускаем
  function isTrackish(code) {
    if (typeof PK_TRACK_RE !== 'undefined' && PK_TRACK_RE.test(code)) return true;
    const n = norm(code);
    return typeof TABLE !== 'undefined' && TABLE.some(r => norm(r[0]) === n);
  }

  class Cam {
    constructor(video, onCode) {
      this.v = video; this.onCode = onCode;
      this.running = false; this.paused = false; this.stream = null; this.track = null;
      this.lastCode = ''; this.lastSeen = 0; this.tickAt = 0;
      this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    async start(deviceId) {
      this.engine = (await hasNative()) ? 'native' : 'zxing';
      const size = this.engine === 'native' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
      const video = Object.assign(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }, size);
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      this.track = this.stream.getVideoTracks()[0];
      this.v.srcObject = this.stream; this.v.setAttribute('playsinline', ''); this.v.muted = true;
      await this.v.play().catch(() => {});
      try { await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
      this.det = this.engine === 'native' ? new BarcodeDetector({ formats: FORMATS }) : zxing();
      if (!this.det) throw new Error('нет распознавателя');
      this.running = true; this.paused = false;
      this.loop();
    }
    async loop() {
      const v = this.v;
      while (this.running) {
        if (this.paused || v.readyState < 2 || !v.videoWidth) { await new Promise(r => setTimeout(r, 80)); continue; }
        const W = v.videoWidth, H = v.videoHeight;
        // центральная полоса: 40% высоты кадра, почти вся ширина — как рамка на экране
        const sh = Math.round(H * 0.40), sy = Math.round((H - sh) / 2), sx = Math.round(W * 0.02), sw = W - 2 * sx;
        let codes = [];
        try {
          if (this.engine === 'native' && window.createImageBitmap) {
            const bmp = await createImageBitmap(v, sx, sy, sw, sh); codes = await this.det.detect(bmp); bmp.close && bmp.close();
          } else {
            if (this.canvas.width !== sw || this.canvas.height !== sh) { this.canvas.width = sw; this.canvas.height = sh; }
            this.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
            codes = await this.det.detect(this.canvas);
          }
        } catch (e) { codes = []; }
        if (this.running && !this.paused && codes.length) this.handle(codes.map(c => String(c.rawValue || '').trim()).filter(Boolean));
        await new Promise(r => setTimeout(r, 0));
      }
    }
    handle(vals) {
      const now = performance.now();
      const code = vals.find(isTrackish);
      if (!code) {   // посторонний код — тихий щелчок не чаще раза в 2 с
        if (now - this.tickAt > 2000) { this.tickAt = now; pkSnd('tick'); }
        return;
      }
      // тот же трек, пока он остаётся в кадре (и 2,5 с после), повторно не обрабатываем
      if (norm(code) === this.lastCode && now - this.lastSeen < 2500) { this.lastSeen = now; return; }
      this.lastCode = norm(code); this.lastSeen = now;
      try { this.onCode(code); } catch (e) {}
    }
    pause() { this.paused = true; }
    resume() { this.paused = false; this.lastSeen = performance.now(); }
    async stop() {
      this.running = false;
      try { this.track && this.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); } catch (e) {}
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null; this.track = null; try { this.v.srcObject = null; } catch (e) {}
    }
    caps() { try { return this.track && this.track.getCapabilities ? this.track.getCapabilities() : {}; } catch (e) { return {}; } }
    settings() { try { return this.track && this.track.getSettings ? this.track.getSettings() : {}; } catch (e) { return {}; } }
    async zoom(z) { try { await this.track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (e) {} }
    async torch(on) { try { await this.track.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch (e) { return false; } }
  }
  return { Cam, available, hasNative, zxing, IOS };
})();

// ============ ЗВУКИ И ВИБРАЦИЯ: свой сигнал на каждый случай ============
let pkAC = null;
function pkTone(f, d, t0, type, vol) {
  const o = pkAC.createOscillator(), g = pkAC.createGain();
  o.type = type || 'sine'; o.frequency.value = f; o.connect(g); g.connect(pkAC.destination);
  const s = pkAC.currentTime + (t0 || 0);
  g.gain.setValueAtTime(vol || .3, s); g.gain.exponentialRampToValueAtTime(.001, s + d);
  o.start(s); o.stop(s + d);
}
function pkSnd(k) {
  try {
    pkAC = pkAC || new (window.AudioContext || window.webkitAudioContext)();
    if (pkAC.state === 'suspended') pkAC.resume();
    if (k === 'ok') { pkTone(1500, .09, 0); pkTone(2000, .14, .09); }                              // отмечено: «ти-динь» вверх
    else if (k === 'al') { pkTone(900, .12, 0, 'triangle'); pkTone(900, .12, .18, 'triangle'); }  // уже отмечен: два средних
    else if (k === 'no') { pkTone(220, .45, 0, 'square', .18); }                                  // не найден: низкий гудок
    else if (k === 'tick') { pkTone(3000, .02, 0, 'sine', .08); }                                 // посторонний код: тихий щелчок
  } catch (e) {}
}
function pkVib(k) { try { navigator.vibrate && navigator.vibrate(k === 'ok' ? 100 : k === 'al' ? [60, 80, 60] : k === 'no' ? [300] : 0); } catch (e) {} }
// iPhone разрешает звук только после первого касания — «будим» звук заранее
document.addEventListener('touchstart', () => { try { pkAC = pkAC || new (window.AudioContext || window.webkitAudioContext)(); pkAC.resume(); } catch (e) {} }, { once: true, passive: true });
