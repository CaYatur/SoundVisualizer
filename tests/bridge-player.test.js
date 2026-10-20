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

test('çalıcı: kayma denetimi tamponu hedefe geri indiriyor (köprünün saati hızlı)', () => {
  const s = core.createScheduler({ latency: 0.12 });
  const d = 480 / 48000; // 10 ms
  let now = 0;
  // Köprü %2 hızlı: her 10 ms'lik parça 9,8 ms'de geliyor, 60 sn boyunca
  for (let i = 0; i < 6000; i++) { s.place(now, d); now += d * 0.98; }
  const buf = s.buffered(now);
  assert.ok(buf <= 0.12 + 0.03 + 1e-9, 'tampon hedefin yakınında kalıyor: ' + Math.round(buf * 1000) + ' ms');
  assert.ok(buf >= 0.1, 'tampon boşalmıyor');
  assert.ok(s.status().trimmed > 0 && s.status().trimmed < 200, 'küçük atlamalar: ' + s.status().trimmed);
  assert.strictEqual(s.status().underruns, 0);
  // Çıkış değişince 250 ms birikmiş gibi: bir saniye içinde hedefe iner
  for (let i = 0; i < 25; i++) s.place(now, d);
  assert.ok(s.buffered(now) > 0.3);
  for (let i = 0; i < 150; i++) { s.place(now, d); now += d; }
  assert.ok(s.buffered(now) <= 0.12 + 0.03 + 1e-9, 'çıkış değişiminden sonra ' + Math.round(s.buffered(now) * 1000) + ' ms');
  // Toplu gelen parçalar (50 ms'de bir 5'li) atılmaz
  const s3 = core.createScheduler({ latency: 0.12 });
  let t3 = 0;
  for (let i = 0; i < 400; i++) { for (let k = 0; k < 5; k++) s3.place(t3, d); t3 += 5 * d; }
  assert.strictEqual(s3.status().trimmed, 0);
  assert.strictEqual(s3.status().underruns, 0);
  // Ağ seğirmesi (hedefin altında) dokunulmaz
  const s2 = core.createScheduler({ latency: 0.12 });
  let t2 = 0;
  for (let i = 0; i < 1000; i++) { s2.place(t2, d); t2 += d * (i % 2 ? 1.3 : 0.7); }
  assert.strictEqual(s2.status().trimmed, 0);
});

test('çalıcı: s16 araya serpiştirilmiş -> kanallar', () => {
  const b = Buffer.alloc(8);
  b.writeInt16LE(16384, 0); b.writeInt16LE(-32768, 2); b.writeInt16LE(0, 4); b.writeInt16LE(32767, 6);
  const [l, r] = core.deinterleave(new Uint8Array(b.buffer, b.byteOffset, b.length), 2);
  assert.deepStrictEqual(Array.from(l), [0.5, 0]);
  assert.strictEqual(r[0], -1);
  assert.ok(Math.abs(r[1] - 32767 / 32768) < 1e-9);
});
