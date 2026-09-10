'use strict';
/* GERİ BESLEME TAMPONUNUN FORMATI — ve neden kayan nokta DEĞİL.
 *
 * MilkDrop'un tamponu 8 bit tamsayı, yani her yazım [0,1]'e KENETLENİYOR.
 * Motorun tamamı bunun üstüne kurulu: blur zinciri aralığı ölçek/bias ile
 * [0,1]'e sığdırıp `GetBlurN` ile geri açıyor, `decay` her karede o
 * kenetlenmiş değeri çarpıyor.
 *
 * Biz RGBA16F kullanıyorduk — daha az bantlanma için. Ama yarı kayan nokta
 * kenetlemiyor ve toplamalı karışımla çizilen şekiller sınırsız birikiyor.
 * Ölçüldü: geri besleme tamponunun HAM değerleri 40 karede 65504'e, yani
 * yarı kayan noktanın tavanına çıkıyordu. Çizim aşamaları teker teker
 * kapatılarak bulundu — kaynak şekil çizimi, şekiller kapatılınca en büyük
 * değer 1,0'a iniyor.
 *
 * RGB10_A2 normalize edilmiş: MilkDrop gibi kenetliyor ama kanal başına 10
 * bit veriyor, yani MilkDrop'un dört katı hassasiyet. Korpusta patlamış
 * sınıf 18'den 13'e indi.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BARE = CODE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const FMT = /_colorFormat\(\) \{[\s\S]*?\n    \}/.exec(BARE);
const WORKS = /_fmtWorks\(internal, type\) \{[\s\S]*?\n    \}/.exec(BARE);
assert.ok(FMT && WORKS, '_colorFormat / _fmtWorks bulunamadı');

test('tampon NORMALIZE, kayan nokta değil', () => {
  /* Kayan nokta hedefte toplamalı çizimler kenetlenmiyor ve şekiller
     tamponu yarı kayan noktanın tavanına kadar taşırıyor. */
  assert.match(FMT[0], /gl\.RGB10_A2/);
  assert.doesNotMatch(FMT[0], /RGBA16F|HALF_FLOAT/,
    'kayan nokta hedef geri gelmemeli — patlamış sınıfın kaynağıydı');
  assert.doesNotMatch(FMT[0], /EXT_color_buffer_float/,
    'kayan nokta uzantısını sormanın anlamı kalmadı');
});

test('yedek RGBA8 — MilkDrop\'un kendi derinliği', () => {
  /* Sürücü RGB10_A2\'yi çerçeve tamponu olarak kabul etmezse en kötü
     durum MilkDrop ile eşitlenmek olmalı, siyah ekran değil. */
  assert.match(FMT[0], /gl\.RGBA8/);
  assert.match(FMT[0], /gl\.UNSIGNED_BYTE/);
});

test('format ÇİZİLEBİLİRLİĞİ gerçekten sınanıyor', () => {
  /* `texImage2D` başarılı diye varsaymak yetmiyor: doku oluşuyor ama
     çerçeve tamponu eksik kalıyor ve ekran sessizce siyah çıkıyor. */
  assert.match(WORKS[0], /checkFramebufferStatus/);
  assert.match(WORKS[0], /gl\.FRAMEBUFFER_COMPLETE/);
  assert.match(WORKS[0], /gl\.getError\(\) === gl\.NO_ERROR/);
  // Deneme kaynakları geri veriliyor; her karede değil, bir kez koşuyor.
  assert.match(WORKS[0], /deleteFramebuffer/);
  assert.match(WORKS[0], /deleteTexture/);
  assert.match(FMT[0], /if \(this\._fmt\) return this\._fmt;/);
});

test('hedefler ve bulanık kopyalar AYNI formatı kullanıyor', () => {
  /* MilkDrop\'ta blur dokuları da 8 bit ve blur\'un ölçek/bias mekanizması
     tam olarak kenetlenen bir hedefe göre tasarlanmış. İkisini ayırmak o
     mekanizmayı yarım bırakırdı. */
  const mk = /_makeTarget\(w, h\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(mk, '_makeTarget bulunamadı');
  assert.match(mk[0], /const f = this\._colorFormat\(\);/);
  assert.match(mk[0], /f\.internal, w, h, 0, gl\.RGBA, f\.type/);
});
