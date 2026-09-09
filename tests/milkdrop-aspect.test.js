'use strict';
/* EN-BOY ORANI — iki ayrı biçim, ve motorda yer değiştirmişlerdi.
 *
 * MilkDrop en-boyu içeride her zaman 1 ya da altında tutuyor: geniş ekranda
 * `aspX = 1`, `aspY = H/W`. Ağın koordinatları, `rad` ve `ang` ile shader'a
 * giden `aspect` bu çiftle hesaplanıyor.
 *
 * Denklem dilindeki `aspectx`/`aspecty` ise bunların TERSİ — MilkDrop
 * kaynağında `var_pf_aspectx = m_fInvAspectX`. Yani geniş ekranda preset
 * `aspectx = 1`, `aspecty = W/H` görüyor.
 *
 * Motorda büyük olan sayı `aspectx`e veriliyordu: ters değil, TAKAS.
 * `aspectx * x` yazan bir preset düzeltmeyi yanlış eksene uyguluyordu ve
 * hiçbir hata çıkmıyordu — yalnız geniş ekranda şekli yamuluyordu.
 * Korpusta %11,2'si denklemde, %25,7'si shader'da en-boy okuyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const SHARED = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'shared', 'milkdrop.js'), 'utf-8');

/* İç çift kaynaktan sökülüp GERÇEKTEN hesaplanıyor: yalnız metne bakan bir
   test, iki satır yer değiştirdiğinde de geçerdi. */
function pair(w, h) {
  const m = /const aspX = ([^;]+);\s*const aspY = ([^;]+);/.exec(CODE);
  assert.ok(m, 'iç en-boy satırları bulunamadı');
  const f = new Function('GW', 'GH', 'return [' + m[1] + ', ' + m[2] + '];');
  return f(w, h);
}

test('en-boy: iç çift her zaman 1 ya da altında', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [800, 800], [3840, 1080]]) {
    const [x, y] = pair(w, h);
    assert.ok(x <= 1 + 1e-9 && x > 0, 'aspX ' + w + 'x' + h + ' = ' + x);
    assert.ok(y <= 1 + 1e-9 && y > 0, 'aspY ' + w + 'x' + h + ' = ' + y);
  }
});

test('en-boy: geniş ekranda kısalan eksen Y', () => {
  /* Geniş ekranda MilkDrop `aspX = 1`, `aspY = H/W` diyor. Tersi olsaydı
     ağın yatay ve dikey ölçeği yer değiştirirdi. */
  const [x, y] = pair(1920, 1080);
  assert.strictEqual(x, 1);
  assert.ok(Math.abs(y - 1080 / 1920) < 1e-9, 'aspY = ' + y);
});

test('en-boy: dar ekranda kısalan eksen X', () => {
  const [x, y] = pair(1080, 1920);
  assert.strictEqual(y, 1);
  assert.ok(Math.abs(x - 1080 / 1920) < 1e-9, 'aspX = ' + x);
});

test('en-boy: kare ekranda ikisi de 1', () => {
  const [x, y] = pair(1000, 1000);
  assert.strictEqual(x, 1);
  assert.strictEqual(y, 1);
});

/* ASIL DÜZELTME: denklem dilindeki değerler iç çiftin TERSİ. Aynı sanmak
   hem takas hem ters çevirme yapıyordu. */
test('denklem: aspectx/aspecty iç çiftin tersi', () => {
  assert.match(CODE, /const aspectx = accAsp \? 1 \/ aspX :/);
  assert.match(CODE, /const aspecty = accAsp \? 1 \/ aspY :/);
});

test('denklem: geniş ekranda aspectx 1, aspecty W/H', () => {
  const [x, y] = pair(1920, 1080);
  assert.strictEqual(1 / x, 1);
  assert.ok(Math.abs(1 / y - 1920 / 1080) < 1e-9);
});

test('shader: aspect.xy iç çift, .zw tersleri', () => {
  assert.match(CODE, /set4\('aspect', ctx\.aspX, ctx\.aspY, 1 \/ ctx\.aspX, 1 \/ ctx\.aspY\)/);
  assert.match(CODE, /w: GW, h: GH, aspectx, aspecty, aspX, aspY,/);
});

test('en-boy: anahtar kapalıyken eski takas geri geliyor', () => {
  /* Eski davranış yanlıştı ama kullanıcıların izlediği görüntü buydu;
     anahtar kapalıyken aynı sayıları vermeye devam ediyor. */
  assert.match(CODE, /accAsp \? 1 \/ aspX : \(GW >= GH \? GW \/ GH : 1\)/);
  assert.match(CODE, /accAsp \? 1 \/ aspY : \(GW >= GH \? 1 : GH \/ GW\)/);
});

// ------------------------------------------------------------- pixelsx/y

/* `pixelsx`/`pixelsy` havuzda hiç yoktu, yani okuyan preset sıfır görüyordu
   ve bir piksele bölmek isteyen satır sonsuza gidiyordu. 178 preset (%1,7)
   okuyor. Anahtara bağlanmadı: eski değer bir davranış değil, eksiklikti. */
test('pixelsx/pixelsy: havuza yazılıyor', () => {
  assert.match(CODE, /pixelsx: GW, pixelsy: GH,/);
});

test('pixelsx/pixelsy: şekil ve dalga bloklarına da taşınıyor', () => {
  /* MilkDrop kare geneli değişkenleri alt havuzlara paylaştırıyor;
     taşınmayan bir ad orada sessizce sıfır kalır. */
  const m = /const SHARED_VARS = \[([\s\S]*?)\];/.exec(SHARED);
  assert.ok(m, 'SHARED_VARS bulunamadı');
  assert.match(m[1], /'pixelsx'/);
  assert.match(m[1], /'pixelsy'/);
});
