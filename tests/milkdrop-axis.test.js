'use strict';
/* AĞIN DÜĞÜM DÖNÜŞÜMÜ — eksen, sıra ve en-boy.
 *
 * MilkDrop düğüm dönüşümünü kendi uzayında yapıyor: v ekseni yukarıdan
 * aşağı (`y = 0` üst), en-boy dönüşümün başında uygulanıp sonunda geri
 * alınıyor, adımların sırası zum → gerdirme → warp → dönme → öteleme.
 *
 * Motorda üçü de farklıydı ve hiçbiri hata vermiyordu:
 *   - eksen aynalanmıştı, `dy`/`cy`/`rot` ters yönde çalışıyordu
 *   - en-boy ağa hiç girmiyordu
 *   - zum merkez etrafındaydı, dönme ile gerdirme yer değiştirmişti,
 *     warp en sona atılmıştı
 *
 * Yön bir deneyle ölçüldü (`scratchpad/drift.js`): merkezde sabit bir
 * şekil, `dy = +0,02`, başka hareket yok. Düzeltmeden önce iz YUKARI,
 * sonra AŞAĞI uzuyor — MilkDrop'un cebriyle aynı yön. Testler kaynağa
 * bakıyor, çünkü asıl kanıt GPU'da ve başlıksız bir WebGL2 bağlamı
 * olmadan burada çalıştırılamıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const MESH = /_warpMeshPass\(P, clock, rep\) \{[\s\S]*?\n    \}/.exec(BODY);
const ACC = MESH && /if \(acc\) \{([\s\S]*?)\n          \} else \{/.exec(MESH[0]);
const LEG = MESH && /\n          \} else \{([\s\S]*?)\n          \}/.exec(MESH[0]);

test('ağ: uyumlu ve eski yol ayrı ayrı duruyor', () => {
  assert.ok(MESH, '_warpMeshPass bulunamadı');
  assert.ok(ACC, 'uyumlu yol bulunamadı');
  assert.ok(LEG, 'eski yol bulunamadı');
  assert.match(MESH[0], /const acc = this\._wantAcc !== false;/);
});

// ------------------------------------------------------------------ eksen

/* Dikey çevirme FORMÜLÜN İÇİNDE (`-ay`), ayrı bir `1 - w` adımı yok.
   İkisi birden olsaydı çevirme iki kez uygulanır ve görüntü baş aşağı
   dönerdi — bu, dönüşümü yeniden yazarken en kolay yapılacak hata. */
test('eksen: dikey çevirme dönüşümün kendisinde, iki kez değil', () => {
  assert.match(ACC[1], /sv = cy0 \* -ay \* 0\.5 \* zi \+ 0\.5;/);
  assert.match(ACC[1], /cy0 \* -0\.5 \* ay \+ 0\.5/);
  assert.ok(!/1 - w/.test(ACC[1]), 'ayrı bir `1 - w` çevirmesi kalmış');
});

test('eksen: doku koordinatı kendi eksenine geri çevriliyor', () => {
  /* Dönüşüm MilkDrop uzayında (v = 0 üst), dokuya yazılan değer bizim
     uzayımızda (v = 0 alt). */
  assert.match(ACC[1], /fv = 1 - sv;/);
  assert.match(LEG[1], /fv = sv;/);
});

test('çizim katmanı: şekil ve dalga ekseni zaten MilkDrop yönünde', () => {
  /* Ters olan yalnız ağdı. Bu test o ayrımı sabitliyor: biri düzeltilip
     diğeri düzeltilirse ikisi yeniden birbirinden ayrılır. */
  assert.match(BODY, /_toClipY\(y\) \{ return 1 - 2 \* y; \}/);
});

// ------------------------------------------------------------------ en-boy

/* En-boy başta uygulanıp SONUNDA geri alınıyor. Aradaki adımlar bu yüzden
   kare bir uzayda çalışıyor: geniş ekranda bir daire daire kalıyor. Yalnız
   biri yapılırsa görüntü kalıcı olarak yamulur. */
test('en-boy: dönüşümün başında uygulanıp sonunda geri alınıyor', () => {
  assert.match(ACC[1], /su = cx0 \* ax \* 0\.5 \* zi \+ 0\.5;/);
  assert.match(ACC[1], /su = \(su - 0\.5\) \/ ax \+ 0\.5;/);
  assert.match(ACC[1], /sv = \(sv - 0\.5\) \/ ay \+ 0\.5;/);
});

test('en-boy: ağ karedeki iç çifti kullanıyor', () => {
  assert.match(BODY, /this\._aspX = aspX; this\._aspY = aspY;/);
  assert.match(ACC[1], /const ax = this\._aspX \|\| 1;/);
  assert.match(ACC[1], /const ay = this\._aspY \|\| 1;/);
});

// -------------------------------------------------------------- rad / ang

/* `rad` ÖLÇEKLENMİYOR: MilkDrop'ta köşede 1'i aşıyor. Bizde 0,7071 ile
   çarpılıp 1'e kenetleniyordu, yani `pow(zoom, pow(zoomexp, rad*2-1))`
   üssünün üst yarısı hiç kullanılmıyordu. */
test('rad: en-boy farkındalı ve ölçeklenmemiş', () => {
  assert.match(ACC[1], /rad = Math\.sqrt\(cx0 \* cx0 \* ax \* ax \+ cy0 \* cy0 \* ay \* ay\);/);
  assert.ok(!/0\.7071/.test(ACC[1]), 'uyumlu yolda hâlâ 0.7071 var');
  assert.match(LEG[1], /Math\.min\(1, Math\.hypot\(cx0, cy0\) \* 0\.7071\)/);
});

test('rad: köşede 1\'i aşıyor', () => {
  const m = /rad = (Math\.sqrt\([^;]+);/.exec(ACC[1]);
  assert.ok(m, 'rad satırı bulunamadı');
  const f = new Function('cx0', 'cy0', 'ax', 'ay', 'Math', 'return ' + m[1] + ';');
  assert.ok(Math.abs(f(1, 1, 1, 1, Math) - Math.SQRT2) < 1e-12, 'kare ekranda köşe √2 olmalı');
  assert.strictEqual(f(0, 0, 1, 1, Math), 0, 'merkez 0 olmalı');
  // Geniş ekranda dikey eksen kısalıyor
  assert.ok(f(0, 1, 1, 0.5625, Math) < f(1, 0, 1, 0.5625, Math));
});

test('ang: (-π, π] aralığında ve merkez sabitleniyor', () => {
  assert.match(ACC[1], /Math\.atan2\(cy0 \* ay, cx0 \* ax\)/);
  assert.ok(!/ang \+= Math\.PI \* 2/.test(ACC[1]), 'uyumlu yolda hâlâ 0..2π kaydırması var');
  /* Tam merkezdeki düğümde atan2(0,0) tanımsız; MilkDrop orayı 0
     sabitliyor. Sabitlenmezse yön ızgara sıklığına göre rastgele çıkar. */
  assert.match(ACC[1], /i === \(this\.meshX >> 1\) && j === \(this\.meshY >> 1\)/);
  assert.match(LEG[1], /ang \+= Math\.PI \* 2/);
});

// -------------------------------------------------------------------- sıra

/* SIRA MilkDrop'un sırası: zum (ekran ortasında) → gerdirme → warp →
   dönme → öteleme. Motorda zum merkez etrafındaydı, dönme ile gerdirme
   yer değiştirmişti ve warp en sona atılmıştı. `rot` ile `cx/cy`yi
   birlikte kullanan presetlerde sonuç bambaşka çıkıyordu. */
test('sıra: zum → gerdirme → warp → dönme → öteleme', () => {
  const idx = (re) => {
    const m = re.exec(ACC[1]);
    assert.ok(m, 'adım bulunamadı: ' + re);
    return m.index;
  };
  const zoom = idx(/su = cx0 \* ax \* 0\.5 \* zi \+ 0\.5;/);
  const stretch = idx(/su = \(su - cx\) \/ sx \+ cx;/);
  const warp = idx(/const wr = p\.warp \* 0\.0035;/);
  const rot = idx(/su = du \* ca - dv \* sa \+ cx;/);
  const move = idx(/su -= p\.dx;/);
  const undo = idx(/su = \(su - 0\.5\) \/ ax \+ 0\.5;/);
  assert.ok(zoom < stretch, 'zum gerdirmeden önce');
  assert.ok(stretch < warp, 'gerdirme warp\'tan önce');
  assert.ok(warp < rot, 'warp dönmeden önce');
  assert.ok(rot < move, 'dönme ötelemeden önce');
  assert.ok(move < undo, 'öteleme en-boy geri almadan önce');
});

test('sıra: zum EKRAN ORTASINDA, merkez etrafında değil', () => {
  /* `+ 0.5` merkezi sabit; `(u - cx)/z + cx` olsaydı zum presetin
     merkezine kayardı ve `cx`/`cy` iki kez etki ederdi. */
  assert.match(ACC[1], /su = cx0 \* ax \* 0\.5 \* zi \+ 0\.5;/);
  assert.ok(!/su = \(u - cx\) \/ z \+ cx/.test(ACC[1]));
  assert.match(LEG[1], /su = \(u - cx\) \/ z \+ cx;/);
});

test('anahtar kapalıyken eski sıra ve eski desen aynen duruyor', () => {
  /* Eski davranış bir uyum değil ama kullanıcıların aylardır izlediği
     görüntü. Yeni yola bakarak "sadeleştirmek" iki yolu birbirine
     yaklaştırır ve anahtarın anlamını götürür. */
  assert.match(LEG[1], /P\.pixel\(u, w, rad, ang, this\._pix\)/);
  assert.match(LEG[1], /su \+= wr \* Math\.sin\(warpTime \* 0\.333 \+ cx0 \* 5 \+ cy0 \* 3\);/);
  const legRot = LEG[1].indexOf('su = du * ca - dv * sa + cx;');
  const legStretch = LEG[1].indexOf('su = (su - cx) / sx + cx;');
  assert.ok(legRot >= 0 && legStretch >= 0);
  assert.ok(legRot < legStretch, 'eski yolda dönme gerdirmeden önceydi');
});
