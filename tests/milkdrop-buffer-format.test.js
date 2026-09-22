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
  const mk = /_makeTarget\(w, h, fmt\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(mk, '_makeTarget bulunamadı');
  /* Açık bir format verilmediğinde motorun kendi formatına düşmeli.
     Flaş sınırlayıcı hedefleri açıkça RGBA8 istiyor — ekrandan
     kopyalanıyorlar ve varsayılan çerçeve tamponu o. */
  assert.match(mk[0], /const f = fmt \|\| this\._colorFormat\(\);/);
  /* Yükleme formatı da açık verilebilmeli: flaş sınırlayıcı hedefleri
     ALFASIZ (RGB8), çünkü bağlam `alpha: false` ile kuruluyor ve ekrandan
     kopyalanan bir dokuda olmayan bir bileşen olamaz. */
  assert.match(mk[0], /const format = f\.format \|\| gl\.RGBA;/);
  assert.match(mk[0], /f\.internal, w, h, 0, format, f\.type, zeroPixels\(gl, w, h, format, f\.type\)\)/);
});

test('hedefler SIFIRLA ayrılıyor, temizlemeye güvenilmiyor (#575)', () => {
  /* Ölçüldü: aynı GPU'da başka bir MilkDrop bağlamı çizerken ve işlemci
     meşgulken yeni ayrılan tampon, `clear`e rağmen o bağlamın görüntüsünü
     taşıyabiliyordu; geri besleme onu büyütüp sürdürüyordu (24 çizimde
     13). Sıfırla ayırınca 24'te 0. Burada motor gerçekten koşuyor: sahte
     bir GL'e giden yükleme sayılıyor. */
  const vm = require('vm');
  const canvas = () => ({ width: 64, height: 64, getContext: (k) => (k === '2d' ? {} : null), addEventListener() {} });
  const ctx = { window: {}, document: { createElement: canvas }, console, performance };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  for (const f of ['src/shared/milkdrop.js', 'src/visualizer/modes/milkdrop.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf-8'), ctx, { filename: f });
  }
  const m = new ctx.window.SVModes.milkdrop(canvas());
  const calls = [];
  const gl = {
    RGBA: 6408, RGB: 6407, RGB8: 32849, RGB10_A2: 32857, UNSIGNED_BYTE: 5121, UNSIGNED_INT_2_10_10_10_REV: 33640,
    TEXTURE_2D: 3553, UNPACK_ALIGNMENT: 3317, FRAMEBUFFER: 36160, COLOR_ATTACHMENT0: 36064, COLOR_BUFFER_BIT: 16384,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, CLAMP_TO_EDGE: 33071,
    createTexture: () => ({}), bindTexture() {}, texParameteri() {}, createFramebuffer: () => ({}),
    bindFramebuffer() {}, framebufferTexture2D() {}, clearColor() {},
    clear: () => calls.push(['clear']),
    pixelStorei: (k, v) => calls.push(['pixelStorei', k, v]),
    texImage2D: (...a) => calls.push(['texImage2D'].concat(a)),
  };
  m.gl = gl;
  const kind = (a) => Object.prototype.toString.call(a);
  // Geri besleme: RGB10_A2, piksel başına bir 32 bit sözcük
  m._makeTarget(8, 4, { internal: gl.RGB10_A2, type: gl.UNSIGNED_INT_2_10_10_10_REV });
  const up1 = calls.filter((c) => c[0] === 'texImage2D').pop();
  const d1 = up1[9];
  assert.strictEqual(kind(d1), '[object Uint32Array]');
  assert.strictEqual(d1.length, 32);
  assert.ok(Array.from(d1).every((v) => v === 0), 'tamamı sıfır');
  const iAlign = calls.findIndex((c) => c[0] === 'pixelStorei' && c[1] === gl.UNPACK_ALIGNMENT && c[2] === 1);
  const iUp = calls.indexOf(up1);
  assert.ok(iAlign >= 0 && iAlign < iUp, 'hizalama yüklemeden önce 1');
  assert.ok(calls.slice(iUp).some((c) => c[0] === 'clear'), 'temizleme yine yapılıyor');
  // Flaş sınırlayıcı: RGB8, satır 4'ün katı değil
  m._makeTarget(5, 3, { internal: gl.RGB8, format: gl.RGB, type: gl.UNSIGNED_BYTE });
  const up2 = calls.filter((c) => c[0] === 'texImage2D').pop();
  assert.strictEqual(kind(up2[9]), '[object Uint8Array]');
  assert.strictEqual(up2[9].length, 45);
  assert.strictEqual(up2[7], gl.RGB);
  // Tampon paylaşılıyor (küçük istek aynı tampon), büyük istek büyütüyor
  assert.strictEqual(up2[9].buffer, d1.buffer, 'küçük hedef aynı sıfır tamponu');
  m._makeTarget(64, 64, { internal: gl.RGB10_A2, type: gl.UNSIGNED_INT_2_10_10_10_REV });
  const up3 = calls.filter((c) => c[0] === 'texImage2D').pop();
  assert.strictEqual(up3[9].length, 4096);
  assert.ok(up3[9].buffer.byteLength >= 4096 * 4);
  assert.ok(Array.from(up3[9]).every((v) => v === 0));
});
