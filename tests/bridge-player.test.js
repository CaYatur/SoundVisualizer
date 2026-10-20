/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Köprü sesinin çalınma zamanlaması (#813): src/bridge-audio/player-core.js
const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/bridge-audio/player-core.js');

test('çalıcı: parçalar ardışık, boşalınca tampon yeniden kuruluyor, birikince atılıyor', () => {
  const s = core.createScheduler({ latency: 0.1 });
  const d = 512 / 48000;
  const a = s.place(0, d);
  assert.ok(Math.abs(a - 0.1) < 1e-9, 'ilk parça gecikme kadar ileride');
  const b = s.place(0.001, d);
  assert.ok(Math.abs(b - (0.1 + d)) < 1e-9, 'ardışık');
  // Ağ takıldı: şimdiki an tamponun ötesine geçti
  const c = s.place(1, d);
  assert.ok(Math.abs(c - 1.1) < 1e-9);
  assert.strictEqual(s.status().underruns, 1);
  // Patlama: 0,3 sn + bir parçadan fazlası birikirse atılır
  let dropped = 0;
  for (let i = 0; i < 100; i++) if (s.place(1, d) == null) dropped++;
  assert.ok(dropped > 0);
  assert.ok(s.buffered(1) <= 0.1 * 3 + 2 * d + 1e-9);
  assert.strictEqual(s.status().dropped, dropped);
});

test('çalıcı: s16 araya serpiştirilmiş -> kanallar', () => {
  const b = Buffer.alloc(8);
  b.writeInt16LE(16384, 0); b.writeInt16LE(-32768, 2); b.writeInt16LE(0, 4); b.writeInt16LE(32767, 6);
  const [l, r] = core.deinterleave(new Uint8Array(b.buffer, b.byteOffset, b.length), 2);
  assert.deepStrictEqual(Array.from(l), [0.5, 0]);
  assert.strictEqual(r[0], -1);
  assert.ok(Math.abs(r[1] - 32767 / 32768) < 1e-9);
});
