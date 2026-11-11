'use strict';
/* Medya katmanı renk ve parlaklık anahtarı. Delik kaynak pikselinin alfası
 * olur; kapalıyken tampon değişmez. Ayar varsayılan dosyada durmaz: o dosya
 * mod küçük resminin anahtarına girer, anahtar ise resmi değiştirmez. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function load() {
  const win = {};
  const sandbox = { window: win, document: { createElement: () => ({ getContext: () => null }) }, Math, parseInt, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(read('src/visualizer/modes/media.js'), sandbox);
  return win.SVMediaKey;
}

const K = load();
const px = (r, g, b, a) => new Uint8ClampedArray([r, g, b, a == null ? 255 : a]);

test('renk anahtarı yeşili siler, kırmızıyı bırakır, yumuşaklıkta ara alfa bırakır', () => {
  const green = px(0, 255, 0);
  assert.strictEqual(K.apply(green, { mode: 'chroma', color: '#00ff00', threshold: 0.2, softness: 0 }), 1);
  assert.strictEqual(green[3], 0);
  const red = px(255, 0, 0, 80);
  assert.strictEqual(K.apply(red, { mode: 'chroma', color: '#00ff00', threshold: 0.2, softness: 0 }), 0);
  assert.strictEqual(red[3], 80);
  const near = px(0, 255, 0);
  near[2] = 12;
  K.apply(near, { mode: 'chroma', color: '00ff00', threshold: 0, softness: 24 / (255 * Math.sqrt(3)) });
  assert.ok(near[3] > 100 && near[3] < 160, 'ara alfa: ' + near[3]);
});

test('parlaklık anahtarı karanlığı siler, tersi aydınlığı siler, eski alfayı çarpar', () => {
  const black = px(0, 0, 0, 200);
  K.apply(black, { mode: 'luma', threshold: 0.4, softness: 0, invert: false });
  assert.strictEqual(black[3], 0);
  const white = px(255, 255, 255, 180);
  K.apply(white, { mode: 'luma', threshold: 0.4, softness: 0, invert: false });
  assert.strictEqual(white[3], 180);
  K.apply(white, { mode: 'luma', threshold: 0.4, softness: 0, invert: true });
  assert.strictEqual(white[3], 0);
  const dim = px(0, 0, 0, 100);
  assert.strictEqual(K.apply(dim, { mode: 'off' }), 0);
  assert.strictEqual(dim[3], 100);
  assert.strictEqual(K.active({}), false);
  assert.strictEqual(K.active({ keyMode: 'chroma' }), true);
});

test('kapalıyken çizim yolu anahtar tuvali açmaz; panel ve çeviri bağlı', () => {
  const src = read('src/visualizer/modes/media.js');
  assert.match(src, /const frame = this\._keyed\(pic, vw, vh, m\) \|\| pic/);
  assert.match(src, /if \(!K \|\| !K\.active\(m\)/);
  const panel = read('src/admin/scene-panels.js');
  for (const s of ['Renk Anahtarı', 'Seçilen Renk', 'Anahtar Rengi', 'Saydam Kalan', 'Anahtar Eşiği', 'Anahtar Yumuşaklığı']) {
    assert.ok(panel.includes(s), s);
  }
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Renk Anahtarı', 'Seçilen Renk', 'Anahtar Rengi', 'Saydam Kalan', 'Anahtar Eşiği', 'Anahtar Yumuşaklığı']) {
    assert.ok(i18n.includes("'" + s + "':"), s);
  }
  assert.ok(!/keyMode:/.test(read('src/shared/defaults.js')), 'varsayılan dosyası anahtar yüzünden değişmemeli');
});
