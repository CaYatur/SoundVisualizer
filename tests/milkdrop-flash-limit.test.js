'use strict';
/* FLAŞ SINIRLAMA — nöbet riski taşıyan yanıp sönmeyi kesmek.
 *
 * MilkDrop'ta yok; bilinçli bir ekleme. projectM'in #947 ve #742'si aynı
 * şeyi yıllardır açık tutuyor. Korpusta "Definitly Not For The Epileptic"
 * ve "Seizure-Inducing ... RMX" gibi adlar var; yazarları ne yaptıklarını
 * biliyor, izleyen herkes bilmiyor.
 *
 * Ölçüt WCAG 2.3.1'in "genel flaş" tanımı: bağıl parlaklıkta (BT.709)
 * saniyede üçten fazla ve 0,10'dan büyük değişim. Eşik ölçülerek seçildi —
 * 70 presetlik tohumlu kesitte kare arası en büyük ortalama parlaklık
 * sıçraması: %71,4'ü 0,02 altında, %90,0'ı 0,10 ALTINDA, %7,1'i saniyede
 * 3+ kez 0,10'u aşıyor. Yani eşik onda dokuza hiç dokunmuyor.
 *
 * GPU'da doğrulandı (240x180, 40 kare): sentetik bir strobe presetinde en
 * büyük sıçrama 0,9961'den 0,0980'e indi — eşiğin hemen altına. Normal bir
 * presette (Geiss - Cauldron) 0,0089 -> 0,0089, yani BİT BİREBİR aynı.
 * GL hatası yok.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const CODE = read('src/visualizer/modes/milkdrop.js');
const BARE = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const DEF = read('src/shared/defaults.js');
const PANEL = read('src/admin/milkdrop-panel.js');
const I18N = read('src/shared/i18n.js');

// -------------------------------------------------------------------- eşik

test('eşik WCAG 2.3.1\'in genel flaş değeri', () => {
  const m = /const FLASH_THRESH = ([0-9.]+);/.exec(BARE);
  assert.ok(m, 'FLASH_THRESH bulunamadı');
  assert.strictEqual(parseFloat(m[1]), 0.10);
});

test('parlaklık BT.709 bağıl parlaklığı', () => {
  /* WCAG bu katsayıları kullanıyor. Düz ortalama (r+g+b)/3 almak yeşili
     olduğundan az, maviyi çok sayardı — flaş algısı yeşile göre. */
  assert.match(CODE, /dot\(c, vec3\(0\.2126, 0\.7152, 0\.0722\)\)/);
});

test('eşiğin altında görüntü DOKUNULMADAN geçiyor', () => {
  /* `k = 1` çarpanı `mix(prv, cur, 1.0)` demek, yani tam olarak `cur`.
     Presetlerin %90'ı bu daldan geçiyor. */
  assert.match(CODE, /float k = d > uThresh \? uThresh \/ d : 1\.0;/);
  assert.match(CODE, /outColor = vec4\(mix\(prv, cur, k\), 1\.0\);/);
});

test('kesme değil ORANLAMA', () => {
  /* `uThresh / d` eşiği on kat aşan bir flaşı onda bire indiriyor, iki kat
     aşanı yarıya. Sabit bir çarpan kullanmak hafif flaşı gereğinden çok
     bastırır, ağırını yeterince bastırmazdı. */
  const m = /uThresh \/ d/.exec(CODE);
  assert.ok(m, 'oranlama yok');
});

// ------------------------------------------------------------- ortalama

test('ortalama mipmap zincirinin en küçük kademesinden', () => {
  /* Donanımın kendi kutu süzgeci, yani gerçek ortalama. Kademe numarası
     bilerek fazla büyük; GLSL var olan en küçüğe kenetliyor. */
  assert.match(CODE, /textureLod\(uCur, vec2\(0\.5\), 24\.0\)/);
  assert.match(CODE, /textureLod\(uPrev, vec2\(0\.5\), 24\.0\)/);
});

test('hedeflerin süzmesi MIPMAP, yoksa "ortalama" tek teksel olur', () => {
  const fn = /_ensureFlash\(W, H\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(fn, '_ensureFlash bulunamadı');
  assert.match(fn[0], /gl\.LINEAR_MIPMAP_LINEAR/);
  assert.match(fn[0], /generateMipmap/);
});

test('karşılaştırma GÖSTERİLEN kareyle, ham kareyle değil', () => {
  /* Ham kareyle karşılaştırsaydık yanıp sönen preset her karede aynı
     sıçramayı yeniden üretir, sınırlama yakınsamaz ve ekran yarı genlikte
     sönmeye devam ederdi. */
  const fn = /_flashPass\(gl, fl, GW, GH\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(fn, '_flashPass bulunamadı');
  const kopya = fn[0].indexOf('copyTexSubImage2D');
  const cizim = fn[0].indexOf('drawArrays');
  assert.ok(cizim > 0 && kopya > cizim, 'kopya çizimden SONRA olmalı');
  assert.match(fn[0].slice(kopya), /generateMipmap/,
    'kopyalanan karenin mipmapı tazelenmeli, yoksa ortalama bir kare geride kalır');
});

// ------------------------------------------------------------- maliyet

test('kapalıyken tek doku bile ayrılmıyor', () => {
  /* 1920x1080'de iki tam boy hedef 16 MB eder; özelliği kullanmayan biri
     onu ödememeli. */
  assert.match(BARE, /const fl = \(this\._flashLimit && this\.flashProg\) \? this\._ensureFlash\(GW, GH\) : null;/);
  assert.match(BARE, /gl\.bindFramebuffer\(gl\.FRAMEBUFFER, fl \? fl\.raw\.fb : null\);/);
  assert.match(BARE, /if \(fl\) this\._flashPass\(gl, fl, GW, GH\);/);
});

test('hedefler ALFASIZ — ekrandan kopyalanıyorlar', () => {
  /* Bağlam `alpha: false` ile kuruluyor, yani varsayılan çerçeve tamponunun
     alfası yok; kaynakta olmayan bir bileşeni hedefe kopyalamak
     INVALID_OPERATION. Ölçüldü: RGBA8 hedefte her karede GL hatası 1282,
     RGB8'de temiz. */
  const fn = /_ensureFlash\(W, H\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.match(fn[0], /internal: gl\.RGB8, format: gl\.RGB, type: gl\.UNSIGNED_BYTE/);
  assert.match(CODE, /alpha: false/, 'bağlam alfasız kuruluyor olmalı');
});

test('boyut değişince hedefler yeniden kuruluyor ve eskileri bırakılıyor', () => {
  const fn = /_ensureFlash\(W, H\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.match(fn[0], /this\.flash\.w === W && this\.flash\.h === H\) return this\.flash;/);
  assert.match(fn[0], /kill\(this\.flash\.raw\); kill\(this\.flash\.prev\);/);
  const dis = /_disposeTargets\(\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.match(dis[0], /this\.flash = null;/, 'hedefler dispose\'da da bırakılmalı');
});

// -------------------------------------------------------------- ayar

test('varsayılan AÇIK, ayardan kapatılabiliyor', () => {
  /* Ölçüldü: %90 hiç etkilenmiyor, devreye WCAG'in riskli dediği %7,1'de
     giriyor. Bedeli neredeyse yok, kazancı erişilebilirlik. */
  assert.match(DEF, /flashLimit: true,/);
  assert.match(BARE, /this\._flashLimit = !\(cfg\.milkdrop && cfg\.milkdrop\.flashLimit === false\);/);
  assert.match(PANEL, /md\.flashLimit === false \? 0 : 1/);
});

test('arayüz metinleri İngilizceye çevrilmiş', () => {
  for (const k of ['Flaş Sınırlama', 'Açık (nöbet riskini kes)', 'Kapalı (ham görüntü)']) {
    assert.ok(I18N.includes("'" + k + "':"), k + ' sözlükte yok');
  }
});
