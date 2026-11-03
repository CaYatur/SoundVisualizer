'use strict';
/* ŞEKİL ÖRNEĞİ VE DALGA NOKTASI: ADLAR ÇAĞRI BAŞINA ARANMIYOR (#905).
 *
 * Şeklin kare denklemi 1024 örneğe kadar koşuyor. Her örnekte alt bloğa ortak girdiler, q'lar ve
 * şeklin tabanı adlarıyla kopyalanıyordu; en yavaş presetlerde karenin %20-45'i buradaydı. Şimdi
 * indislerle kopyalanıyor. Bu dosya hızı değil, indisli yolun DAVRANIŞI değiştirmediğini koruyor:
 * her örnek aynı yerden başlıyor, kip değişince doğru taban okunuyor, tabana eklenen alan çıktıda
 * kaybolmuyor.
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');

const INPUTS = {
  time: 2, frame: 120, fps: 60, progress: 0.25, bass: 1.5, mid: 1.2, treb: 0.8, bass_att: 1.1, mid_att: 1, treb_att: 0.9,
  mouse_x: 0.25, mouse_y: 0.75, mouse_down: 1, meshx: 12, meshy: 9, pixelsx: 640, pixelsy: 480, aspectx: 0.75, aspecty: 1,
};
const shapeText = (perFrame, extra) => `[preset00]
per_frame_1=q1 = 0.5; q2 = bass;
shapecode_0_enabled=1
shapecode_0_sides=5
shapecode_0_num_inst=4
shapecode_0_x=0.25
shapecode_0_rad=0.2
${extra || ''}
shape_0_per_frame1=${perFrame}
`;

function preset(text, opts) {
  const p = new MD.Preset(text, Object.assign({ seed: 7 }, opts));
  p.frame(INPUTS);
  p.captureBase();
  return p;
}

test('şekil çıktısında tabanın bütün alanları var', () => {
  for (const accurate of [true, false]) {
    const p = preset(shapeText('rad = 0.3;'), { accurate });
    const s = p.shapes.find((x) => x && x.enabled);
    const o = p.shapeFrame(s, 0, {});
    assert.deepStrictEqual(Object.keys(o).sort(), Object.keys(s.base).sort());
    assert.deepStrictEqual(Object.keys(s.baseMd2).sort(), Object.keys(s.base).sort());
    assert.strictEqual(o.rad, 0.3);
    assert.strictEqual(o.x, 0.25);
  }
});

test('her şekil örneği aynı girdilerden başlıyor', () => {
  // Örnek ortak girdiyi, q'yu ve tabanı bozuyor; sonraki örnek bunu görmemeli
  const p = preset(shapeText('x = x + 0.1 + instance * 0.01; y = bass; r = q1; g = time; b = num_inst; time = 99; bass = 99; q1 = 99;'));
  const s = p.shapes.find((x) => x && x.enabled);
  const a = p.shapeFrame(s, 0, {});
  const b = p.shapeFrame(s, 1, {});
  assert.ok(Math.abs(a.x - 0.35) < 1e-12);
  assert.ok(Math.abs(b.x - 0.36) < 1e-12);
  assert.strictEqual(b.y, 1.5);
  assert.strictEqual(b.r, 0.5);
  assert.strictEqual(b.g, 2);
  assert.strictEqual(b.b, 4);
});

test('uyum kipi kare ortasında dönünce doğru taban okunuyor', () => {
  // Dosya g yazmıyor: uyumda varsayılan 0, eski tabanda 1
  const p = preset(shapeText('rad = 0.3;'));
  const s = p.shapes.find((x) => x && x.enabled);
  assert.strictEqual(p.shapeFrame(s, 0, {}).g, 0);
  p.accurate = false;
  assert.strictEqual(p.shapeFrame(s, 0, {}).g, 1);
  p.accurate = true;
  assert.strictEqual(p.shapeFrame(s, 0, {}).g, 0);
});

test('şeklin ara değişkenleri her örnekte init değerine dönüyor', () => {
  const p = preset(shapeText('t1 = t1 + 1; x = t1;', 'shape_0_init1=t1 = 5;'));
  const s = p.shapes.find((x) => x && x.enabled);
  assert.strictEqual(p.shapeFrame(s, 0, {}).x, 6);
  assert.strictEqual(p.shapeFrame(s, 1, {}).x, 6);
});

test('dalga noktası her noktada kendi tohumundan başlıyor', () => {
  const text = `[preset00]
wavecode_0_enabled=1
wavecode_0_samples=8
wavecode_0_r=0.5
wave_0_per_point1=r = r * 0.5; x = x + sample;
`;
  const p = preset(text);
  const w = p.waves.find((x) => x && x.enabled);
  assert.ok(p.waveFrame(w));
  const o = {};
  p.wavePoint(w, 0.25, 0.1, -0.2, o);
  assert.strictEqual(o.r, 0.25);
  assert.ok(Math.abs(o.x - 0.85) < 1e-12);
  assert.ok(Math.abs(o.y - 0.3) < 1e-12);
  // İkinci nokta birinciden kalan rengi görmüyor
  p.wavePoint(w, 0.5, 0, 0, o);
  assert.strictEqual(o.r, 0.25);
  assert.strictEqual(o.x, 1);
});

test('sayı olmayan girdi havuza 0 olarak yazılıyor', () => {
  const text = `[preset00]
wavecode_0_enabled=1
wave_0_per_point1=g = value1;
`;
  const p = preset(text);
  const w = p.waves.find((x) => x && x.enabled);
  assert.ok(p.waveFrame(w));
  assert.strictEqual(p.wavePoint(w, 0, NaN, 0, {}).g, 0);
});
