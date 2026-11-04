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
             target, min, max,
             // analog ayrıntı (eksen → sürekli ayar); yoksa varsayılanlar
             mode: 'abs' | 'rel', range: 'full' | 'pos' | 'neg', deadzone, curve: 'linear' | 'expo',
             expo, invert, smooth (0..0.95), rate (göreli kipte saniyede tam aralık) } */
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

  /* Analog seçenekleri: eksik ya da bozuk alanlar güvenli varsayılana döner. */
  const OPTS = { mode: 'abs', range: 'full', deadzone: DEAD, curve: 'linear', expo: 2, invert: false, smooth: 0, rate: 0.5 };
  function clampNum(v, lo, hi, d) { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
  function opts(m) {
    const o = m || {};
    return {
      mode: o.mode === 'rel' ? 'rel' : 'abs',
      range: o.range === 'pos' || o.range === 'neg' ? o.range : 'full',
      deadzone: clampNum(o.deadzone, 0, 0.9, OPTS.deadzone),
      curve: o.curve === 'expo' ? 'expo' : 'linear',
      expo: clampNum(o.expo, 1, 5, OPTS.expo),
      invert: !!o.invert,
      smooth: clampNum(o.smooth, 0, 0.95, 0),
      rate: clampNum(o.rate, 0.01, 10, OPTS.rate),
    };
  }

  /* Ham eksen (-1..1) → biçimlenmiş iki yönlü değer (-1..1): ölü bölge (kalanı yeniden ölçekler,
     sıçrama olmaz), ters çevirme, üstel eğri. */
  function shape(m, raw) {
    const o = opts(m);
    let v = Math.max(-1, Math.min(1, Number(raw) || 0));
    const a = Math.abs(v);
    v = a <= o.deadzone ? 0 : Math.sign(v) * (a - o.deadzone) / (1 - o.deadzone);
    if (o.invert) v = -v;
    if (o.curve === 'expo') v = Math.sign(v) * Math.pow(Math.abs(v), o.expo);
    return v;
  }

  /* Mutlak kip: biçimlenmiş değer → 0..1. 'pos' / 'neg' eksenin yalnız bir yarısını kullanır
     (tetik ya da çubuğun tek yönü). */
  function abs01(m, raw) {
    const o = opts(m);
    const v = shape(m, raw);
    if (o.range === 'pos') return Math.max(0, v);
    if (o.range === 'neg') return Math.max(0, -v);
    return (v + 1) / 2;
  }

  /* Göreli kip: çubuk tutuldukça değer artar ya da azalır; bırakınca yerinde kalır. dt milisaniye. */
  function relStep(m, cur01, raw, dt) {
    const o = opts(m);
    let v = shape(m, raw);
    if (o.range === 'pos') v = Math.max(0, v);
    else if (o.range === 'neg') v = -Math.max(0, -v);
    const next = (Number(cur01) || 0) + v * o.rate * (Math.max(0, Number(dt) || 0) / 1000);
    return Math.max(0, Math.min(1, next));
  }

  /* Yumuşatma: kare hızından bağımsız üstel yaklaşma (16 ms'lik adıma göre). */
  function smoothTo(m, prev, target, dt) {
    const k = opts(m).smooth;
    if (!k || prev == null || !Number.isFinite(prev)) return target;
    const f = Math.pow(k, Math.max(0, Number(dt) || 0) / 16);
    return target + (prev - target) * f;
  }

  /* Durumdan eşlemenin ham değeri: pad -1 ise en çok sapan kumanda. */
  function rawOf(m, state) {
    let best = null;
    const tag = (m.kind === 'axis' ? ':a:' : ':b:') + m.index;
    for (const k of Object.keys(state || {})) {
      if (!k.endsWith(tag)) continue;
      const p = Number(k.slice(0, k.indexOf(':')));
      if (m.pad != null && m.pad >= 0 && m.pad !== p) continue;
      const v = Number(state[k]) || 0;
      if (best == null || Math.abs(v) > Math.abs(best)) best = v;
    }
    return best;
  }

  const api = { diff, learnFrom, matches, label, axis01, opts, shape, abs01, relStep, smoothTo, rawOf, OPTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVGamepadMap = api;
})();
