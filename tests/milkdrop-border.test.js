'use strict';
/* KENARLIKLAR ve MERKEZ KARARTMA.
 *
 * Presetlerin %99,7'si `ob_*` ve `ib_*` değerlerini dosyasında taşıyor;
 * 3.100'ü (%30,0) görünür bir dış, 1.575'i (%15,2) görünür bir iç kenarlık
 * istiyor. Motor hiçbirini çizmiyordu. `bDarkenCenter` de öyle: 711 preset
 * (%6,9) açık bırakıyor.
 *
 * Çizimin kendisi bir deneyle doğrulandı — kırmızı dış, mavi iç kenarlıklı
 * sentetik bir preset, sonra tek tek piksel okuması: 4. pikselde kırmızı,
 * 12.'de mavi, 40.'da gövde. Buradaki testler o davranışın kaynaktaki
 * koşullarını sabitliyor, çünkü GPU'suz çalıştırılamıyorlar.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const BORDER = /_drawBorders\(gl\) \{[\s\S]*?\n    \}/.exec(BODY);
const DARK = /_drawDarkenCenter\(gl, GW, GH\) \{[\s\S]*?\n    \}/.exec(BODY);

test('sıra: kenarlıklar çizimlerin EN SONUNDA', () => {
  /* MilkDrop'ta da sıra bu. Daha önce çizilseler dalga, şekil ve hareket
     vektörleri kenarlığın üstünü kapatırdı. */
  assert.match(BODY, /_drawMotionVectors\(gl[^)]*\);\s*this\._drawDarkenCenter\(gl, GW, GH\);\s*this\._drawBorders\(gl\);/);
});

test('kenarlık: iki halka da kendi renk ve boyunu okuyor', () => {
  assert.ok(BORDER, '_drawBorders bulunamadı');
  for (const k of ['ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a',
    'ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a']) {
    assert.match(BORDER[0], new RegExp("get\\('" + k + "'\\)"), k + ' okunmuyor');
  }
});

/* GEOMETRİ MilkDrop'unki (#580; milkdropfs.cpp:3226-3284): kırpma uzayında
   şerit, her kenarda gönye kesimli bir yamuk, kalınlık sınırsız, eşik ham
   saydamlıkta. Testler üçgenleri noktalarla örnekliyor: bir nokta kaç
   üçgenin içinde (0 = boş, 1 = tek harman, 2 = üst üste). */
const M = require('../src/shared/milkdrop.js');
function cover(tris, x, y) {
  let n = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const s = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) n++;
  }
  return n;
}
const ringOf = (rings, k) => (rings.find((r) => r.ring === k) || { verts: [] }).verts;

test('kenarlık: dış şerit kenardan içeri, iç şerit onun bittiği yerden; köşede tek kat', () => {
  const r = M.borderRings(0.1, 0.05, 0.5, 0.5);
  const outer = ringOf(r, 0), inner = ringOf(r, 1);
  assert.strictEqual(outer.length, 24);
  // Dış: 0,9 < |x| < 1 ya da |y| aynısı
  assert.strictEqual(cover(outer, 0.95, 0.3), 1);
  assert.strictEqual(cover(outer, -0.3, -0.95), 1);
  assert.strictEqual(cover(outer, 0.85, 0.3), 0);
  // Köşe gönye kesimli: iki yamuk paylaşıyor, iki kat değil
  assert.strictEqual(cover(outer, 0.95, 0.96), 1);
  assert.strictEqual(cover(outer, -0.97, 0.93), 1);
  // İç: 0,85 < |x| < 0,9
  assert.strictEqual(cover(inner, 0.87, 0.2), 1);
  assert.strictEqual(cover(inner, 0.95, 0.2), 0);
  assert.strictEqual(cover(inner, 0.8, 0.2), 0);
  // Ortası boş
  assert.strictEqual(cover(outer.concat(inner), 0, 0), 0);
});

test('kenarlık: eşik ham saydamlıkta, 0,001', () => {
  assert.deepStrictEqual(M.borderRings(0.1, 0.1, 0.001, 0), []);
  assert.strictEqual(M.borderRings(0.1, 0.1, 0.0015, 0).length, 1, 'renk sarmasından önce: 0,0015 çiziliyor');
  // 1'in üstü de ham değerle geçiyor; rengini colorNorm sarıyor
  assert.strictEqual(M.borderRings(0.1, 0.1, 1.001, 0).length, 1);
  assert.deepStrictEqual(M.borderRings(NaN, 0.1, 0.5, 0), [], 'kalınlık sayı değilse çizilmiyor');
});

test('kenarlık: eksi kalınlık — içte dış şeridin üstüne binen şerit, dışta ekran dışı', () => {
  // ob 0,1, ib −0,05: iç şerit 0,9..0,95 arası, dış şeridin içinde
  const inner = ringOf(M.borderRings(0.1, -0.05, 0, 0.5), 1);
  assert.strictEqual(cover(inner, 0.92, 0.1), 1);
  assert.strictEqual(cover(inner, 0.97, 0.1), 0);
  // ob −0,1: dış şerit 1..1,1, ekranın dışında
  const outer = ringOf(M.borderRings(-0.1, 0, 0.5, 0), 0);
  assert.strictEqual(cover(outer, 0.99, 0), 0);
  assert.strictEqual(cover(outer, 1.05, 0), 1);
});

test('kenarlık: 1\'in üstündeki kalınlık ortada üst üste biniyor', () => {
  // ob 1: yamuklar merkezde birleşiyor, ekran tek katla kaplı
  const full = ringOf(M.borderRings(1, 0, 0.5, 0), 0);
  assert.strictEqual(cover(full, 0.3, 0.1), 1);
  assert.strictEqual(cover(full, -0.6, 0.55), 1);
  // ob 1,2: dört yamuk da merkezi aşıyor, ortada dört kat harmanlanıyor
  const over = ringOf(M.borderRings(1.2, 0, 0.5, 0), 0);
  assert.strictEqual(cover(over, 0.05, 0.0), 4);
  assert.strictEqual(cover(over, 0.9, 0.2), 1);
});

test('kenarlık: çizim geometriyi motorun işlevinden alıyor', () => {
  assert.match(BORDER[0], /window\.SVMilkdrop\.borderRings\(\+P\.get\('ob_size'\), \+P\.get\('ib_size'\), \+P\.get\('ob_a'\), \+P\.get\('ib_a'\)\)/);
});

test('kenarlık: anahtar kapalıyken hiç çizilmiyor', () => {
  assert.match(BORDER[0], /if \(!P \|\| this\._wantAcc === false\) return;/);
});

// ------------------------------------------------------- merkez karartma

test('merkez karartma: ayar okunuyor', () => {
  assert.ok(DARK, '_drawDarkenCenter bulunamadı');
  assert.match(DARK[0], /if \(!\(P\.get\('darken_center'\) > 0\)\) return;/);
});

/* Biçim MilkDrop'un kendi biçimi: yarım boyu 0,05 olan bir baklava, merkezde
   alfa 3/32, köşelerde 0. Sert bir leke değil, sönen bir gölge — köşelerin
   alfası 0 olmazsa ortada belirgin bir kare çıkar. */
test('merkez karartma: MilkDrop biçimi ve alfası', () => {
  assert.match(DARK[0], /const h = 0\.05;/);
  assert.match(DARK[0], /d\[k \+ 5\] = i === 0 \? 3 \/ 32 : 0;/);
  assert.match(DARK[0], /\[\[0, 0\], \[-h \* aspY, 0\], \[0, -h\], \[h \* aspY, 0\], \[0, h\], \[-h \* aspY, 0\]\]/);
  // Renk siyah: karartma, renk katmıyor
  assert.match(DARK[0], /d\[k \+ 2\] = 0; d\[k \+ 3\] = 0; d\[k \+ 4\] = 0;/);
});

test('merkez karartma: en-boy düzeltmesi X ekseninde', () => {
  /* Y'den ölçeklemek de baklavayı düzeltir ama geniş ekranda karartmayı
     olduğundan büyük yapar; şekillerde de aynı kural geçerli. */
  assert.match(DARK[0], /const aspY = GW > GH \? GH \/ GW : 1;/);
});

test('merkez karartma: anahtar kapalıyken çizilmiyor', () => {
  assert.match(DARK[0], /if \(!P \|\| this\._wantAcc === false\) return;/);
});
