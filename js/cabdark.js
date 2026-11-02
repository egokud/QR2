// ============ ТЁМНАЯ ТЕМА КАБИНЕТА (03.11.2026) ============
// Строится сама из светлых цветов css/cabinet.css: светлые фоны → тёмные, тёмный текст → светлый, оттенок сохраняется.
// Плюс инлайн-цвета из шаблонов cabinet.js (список ниже). Всё под body.dark — в светлой теме ничего не меняется.
// Включается там же, где в мобильной: Настройки → Оформление → «Тёмная» (поле users/{uid}.theme).
(function () {
  const toHls = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, l, s]; };
  const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const mk = (h, l, s) => { let r, g, b; if (!s) r = g = b = l; else { const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3); }
    return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join(''); };
  const parse = c => { let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c); if (m) { let x = m[1]; if (x.length === 3) x = x.replace(/./g, '$&$&'); return [0, 2, 4].map(i => parseInt(x.substr(i, 2), 16)).concat(1); }
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s\/]+([\d.]+))?\s*\)$/i.exec(c); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  // роли цвета
  const text = c => { const p = parse(c); if (!p || p[3] < .5) return null; const [h, l, s] = toHls(p[0], p[1], p[2]); if (l >= .62) return null;
    return s < .12 ? mk(h, .93 - l * .55, s) : mk(h, Math.min(.8, .95 - l * .5), s * .95); };
  const back = c => { const p = parse(c); if (!p || p[3] < .5) return null; const [h, l, s] = toHls(p[0], p[1], p[2]);
    if (p[0] === 255 && p[1] === 255 && p[2] === 255) return '#1d1a2e';
    if (l > .9) return s < .15 ? '#241f37' : mk(h, .17, Math.min(s, .45));
    if (l > .74) return s < .15 ? '#302a48' : mk(h, .24, Math.min(s, .4));
    return null; };
  const line = c => { const p = parse(c); if (!p) return null; const [h, l, s] = toHls(p[0], p[1], p[2]); if (l <= .7) return null; return s < .3 ? '#342d4d' : mk(h, .3, Math.min(s, .4)); };
  const PROPS = { color: text, 'background-color': back, 'border-top-color': line, 'border-right-color': line, 'border-bottom-color': line, 'border-left-color': line, 'outline-color': line };
  const darkSel = s => s.split(',').map(x => { x = x.trim(); return /^body[.\s:]/.test(x) ? x.replace(/^body/, 'body.dark') : 'body.dark ' + x; }).join(',');
  function rulesOf(list, out) {
    for (const r of list) {
      if (r.type === 1) {   // обычное правило
        if (/body\.dark/.test(r.selectorText)) continue;
        const d = [];
        for (const prop in PROPS) { const v = r.style.getPropertyValue(prop); if (!v) continue; const n = PROPS[prop](v.trim()); if (n) d.push(prop + ':' + n); }
        if (d.length) out.push(darkSel(r.selectorText) + '{' + d.join(';') + '}');
      } else if (r.cssRules && r.conditionText !== undefined) {   // @media / @container
        const sub = []; rulesOf(r.cssRules, sub);
        if (sub.length) out.push((r.type === 4 ? '@media ' : '@container ') + r.conditionText + '{' + sub.join('') + '}');
      }
    }
  }
  // инлайн-цвета из шаблонов cabinet.js: c — текст, b — фон, r — рамка
  const INL = {
    c: '15803d 16a34a 1a1a2e 2563a8 2aabee 3cb371 4a5260 5f6470 6b7280 6c4db8 92400e 9aa0ab 9ca3af b45309 dc2626 eab308 f59e0b',
    b: 'e7f8ee f0ecf9 f3f4f6 fde68a fee2e2 fef2f2 fef3c7 fff fffbeb fffdf5',
    r: 'b9a8e3 d5d8dd e5e7eb fca5a5 fde68a 86efac'
  };
  const SC = 'body.dark :is(#cabinetScreen,.cab-ovl,.cab-dlg,.cab-menu,.cab-zoom,#cabImgZoom,.cab-help-pop)';
  function inline(out) {
    for (const h of INL.c.split(' ')) { const n = text('#' + h); if (n) out.push(`${SC} [style^="color:#${h}" i],${SC} [style*=";color:#${h}" i],${SC} [style*="; color:#${h}" i]{color:${n}!important}`); }
    for (const h of INL.b.split(' ')) { const n = back('#' + h); if (n) out.push(`${SC} [style*="background:#${h}" i],${SC} [style*="background-color:#${h}" i]{background-color:${n}!important}`); }
    for (const h of INL.r.split(' ')) { const n = line('#' + h); if (n) out.push(`${SC} [style*="border"][style*="#${h}" i]{border-color:${n}!important}`); }
  }
  const BASE = `
body.dark .cabinet-screen,body.dark .cabinet-screen .cab-main{background:#110f1c;color:#e6e2f3;color-scheme:dark}
body.dark :is(#cabinetScreen,.cab-dlg,.cab-help-pop) :is(input:not([type=checkbox]):not([type=radio]),select,textarea){background:#15121f!important;color:#e6e2f3!important;border-color:#3a3358!important}
body.dark .cabinet-screen ::placeholder{color:#7d7799}
body.dark .cabinet-screen img{filter:brightness(.92)}
body.dark :is(.cab-sidebar,.cab-table-wrap,.cab-dlg,.cab-help-pop,.cab-menu,.ctf-card,.cab-card){box-shadow:none}
body.dark .ctf-card.sel{box-shadow:0 10px 30px rgba(0,0,0,.35)}
body.dark .cab-top-back,body.dark .cab-top-help{background:#1d1a2e;border-color:#3a3358}`;
  let built = false;
  function build() {
    if (built) return; built = true;
    const out = [];
    try { for (const sh of document.styleSheets) { if (!/cabinet\.css/.test(sh.href || '')) continue; rulesOf(sh.cssRules, out); } } catch (e) {}
    inline(out);
    const st = document.createElement('style'); st.id = 'cabDark'; st.textContent = out.join('\n') + BASE; document.head.appendChild(st);
  }
  // строим, когда тема включена (или включится) — чтобы не тратить время в светлой
  const go = () => { if (document.body.classList.contains('dark')) build(); };
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  new MutationObserver(go).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
