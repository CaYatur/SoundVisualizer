'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../scripts/golden-lib');

test('kare farkı: uzunluk farkı da sayılıyor, ilk fark bildiriliyor', () => {
  assert.deepStrictEqual(G.diffFrames(['a', 'b'], ['a', 'b']), { frames: 2, diff: 0, first: -1 });
  assert.deepStrictEqual(G.diffFrames(['a', 'b', 'c'], ['a', 'x', 'c']), { frames: 3, diff: 1, first: 1 });
  assert.deepStrictEqual(G.diffFrames(['a'], ['a', 'b']), { frames: 2, diff: 1, first: 1 });
  assert.deepStrictEqual(G.diffFrames(null, undefined), { frames: 0, diff: 0, first: -1 });
});

const run = (cases) => ({ cases });
const F = (...frames) => ({ frames });

test('iki koşu: aynı, değişen ve eşsiz ayrı ayrı', () => {
  const a = run({ x: { nativeStack: false, asis: F('1', '2'), toggled: F('1', '2') }, y: { asis: F('5') }, z: { asis: F('9') } });
  const b = run({ x: { nativeStack: true, asis: F('1', '2'), toggled: F('1', '3') }, y: { asis: F('5'), toggled: F('5') }, n: { asis: F('7') } });
  const r = G.compareRuns(a, b);
  assert.strictEqual(r.same, 2);
  assert.deepStrictEqual(r.changed, [{ name: 'x', mode: 'toggled', frames: 2, diff: 1, first: 1 }]);
  const missing = r.missing.map((m) => m.name + '/' + (m.mode || '') + '/' + m.in).sort();
  assert.deepStrictEqual(missing, ['n//yalnız yeni', 'y/toggled/yalnız yeni', 'z//yalnız önceki']);
});

test('anahtar çevrilince fark yöne göre ayrılıyor, PSNR ile', () => {
  const r = G.modePairs(run({
    same: { nativeStack: false, asis: F('1'), toggled: F('1') },
    diff: { nativeStack: false, asis: F('1', '2'), toggled: Object.assign(F('1', '3'), { psnr: 41.5 }) },
    kat: { nativeStack: true, asis: F('1'), toggled: F('2') },
    tek: { nativeStack: false, asis: F('1') },
  }));
  assert.deepStrictEqual(r.classicToStack.same, ['same']);
  assert.deepStrictEqual(r.classicToStack.different, [{ name: 'diff', diff: 1, frames: 2, psnr: 41.5 }]);
  assert.deepStrictEqual(r.stackToClassic.different, [{ name: 'kat', diff: 1, frames: 1, psnr: null }]);
});
