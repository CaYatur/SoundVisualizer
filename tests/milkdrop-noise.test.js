'use strict';
/* MilkDrop'un GÜRÜLTÜ DOKULARI ve HACİM GÜRÜLTÜSÜ.
 *
 * İki ayrı uyum hatası vardı, ikisi de derleme ölçümünde görünmüyordu:
 *
 * 1) `sampler_noisevol_lq/hq` iki boyutlu bildiriliyordu ve `tex3D`
 *    koordinatın z bileşenini ATIYORDU. Preset hacmin içinde ilerlediğini
 *    sanarken hep aynı dilimi okuyordu. Ölçüldü (10.347 presetlik korpus):
 *    2.217 preset (%21,4) `tex3D` çağırıyor, toplam 4.322 çağrı.
 *
 * 2) `noise_mq` ve `noise_hq` AYNI parametrelerle üretiliyordu. MilkDrop
 *    ikisini farklı kafes ölçeklerinde (4 ve 8) üretiyor; iki ayrı doku
 *    isteyen preset bizde ikisinden de aynı deseni alıyordu.
 *
 * Testler kaynağa bakıyor çünkü asıl kanıt GPU'da: doku gerçekten üç
 * boyutlu mu, iki üreteç gerçekten farklı ölçekte mi. Bunları başlıksız
 * bir WebGL2 bağlamı olmadan çalıştıramayız, ama YANLIŞ olduklarında
 * kaynakta bıraktıkları iz kesin.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../src/shared/milkdrop-shader.js');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// --------------------------------------------------------------- çeviri

test('çeviri: hacim gürültüsü sampler3D bildiriliyor', () => {
  const r = T.translate('shader_body { ret = tex3D(sampler_noisevol_hq, uv3); }');
  assert.match(r.glsl, /uniform sampler3D sampler_noisevol_hq;/);
  assert.match(r.glsl, /uniform sampler3D sampler_noisevol_lq;/);
  // Diğer yerleşikler iki boyutlu kalmalı
  assert.match(r.glsl, /uniform sampler2D sampler_noise_hq;/);
  assert.match(r.glsl, /uniform sampler2D sampler_main;/);
});

/* GLSL ES 3.00'da parça shader'ının `sampler2D` için örtük bir kesinliği
   var, `sampler3D` için YOK. Bu satır olmadan hacim gürültüsünü okuyan
   HER aşama "No precision specified" ile düşüyordu — ölçüldü: 40 presetlik
   bir kesitte 57 aşamanın 57'si. */
test('çeviri: sampler3D için kesinlik bildiriliyor', () => {
  const r = T.translate('shader_body { ret = tex3D(sampler_noisevol_hq, uv3); }');
  assert.match(r.glsl, /precision\s+\w+\s+sampler3D;/);
});

/* Asıl düzeltme bu satırda: z KULLANILIYOR. `texture(s, uv2.xy)` yazan
   sürüm de derleniyordu ve hiçbir hata vermiyordu — yalnız yanlış
   görüntü veriyordu. */
test('çeviri: tex3D üç boyutlu okumada z bileşenini kullanıyor', () => {
  const r = T.translate('shader_body { ret = tex3D(sampler_noisevol_hq, uv3); }');
  assert.match(r.glsl, /vec3 tex3D\(sampler3D s, vec3 uv2\)\{ return texture\(s, uv2\)\.xyz; \}/);
});

/* İki boyutlu aşırı yükleme duruyor: korpusta bir örneği yok ama korpus
   dışında bir preset 2B sampler geçirirse, eskiden derlenen shader birden
   derlenmez olurdu. */
test('çeviri: tex3D iki boyutlu aşırı yüklemesi korunuyor', () => {
  const r = T.translate('shader_body { ret = tex3D(sampler_noise_lq, uv3); }');
  assert.match(r.glsl, /vec3 tex3D\(sampler2D s, vec3 uv2\)/);
});

/* Ön ekli türev de üç boyutlu olmalı. `sampler2D` bildirilseydi shader
   yine derlenirdi — aşırı yükleme çözümü sessizce 2B sürümü seçer ve z
   yine yok sayılırdı. Korpusta 65 kullanım. */
test('çeviri: ön ekli hacim türevi de sampler3D', () => {
  const r = T.translate('shader_body { ret = tex3D(sampler_pw_noisevol_hq, uv3); }');
  assert.match(r.glsl, /uniform sampler3D sampler_pw_noisevol_hq;/);
  assert.ok(!/uniform sampler2D sampler_pw_noisevol_hq;/.test(r.glsl));
});

test('çeviri: kullanıcı dokusu iki boyutlu kalıyor', () => {
  const r = T.translate('shader_body { ret = tex2D(sampler_worms, uv); }');
  assert.match(r.glsl, /uniform sampler2D sampler_worms;/);
});

// ------------------------------------------------------------------ motor

test('motor: hacim gürültüsü TEXTURE_3D hedefine bağlanıyor', () => {
  assert.match(CODE, /bind\(8, this\.noise\.volLq\.tex, gl\.TEXTURE_3D\)/);
  assert.match(CODE, /bind\(9, this\.noise\.volHq\.tex, gl\.TEXTURE_3D\)/);
});

/* Türev birimleri de doğru hedefe bağlanmalı. Hedef yanlışsa hata
   çıkmıyor: o birimde boş doku okunur, yani siyah. */
test('motor: türev bağlaması hedefi kanonik addan alıyor', () => {
  assert.match(CODE, /bind\(e\.p\.unit, this\._texFor\(e\.p\.canon, mainTex\), this\._targetFor\(e\.p\.canon\)\)/);
  assert.match(CODE, /_targetFor\(canon\)[\s\S]{0,240}sampler_noisevol_lq[\s\S]{0,80}sampler_noisevol_hq[\s\S]{0,80}TEXTURE_3D/);
});

/* Bir birimde iki hedef birden asılı kalabiliyor. Önceki preset oraya
   hacim gürültüsü bağladıysa ve şimdi aynı birim iki boyutlu okunuyorsa,
   eski bağ birimde durur. Temizlik her karede yapılmalı. */
test('motor: türev aralığı her iki hedefte de temizleniyor', () => {
  const loop = /for \(let unit = SAMPLER_UNITS\.length; unit < \(this\.unitMax \|\| 16\); unit\+\+\) \{[\s\S]*?\n      \}/.exec(CODE);
  assert.ok(loop, 'türev temizleme döngüsü bulunamadı');
  assert.match(loop[0], /bindSampler\(unit, null\)/);
  assert.match(loop[0], /bindTexture\(gl\.TEXTURE_2D, null\)/);
  assert.match(loop[0], /bindTexture\(gl\.TEXTURE_3D, null\)/);
});

test('motor: hacim gürültüsü texImage3D ile yükleniyor', () => {
  assert.match(CODE, /texImage3D\(tgt, 0, gl\.RGBA8, size, size, depth, 0, gl\.RGBA, gl\.UNSIGNED_BYTE, px\)/);
  // Üç boyutlu sarma da kurulmalı; kurulmazsa z'de kenetlenir
  assert.match(CODE, /if \(depth > 1\) gl\.texParameteri\(tgt, gl\.TEXTURE_WRAP_R, gl\.REPEAT\)/);
});

/* Ölçekler MilkDrop'un kendi ölçekleri. Bu test asıl olarak mq ile hq'nun
   AYNI olmamasını koruyor: eşitlenirlerse iki ayrı doku isteyen preset
   yine tek desen alır ve hiçbir hata görünmez. */
test('motor: mq ve hq farklı kafes ölçeğinde üretiliyor', () => {
  const mq = /mq: two\(256, (\d+), /.exec(CODE);
  const hq = /hq: two\(256, (\d+), /.exec(CODE);
  assert.ok(mq && hq, 'mq/hq üretim satırları bulunamadı');
  assert.strictEqual(mq[1], '4');
  assert.strictEqual(hq[1], '8');
  assert.notStrictEqual(mq[1], hq[1]);
});

test('motor: hacim gürültüsü 32 kenarlı ve iki ölçekte', () => {
  assert.match(CODE, /volLq: three\(32, 1, /);
  assert.match(CODE, /volHq: three\(32, 4, /);
});

/* Mipmap olmadan uzaklaşan bir ağın üstündeki gürültü cızırdıyor —
   #560'ın 1. maddesindeki anizotropik süzme bunu kapatıyor. */
test('motor: gürültü dokuları mipmap ve anizotropik süzme alıyor', () => {
  assert.match(CODE, /generateMipmap\(tgt\)/);
  assert.match(CODE, /TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR/);
  assert.match(CODE, /EXT_texture_filter_anisotropic/);
  assert.match(CODE, /TEXTURE_MAX_ANISOTROPY_EXT/);
});

// ------------------------------------------------------- uyum anahtarı

test('ayar: MilkDrop uyumu varsayılan olarak açık', () => {
  assert.strictEqual(SV.DEFAULT_CONFIG.milkdrop.accurate, true);
});

/* Anahtar yalnızca DEĞERLERİ değiştiriyor, yapıyı değil: iki durumda da
   aynı doku nesneleri, aynı hedefler, aynı birimler. Yapı da değişseydi
   iki ayrı kod yolu ve iki ayrı test yüzeyi çıkardı. */
test('motor: anahtar kapalıyken de hacim gürültüsü üç boyutlu', () => {
  const three = /const three = \(size, zoom, smooth\) =>[\s\S]{0,200}?;/.exec(CODE);
  assert.ok(three, 'hacim üreteci bulunamadı');
  assert.match(three[0], /upload\(size, size, accurate \? lattice\([\s\S]*?\) : boxed\(/);
});

test('motor: anahtar değişince gürültü yeniden üretiliyor', () => {
  assert.match(CODE, /this\._wantAcc = !\(cfg\.milkdrop && cfg\.milkdrop\.accurate === false\)/);
  assert.match(CODE, /if \(this\.noise && this\._noiseAcc !== this\._wantAcc\) this\._buildNoise\(this\._wantAcc\)/);
});

/* Yeniden üretim eskisini SİLMELİ. Silinmezse anahtarla oynayan bir
   kullanıcı her seferinde altı doku daha sızdırır. */
test('motor: yeniden üretimden önce eski dokular siliniyor', () => {
  assert.match(CODE, /_buildNoise\(accurate\) \{[\s\S]{0,200}?this\._dropNoise\(\)/);
  assert.match(CODE, /_dropNoise\(\)[\s\S]*?gl\.deleteTexture\(n\.tex\)/);
});
