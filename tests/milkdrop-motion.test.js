'use strict';
/* MilkDrop'un HAREKET VEKTÖRLERİ (nMotionVectorsX/Y + mv_*).
 *
 * Warp alanını gösteren küçük çizgilerden bir ızgara. Korpusta presetlerin
 * %92'sinde ızgara açık ama görünürlüğü `mv_a` belirliyor: %8,6'sı dosyada
 * sıfırdan büyük bir alfa yazıyor, %5,7'si de per_frame içinde açıp
 * kapıyor. Motorda hiç çizilmiyorlardı ve bu, shader'lar hatasız
 * derlendiği için derleme ölçümünde görünmüyordu.
 *
 * Ad eşlemesi sessiz bir tuzak: preset başlığında `nMotionVectorsX`,
 * denklemlerde `mv_x`. Eşleme kurulmazsa ızgara sayısı motora hiç ulaşmaz
 * ve varsayılanda kalır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const MD = require('../src/shared/milkdrop.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('ayrıştırıcı: nMotionVectorsX/Y denklem adlarına eşleniyor', () => {
  const p = new MD.Preset('nMotionVectorsX=24.000\nnMotionVectorsY=18.000\n', { seed: 1 });
  p.frame({ time: 0, frame: 1, fps: 30 });
  assert.strictEqual(p.get('mv_x'), 24);
  assert.strictEqual(p.get('mv_y'), 18);
});

test('ayrıştırıcı: mv_* varsayılanları MilkDrop ile aynı', () => {
  /* mv_l sıfır kalsaydı vektörler sıfır uzunlukta çizilir, hiç görünmezdi.
     mv_a ise 0 olmalı: preset açıkça istemedikçe çizilmiyorlar. */
  const p = new MD.Preset('fDecay=0.9\n', { seed: 1 });
  assert.strictEqual(p.get('mv_l'), 1);
  assert.strictEqual(p.get('mv_a'), 0);
  assert.strictEqual(p.get('mv_r'), 1);
});

test('ayrıştırıcı: dosyadaki mv_a ve mv_l havuza giriyor', () => {
  const p = new MD.Preset('mv_a=0.400\nmv_l=2.500\nmv_dx=0.010\n', { seed: 1 });
  assert.strictEqual(p.get('mv_a'), 0.4);
  assert.strictEqual(p.get('mv_l'), 2.5);
  assert.strictEqual(p.get('mv_dx'), 0.01);
});

test('motor: hareket vektörleri BİRLEŞTİRMEDEN ÖNCE çiziliyor', () => {
  /* Sıra görünür: birleştirmeden önce çizilince vektörler geri besleme
     tamponuna giriyor ve sonraki karelerde akıp sönüyorlar. Sonra çizmek
     onları geri beslemenin dışında bırakır, iz bırakmadan yanıp sönerlerdi. */
  /* Sıralama draw() GÖVDESİ içinde aranıyor: bindFramebuffer(..., null)
     blur zincirinde de geçiyor ve metnin tamamında ilk bulunan o oluyor. */
  const body = CODE.slice(CODE.indexOf('draw(audio, cfg, t, dt)'));
  const call = body.indexOf('this._drawMotionVectors(gl');
  const comp = body.indexOf('this.compPreset');
  assert.ok(call > 0, 'çizim çağrısı draw() içinde olmalı');
  assert.ok(comp > 0, 'comp geçişi bulunmalı');
  assert.ok(call < comp,
    'vektörler hedef tampona, comp geçişinden önce çizilmeli');
});

test('motor: alfa sıfırken hiç çizilmiyor', () => {
  assert.match(CODE, /mv_a[\s\S]{0,120}?<=\s*0\.002/,
    'görünmez alfada erken çıkış olmalı');
});

test('motor: ızgara tamponu taşınca kesilmiyor, boşaltılıyor', () => {
  /* 64x48 bir ızgara 3072 vektör; çizgi tamponu 512 düğümlük. Kesmek
     ızgaranın yalnız üst şeridini çizerdi. */
  assert.match(CODE, /const flush = \(\)/);
  assert.match(CODE, /if \(count \+ 2 > 512\) flush\(\)/);
});
