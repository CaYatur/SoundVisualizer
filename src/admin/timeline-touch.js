/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
'use strict';
/* ZAMAN ÇİZELGESİ DOKUNMA KATMANI — Android (WebView) ve dokunmatik ekranlar.

   Çizelge tuvalleri fare olaylarıyla yazıldı (mousedown → pencerede
   mousemove/mouseup). Dokunmada tarayıcı bunları yalnız dokunup bırakınca
   üretiyor: sürükleme, kırpma, taşıma hiç çalışmıyordu. Bu katman işaretçi
   olaylarını (pointer events) dinler ve:

   - tek parmak bir öğenin (klip, kenar, tutamaç, cetvel) üstündeyse aynı
     fare olaylarını üretir: mevcut sürükleme kodu değişmeden çalışır;
   - tek parmak boş şeritteyse çizelgeyi kaydırır (yatayda zaman, dikeyde
     şerit listesi), klip sürüklemesiyle kavga etmez;
   - iki parmak sıkıştırma yakınlaştırır, birlikte kaydırma zamanda kaydırır;
   - uzun basış (~500 ms, kıpırdamadan) sağ tık menüsünü açar;
   - çift dokunuş fare çift tıklaması gibi (detail = 2).

   Fare ve kalem eskisi gibi doğrudan tuvalin kendi olaylarına gider. */
(function () {
  const LONG_MS = 500;
  const SLOP = 8; // px: bunun altı "kıpırdamadı" sayılır
  const DOUBLE_MS = 350;

  /* Kaba işaretçi (parmak): isabet alanları genişler (en az ~36–44 px). */
  function coarse() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch { return false; }
  }
  // Kenar / tutamaç isabet payı (piksel): fare 6–7, parmak 16
  function tol(mouse) { return coarse() ? Math.max(16, mouse || 0) : (mouse || 6); }

  function mouse(type, target, p, extra) {
    const ev = new MouseEvent(type, Object.assign({
      bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
      button: type === 'mousemove' ? 0 : 0, buttons: type === 'mouseup' ? 0 : 1, detail: 1,
    }, extra || {}));
    ev.svTouch = true;
    target.dispatchEvent(ev);
    return ev;
  }

  /* bind(canvas, opts)
     opts.grab(x, y)   → true: bu noktada sürüklenecek bir şey var (fareye çevir)
     opts.pan(dx, dy)  → boş alanda tek parmak / iki parmak kaydırma (piksel)
     opts.zoom(f, x)   → sıkıştırma: f çarpanı, x tuval içi çıpa
     x, y tuvalin sol üstüne göre CSS pikseli. */
  function bind(cv, opts) {
    if (!cv || cv._svTouch) return;
    cv._svTouch = true;
    const o = opts || {};
    const pts = new Map(); // pointerId → {x, y}
    let mode = ''; // 'drag' | 'pan' | 'pinch' | ''
    let start = null;
    let last = null;
    let timer = 0;
    let longFired = false;
    let lastTap = { at: 0, x: 0, y: 0 };
    let pinch = null;
    let suppressMenuUntil = 0;
    const local = (p) => { const r = cv.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    const isTouch = (e) => e.pointerType === 'touch';

    cv.addEventListener('pointerdown', (e) => {
      if (!isTouch(e)) return;
      e.preventDefault(); // uyumluluk fare olayları ve sayfa kaydırması gelmesin
      try { cv.setPointerCapture(e.pointerId); } catch { /* yok say */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        // İkinci parmak: başlamış tek parmak işi bırakılır, sıkıştırmaya geçilir
        clearTimer();
        if (mode === 'drag') mouse('mouseup', window, last);
        const [a, b] = Array.from(pts.values());
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        mode = 'pinch';
        return;
      }
      if (pts.size > 2) return;
      start = { x: e.clientX, y: e.clientY, at: Date.now() };
      last = start;
      longFired = false;
      const lp = local(start);
      const dbl = Date.now() - lastTap.at < DOUBLE_MS && Math.hypot(start.x - lastTap.x, start.y - lastTap.y) < 24;
      if (o.grab && o.grab(lp.x, lp.y)) {
        mode = 'drag';
        mouse('mousedown', cv, start, { detail: dbl ? 2 : 1 });
      } else mode = 'pending';
      timer = setTimeout(() => {
        timer = 0;
        if (!last || Math.hypot(last.x - start.x, last.y - start.y) > SLOP) return;
        longFired = true;
        // Uzun basış: önce başlamış sürüklemeyi yerinde bitir (yalnız seçim kalır), sonra menü
        if (mode === 'drag') mouse('mouseup', window, start);
        mode = 'menu';
        suppressMenuUntil = Date.now() + 800;
        const ev = mouse('contextmenu', cv, start, { button: 2, buttons: 0 });
        void ev;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* yok */ } }
      }, LONG_MS);
    }, { passive: false });

    cv.addEventListener('pointermove', (e) => {
      if (!isTouch(e) || !pts.has(e.pointerId)) return;
      e.preventDefault();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'pinch' && pts.size >= 2) {
        const [a, b] = Array.from(pts.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        if (o.zoom && Math.abs(d / pinch.d - 1) > 0.01) o.zoom(d / pinch.d, local({ x: cx, y: cy }).x);
        if (o.pan) o.pan(pinch.cx - cx, 0);
        pinch = { d, cx, cy };
        return;
      }
      const prev = last;
      last = { x: e.clientX, y: e.clientY };
      if (!start) return;
      const moved = Math.hypot(last.x - start.x, last.y - start.y) > SLOP;
      if (moved) clearTimer();
      if (mode === 'drag') { mouse('mousemove', window, last); return; }
      if (mode === 'pending' && moved) mode = 'pan';
      if (mode === 'pan' && o.pan && prev) o.pan(prev.x - last.x, prev.y - last.y);
    }, { passive: false });

    const end = (e) => {
      if (!isTouch(e) || !pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      clearTimer();
      if (mode === 'pinch') { if (!pts.size) mode = ''; start = null; return; }
      const p = last || { x: e.clientX, y: e.clientY };
      if (mode === 'drag') mouse('mouseup', window, p);
      else if (mode === 'pending' && !longFired && e.type === 'pointerup') {
        // Boş yere dokunup bırakmak: fare tıklaması (seçimi kaldır, kafayı taşı, çift dokunuşla klip ekle)
        const dbl = Date.now() - lastTap.at < DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 24;
        mouse('mousedown', cv, p, { detail: dbl ? 2 : 1 });
        mouse('mouseup', window, p, { detail: dbl ? 2 : 1 });
        mouse('click', cv, p, { detail: dbl ? 2 : 1, buttons: 0 });
      }
      if (e.type === 'pointerup' && !longFired && start && Math.hypot(p.x - start.x, p.y - start.y) <= SLOP) lastTap = { at: Date.now(), x: p.x, y: p.y };
      mode = '';
      start = null;
      last = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    // Tarayıcının kendi uzun basış menüsü: bizimki zaten açıldı, ikincisi gelmesin
    cv.addEventListener('contextmenu', (e) => {
      if (e.svTouch) return;
      if (Date.now() < suppressMenuUntil || mode === 'drag' || mode === 'pan' || mode === 'pending') { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  /* Dikey kaydırma için en yakın kaydırılabilir ata (şerit listesi). */
  function scrollY(el, dy) {
    for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) { n.scrollTop += dy; return true; }
    }
    return false;
  }

  const api = { bind, coarse, tol, scrollY, LONG_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTimelineTouch = api;
})();
