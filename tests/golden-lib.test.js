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

test('--repeat: aynı durumun iki dışa aktarımı karşılaştırılıyor (#467)', () => {
  const G2 = require('../scripts/golden-lib.js');
  assert.deepStrictEqual(G2.repeatCheck(['a', 'b', 'c'], ['a', 'b', 'c']), { same: true, diff: 0, frames: 3 });
  assert.deepStrictEqual(G2.repeatCheck(['a', 'b', 'c'], ['a', 'x', 'c']), { same: false, diff: 1, frames: 3 });
  assert.strictEqual(G2.repeatCheck(['a', 'b'], ['a']).same, false, 'eksik kare de fark');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'golden.js'), 'utf8');
  assert.match(src, /const REPEAT = argv\.includes\('--repeat'\);/);
  assert.match(src, /run\.cases\[key\]\.repeat = r;/);
  assert.match(src, /if \(unstable\.length\) process\.exitCode = 1;/);
  assert.match(src, /KABUL ETME: koşu `<klasör>\/golden\.json` yazar\./, 'bilerek yapılan farkın nasıl kabul edildiği yazılı (#461)');
});
