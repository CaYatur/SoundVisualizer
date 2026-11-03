/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* BOŞTA EKRAN KORUYUCU.

   Ses belirli bir süre kesilince çıkış penceresi kararır ve ekranda yavaşça
   gezinen bir saat/yazı belirir: gösteri arasında projeksiyon ya da LED
   duvarı aynı görüntüyü saatlerce tutmasın (iz kalması), boş sahne de
   "donmuş" görünmesin. Ses gelince hemen çıkar.

   Saf durum makinesi: update() her kare çağrılır, karartma oranını
   (0..1) ve yazının konumunu döner. Çizim pencerenin işi. */
(function () {
  function defaults() {
    return { enabled: false, idleSec: 300, dim: 0.85, showClock: true, text: '', fadeSec: 2 };
  }

  function create() {
    return { silentFor: 0, amount: 0, x: 0.5, y: 0.5, vx: 0.013, vy: 0.009 };
  }

  /* s: create() durumu, o: { silent, dt, cfg }. Dönüş: s (yerinde) */
  function update(s, o) {
    const c = Object.assign(defaults(), (o && o.cfg) || {});
    const dt = Math.max(0, Math.min(1, (o && o.dt) || 0));
    if (!c.enabled) { s.silentFor = 0; s.amount = 0; return s; }
    s.silentFor = o.silent ? s.silentFor + dt : 0;
    const want = s.silentFor >= Math.max(5, c.idleSec) ? 1 : 0;
    // Girerken yavaş kararır; ses gelince hızlı (beş kat) çıkar
    const rate = dt / Math.max(0.05, c.fadeSec);
    s.amount = want ? Math.min(1, s.amount + rate) : Math.max(0, s.amount - rate * 5);
    if (s.amount > 0) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < 0.15 || s.x > 0.85) { s.vx = -s.vx; s.x = Math.max(0.15, Math.min(0.85, s.x)); }
      if (s.y < 0.15 || s.y > 0.85) { s.vy = -s.vy; s.y = Math.max(0.15, Math.min(0.85, s.y)); }
    }
    return s;
  }

  function clockText(d) {
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  const api = { defaults, create, update, clockText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVScreensaver = api;
})();
