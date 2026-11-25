/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* JSON farkı (src/shared/json-delta.js): PC bağlantısında büyük zaman çizelgesinin yalnız değişen
   yerleri gider. Fark uygulanınca hedefin aynısı çıkmalı, küçük kalmalı, bozuk ya da kötü niyetli
   işlem hiçbir şeyi değiştirmemeli. */
const test = require('node:test');
const assert = require('node:assert');
const J = require('../src/shared/json-delta.js');

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const clone = (v) => JSON.parse(JSON.stringify(v));

function timeline(tracks, clips) {
  const t = { id: 'tl1', name: 'D', useTimeline: false, enabled: false, tempo: [{ t: 0, bpm: 120 }], markers: [{ id: 'm1', t: 4, name: 'Drop' }], loop: null, bank: [], tracks: [] };
  for (let i = 0; i < tracks; i++) {
    const tr = { id: 'tr' + i, kind: 'clip', type: 'scene', name: 'İz ' + i, clips: [] };
    for (let j = 0; j < clips; j++) {
      tr.clips.push({ id: 'c' + i + '_' + j, start: j * 8, dur: 8, type: 'scene', ref: '', local: { from: { type: 'scene', ref: 's' + j }, data: { layers: [{ id: 'l' + j, kind: 'milkdrop', settings: { milkdrop: { source: 'per_frame_1=zoom=1.01;'.repeat(300) } } }] } } });
    }
    t.tracks.push(tr);
  }
  return t;
}

test('aynı değer: işlem yok; farkı uygulamak hedefi bire bir verir', () => {
  const a = timeline(3, 4);
  assert.deepStrictEqual(J.diff(a, clone(a)), []);
  const b = clone(a);
  b.useTimeline = true;
  b.tracks[1].clips[2].start = 17.5;
  delete b.loop;
  b.markers.push({ id: 'm2', t: 9, name: 'Son' });
  const ops = J.diff(a, b);
  assert.deepStrictEqual(J.apply(a, ops), b);
  assert.notStrictEqual(J.apply(a, ops), a);
  // Girdi değişmedi
  assert.deepStrictEqual(a, timeline(3, 4));
});

test('bir klibi kaydırmak çizelgenin tamamından çok küçük', () => {
  const a = timeline(6, 6);
  const b = clone(a);
  b.tracks[4].clips[3].start += 2;
  const ops = J.diff(a, b);
  assert.strictEqual(ops.length, 1);
  assert.deepStrictEqual(ops[0].p, ['tracks', { id: 'tr4' }, 'clips', { id: 'c4_3' }, 'start']);
  assert.ok(J.size(ops) < 200 && J.size(b) > 200000, J.size(ops) + ' / ' + J.size(b));
});

test('rastgele düzenlemeler: fark her seferinde hedefi verir', () => {
  for (let n = 0; n < 200; n++) {
    const a = timeline(1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 5));
    const b = clone(a);
    const tr = b.tracks[Math.floor(rnd() * b.tracks.length)];
    const k = rnd();
    if (k < 0.25) tr.clips[Math.floor(rnd() * tr.clips.length)].dur = Math.round(rnd() * 100) / 10;
    else if (k < 0.45) tr.clips.splice(Math.floor(rnd() * tr.clips.length), 1);
    else if (k < 0.6) tr.clips.push({ id: 'n' + n, start: 99, dur: 1, type: 'image', ref: 'x' });
    else if (k < 0.7) tr.clips.reverse();
    else if (k < 0.8) b.tracks.push({ id: 'tn' + n, kind: 'clip', clips: [] });
    else if (k < 0.9) { b.bank.push(clone(a)); b.name = 'E'; }
    else { tr.name = null; b.tempo[0].bpm = 128; }
    assert.deepStrictEqual(J.apply(a, J.diff(a, b)), b, 'düzenleme ' + n);
  }
});

test('kimlikle adresleme: araya giren sıralama değişikliği yanlış klibe yazdırmaz', () => {
  const a = timeline(1, 3);
  const b = clone(a);
  b.tracks[0].clips[1].start = 42; // c0_1
  const ops = J.diff(a, b);
  // PC'de bu arada klipler başka sıraya girmiş
  const pcNow = clone(a);
  pcNow.tracks[0].clips.reverse();
  const out = J.apply(pcNow, ops);
  assert.strictEqual(out.tracks[0].clips.find((c) => c.id === 'c0_1').start, 42);
  assert.strictEqual(out.tracks[0].clips.find((c) => c.id === 'c0_0').start, 0);
  // Klip PC'de silinmişse işlem uygulanmaz (null: çağıran tam değere döner)
  const gone = clone(a);
  gone.tracks[0].clips.splice(1, 1);
  assert.strictEqual(J.apply(gone, ops), null);
});

test('kötü niyetli ya da bozuk işlemler reddedilir, hiçbir şey değişmez', () => {
  const a = timeline(1, 1);
  const before = JSON.stringify(a);
  for (const ops of [
    null, {}, [{ p: ['__proto__', 'x'], v: 1 }], [{ p: ['constructor', 'prototype', 'x'], v: 1 }],
    [{ p: ['tracks', { id: 'tr0', x: 1 }], v: 1 }], [{ p: ['name'] }], [{ p: ['name'], v: 1, d: 1 }],
    [{ p: [], d: 1 }], [{ p: ['tracks', 3], v: 1 }], [{ p: ['tracks', { id: 'yok' }, 'x'], v: 1 }],
    [{ p: ['name', 'x'], v: 1 }], [{ p: new Array(60).fill('a'), v: 1 }],
  ]) {
    assert.strictEqual(J.apply(a, ops), null, JSON.stringify(ops));
  }
  assert.strictEqual(JSON.stringify(a), before);
  assert.strictEqual(({}).x, undefined);
  // Fark üretirken de tehlikeli anahtar yol olmaz (bütün nesne yazılır)
  const b = JSON.parse('{"o":{"__proto__":{"x":1}}}');
  const ops = J.diff({ o: {} }, b);
  assert.ok(ops.every((o) => !o.p.includes('__proto__')));
});

test('işlem sınırı aşılınca null (çağıran bütün değeri yollar)', () => {
  const a = { list: Array.from({ length: J.MAX_OPS + 10 }, (_, i) => ({ id: 'x' + i, v: 0 })) };
  const b = clone(a);
  for (const x of b.list) x.v = 1;
  assert.strictEqual(J.diff(a, b), null);
});
