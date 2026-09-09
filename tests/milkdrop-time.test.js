'use strict';
/* SHADER ZAMANI ve HAREKET VEKTÖRÜ ANAHTARI.
 *
 * MilkDrop `time`i iki farklı yerde iki farklı şey olarak veriyor:
 * denklem dilinde uygulamanın açılışından beri geçen süre, shader'da ise
 * PRESETİN başından beri geçen ve 10.000'de sarılan süre. Motor ikisine
 * de uygulama zamanını veriyordu.
 *
 * İki sonucu var. Faz: `sin(time)` yazan bir preset MilkDrop'ta her
 * açılışta aynı yerden başlar, bizde uygulamanın kaç saattir açık
 * olduğuna bağlı bir yerden. Kesinlik: shader'daki `float` büyük
 * sayılarda çözünürlük kaybediyor, bir gün açık kalmış bir kurulumda
 * animasyon basamaklı hâle geliyordu — sarma tam bunun için var.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');
const P = (src) => new MD.Preset(src, { seed: 1 });

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('shader zamanı: preset başından, uygulamadan değil', () => {
  assert.match(CODE, /const shTime = accurate\s*\?\s*pTime - Math\.floor\(pTime \/ 10000\) \* 10000\s*:\s*ctx\.time;/);
  assert.match(CODE, /set1\('time', shTime\);/);
});

test('denklem zamanı uygulama zamanı olarak kalıyor', () => {
  /* MilkDrop kaynağında denklem `time`i açılıştan beri geçen süre; ikisini
     aynı yapmak per_frame yazan presetleri kaydırırdı. */
  assert.match(CODE, /time: this\.time,/);
});

/* Sarmanın kendisi çalıştırılıyor: 10.000'i geçtikten sonra sayı küçük
   kalmalı ve süreklilik korunmalı. */
test('sarma: 10.000 sonrası sayı küçük kalıyor', () => {
  const wrap = (t) => t - Math.floor(t / 10000) * 10000;
  assert.strictEqual(wrap(0), 0);
  assert.strictEqual(wrap(9999), 9999);
  assert.ok(Math.abs(wrap(10000) - 0) < 1e-9);
  assert.ok(Math.abs(wrap(10001) - 1) < 1e-9);
  assert.ok(Math.abs(wrap(123456.75) - 3456.75) < 1e-6);
  for (const t of [0, 1, 5000, 9999.9, 10000.1, 999999]) {
    assert.ok(wrap(t) >= 0 && wrap(t) < 10000, 't=' + t);
  }
});

test('shader zamanı: anahtar kapalıyken eski uygulama zamanı', () => {
  assert.match(CODE, /: ctx\.time;/);
});

// ------------------------------------------------- hareket vektörü uyumluluğu

/* `bMotionVectorsOn` ESKİ presetler için bir uyumluluk anahtarı, ayrı bir
   çalışma zamanı bayrağı DEĞİL: MilkDrop onu yükleme anında `mv_a`ya
   çeviriyor ve dosyada ayrıca `mv_a` varsa o eziyor. Motor onu `mv_on`
   diye ayrı bir ada koyuyor ve kimse okumuyordu.

   Korpusta 86 preset taşıyor ve hiçbirinde `mv_a` yok. 82'si kapalı —
   bizim 0 varsayılanımızla zaten doğruydu — ama 4'ü AÇIK ve onlarda
   hareket vektörleri hiç çizilmiyordu. Bunu bir çalışma zamanı kapısı
   olarak yazmak 10.261 preseti (mv_a taşıyanları) sessizce kapatırdı;
   fark bu testin var olma sebebi. */
test('mv_a: bayrak yükleme anında mv_a\'ya çevriliyor', () => {
  assert.strictEqual(P('bMotionVectorsOn=1\n').get('mv_a'), 1);
  assert.strictEqual(P('bMotionVectorsOn=0\n').get('mv_a'), 0);
});

test('mv_a: dosyanın kendi mv_a değeri bayrağı eziyor', () => {
  assert.strictEqual(P('bMotionVectorsOn=0\nmv_a=0.7\n').get('mv_a'), 0.7);
  assert.strictEqual(P('bMotionVectorsOn=1\nmv_a=0.0\n').get('mv_a'), 0);
});

test('mv_a: ikisi de yoksa varsayılan 0', () => {
  /* MilkDrop'ta da görünmezler: preset açıkça istemedikçe çizilmiyorlar. */
  assert.strictEqual(P('fDecay=0.9\n').get('mv_a'), 0);
});
