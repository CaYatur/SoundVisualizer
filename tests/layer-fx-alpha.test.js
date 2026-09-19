'use strict';
/* KATMAN EFEKTİ KATMANIN SAYDAMLIĞINI KORUYOR (#590).
 *
 * Tek bir katmana verilen efekt, sahne şeffaf değilse, altındaki her şeyi
 * siyahla kapatıyordu: efekt zinciri opak kipte her pikselin alfasını 1
 * yazıyor ve katmanın boş yerleri siyah bir örtüye dönüyordu. Genel efekt
 * zincirinde sorun yoktu — orada çizilen şey sahnenin son hâli.
 *
 * Yalıtılmış bir kopyada ölçüldü: altta düz kırmızı arkaplan, üstte kendi
 * efekti (bloom) olan bir bar katmanı. Üst köşe efektsizken ve efekt genel
 * zincirdeyken kırmızıydı; efekt katmandayken siyahtı ve bar katmanının
 * tuvali o köşede opaktı (alfa 255). Düzeltmeden sonra üçünde de kırmızı,
 * katman tuvali saydam (alfa 0).
 *
 * Efekt zinciri WebGL istediği için burada çizim yolunun KARARI sınanıyor:
 * katman efektine hangi kipin istendiği.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global.window || {};
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// `_drawEntry` sahte parçalarla: katman efektine giden kip kaydediliyor
function seeFor(cfg) {
  let got;
  const fake = {
    _drawEntryRaw() {},
    _applyMask() {},
    _applyLayerFX(e, l, audio, t, dt, see) { got = see; },
  };
  const e = { layer: { id: 'x', kind: 'visualizer', type: 'bars' }, canvas: {} };
  L.LayerStack.prototype._drawEntry.call(fake, e, {}, cfg, 0, 1 / 60);
  return got;
}

test('katman efekti opak sahnede de saydam kipte isteniyor', () => {
  const opaque = { background: { type: 'solid', solidColor: '#000000', transparent: false } };
  assert.strictEqual(L.seeThrough(opaque), false, 'sahne opak olmalı');
  assert.strictEqual(seeFor(opaque), true);
});

test('şeffaf sahnede de saydam kip', () => {
  const see = { background: { type: 'solid', transparent: true } };
  assert.strictEqual(seeFor(see), true);
});

test('vekil çizilmiyor, efekti de uygulanmıyor', () => {
  let called = false;
  const fake = { _drawEntryRaw() { called = true; }, _applyMask() {}, _applyLayerFX() { called = true; } };
  L.LayerStack.prototype._drawEntry.call(fake, { proxyOf: {} }, {}, {}, 0, 0);
  assert.strictEqual(called, false);
});

test('genel zincir sahnenin saydamlığına bakmaya devam ediyor', () => {
  /* Genel zincir sahnenin son hâli: opak bir çıktıda alfayı 1 yazması
     doğru. Katman efektiyle aynı karara bağlanmamalı. */
  const B = bare(read('src/visualizer/layers.js'));
  assert.match(B, /this\.postfx\.render\(src, audio, t, dt, seeThrough\(cfg\)\);/);
  assert.match(B, /this\._applyLayerFX\(e, l, audio, t, dt, true\);/);
  assert.match(B, /if \(!fx\.render\(e\.canvas, audio, t, dt, !!see\)\) return;/);
});
