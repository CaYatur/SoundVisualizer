'use strict';
/* Uyarlanır çözünürlük basamağı (#453) görüntüyü baştan başlatmıyor: tuval boyutu değişince
   geri besleme tamponları, iz tamponları ve piksel koordinatlı parçacıklar taşınıyor.
   Ölçüldü: önceden MilkDrop basamak karesinde kararıyordu (ortalama parlaklık 13 → 7), akış
   alanı izlerini ve parçacıklarını yeniden tohumluyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('rescale: piksel koordinatları yeni boyuta orantılı taşınır, ilk çağrı yalnız kaydeder', () => {
  global.window = global.window || {};
  delete require.cache[require.resolve('../src/visualizer/modes/generative.js')];
  require('../src/visualizer/modes/generative.js');
  const { rescale } = global.window.SVGenUtil;
  const self = {};
  const xs = new Float32Array([100, 200]);
  const ys = new Float32Array([50, 80]);
  rescale(self, 1000, 500, [xs], [ys]);
  assert.deepStrictEqual(Array.from(xs), [100, 200], 'ilk çağrı dokunmaz');
  rescale(self, 900, 400, [xs], [ys]);
  assert.deepStrictEqual(Array.from(xs).map(Math.round), [90, 180]);
  assert.deepStrictEqual(Array.from(ys).map(Math.round), [40, 64]);
  rescale(self, 900, 400, [xs], [ys]);
  assert.deepStrictEqual(Array.from(xs).map(Math.round), [90, 180], 'boyut aynıysa dokunmaz');
});

test('boyut değişiminde durum silen resize() kalmadı (görselleştirici modları)', () => {
  for (const f of ['generative.js', 'generative2.js']) {
    const src = read('src/visualizer/modes/' + f);
    assert.doesNotMatch(src, /resize\(\) \{ [^}]*(init = false|trail = null|ropes = null|flip = null|life\.fill\(0\)|this\.n = 0)/, f);
  }
  const g = read('src/visualizer/modes/generative.js');
  assert.match(g, /rescale\(this, W, H, \[this\.px\], \[this\.py\]\);/, 'akış alanı');
  assert.match(g, /rescale\(this, W, H, \[this\.x, this\.vx\], \[this\.y, this\.vy\]\);/, 'sürü');
  assert.match(g, /for \(const pts of this\.ropes\) for \(const p of pts\) \{ p\.x \*= kx; p\.px \*= kx; p\.y \*= ky; p\.py \*= ky; \}/, 'ipler');
  assert.ok((g.match(/sizeTrail\(this, W, H\)/g) || []).length >= 4, 'iz tamponları taşınıyor');
  assert.match(g, /tc\.drawImage\(old, 0, 0, W, H\);/);
  assert.match(read('src/visualizer/modes/generative2.js'), /G\.rescale\(this, W, H, \[this\.x, this\.vx\], \[this\.y, this\.vy\]\);/, 'konfeti');
});

test('MilkDrop ve shader barındırıcı: geri besleme yeni boyuta kopyalanıyor', () => {
  const md = read('src/visualizer/modes/milkdrop.js');
  assert.match(md, /carry = \{ targets: this\.targets, cur: this\.cur \};\s*this\.targets = null;/);
  assert.match(md, /for \(let i = 0; i < 2; i\+\+\) this\._carryTarget\(carry\.targets\[i\], this\.targets\[i\]\);\s*this\.cur = carry\.cur;/);
  assert.match(md, /gl\.blitFramebuffer\(0, 0, src\.w, src\.h, 0, 0, dst\.w, dst\.h, gl\.COLOR_BUFFER_BIT, gl\.LINEAR\);/);
  const sh = read('src/visualizer/modes/shaderhost.js');
  const resize = sh.slice(sh.indexOf('    resize(w, h) {'), sh.indexOf('    _releaseFbos() {'));
  assert.doesNotMatch(resize, /_releaseFbos\(\)/, 'boyut değişince tamponlar bırakılmıyor');
  assert.match(sh, /gl\.blitFramebuffer\(0, 0, old\.w, old\.h, 0, 0, W, H, gl\.COLOR_BUFFER_BIT, gl\.LINEAR\);/);
});
