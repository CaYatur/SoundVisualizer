/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* ANDROID SES GİRİŞİ (src/mobile/messages.js, src/mobile/audio-input.js).

   Telefondaki kare, masaüstündeki yakalama yardımcısının kuracağı kareyle
   aynı olmalı: aynı halka tamponu, aynı tayf. Burada aynı ses iki yoldan
   geçiriliyor ve kareler bayt bayt karşılaştırılıyor. Ayrıca ikili ileti
   biçiminin örnek dosyaları yazılıyor; Kotlin birim testi aynı dosyaları
   çözüyor (MESSAGES.md, çapraz test). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../../src/mobile/messages.js');
const Input = require('../../src/mobile/audio-input.js');
const SPEC = require('../../src/shared/audio-spectrum.js');
const frameFormat = require('../../src/main/audio-frame.js');

const FIX = path.join(__dirname, 'fixtures');

function tone(frames, ch, f1, f2, start) {
  const s = new Int16Array(frames * ch);
  for (let i = 0; i < frames; i++) {
    const t = (start + i) / 48000;
    s[i * ch] = Math.round(12000 * Math.sin(2 * Math.PI * f1 * t));
    if (ch > 1) s[i * ch + 1] = Math.round(9000 * Math.sin(2 * Math.PI * f2 * t));
  }
  return s;
}

test('PCM iletisi yazılıp okunuyor', () => {
  const s = tone(512, 2, 440, 880, 0);
  const buf = M.pcmS16(41, 12.5, 48000, 2, 2, s);
  const h = M.readHeader(buf);
  assert.deepStrictEqual({ ...h }, { type: M.TYPE_PCM, seq: 41, time: 12.5 });
  const p = M.readPcm(buf);
  assert.strictEqual(p.sampleRate, 48000);
  assert.strictEqual(p.channels, 2);
  assert.strictEqual(p.source, 'capture');
  assert.deepStrictEqual(Array.from(p.samples), Array.from(s));
});

test('bozuk iletiler reddediliyor', () => {
  assert.strictEqual(M.readHeader(new ArrayBuffer(15)), null);
  const bad = new Uint8Array(16);
  bad[0] = 0x53; bad[1] = 0x57; bad[2] = 1;
  assert.strictEqual(M.readHeader(bad.buffer), null);
  bad[1] = 0x56; bad[2] = 2;
  assert.strictEqual(M.readHeader(bad.buffer), null);
  assert.strictEqual(M.readPcm(new Uint8Array([0x53, 0x56, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), null);
});

test('telefondaki kare masaüstü yardımcısının karesiyle bayt bayt aynı', () => {
  const frames = [];
  const input = Input.create((f) => frames.push({ freq: Array.from(f.freq), time: Array.from(f.time), left: Array.from(f.left), right: Array.from(f.right) }));
  // Masaüstü yolu: aynı halka, aynı tayf, aynı kare yerleşimi (loopback-helper emit)
  const rings = new SPEC.SourceRings();
  const sp = SPEC.create();
  const out = Buffer.alloc(frameFormat.FRAME_BYTES);
  for (let b = 0; b < 6; b++) {
    const s = tone(512, 2, 110, 3500, b * 512);
    input.pushPcm(M.readPcm(M.pcmS16(b, b, 48000, 2, 2, s)));
    const f = Float32Array.from(s, (x) => x / 32768);
    rings.pushFloat32(f, 2);
    sp.spectrum(rings.mono, out, frameFormat.OFFSET.freq);
    frameFormat.writeTime(out, frameFormat.OFFSET.time, rings.mono);
    frameFormat.writeTime(out, frameFormat.OFFSET.left, rings.left);
    frameFormat.writeTime(out, frameFormat.OFFSET.right, rings.right);
    const want = frameFormat.parseFrame(out);
    const got = frames[b];
    assert.deepStrictEqual(got.freq, Array.from(want.freq), 'blok ' + b + ' tayf');
    assert.deepStrictEqual(got.time, Array.from(want.time), 'blok ' + b + ' mono');
    assert.deepStrictEqual(got.left, Array.from(want.left), 'blok ' + b + ' sol');
    assert.deepStrictEqual(got.right, Array.from(want.right), 'blok ' + b + ' sağ');
  }
  assert.strictEqual(input.stats.frames, 6);
  assert.strictEqual(input.stats.gaps, 0);
});

test('sıra numarasındaki boşluk sayılıyor', () => {
  const input = Input.create(() => {});
  const s = tone(512, 2, 440, 440, 0);
  input.pushPcm(M.readPcm(M.pcmS16(1, 0, 48000, 2, 3, s)));
  input.pushPcm(M.readPcm(M.pcmS16(3, 0, 48000, 2, 3, s)));
  assert.strictEqual(input.stats.gaps, 1);
  assert.strictEqual(input.stats.source, 'mic');
});

test('Visualizer dalgası kareye çevriliyor', () => {
  const frames = [];
  const input = Input.create((f) => frames.push(Array.from(f.time)));
  const w = new Uint8Array(1024).map((_, i) => 128 + Math.round(100 * Math.sin(i / 10)));
  const buf = new ArrayBuffer(M.HEADER_BYTES + M.WAVE_HEADER_BYTES + w.length);
  const v = new DataView(buf);
  M.writeHeader(v, M.TYPE_WAVE, 0, 0);
  v.setUint32(16, 44100, true);
  v.setUint16(20, w.length, true);
  new Uint8Array(buf, 24).set(w);
  const m = M.readWave(buf);
  assert.strictEqual(m.sampleRate, 44100);
  input.pushWave(m);
  assert.strictEqual(frames.length, 1);
  // Anlık görüntü halkanın sonunda; zaman baytları yaklaşık aynı dalgayı veriyor
  const tail = frames[0].slice(2048 - 1024);
  for (let i = 0; i < 1024; i += 97) assert.ok(Math.abs(tail[i] - w[i]) <= 1, 'örnek ' + i);
});

test('çapraz test dosyaları: Kotlin birim testi aynı baytları çözüyor', () => {
  /* Dosya depoda; biçim değişirse bu test düşer ve dosya bilerek yeniden
     üretilir (silip testi koşmak). Kotlin tarafı: MessagesTest.fixtureFromJs. */
  const file = path.join(FIX, 'pcm-s16.bin');
  const pcm = Buffer.from(M.pcmS16(0xfffffffe, 1234.5, 48000, 2, 2, Int16Array.from([1, -1, 32767, -32768])));
  if (!fs.existsSync(file)) { fs.mkdirSync(FIX, { recursive: true }); fs.writeFileSync(file, pcm); }
  assert.deepStrictEqual(Array.from(fs.readFileSync(file)), Array.from(pcm));
});
