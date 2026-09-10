'use strict';
/* TEPE RENGİ 8 BİTE İNERKEN NE OLUYOR — MilkDrop'un `COLOR_NORM`u.
 *
 *     #define COLOR_NORM(x) (((int)(x * 255) & 0xFF) / 255.0f)
 *     (milkdropfs.cpp:37)
 *
 * KENETLEMİYOR, 256'ya göre SARIYOR. Denklemi 1,5 üreten bir preset
 * MilkDrop'ta 0,494 çiziyor, 1,0 değil. Negatifler de sarıyor: `(int)`
 * sıfıra doğru kırpıyor, `& 0xFF` iki tümleyen sonucu veriyor.
 *
 * Motor kenetliyordu, yani taşan her renk beyaza gidiyordu. Ölçüldü:
 * 10.347 presetin 3.818'i (%36,9) en az bir kez kenetlemeden anlamlı
 * biçimde farklı bir değer üretiyor; 2.055'i (%19,9) 1,4'ün üstüne çıkıyor,
 * ki orada sarma tamamen başka bir renk demek.
 *
 * MilkDrop'un uyguladığı yerler: şekil dolgusu (2185-2192), şekil kenar
 * çizgisi (2235-2238), özel dalga (2487-2490), varsayılan dalga
 * (3099-3102), kenarlıklar (3245-3248), hareket vektörleri (1235-1238) ve
 * `decay` (1795). Shader'ların ürettiği renge uygulanmaz — onlar bu
 * yoldan geçmiyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');
const cn = MD.colorNorm;

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BARE = CODE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* Referans: C ifadesinin JavaScript'te bire bir karşılığı. Testte yeniden
   yazmak yerine C'nin kendisini taklit ediyor, böylece asıl kod bir gün
   sadeleştirilirse fark burada yakalanır. */
const ref = (x) => ((Math.trunc(x * 255) & 0xFF)) / 255;

// ------------------------------------------------------------------ aralık

test('[0,1] içinde 1/255 adımlarına iniyor', () => {
  assert.strictEqual(cn(0), 0);
  assert.strictEqual(cn(1), 1);
  assert.ok(Math.abs(cn(0.5) - 127 / 255) < 1e-12, 'yarım = 127/255, 128 değil');
  /* `(int)` sıfıra doğru kırpıyor, yuvarlamıyor: 0,999 -> 254/255. */
  assert.ok(Math.abs(cn(0.999) - 254 / 255) < 1e-12);
});

test('1\'in ÜSTÜ sarıyor, kenetlenmiyor', () => {
  /* Farkın görüldüğü asıl yer. 1,5 -> (int)382 & 255 = 126 -> 0,494. */
  assert.ok(Math.abs(cn(1.5) - 126 / 255) < 1e-12, '1,5 için ' + cn(1.5));
  assert.ok(cn(1.5) < 0.6, 'kenetlenseydi 1,0 olurdu');
  assert.ok(Math.abs(cn(2.0) - 254 / 255) < 1e-12, '2,0 için ' + cn(2.0));
  assert.strictEqual(cn(256 / 255), 0, 'tam bir tur atınca sıfıra dönüyor');
});

test('SIFIRIN ALTI da sarıyor', () => {
  /* `(int)(-0,5*255)` = -127, `-127 & 0xFF` = 129 -> 0,506. */
  assert.ok(Math.abs(cn(-0.5) - 129 / 255) < 1e-12, '-0,5 için ' + cn(-0.5));
  assert.ok(cn(-0.5) > 0.4, 'kenetlenseydi 0 olurdu');
});

test('geniş bir aralıkta C ifadesiyle birebir', () => {
  for (let x = -4; x <= 4; x += 0.013) {
    assert.ok(Math.abs(cn(x) - ref(x)) < 1e-12, x + ' için ayrıştı');
  }
});

test('sayı olmayan ve sonsuz girdi 1 dönüyor', () => {
  /* Bir denklem NaN üretebiliyor. Sonuç bir tepe rengi olacağı için
     tanımsız değer GL\'e gidemez; `clampColor` ile aynı yedek. */
  for (const v of [NaN, Infinity, -Infinity, undefined, null, 'x']) {
    assert.strictEqual(cn(v), 1, String(v) + ' için');
  }
});

test('çok büyük sayı taşmıyor', () => {
  /* `|0` 2^31\'i aşınca sarardı; `Math.trunc` + `& 0xFF` aşmıyor. */
  for (const v of [1e9, -1e9, 1e15]) {
    const r = cn(v);
    assert.ok(isFinite(r) && r >= 0 && r <= 1, v + ' için ' + r);
  }
});

// -------------------------------------------------------------- bağlanışı

test('şekil dolgusu ve kenarı COLOR_NORM kullanıyor', () => {
  /* `alpha_mult` COLOR_NORM\'un İÇİNDE: MilkDrop önce çarpıp sonra 8 bite
     indiriyor. Dışında yapmak geçiş sırasında başka bir alfa verirdi. */
  assert.match(BARE, /const c1 = \[cn\(o\.r\), cn\(o\.g\), cn\(o\.b\), cn\(\(\+o\.a \|\| 0\) \* aMul\)\]/);
  assert.match(BARE, /const c2 = \[cn\(o\.r2\), cn\(o\.g2\), cn\(o\.b2\), cn\(\(\+o\.a2 \|\| 0\) \* aMul\)\]/);
  assert.match(BARE, /const ba = cn\(\(\+o\.border_a \|\| 0\) \* aMul\)/);
  assert.match(BARE, /d\[k \+ 2\] = cn\(o\.border_r\)/);
});

test('özel dalga, kenarlıklar ve hareket vektörleri COLOR_NORM kullanıyor', () => {
  assert.match(BARE, /d\[k \+ 5\] = cn\(\(\+o\.a \|\| 0\) \* aMul\)/);
  assert.match(BARE, /c: \[cn\(P\.get\('ob_r'\)\), cn\(P\.get\('ob_g'\)\), cn\(P\.get\('ob_b'\)\), cn\(P\.get\('ob_a'\)\)\]/);
  assert.match(BARE, /const r = cn\(P\.get\('mv_r'\)\), g = cn\(P\.get\('mv_g'\)\), b = cn\(P\.get\('mv_b'\)\)/);
  assert.match(BARE, /const al = cn\(a\)/);
});

test('varsayılan dalga rengi ÖNCE kenetleniyor, sonra 8 bite iniyor', () => {
  /* Tek istisna burası: MilkDrop varsayılan dalganın r/g/b\'sini
     COLOR_NORM\'dan önce ayrıca kenetliyor (milkdropfs.cpp:2623-2628), yani
     rengi sarmıyor — şekil ve özel dalgada sarıyor. Alfa kenetlenmiyor. */
  const fn = BARE.slice(BARE.indexOf('_drawWaveModes(gl, GW, GH)'));
  assert.match(fn, /let cr = cl\(P\.get\('wave_r'\)\)/, 'renk önce kenetlenmeli');
  assert.match(fn, /cr = cn\(cr\); cg = cn\(cg\); cb = cn\(cb\);/);
  assert.match(fn, /alpha = cn\(alpha\);/);
  const brighten = fn.indexOf('wave_brighten');
  const norm = fn.indexOf('cr = cn(cr)');
  assert.ok(brighten > 0 && norm > brighten,
    '8 bite indirme parlatmadan SONRA olmalı');
});

test('decay de COLOR_NORM\'dan geçiyor', () => {
  /* Bir tepe rengi olarak taşındığı için (milkdropfs.cpp:1795).
     `decay = 50,95` yazan preset MilkDrop\'ta 0,753 alıyor. */
  assert.match(BARE, /const decay = window\.SVMilkdrop\.colorNorm\(this\.preset\.get\('decay'\)\)/);
  assert.ok(Math.abs(cn(50.95) - 192 / 255) < 1e-9,
    '50,95 -> 0,753 olmalı, bulunan ' + cn(50.95));
});

test('shader rengi COLOR_NORM görmüyor', () => {
  /* Shader\'ın ürettiği renk 8 bitlik tepe rengi yolundan geçmiyor;
     oraya uygulamak MilkDrop\'un yapmadığı bir niceleme eklerdi. */
  const m = /_drawCompPass\(gl, dst, prog, ctx\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(m, '_drawCompPass bulunamadı');
  assert.doesNotMatch(m[0], /colorNorm|\bcn\(/);
  const warp = /_drawWarpPass\(gl, src, prog, ctx, step\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(warp, '_drawWarpPass bulunamadı');
  /* Warp\'ta yalnızca `decay` geçiyor — o gerçekten bir tepe rengi
     (milkdropfs.cpp:1795). Shader\'ın kendi çıktısına dokunulmuyor. */
  const kacKez = (warp[0].match(/colorNorm/g) || []).length;
  assert.strictEqual(kacKez, 1, 'warp yolunda yalnız decay 8 bite inmeli');
});
