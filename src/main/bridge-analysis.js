/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KÖPRÜNÜN ÇÖZÜMLEMESİ (#813). Köprü kareyi gönderirken bantları, seviyeyi,
   vuruşu, BPM'i ve başlangıçları (onset) da kendisi hesaplayıp yollar; her
   değer köprünün saatiyle damgalı. Alıcının pencereleri kareden kendi
   çözümlemesini yapmaya devam ediyor (aynı kare → aynı sayı); bu paket
   panelde, gösteri öncesi denetimde ve dışarıdan okunabilsin diye.

   Vuruş ve BPM görselleştiricinin kullandığı motorla (shared/tempo.js)
   aynı: tayf baytları onun beklediği `getBars` biçimine çevriliyor.
   Pencere, GPU ve DOM yok; köprü kipinde de çalışıyor. */

const { Tempo } = require('../shared/tempo');

const BANDS = Object.freeze({ bass: [20, 250], mid: [250, 4000], treble: [4000, 16000] });

function binOf(hz, sr, bins) {
  return Math.max(0, Math.min(bins - 1, Math.round(hz / (sr / 2) * bins)));
}

// Tayf baytları (0..255, dB ölçekli) → 0..1 ortalama
function bandMean(freq, sr, lo, hi) {
  const bins = freq.length;
  const a = binOf(lo, sr, bins);
  const b = Math.max(a + 1, binOf(hi, sr, bins));
  let s = 0;
  for (let i = a; i < b; i++) s += freq[i];
  return s / ((b - a) * 255);
}

// Tempo motorunun beklediği ses nesnesi: log aralıklı n çubuk
function audioView(freq, sr) {
  const cache = new Map();
  return {
    ready: true,
    getBars(n, lo, hi) {
      const key = n + '|' + lo + '|' + hi;
      if (cache.has(key)) return cache.get(key);
      const out = new Float32Array(n);
      const r = Math.log(hi / lo);
      for (let i = 0; i < n; i++) {
        const f0 = lo * Math.exp(r * i / n);
        const f1 = lo * Math.exp(r * (i + 1) / n);
        out[i] = bandMean(freq, sr, f0, Math.max(f1, f0 + 1));
      }
      cache.set(key, out);
      return out;
    },
  };
}

function rms(time) {
  if (!time || !time.length) return { level: 0, peak: 0 };
  let s = 0;
  let p = 0;
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128;
    s += v * v;
    const a = v < 0 ? -v : v;
    if (a > p) p = a;
  }
  return { level: Math.sqrt(s / time.length), peak: p };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

function createAnalyser() {
  const tempo = new Tempo();
  let lastT = 0;
  let onsets = 0;
  return {
    /* Bir kare: `t` köprünün saati (ms). Dönen nesne doğrudan yollanır. */
    push(frame, t) {
      if (!frame || !frame.freq || !frame.freq.length) return null;
      const sr = frame.sampleRate || 48000;
      const dt = lastT ? Math.max(0.001, Math.min(0.25, (t - lastT) / 1000)) : 1 / 60;
      lastT = t;
      const beat = tempo.update(audioView(frame.freq, sr), t / 1000, dt);
      if (beat) onsets++;
      const lv = rms(frame.time);
      return {
        t,
        level: r3(lv.level), peak: r3(lv.peak),
        bands: {
          bass: r3(bandMean(frame.freq, sr, BANDS.bass[0], BANDS.bass[1])),
          mid: r3(bandMean(frame.freq, sr, BANDS.mid[0], BANDS.mid[1])),
          treble: r3(bandMean(frame.freq, sr, BANDS.treble[0], BANDS.treble[1])),
        },
        beat: !!beat,
        bpm: Math.round((tempo.bpm || 0) * 10) / 10,
        confidence: r3(tempo.confidence || 0),
        phase: r3(tempo.phase || 0),
        bar: tempo.barPosition | 0,
        onset: r3(tempo.energy || 0),
        onsets,
      };
    },
    reset() { tempo.reset(); lastT = 0; onsets = 0; },
  };
}

module.exports = { createAnalyser, bandMean, audioView, rms, BANDS };
