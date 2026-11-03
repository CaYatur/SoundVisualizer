/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* OYUN KUMANDASI (Gamepad API) → eşleme olayları.

   MIDI eşlemesiyle aynı motor: düğme ya da eksen bir ayarı sürer ya da bir
   eylemi tetikler. Tarayıcı olay yollamaz, durum okunur; burada iki okuma
   arasındaki FARK olaya çevrilir. Eksen -1..1 → 0..1; ölü bölge küçük
   titremeyi yutar.

   Eşleme: { id, kind: 'button' | 'axis', index, pad: -1 (hepsi) | n,
             target, min, max } */
(function () {
  const DEAD = 0.08;

  function axis01(v) { return Math.max(0, Math.min(1, (Number(v) + 1) / 2)); }

  /* prev: önceki durum ({ 'p:b:i': değer }), pads: navigator.getGamepads().
     Dönüş: { state, events: [{ pad, kind, index, value01, raw }] } */
  function diff(prev, pads, deadzone) {
    const dz = deadzone == null ? DEAD : deadzone;
    const state = {};
    const events = [];
    const list = pads ? Array.from(pads) : [];
    for (let p = 0; p < list.length; p++) {
      const gp = list[p];
      if (!gp || gp.connected === false) continue;
      const pi = gp.index != null ? gp.index : p;
      (gp.buttons || []).forEach((b, i) => {
        const v = typeof b === 'number' ? b : (b && (b.value != null ? b.value : b.pressed ? 1 : 0)) || 0;
        const k = pi + ':b:' + i;
        state[k] = v;
        const was = prev && prev[k] != null ? prev[k] : 0;
        if (Math.abs(v - was) >= 0.02 || (v >= 0.5) !== (was >= 0.5)) events.push({ pad: pi, kind: 'button', index: i, value01: v, raw: v });
      });
      (gp.axes || []).forEach((a, i) => {
        let v = Number(a) || 0;
        if (Math.abs(v) < dz) v = 0;
        const k = pi + ':a:' + i;
        state[k] = v;
        const was = prev && prev[k] != null ? prev[k] : 0;
        if (Math.abs(v - was) >= 0.01) events.push({ pad: pi, kind: 'axis', index: i, value01: axis01(v), raw: v });
      });
    }
    return { state, events };
  }

  // Öğren: yeterince belirgin ilk hareket (yarım basış ya da eksenin yarısı)
  function learnFrom(events) {
    for (const e of events || []) {
      if (e.kind === 'button' && e.raw >= 0.5) return { kind: 'button', index: e.index, pad: -1 };
      if (e.kind === 'axis' && Math.abs(e.raw) >= 0.5) return { kind: 'axis', index: e.index, pad: -1 };
    }
    return null;
  }

  function matches(m, e) {
    if (!m || !e || m.kind !== e.kind || m.index !== e.index) return false;
    return m.pad == null || m.pad < 0 || m.pad === e.pad;
  }

  function label(m, en) {
    if (!m || !(m.index >= 0)) return '—';
    const b = m.kind === 'axis' ? (en ? 'Axis ' : 'Eksen ') : (en ? 'Button ' : 'Düğme ');
    return b + m.index + (m.pad >= 0 ? ' · #' + (m.pad + 1) : '');
  }

  const api = { diff, learnFrom, matches, label, axis01 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVGamepadMap = api;
})();
