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
  /* Bellek sınırı (#1170): adım sayısının yanında anlık kopyaların toplam boyu da sınırlı.
     Taslak kapsamı yapılandırmanın tamamını tuttuğu için 60 adım büyük olabilir. */
  const MAX_CHARS = 24 * 1024 * 1024;
  function create(env) {
    const past = [];
    const next = [];
    let now = null;
    let timer = 0;
    const scopes = new Map();
    let scopeKey = '';
    let inner = ''; // çağıranın istediği kapsam (Timeline klibi)
    let base = ''; // üst kapsam (önizleme taslağı); boşken kapsam adı eskisiyle aynı
    const keysOf = () => env.keys;
    const snap = () => {
      const o = {};
      for (const k of keysOf()) { const v = env.get(k); if (v !== undefined) o[k] = v; }
      return JSON.stringify(o);
    };
    const size = (list) => list.reduce((n, x) => n + x.length, 0);
    function trim() {
      while (past.length > MAX) past.shift();
      while (past.length > 1 && size(past) + size(next) + (now ? now.length : 0) > MAX_CHARS) past.shift();
    }
    function settle() {
      timer = 0;
      const cur = snap();
      if (now === null) { now = cur; return; }
      if (cur === now) return;
      past.push(now);
      next.length = 0;
      now = cur;
      trim();
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
        next.length = 0;
        now = cur;
        trim();
      }
      if (!from.length) { env.changed(); return; }
      to.push(now);
      now = from.pop();
      const o = JSON.parse(now);
      /* Anahtar listesi kapsamla değişebilir (taslak: tüm yapılandırma); kopyada olup
         şimdiki listede olmayan anahtar da geri yazılır. Sahne kapsamında küme aynı. */
      const ks = new Set(keysOf());
      for (const k of Object.keys(o)) ks.add(k);
      for (const k of ks) env.set(k, o[k]);
      env.apply();
      env.changed();
    }
    function switchTo(k, load) {
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
    }
    const compose = (b, i) => (b ? b + (i ? '/' + i : '') : i);
    /* Son adımda değişen üst düzey anahtarlar (etiket ve geçmiş listesi için). */
    function diffKeys(a, b) {
      try {
        const x = JSON.parse(a);
        const y = JSON.parse(b);
        const out = [];
        for (const k of new Set(Object.keys(x).concat(Object.keys(y)))) {
          if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(k);
        }
        return out;
      } catch { return []; }
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
        inner = String(key || '');
        switchTo(compose(base, inner), load);
      },
      /* Üst kapsam (#1170): önizleme taslağı açıkken her kapsam taslağa özel yığın
         kullanır; kapanınca eski yığınlar olduğu gibi döner. */
      setBase(key, load) {
        base = String(key || '');
        switchTo(compose(base, inner), load);
      },
      base: () => base,
      scopeKey: () => inner,
      dropScope(key) { scopes.delete(String(key || '')); },
      // Taslak kapsamındaki yığınları at (Sahneye Gönder, çıkış)
      dropBase(b) {
        const pre = String(b || '');
        if (!pre) return;
        for (const k of Array.from(scopes.keys())) if (k === pre || k.indexOf(pre + '/') === 0) scopes.delete(k);
      },
      // Bu kapsamın geçmişini boşalt: şimdiki hâl yeni başlangıç olur
      reset() {
        if (timer) { clearTimeout(timer); timer = 0; }
        past.length = 0;
        next.length = 0;
        now = snap();
        env.changed();
      },
      canUndo: () => past.length > 0,
      canRedo: () => next.length > 0,
      // Geri alınacak son adımlar (en yenisi önce): her biri değişen anahtarlar
      steps(n) {
        const out = [];
        let after = now;
        for (let i = past.length - 1; i >= 0 && out.length < (n || 5); i--) {
          out.push(after === null ? [] : diffKeys(past[i], after));
          after = past[i];
        }
        return out;
      },
      redoSteps(n) {
        const out = [];
        let before = now;
        for (let i = next.length - 1; i >= 0 && out.length < (n || 5); i--) {
          out.push(before === null ? [] : diffKeys(before, next[i]));
          before = next[i];
        }
        return out;
      },
      settleNow: settle,
    };
  }
  const api = { create, MAX, MAX_CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVUndo = api;
})();
