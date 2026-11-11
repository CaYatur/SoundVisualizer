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
  const r = G.compareRuns(run({ x: F('1', '2'), y: F('5'), z: F('9') }), run({ x: F('1', '3'), y: F('5'), n: F('7') }));
  assert.strictEqual(r.same, 1);
  assert.deepStrictEqual(r.changed, [{ name: 'x', frames: 2, diff: 1, first: 1 }]);
  assert.deepStrictEqual(r.missing.map((m) => m.name + '/' + m.in).sort(), ['n/yalnız yeni', 'z/yalnız önceki']);
});
