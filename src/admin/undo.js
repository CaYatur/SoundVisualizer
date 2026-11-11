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
    const scopes = new Map();
    let scopeKey = '';
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
      if (timer) { clearTimeout(timer); timer = 0; }
      /* Henüz not edilmemiş değişiklik KENDİ adımı olur. Eskiden son not edilen adımla
         birleşiyordu: bekleme süresi dolmadan basılan Ctrl+Z iki adım birden geri alıyordu
         (düzen editöründe ok tuşuyla kaydırıp hemen geri alınca önceki sürükleme de gidiyordu). */
      const cur = snap();
      if (now === null) now = cur;
      else if (cur !== now) {
        past.push(now);
        if (past.length > MAX) past.shift();
        next.length = 0;
        now = cur;
      }
      if (!from.length) { env.changed(); return; }
      to.push(now);
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
      /* Kapsam (Timeline klip düzenleme): her düzenleme hedefinin kendi
         geri al yığını var. Hedef değişince bekleyen adım eski kapsama
         yazılır; yeni kapsam kendi yığınıyla (yoksa boş) devam eder. Böylece
         bir klipte geri almak elle ayara ya da başka klibe sızmaz. */
      scope(key, load) {
        const k = String(key || '');
        if (k === scopeKey) { if (load) load(); return; }
        if (timer) { clearTimeout(timer); timer = 0; }
        settle();
        scopes.set(scopeKey, { past: past.splice(0), next: next.splice(0), now });
        scopeKey = k;
        const got = scopes.get(k);
        scopes.delete(k);
        if (got) { past.push(...got.past); next.push(...got.next); }
        if (load) load();
        now = snap();
        env.changed();
      },
      scopeKey: () => scopeKey,
      dropScope(key) { scopes.delete(String(key || '')); },
      canUndo: () => past.length > 0,
      canRedo: () => next.length > 0,
      settleNow: settle,
    };
  }

  const api = { create, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUndo = api;
})();
