/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TEK GERİ AL (#905). Sahneye ait alanların anlık kopyası; aygıt ve kurulum ayarları girmiyor.
   Kaydırıcı sürüklerken her karede değil, durunca bir adım. Zaman çizelgesinin kendi geçmişi var. */
(function () {
  const MAX = 60;
  const WAIT_MS = 400;

  function create(env) {
    const past = [];
    const next = [];
    let now = null;
    let timer = 0;
    const snap = () => {
      const o = {};
      for (const k of env.keys) { const v = env.get(k); if (v !== undefined) o[k] = v; }
      return JSON.stringify(o);
    };
    function settle() {
      timer = 0;
      const cur = snap();
      if (now === null) { now = cur; return; }
      if (cur === now) return;
      past.push(now);
      if (past.length > MAX) past.shift();
      next.length = 0;
      now = cur;
      env.changed();
    }
    function step(from, to) {
      if (!from.length) return;
      if (timer) { clearTimeout(timer); timer = 0; }
      const cur = snap();
      // Henüz not edilmemiş değişiklik varsa o da geri alınabilsin
      to.push(now === null || cur !== now ? cur : now);
      now = from.pop();
      const o = JSON.parse(now);
      for (const k of env.keys) env.set(k, o[k]);
      env.apply();
      env.changed();
    }
    return {
      note() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(settle, WAIT_MS);
      },
      undo: () => step(past, next),
      redo: () => step(next, past),
      canUndo: () => past.length > 0,
      canRedo: () => next.length > 0,
      settleNow: settle,
    };
  }

  const api = { create, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUndo = api;
})();
