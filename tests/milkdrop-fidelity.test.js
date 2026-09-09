'use strict';
/* MilkDrop'un SAYISAL UYUMU: roam ve hue_shader.
 *
 * İkisi de "shader derleniyor ama yanlış çiziyor" sınıfından. Derleme
 * ölçümü ikisini de %100 başarılı sayıyordu.
 *
 * 1) ROAM. MilkDrop dört bileşeni dört AYRI hızda döndürüyor
 *    (0,3 / 1,3 / 5 / 20) ve 0..1 aralığına haritalıyor. Bizde hızlar
 *    0,3 / 0,7 / 1,1 / 1,5 idi — birbirine o kadar yakın ki dördü de
 *    neredeyse aynı sayıyı veriyordu; "yavaş bileşenle hızlıyı karıştır"
 *    diye yazılmış preset düz çıkıyordu. Aralık da -1..1 idi: işareti
 *    değişen bir çarpan presetin yönünü tersine çevirebiliyor.
 *
 * 2) HUE_SHADER. MilkDrop bunu EKRAN BOYUNCA değiştiriyor: dört köşeye
 *    dört renk, arası çift doğrusal. Bizde tek renkti, yani `ret *=
 *    hue_shader` yazan preset bütün ekranı aynı tonda boyuyordu.
 *
 * Kaynağa bakan testler bilinçli: değerlerin GPU'daki etkisini burada
 * çalıştıramayız, ama yanlış değerin kaynakta bıraktığı iz kesin.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../src/shared/milkdrop-shader.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// ------------------------------------------------------------------ roam

test('roam: MilkDrop frekansları ve yavaş eşleri', () => {
  assert.match(CODE, /const RO = accurate \? \[0\.3, 1\.3, 5\.0, 20\.0\]/);
  assert.match(CODE, /const SRO = accurate \? \[0\.005, 0\.008, 0\.013, 0\.022\]/);
});

/* Aralık haritalaması ayrı bir testte: frekanslar doğru olup aralık
   -1..1 kalsaydı hiçbir şey hata vermez, yalnız işaret çarpanları
   ters dönerdi. */
test('roam: değerler 0..1 aralığına haritalanıyor', () => {
  assert.match(CODE, /const half = \(f\) => \(accurate \? 0\.5 \+ 0\.5 \* f : f\)/);
  for (const n of ['roam_cos', 'roam_sin', 'slow_roam_cos', 'slow_roam_sin']) {
    assert.match(CODE, new RegExp("set4\\('" + n + "', half\\("),
      n + ' half() üzerinden geçmeli');
  }
});

test('roam: anahtar kapalıyken eski frekanslar geri geliyor', () => {
  assert.match(CODE, /: \[0\.3, 0\.7, 1\.1, 1\.5\]/);
  assert.match(CODE, /: \[0\.05, 0\.09, 0\.13, 0\.17\]/);
});

// ------------------------------------------------------------- hue_shader

test('çeviri: hue_shader dört köşeden hesaplanıyor', () => {
  const r = T.translate('shader_body { ret = hue_shader; }');
  assert.match(r.glsl, /uniform vec3 hue_corner\[4\];/);
  assert.match(r.glsl, /hue_shader = hueAt\(uv\);/);
});

/* Çift doğrusal karışım kapalı biçimde, parça shader'ında. Tam ekran tek
   üçgenle çizildiği için köşe rengini donanıma bırakmak mümkün değil —
   üçgenin köşeleri ekranın köşeleri değil. */
test('çeviri: hueAt dört köşeyi çift doğrusal karıştırıyor', () => {
  const r = T.translate('shader_body { ret = hue_shader; }');
  assert.match(r.glsl, /hue_corner\[0\] \* x \* y/);
  assert.match(r.glsl, /hue_corner\[1\] \* \(1\.0 - x\) \* y/);
  assert.match(r.glsl, /hue_corner\[2\] \* x \* \(1\.0 - y\)/);
  assert.match(r.glsl, /hue_corner\[3\] \* \(1\.0 - x\) \* \(1\.0 - y\)/);
});

/* MilkDrop'un tarama sırası ekranın ÜSTÜNDEN başlıyor, bizim `uv.y` ise
   altta sıfır. Ters çevrilmezse renk geçişi dikeyde aynalanır — hata
   vermez, yalnız yanlış görünür. */
test('çeviri: hueAt dikeyde ters çeviriyor', () => {
  const r = T.translate('shader_body { ret = hue_shader; }');
  assert.match(r.glsl, /float y = 1\.0 - p\.y;/);
});

test('çeviri: warp aşaması da hue_shader alıyor', () => {
  const r = T.translate('shader_body { ret = hue_shader; }', { stage: 'warp' });
  assert.match(r.glsl, /hue_shader = hueAt\(uv\);/);
});

test('motor: köşe renkleri tek seferde yükleniyor', () => {
  assert.match(CODE, /L\.hue_corner = u\('hue_corner\[0\]'\)/);
  assert.match(CODE, /gl\.uniform3fv\(L\.hue_corner, hc\)/);
  // Dört köşe x üç bileşen
  assert.match(CODE, /new Float32Array\(12\)/);
});

/* Köşe başına ayrı faz olmasaydı dört köşe aynı rengi alırdı ve
   düzeltmenin tamamı boşa giderdi — ekran yine tek tonda olurdu. */
test('motor: köşe fazları birbirinden ayrı', () => {
  assert.match(CODE, /0\.6 \+ 0\.3 \* Math\.sin\(t \* 30 \* 0\.0143 \+ 3 \+ k \* 21/);
  assert.match(CODE, /0\.6 \+ 0\.3 \* Math\.sin\(t \* 30 \* 0\.0107 \+ 1 \+ k \* 13/);
  assert.match(CODE, /0\.6 \+ 0\.3 \* Math\.sin\(t \* 30 \* 0\.0129 \+ 6 \+ k \* 9/);
});

/* En büyük bileşene bölme rengi DOYURUYOR. Bölmezsek üç kanal da 0,6
   civarında kalır ve dört köşe de gri-beyaza yaklaşır. */
test('motor: köşe rengi en büyük bileşene bölünüp yeniden haritalanıyor', () => {
  assert.match(CODE, /const mx = Math\.max\(r, g, b\) \|\| 1;/);
  assert.match(CODE, /r = 0\.5 \+ 0\.5 \* \(r \/ mx\)/);
});

/* Anahtar kapalıyken YAPI aynı kalıyor: yine dört köşe, yine aynı
   shader, yine aynı uniform. Yalnız dördüne de aynı renk gidiyor. */
test('motor: anahtar kapalıyken dört köşe de aynı rengi alıyor', () => {
  const blk = /if \(L\.hue_corner\) \{[\s\S]*?gl\.uniform3fv/.exec(CODE);
  assert.ok(blk, 'hue_corner bloğu bulunamadı');
  assert.match(blk[0], /r = 0\.5 \+ 0\.5 \* Math\.sin\(t \* 0\.31\)/);
  assert.match(blk[0], /g = 0\.5 \+ 0\.5 \* Math\.sin\(t \* 0\.31 \+ 2\.09\)/);
  // Kapalı kipte k'ya bağlı hiçbir terim olmamalı; yoksa köşeler ayrışırdı
  const legacy = /\} else \{[\s\S]*?\}/.exec(blk[0]);
  assert.ok(legacy && !/\bk\b/.test(legacy[0]), 'kapalı kip köşeye bağlı olmamalı');
});

/* `rand_start` MilkDrop'ta preset başına dört rastgele sayı; bizde
   `randPreset`. Kullanılmazsa her preset aynı renk döngüsünü alır. */
test('motor: köşe renkleri preset rastgeleliğini kullanıyor', () => {
  assert.match(CODE, /const rs = this\.randPreset \|\| \[0, 0, 0, 0\]/);
  assert.match(CODE, /\+ rs\[3\]\)/);
  assert.match(CODE, /\+ rs\[1\]\)/);
  assert.match(CODE, /\+ rs\[2\]\)/);
});

// ------------------------------------------------------------ bulanıklık

/* Çekirdek aritmetiği GERÇEKTEN koşturuluyor: `BLUR_KERNEL` kendi kendine
   yeten bir blok, kaynaktan çıkarılıp değerlendirilebiliyor. Regex bir
   ağırlığın yanlış yazılmasını yakalamaz, bu yakalar. */
/* Kayan nokta toplami: 4,0 + 3,8 tam olarak 7,8 etmiyor. Karsilastirma
   toleransli, cunku burada onemli olan agirliklarin DOGRU olmasi, ikili
   gosterimin son biti degil. */
function close(got, want, eps) {
  assert.strictEqual(got.length, want.length);
  for (let i = 0; i < want.length; i++) {
    assert.ok(Math.abs(got[i] - want[i]) < (eps || 1e-9),
      i + '. deger ' + got[i] + ', beklenen ' + want[i]);
  }
}

function blurKernel() {
  const raw = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
  const at = raw.indexOf('const BLUR_KERNEL = (() => {');
  assert.ok(at >= 0, 'BLUR_KERNEL bulunamadı');
  const end = raw.indexOf('\n  })();', at);
  assert.ok(end > at, 'BLUR_KERNEL sonu bulunamadı');
  const body = raw.slice(at + 'const BLUR_KERNEL = '.length, end + '\n  })()'.length);
  // eslint-disable-next-line no-new-func
  return new Function('return ' + body)();
}

test('bulanıklık: yatay çekirdek sekiz ağırlığı dört çifte topluyor', () => {
  const k = blurKernel();
  close(k.h.w, [7.8, 6.4, 3.1, 1.0]);
  assert.strictEqual(k.h.center, 0);
  // Çiftin uzaklığı ağırlık oranıyla kayıyor; ilk çift merkezi de kapsıyor
  assert.ok(k.h.d[0] > 0.9 && k.h.d[0] < 1.0, 'ilk çift merkeze bitişik olmalı');
  for (let i = 1; i < 4; i++) assert.ok(k.h.d[i] > k.h.d[i - 1], 'uzaklıklar artmalı');
});

test('bulanıklık: dikey çekirdek iki çift kullanıyor', () => {
  const k = blurKernel();
  close(k.v.w, [14.2, 4.1, 0, 0]);
  assert.deepStrictEqual(k.v.d.slice(2), [0, 0], 'kullanılmayan çiftler sıfır');
});

/* İki geçişin böleni aynı sayıya çıkıyor: aynı ağırlık toplamının iki
   farklı gruplanması. Tutmazsa geçişlerden biri görüntüyü karartır ya da
   parlatır ve geri besleme döngüsünde bu birikir. */
test('bulanıklık: yatay ve dikey bölen aynı', () => {
  const k = blurKernel();
  assert.ok(Math.abs(k.h.norm - k.v.norm) < 1e-12, k.h.norm + ' != ' + k.v.norm);
});

test('bulanıklık: her çekirdek bire normalleniyor', () => {
  const k = blurKernel();
  const total = (x) => (x.center + 2 * (x.w[0] + x.w[1] + x.w[2] + x.w[3])) * x.norm;
  assert.ok(Math.abs(total(k.h) - 1) < 1e-9, 'yatay toplam ' + total(k.h));
  assert.ok(Math.abs(total(k.v) - 1) < 1e-9, 'dikey toplam ' + total(k.v));
  assert.ok(Math.abs(total(k.legacy) - 1) < 1e-3, 'eski toplam ' + total(k.legacy));
});

test('bulanıklık: kademe oranları MilkDrop değerleri', () => {
  assert.match(CODE, /BLUR_RATIOS = \[\[0\.5, 0\.25\], \[0\.125, 0\.125\], \[0\.0625, 0\.0625\]\]/);
  assert.match(CODE, /BLUR_RATIOS_LEGACY = \[\[0\.5, 0\.5\], \[0\.25, 0\.25\], \[0\.125, 0\.125\]\]/);
});

test('bulanıklık: boyutlar 16 ve 4 katına hizalanıyor, en az 16', () => {
  assert.match(CODE, /Math\.floor\(\(Math\.max\(W \* r, 16\) \+ 3\) \/ 16\) \* 16/);
  assert.match(CODE, /Math\.floor\(\(Math\.max\(H \* r, 16\) \+ 3\) \/ 4\) \* 4/);
});

/* Yatay ve dikey hedefler artık farklı boyutta. Adım HEDEFİN tekseliyle
   hesaplansaydı çekirdek kademe başına sessizce genişler ya da daralırdı. */
test('bulanıklık: adım kaynağın tekseline göre', () => {
  assert.match(CODE, /gl\.uniform2f\(L\.uStep, 1 \/ iw, 0\)/);
  assert.match(CODE, /gl\.uniform2f\(L\.uStep, 0, 1 \/ b\.hh\)/);
});

test('bulanıklık: ölçek yalnız ikinci geçişe uygulanıyor', () => {
  const fn = /_buildBlur\(srcTex\) \{[\s\S]*?\n    \}/.exec(CODE);
  assert.ok(fn, '_buildBlur bulunamadı');
  assert.match(fn[0], /setSB\(1, 0\);/, 'yatay geçiş birim ölçek almalı');
  assert.match(fn[0], /setSB\(sb\[i\]\[0\], sb\[i\]\[1\]\)/, 'dikey geçiş gerçek ölçeği almalı');
});

/* İkinci ve üçüncü kademenin aralığı BİR ÖNCEKİ kademenin aralığına göre
   veriliyor: girdisi zaten sıkıştırılmış olan o doku. */
test('bulanıklık: ölçek zinciri bir önceki kademeye göre', () => {
  assert.match(CODE, /const span = safe\(mx\[i - 1\] - mn\[i - 1\]\)/);
  assert.match(CODE, /const lo = \(mn\[i\] - mn\[i - 1\]\) \/ span/);
  assert.match(CODE, /const hi = \(mx\[i\] - mn\[i - 1\]\) \/ span/);
});

/* b1n ile b1x'i eşit yazan bir preset var olabilir; sonsuz ölçek bütün
   kareyi beyaza çevirirdi. */
test('bulanıklık: sıfıra bölme korunuyor', () => {
  assert.match(CODE, /const safe = \(d\) => \(Math\.abs\(d\) < 1e-6 \? 1e-6 : d\)/);
});

test('bulanıklık: GetBlurN geri açma çarpanını uniform"dan alıyor', () => {
  const r = T.translate('shader_body { ret = GetBlur1(uv); }');
  assert.match(r.glsl, /GetBlur1\(vec2 u\)\{ return texture\(sampler_blur1, u\)\.xyz \* blur1_scale \+ blur1_min; \}/);
  assert.match(r.glsl, /uniform vec3 blur1_scale, blur2_scale, blur3_scale;/);
});

test('bulanıklık: çarpan açıkken aralık, kapalıyken eski davranış', () => {
  assert.match(CODE, /const sc = accurate \? hi - lo : hi;/);
  assert.match(CODE, /set3\('blur' \+ i \+ '_scale', sc, sc, sc\)/);
});

/* Mipmap çerçeve tamponu bırakıldıktan SONRA üretilmeli ve HER karede
   üretilmeli: eksik bir mipmap zinciri dokuyu tamamlanmamış yapar ve
   siyah okutur. */
test('bulanıklık: mipmap tampon bırakıldıktan sonra üretiliyor', () => {
  const fn = /_buildBlur\(srcTex\) \{[\s\S]*?\n    \}/.exec(CODE);
  const unbind = fn[0].indexOf('gl.bindFramebuffer(gl.FRAMEBUFFER, null)');
  const mip = fn[0].indexOf('generateMipmap');
  assert.ok(unbind >= 0 && mip > unbind, 'mipmap tampon bırakıldıktan sonra gelmeli');
  assert.match(CODE, /TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR/);
});

test('bulanıklık: anahtar değişince kademeler yeniden kuruluyor', () => {
  assert.match(CODE, /if \(this\.blur && this\._blurAcc !== acc\) this\._disposeTargets\(\)/);
});
