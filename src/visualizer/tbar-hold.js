/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Telefon T-bar'ı sahne ayarından önce parmağı oynatıyor. Katman yığını o sırada
   geçişi henüz kurmamış oluyor; ilk ilerleme düşerse karışım saatle bitiyor ve
   yarıda bile varış görüntüsü tam görünüyor. Bekleyen örnek, geçiş elle
   tutulduğu anda uygulanıyor. Otomatik (kurulmamış) geçişe dokunulmuyor.
   Bu dosya küçük resim anahtarına girmez: layers.js değişince bütün mod
   resimleri eskirdi. */
(function () {
  function clamp(p) {
    return Math.max(0, Math.min(1, Number(p) || 0));
  }

  function attach(stack) {
    if (!stack || stack.__svTbarHold || typeof stack.tbar !== 'function' || typeof stack.setConfig !== 'function') return stack;
    stack.__svTbarHold = true;
    let pending = null;
    const origTbar = stack.tbar.bind(stack);
    const origSet = stack.setConfig.bind(stack);
    stack.tbar = (m) => {
      const ph = m && m.phase;
      if (ph === 'arm') { pending = null; return origTbar(m); }
      const tr = stack.trans;
      if (!tr || !tr.manual) {
        if (!tr && (ph === 'move' || ph === 'end' || ph === 'cancel')) pending = { phase: ph, p: clamp(m.p) };
        return origTbar(m);
      }
      pending = null;
      return origTbar(m);
    };
    stack.setConfig = (cfg) => {
      const result = origSet(cfg);
      const pend = pending;
      const tr = stack.trans;
      if (pend && tr && tr.manual) {
        pending = null;
        if (pend.phase === 'move') tr.manualP = pend.p;
        else if (pend.phase === 'end') stack.endTransition();
        else if (pend.phase === 'cancel') stack.cancelTransition();
      }
      return result;
    };
    return stack;
  }

  const api = { attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVTbarHold = api;
})();
