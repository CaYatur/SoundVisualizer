/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SES GİRİŞİ: uygulamadan gelen ham sesten masaüstü ses karesi.

   Masaüstünde kareyi yakalama yardımcısı kuruyor (loopback-helper.js). Android'de
   uygulama yalnız PCM yolluyor; kare burada, AYNI halka tamponları ve AYNI tayf
   hesabıyla kuruluyor (src/shared/audio-spectrum.js). Böylece bir sahne telefonda
   da masaüstündeki sayıları görüyor.

   Masaüstündeki gibi her 512 örneklik blok bir kare üretir. Visualizer yedeği
   (WAVE) sürekli ses değil, saniyede ~20 kısa anlık görüntü; onlar da aynı
   halkaya yazılır, kare sayısı azdır. */
(function () {
  const SPEC = typeof window !== 'undefined' && window.SVAudioSpectrum
    ? window.SVAudioSpectrum
    : require('../shared/audio-spectrum.js');

  function create(onFrame) {
    const rings = new SPEC.SourceRings();
    const spectrum = SPEC.create();
    const frame = {
      freq: new Uint8Array(SPEC.BINS),
      time: new Uint8Array(SPEC.FFT_SIZE),
      left: new Uint8Array(SPEC.FFT_SIZE),
      right: new Uint8Array(SPEC.FFT_SIZE),
      sampleRate: 48000,
    };
    let f32 = new Float32Array(0);
    const stats = { frames: 0, pcm: 0, wave: 0, gaps: 0, source: null, lastSeq: -1 };

    function emit(sampleRate) {
      spectrum.spectrum(rings.mono, frame.freq, 0);
      SPEC.timeBytes(rings.mono, frame.time, 0);
      SPEC.timeBytes(rings.left, frame.left, 0);
      SPEC.timeBytes(rings.right, frame.right, 0);
      frame.sampleRate = sampleRate;
      stats.frames++;
      onFrame(frame);
    }

    function seq(s) {
      if (stats.lastSeq >= 0 && s !== ((stats.lastSeq + 1) >>> 0)) stats.gaps++;
      stats.lastSeq = s;
    }

    return {
      stats,
      /* readPcm() sonucu. 16 bit örnekler -1..1'e (÷32768) çevrilir: masaüstündeki
         yakalama float32 veriyor, ölçek aynı. */
      pushPcm(m) {
        seq(m.seq);
        stats.pcm++;
        stats.source = m.source;
        const s = m.samples;
        if (f32.length !== s.length) f32 = new Float32Array(s.length);
        if (s instanceof Float32Array) f32.set(s);
        else for (let i = 0; i < s.length; i++) f32[i] = s[i] / 32768;
        rings.pushFloat32(f32, m.channels);
        emit(m.sampleRate || 48000);
      },
      /* readWave() sonucu: 128 merkezli baytlar, tek kanal. */
      pushWave(m) {
        stats.wave++;
        stats.source = 'visualizer';
        const w = m.wave;
        if (f32.length !== w.length) f32 = new Float32Array(w.length);
        for (let i = 0; i < w.length; i++) f32[i] = (w[i] - 128) / 128;
        rings.pushFloat32(f32, 1);
        emit(m.sampleRate || 48000);
      },
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SVAudioInput = api;
})();
