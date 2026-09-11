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

/* İç kenarlık dıştakinin BİTTİĞİ yerden başlamalı. İkisi de kenardan
   ölçseydi iç kenarlık dışın altına gizlenir ve hiç görünmezdi. */
test('kenarlık: iç halka dış halkanın bittiği yerden başlıyor', () => {
  assert.match(BORDER[0], /\{ size: P\.get\('ib_size'\), prev: P\.get\('ob_size'\)/);
  assert.match(BORDER[0], /\{ size: P\.get\('ob_size'\), prev: 0,/);
});

/* Halka DÖRT ŞERİT. Tek bir büyük dikdörtgenin üstüne küçüğünü çizmek de
   halka verirdi ama saydam bir kenarlıkta köşeler iki kez harmanlanır ve
   dört köşe gövdeden koyu çıkardı. */
test('kenarlık: dört şerit ve köşede üst üste binme yok', () => {
  const quads = /const quads = \[([\s\S]*?)\];/.exec(BORDER[0]);
  assert.ok(quads, 'şerit listesi bulunamadı');
  const rows = quads[1].split('\n').filter((l) => l.indexOf('[') >= 0);
  assert.strictEqual(rows.length, 4, 'dört şerit olmalı');
  /* Sol ve sağ şeritler dikeyde kenarlık kalınlığı kadar İÇERİ çekiliyor
     (-1 + p1 .. 1 - p1), üst ve alt şeritler ise yatayda dışa kadar
     gidiyor (-1 + p0 .. 1 - p0). Çakışma tam bu yüzden olmuyor. */
  assert.match(rows[0], /-1 \+ p0, -1 \+ p1, -1 \+ p1, 1 - p1/);
  assert.match(rows[1], /1 - p1, 1 - p0, -1 \+ p1, 1 - p1/);
  assert.match(rows[2], /-1 \+ p0, 1 - p0, -1 \+ p0, -1 \+ p1/);
  assert.match(rows[3], /-1 \+ p0, 1 - p0, 1 - p1, 1 - p0/);
});

test('kenarlık: görünmez halka hiç çizilmiyor', () => {
  /* Alfası ya da boyu sıfır olan halka için tek bir çizim çağrısı bile
     yapılmamalı: presetlerin %99,7'si bu anahtarları taşıyor ama çoğunda
     ikisi de sıfır. */
  assert.match(BORDER[0], /if \(!\(size > 0\) \|\| !\(r\.c\[3\] > 0\.002\)\) continue;/);
});

test('kenarlık: kalınlık ekranı taşmıyor', () => {
  /* `ob_size = 3` yazan bir preset olabilir; kırpılmazsa şeritler ters
     dönüp bütün ekranı kaplardı. */
  assert.match(BORDER[0], /Math\.min\(1, size \+ prev\)/);
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
