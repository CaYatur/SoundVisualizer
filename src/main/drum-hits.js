/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Kick, trampet ve hi-hat. Yakalama yardımcısının yazdığı tayf karesi ana
   sürece ulaşır ulaşmaz çalışır. Çizim karesini beklemez: kare hızı sınırı
   bir vuruşu 30 ms'den fazla tutabiliyordu.

   WASAPI geri çağrısının kendisi yalnız örnek kopyalar. Algılayıcı o iş
   parçacığında değil, aynı karenin ana süreçteki tesliminde koşar. Ses
   iş parçacığına FFT bindirmek kesinti yapardı. Bantlar ve eşikler
   src/shared/analysis.js ile aynıdır. */

const { Onset } = require('../shared/onset.js');

const FFT_SIZE = 2048;

function bandEnergy(spec, binHz, f0, f1) {
  const i0 = Math.max(1, Math.floor(f0 / binHz));
  const i1 = Math.min(spec.length - 1, Math.ceil(f1 / binHz));
  if (i1 < i0) return 0;
  let s = 0;
  for (let i = i0; i <= i1; i++) s += spec[i] * spec[i];
  return Math.sqrt(s / (i1 - i0 + 1));
}

class DrumHits {
  constructor() {
    this.kick = new Onset({ refractory: 0.09, floor: 0.3, gate: 0.008 });
    this.snare = new Onset({ refractory: 0.09, floor: 0.3, gate: 0.008 });
    this.hat = new Onset({ refractory: 0.045, floor: 0.3, gate: 0.008 });
    this.lastAt = 0;
    this.sent = { kick: 0, snare: 0, hat: 0 };
    this.spec = new Float32Array(FFT_SIZE / 2);
  }

  /* freq: 1024 bayt, 0..255. now: ms. Değişmediyse null. Kapanış 0 da
     bir değişikliktir ve bir kez döner. */
  push(freq, sampleRate, now) {
    if (!freq || freq.length < 8) return null;
    const sr = sampleRate > 1000 ? sampleRate : 48000;
    const binHz = sr / FFT_SIZE;
    const n = Math.min(freq.length, this.spec.length);
    const spec = this.spec;
    for (let i = 0; i < n; i++) spec[i] = freq[i] / 255;
    const dt = this.lastAt ? Math.min(0.25, Math.max(0.001, (now - this.lastAt) / 1000)) : 0.014;
    this.lastAt = now;
    const hits = {
      kick: this.kick.push(bandEnergy(spec, binHz, 30, 130), dt),
      snare: this.snare.push(bandEnergy(spec, binHz, 180, 900), dt),
      hat: this.hat.push(bandEnergy(spec, binHz, 6000, 14000), dt),
    };
    let changed = false;
    for (const k of ['kick', 'snare', 'hat']) {
      if ((hits[k] > 0 || this.sent[k] > 0) && hits[k] !== this.sent[k]) changed = true;
    }
    if (!changed) return null;
    this.sent = hits;
    return hits;
  }
}

module.exports = { DrumHits, bandEnergy, FFT_SIZE };
