'use strict';
/* MilkDrop'un DOKULU şekilleri (shapecode_N_textured=1).
 *
 * Neden bu test var: dokulu şekiller desteklenmediğinde motor onları DÜZ
 * RENK bir çokgen olarak çiziyordu. Renkleri çoğunlukla beyaz ve yarıçapları
 * ekranı kaplayacak kadar büyük olduğu için sonuç bembeyaz bir ekrandı —
 * 900 presetlik ölçümde "patlamış" sınıfının tamamı buydu ve shader'lar
 * hatasız derlendiği için derleme ölçümü hiçbir şey görmüyordu.
 *
 * Korpusta presetlerin %40,3'ü dokulu şekil kullanıyor, %12,1'inde şekil
 * ekranı kaplıyor. Sessizce kaybedilebilecek bir özellik olduğu için
 * yapısal olarak sabitleniyor: GPU olmadan çizim sınanamıyor, ama çizim
 * YOLUNUN varlığı sınanabiliyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const MD = require('../src/shared/milkdrop.js');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');

/* Yorumlar çıkarılıyor: yorum içinde geçen bir ad, silinmiş bir kodu hâlâ
   varmış gibi gösterip testi işe yaramaz hale getirir. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const CODE = stripComments(SRC);

test('ayrıştırıcı: textured ve tex_zoom/tex_ang şekilden okunuyor', () => {
  const p = new MD.Preset(
    'shapecode_0_enabled=1\nshapecode_0_textured=1\nshapecode_0_tex_zoom=2.5\n' +
    'shapecode_0_tex_ang=1.25\nshapecode_0_rad=1.9\nshapecode_0_sides=4\n', { seed: 1 });
  const s = p.shapes[0];
  assert.ok(s, 'şekil ayrıştırılmalı');
  assert.strictEqual(s.textured, true);
  const o = p.shapeFrame(s, 0, {});
  assert.strictEqual(o.tex_zoom, 2.5);
  assert.strictEqual(o.tex_ang, 1.25);
});

test('motor: dokulu şekiller için ayrı bir çizim yolu var', () => {
  assert.ok(/s\.textured/.test(CODE),
    'çizim döngüsü s.textured üzerinden dallanmalı; yoksa dokulu şekiller ' +
    'düz renk çizilir ve ekran beyaza boğulur');
});

test('motor: dokulu şekil dokuyu RENKLE ÇARPIYOR, yerine koymuyor', () => {
  /* MilkDrop şekil rengini örneklenen dokuyla modüle ediyor. Yerine koymak
     şeklin rengini tümden yok sayardı; çarpmamak ise dokuyu. */
  assert.match(CODE, /texture\(uSrc, vUV\) \* vCol/);
});

test('motor: dokulu şekil ÖNCEKİ kareyi örnekliyor', () => {
  /* Şu an yazılan hedeften okumak tanımsız davranış: aynı dokuya yazarken
     ondan okumak sürücüye göre değişen çöp verir. Kaynak, warp'a girdi olan
     kare olmalı. */
  assert.match(CODE, /_shapeSrcTex = src\.tex/);
  assert.ok(!/_shapeSrcTex = dst/.test(CODE),
    'hedef tampon şekil dokusu olarak bağlanmamalı');
});

test('motor: doku koordinatı tex_zoom ve tex_ang kullanıyor', () => {
  /* İkisi de şeklin ÖRNEKLEME penceresini belirliyor: tex_zoom pencerenin
     büyüklüğünü, tex_ang dönüşünü. Okunmazlarsa şekil her zaman tüm
     dokuyu, dönmeden gösterir. */
  assert.ok(/o\.tex_zoom/.test(CODE), 'tex_zoom şekil karesinden okunmalı');
  assert.ok(/o\.tex_ang/.test(CODE), 'tex_ang şekil karesinden okunmalı');
});
