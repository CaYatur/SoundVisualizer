/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* LOGO DEĞİŞİMİ (#535). Aynı videoda bir bölümde etiket logosu, başka
   bölümde albüm kapağı: logo kitaplığından seçilen görseller bir kurala göre
   sırayla değişir.

   Kurallar:
     seconds — her N saniyede bir
     bars    — her N ölçüde bir (BPM: çizelge açıksa onun temposu, değilse
               kilitli tempo, o da yoksa 120 — yapılandırmadan, belirlenimli)
     bass    — bas vuruşunda (en az `hold` saniye arayla)
     random  — [min, max] saniye arasında rastgele aralıklarla

   Canlı çıktı ve dışa aktarım AYNI sırayı vermeli (#539). Bu yüzden zamana
   bağlı kurallar durumsuz: hangi dilimde olunduğu ve dilimin görseli
   doğrudan `t`'den hesaplanır, rastgelelik de dilim numarasından türeyen bir
   karmadır (Math.random yok). Bas kuralı sesin kendisine bağlı; aynı sesle
   aynı sırayı verir. Geçiş çapraz (süre `fade`) ya da kesme. */
(function () {
  const RULES = ['seconds', 'bars', 'bass', 'random'];
  const DEFAULTS = {
    enabled: false, items: [], rule: 'seconds', every: 8,
    min: 4, max: 12, hold: 1, threshold: 0.5, transition: 'fade', fade: 0.6, seed: 1,
  };

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function normalize(sw) {
    const s = Object.assign({}, DEFAULTS, sw || {});
    s.items = Array.isArray(s.items) ? s.items.filter((x) => typeof x === 'string' && x).slice(0, 64) : [];
    if (RULES.indexOf(s.rule) < 0) s.rule = 'seconds';
    s.every = clamp(num(s.every, 8), 0.25, 3600);
    s.min = clamp(num(s.min, 4), 0.25, 3600);
    s.max = Math.max(s.min, clamp(num(s.max, 12), 0.25, 3600));
    s.hold = clamp(num(s.hold, 1), 0, 60);
    s.threshold = clamp(num(s.threshold, 0.5), 0, 1);
    s.fade = s.transition === 'cut' ? 0 : clamp(num(s.fade, 0.6), 0, 10);
    s.seed = Math.round(num(s.seed, 1));
    return s;
  }

  function active(sw) {
    return !!(sw && sw.enabled && Array.isArray(sw.items) && sw.items.length >= 2);
  }

  // Ölçü kuralının temposu: yapılandırmadan (canlı tempo kestirimi dışa
  // aktarımda aynı olmayabilir)
  function bpmOf(cfg) {
    const tl = cfg && cfg.timeline;
    if (tl && tl.enabled && Array.isArray(tl.tempo) && tl.tempo[0] && tl.tempo[0].bpm > 0) {
      return { bpm: tl.tempo[0].bpm, beatsPerBar: tl.tempo[0].beatsPerBar || 4 };
    }
    const lock = cfg && cfg.autovj && cfg.autovj.bpmLock;
    if (lock > 0) return { bpm: lock, beatsPerBar: (cfg.autovj.beatsPerBar || 4) };
    const mb = cfg && cfg.modulation && cfg.modulation.bpm;
    if (mb > 0) return { bpm: mb, beatsPerBar: 4 };
    return { bpm: 120, beatsPerBar: 4 };
  }

  // Tam sayı karması → [0, 1)
  function hash01(n) {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }

  /* Zamana bağlı kurallarda dilim: { k: dilim numarası, start: başladığı
     saniye }. Rastgele kuralda dilim uzunlukları karmadan; önbellek bir
     önceki sonuçtan ileri yürür (her karede baştan toplamaz). */
  function slotAt(s, cfg, t, cache) {
    const tt = Math.max(0, t);
    if (s.rule === 'seconds' || s.rule === 'bars') {
      let len = s.every;
      if (s.rule === 'bars') {
        const b = bpmOf(cfg);
        len = s.every * b.beatsPerBar * 60 / b.bpm;
      }
      const k = Math.floor(tt / len);
      return { k, start: k * len };
    }
    // random
    const lenOf = (k) => s.min + hash01(s.seed * 7919 + k) * (s.max - s.min);
    let c = cache && cache.rnd && cache.rnd.seed === s.seed && cache.rnd.min === s.min && cache.rnd.max === s.max && cache.rnd.start <= tt
      ? cache.rnd : { k: 0, start: 0, seed: s.seed, min: s.min, max: s.max };
    let guard = 0;
    while (c.start + lenOf(c.k) <= tt && guard < 100000) {
      c = { k: c.k + 1, start: c.start + lenOf(c.k), seed: c.seed, min: c.min, max: c.max };
      guard++;
    }
    if (cache) cache.rnd = c;
    return { k: c.k, start: c.start };
  }

  // Dilimin görseli: sıralı kurallarda sırayla, rastgelede bir öncekinden farklı
  function itemFor(s, k) {
    const n = s.items.length;
    if (s.rule !== 'random') return ((k % n) + n) % n;
    if (k <= 0) return 0;
    const prev = itemFor(s, k - 1);
    const r = Math.floor(hash01(s.seed * 104729 + k * 31) * (n - 1));
    return r >= prev ? r + 1 : r;
  }

  /* Bu karede çizilecekler: { cur, prev, k } — cur/prev kitaplık kimliği,
     k geçiş ilerlemesi (1 = yalnız cur). `state` katman başına tutulur
     (bas kuralının sayacı ve rastgele dilim önbelleği). */
  function step(state, swIn, cfg, t, audio) {
    const s = normalize(swIn);
    if (!active(s)) return null;
    const st = state || {};
    let idx;
    let prevIdx;
    let since;
    if (s.rule === 'bass') {
      if (st.idx == null || st.sig !== s.items.join('|')) {
        st.idx = 0; st.prevIdx = null; st.at = t; st.sig = s.items.join('|');
      }
      // Zaman geri sardıysa (dışa aktarım baştan) sayaç da baştan
      if (t < st.at) { st.idx = 0; st.prevIdx = null; st.at = t; }
      const hits = audio && audio.analysis && audio.analysis.hits;
      const kick = hits ? num(hits.kick, 0) : 0;
      if (kick >= s.threshold && kick > 0 && t - st.at >= s.hold) {
        st.prevIdx = st.idx;
        st.idx = (st.idx + 1) % s.items.length;
        st.at = t;
      }
      idx = st.idx; prevIdx = st.prevIdx; since = t - st.at;
    } else {
      const sl = slotAt(s, cfg, t, st);
      idx = itemFor(s, sl.k);
      prevIdx = sl.k > 0 ? itemFor(s, sl.k - 1) : null;
      since = t - sl.start;
    }
    const k = s.fade > 0 && prevIdx != null ? clamp(since / s.fade, 0, 1) : 1;
    return { cur: s.items[idx], prev: k < 1 && prevIdx != null ? s.items[prevIdx] : null, k };
  }

  const api = { RULES, DEFAULTS, normalize, active, bpmOf, slotAt, itemFor, step, hash01 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVLogoSwap = api;
})();
