'use strict';
/* Üçüncü mod bölümü (#905): on görselleştirici, sekiz arkaplan. Kayıt, ayar ve çeviri
   eşleşmesini tests/mode-catalog.test.js denetliyor; burada bu dosyalara özgü kurallar. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const MC = require('../src/shared/mode-catalog.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const VIS = ['capsules', 'stagebars', 'hexspectrum', 'liquidspectrum', 'dotwave', 'neonrings', 'corona', 'spiralspectrum', 'warpstars', 'orbitals'];
const BG = ['colorcloud', 'silk', 'papercut', 'stripes', 'dotgrid', 'sunset', 'dunes', 'nightsky'];

test('yeni modlar katalogda, otomatik dolaşımda ve katman listesinde', () => {
  for (const id of VIS) {
    assert.ok(MC.get('visualizer', id), id);
    assert.ok(MC.cycleIds('visualizer').includes(id), id + ' dolaşımda');
  }
  for (const id of BG) {
    assert.ok(MC.get('background', id), id);
    assert.strictEqual(MC.settingsOf('background', id).length, 5, id + ': beş ayar');
  }
});

test('rastgelelik tohumlu: dışa aktarım kare kare tekrarlanabilir', () => {
  for (const f of ['src/visualizer/modes/generative3.js', 'src/visualizer/modes/backgrounds-gen3.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /Math\.random\(/, f);
    assert.doesNotMatch(src, /Date\.now\(|performance\.now\(/, f + ': zaman çizim saatinden gelir');
  }
});

test('her sayfada yardımcılarından sonra yükleniyor', () => {
  for (const page of ['src/admin/index.html', 'src/exporter/index.html', 'src/thumbs/modes.html', 'src/visualizer/index.html', 'src/web/overlay.html']) {
    const html = read(page);
    const at = (f) => html.indexOf('modes/' + f);
    assert.ok(at('generative3.js') > at('generative.js') && at('generative.js') > 0, page + ': generative3.js');
    assert.ok(at('backgrounds-gen3.js') > at('backgrounds.js') && at('backgrounds.js') > 0, page + ': backgrounds-gen3.js');
  }
});

test('görselleştiriciler tuvali temizler (arkaplan görünür) ve kare başına dizi ayırmaz', () => {
  const src = read('src/visualizer/modes/generative3.js');
  const classes = src.split(/\n  class /).slice(1);
  assert.strictEqual(classes.length, VIS.length);
  for (const c of classes) {
    const name = c.slice(0, c.indexOf(' '));
    const draw = c.slice(c.indexOf('    draw(audio, cfg, t, dt) {'));
    assert.match(draw, /ctx\.clearRect\(0, 0, W, H\);/, name);
    assert.doesNotMatch(draw, /new (Float32Array|Array|Uint8Array)\([^)]*\);\s*\n(?![\s\S]{0,200}this\.n = n)/, name);
  }
});
