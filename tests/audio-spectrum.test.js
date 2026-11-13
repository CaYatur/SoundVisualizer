/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ORTAK TAYF HESABI (#1054). src/shared/audio-spectrum.js, canlı yakalama
   yardımcısındaki ve dışa aktarım sayfasındaki iki kopyanın yerini aldı. Kareler
   bayt bayt aynı kalmalı: görselleştirici dB'yi baytlardan geri çeviriyor ve
   golden ölçüsü dışa aktarılan karelerin özetini tutuyor.

   REFERANS aşağıda, eski kodun (loopback-helper.js `emit`, exporter.js
   `analyzeAt`) DONDURULMUŞ kopyası. Değiştirilmemeli: amacı yeni modülün
   eskisiyle aynı baytları verdiğini kanıtlamak. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../src/shared/audio-spectrum.js');
const frame = require('../src/main/audio-frame.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- Dondurulmuş eski hesap ----
function legacy(ring) {
  const FFT_SIZE = 2048;
  const BINS = 1024;
  const MIN_DB = -90;
  const MAX_DB = -18;
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) { re[i] = ring[i] * hann[i]; im[i] = 0; }
  const n = FFT_SIZE;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const freq = new Uint8Array(BINS);
  const range = MAX_DB - MIN_DB;
  for (let i = 0; i < BINS; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_SIZE / 4);
    let db = 20 * Math.log10(mag + 1e-9);
    let v = (db - MIN_DB) / range;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    freq[i] = (v * 255) | 0;
  }
  const time = new Uint8Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let s = ring[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    time[i] = (128 + s * 127) | 0;
  }
  return { freq, time };
}

// Tekrarlanabilir gürültü (mulberry32)
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function signals() {
  const N = 2048;
  const make = (fn) => Float32Array.from({ length: N }, (_, i) => fn(i));
  const r = rng(1054);
  return {
    sessizlik: make(() => 0),
    'sinüs 440 Hz': make((i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000)),
    'bas + tiz': make((i) => 0.6 * Math.sin((2 * Math.PI * 55 * i) / 48000) + 0.2 * Math.sin((2 * Math.PI * 9000 * i) / 48000)),
    gürültü: make(() => r() * 2 - 1),
    'kırpılan (±3)': make((i) => 3 * Math.sin((2 * Math.PI * 100 * i) / 48000)),
    'çok sessiz': make((i) => 1e-7 * Math.sin(i)),
    'tek dürtü': make((i) => (i === 1024 ? 1 : 0)),
    'NaN içeren': make((i) => (i % 97 === 0 ? NaN : 0.3 * Math.sin(i / 7))),
  };
}

test('ortak tayf eski hesapla bayt bayt aynı', () => {
  const sp = S.create();
  for (const [name, ring] of Object.entries(signals())) {
    const want = legacy(ring);
    const got = new Uint8Array(S.BINS);
    sp.spectrum(ring, got, 0);
    assert.deepStrictEqual(Array.from(got), Array.from(want.freq), name + ': tayf farklı');
  }
});

test('ortak zaman baytları eski hesapla aynı (kırpma ve NaN dahil)', () => {
  for (const [name, ring] of Object.entries(signals())) {
    const want = legacy(ring);
    const got = new Uint8Array(S.FFT_SIZE);
    S.timeBytes(ring, got, 0);
    assert.deepStrictEqual(Array.from(got), Array.from(want.time), name + ': zaman baytları farklı');
  }
});

test('ofsetle yazım ve Node Buffer: canlı karenin yerleşimi', () => {
  const ring = signals()['bas + tiz'];
  const want = legacy(ring);
  const buf = Buffer.alloc(frame.FRAME_BYTES);
  S.create().spectrum(ring, buf, frame.OFFSET.freq);
  frame.writeTime(buf, frame.OFFSET.time, ring);
  assert.deepStrictEqual(Array.from(buf.subarray(frame.OFFSET.freq, frame.OFFSET.freq + 1024)), Array.from(want.freq));
  assert.deepStrictEqual(Array.from(buf.subarray(frame.OFFSET.time, frame.OFFSET.time + 2048)), Array.from(want.time));
  // Komşu bölgelere taşma yok
  assert.strictEqual(buf[frame.OFFSET.freq - 1], 0);
  assert.strictEqual(buf[frame.OFFSET.left], 0);
});

test('aynı hesaplayıcı art arda çağrılınca önceki çağrıdan iz kalmıyor', () => {
  const sp = S.create();
  const all = signals();
  const a = new Uint8Array(1024);
  const b = new Uint8Array(1024);
  sp.spectrum(all.gürültü, a, 0);
  sp.spectrum(all['sinüs 440 Hz'], a, 0);
  S.create().spectrum(all['sinüs 440 Hz'], b, 0);
  assert.deepStrictEqual(Array.from(a), Array.from(b));
});

test('sabitler görselleştiricinin dB geri dönüşümüyle uyumlu', () => {
  assert.strictEqual(S.FFT_SIZE, 2048);
  assert.strictEqual(S.BINS, 1024);
  assert.strictEqual(S.MIN_DB, -90);
  assert.strictEqual(S.MAX_DB, -18);
  const audio = read('src/visualizer/audio.js');
  assert.match(audio, /BYTE_DB0 = -90/);
  assert.match(audio, /BYTE_DB_RANGE = 72/);
  assert.strictEqual(frame.FFT_SIZE, S.FFT_SIZE);
  assert.strictEqual(frame.BINS, S.BINS);
});

test('FFT tek kopya: yakalama yardımcısı ve dışa aktarım ortak modülü kullanıyor', () => {
  const helper = read('src/main/loopback-helper.js');
  const exporter = read('src/exporter/exporter.js');
  assert.match(helper, /require\('\.\.\/shared\/audio-spectrum\.js'\)\.create\(\)/);
  assert.match(exporter, /window\.SVAudioSpectrum/);
  for (const [name, src] of [['loopback-helper.js', helper], ['exporter.js', exporter]]) {
    assert.doesNotMatch(src, /function fft\(/, name + ' kendi FFT kopyasını taşıyor');
    assert.doesNotMatch(src, /Math\.log10\(mag/, name + ' kendi dB hesabını taşıyor');
  }
});

test('halka tamponları ortak modülde; yakalama yardımcısı aynı sınıfı kullanıyor', () => {
  assert.strictEqual(frame.SourceRings, S.SourceRings);
  // Tarayıcıda da yükleniyor (Android sayfası): Node'a özgü bir şeye dayanmıyor
  const vm = require('node:vm');
  const ctx = { window: {}, Math, Float32Array };
  vm.createContext(ctx);
  vm.runInContext(read('src/shared/audio-spectrum.js'), ctx);
  const r = new ctx.window.SVAudioSpectrum.SourceRings();
  r.pushFloat32(Float32Array.from([0.5, -0.5, 0.25, 0.75]), 2);
  assert.strictEqual(r.mono[2047], 0.5);
  assert.strictEqual(r.left[2046], 0.5);
  assert.strictEqual(r.right[2046], -0.5);
});

test('dışa aktarım sayfası ortak modülü exporter.js\'ten önce yüklüyor', () => {
  const html = read('src/exporter/index.html');
  const a = html.indexOf('../shared/audio-spectrum.js');
  const b = html.indexOf('src="exporter.js"');
  assert.ok(a > 0 && b > a, 'audio-spectrum.js exporter.js\'ten önce gelmeli');
});
