/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MIDI notasının eşlemeye giden değeri (#436): varsayılan açık/kapalı kalır, basma gücü
   yalnız eşlemede açıkça seçilince ve hedef bir ayarken kullanılır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/shared/controller-maps.js');

test('varsayılan eşleme eskisi gibi: basılı 1, bırakılmış 0, hız önemsiz', () => {
  const m = { kind: 'note', target: 'master' };
  assert.strictEqual(C.noteValue(0x90, 127, m), 1);
  assert.strictEqual(C.noteValue(0x90, 1, m), 1);
  assert.strictEqual(C.noteValue(0x93, 40, m), 1); // kanal 4
  assert.strictEqual(C.noteValue(0x90, 0, m), 0); // hızı 0 olan Note On = bırakma
  assert.strictEqual(C.noteValue(0x80, 64, m), 0);
  assert.strictEqual(C.noteValue(0x90, 64, null), 1);
});

test('basma gücü açıkken ayar hedefi hız/127 alır, bırakınca 0', () => {
  const m = { kind: 'note', target: 'master', velocity: true };
  assert.strictEqual(C.noteValue(0x90, 127, m), 1);
  assert.strictEqual(C.noteValue(0x90, 64, m), 64 / 127);
  assert.strictEqual(C.noteValue(0x90, 1, m), 1 / 127);
  assert.strictEqual(C.noteValue(0x80, 100, m), 0);
  assert.strictEqual(C.noteValue(0x90, 0, m), 0);
  // "true" dışındaki değerler açmaz (eski ya da bozuk kayıt)
  assert.strictEqual(C.noteValue(0x90, 64, { target: 'master', velocity: 'yes' }), 1);
});

test('eylemler basma gücünden etkilenmez: yumuşak vuruş da tetikler', () => {
  const m = { kind: 'note', target: 'action:blackout', velocity: true };
  assert.strictEqual(C.noteValue(0x90, 10, m), 1);
  assert.strictEqual(C.noteValue(0x80, 10, m), 0);
});

test('panel notaları bu işlevden geçiriyor, seçenek yalnız nota → ayar eşlemesinde', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'control.js'), 'utf8');
  assert.ok(src.includes("applyMapping(m, isNote ? CMAPS().noteValue(d[0], raw, m) : value01)"));
  assert.ok(/surface === 'midi' && m\.kind === 'note' && t && !t\.action/.test(src));
});
