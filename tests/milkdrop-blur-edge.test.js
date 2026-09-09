'use strict';
/* BULANIK KOPYADA KENAR KARARTMA — `b1ed`.
 *
 * Bulanıklık kenarda kendi dışından örnek almak zorunda ve orada
 * kenetlenmiş teksel duruyor: kenar çizgisi olduğundan parlak çıkıyor ve
 * bir çerçeve parlıyor. MilkDrop kenara olan uzaklığın KAREKÖKÜYLE sönen
 * bir çarpan uyguluyor.
 *
 * Motorda hiç yoktu. Korpusta 7.094 preset (%68,6) sıfırdan büyük bir
 * değer yazıyor; 1.544'ü (%14,9) hiç yazmıyor ve MilkDrop'un 0,25
 * varsayılanını görmesi gerekiyor — havuzun doğal başlangıcı 0 olsaydı o
 * presetlerde karartma hiç olmazdı.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.window = global.window || {};
const MD = require('../src/shared/milkdrop.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const FRAG = /const BLUR_FRAG = `([\s\S]*?)`;/.exec(CODE);
const BUILD = /_buildBlur\(srcTex\) \{[\s\S]*?\n    \}/
  .exec(CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 '));

// --------------------------------------------------------------- varsayılan

test('b1ed: yazılmayan presette MilkDrop varsayılanı 0,25', () => {
  const p = new MD.Preset('fDecay=0.9\n', { seed: 1 });
  assert.strictEqual(p.get('b1ed'), 0.25);
});

test('b1ed: başlıktaki değer varsayılanı eziyor, sıfır dahil', () => {
  assert.strictEqual(new MD.Preset('b1ed=0.700\n', { seed: 1 }).get('b1ed'), 0.7);
  /* Sıfır GEÇERLİ: "karartma istemiyorum" demek. `|| varsayılan` biçiminde
     bir yedek onu 0,25'e çevirirdi. */
  assert.strictEqual(new MD.Preset('b1ed=0.000\n', { seed: 1 }).get('b1ed'), 0);
});

test('b1ed: denklem dilindeki adı da aynı değere bağlı', () => {
  /* Dosyada `b1ed`, denklem dilinde `blur1_edge_darken`. Korpusta hiçbir
     preset denklemden yazmıyor ama okuyan bir preset ikisini de bulmalı. */
  assert.strictEqual(new MD.Preset('b1ed=0.600\n', { seed: 1 }).get('blur1_edge_darken'), 0.6);
});

// ------------------------------------------------------------------ shader

test('shader: karartma karekök eğrisiyle uygulanıyor', () => {
  assert.ok(FRAG, 'BLUR_FRAG bulunamadı');
  assert.match(FRAG[1], /float e = min\(min\(vUV\.x, vUV\.y\), 1\.0 - max\(vUV\.x, vUV\.y\)\);/);
  assert.match(FRAG[1], /e = sqrt\(max\(e, 0\.0\)\);/);
  assert.match(FRAG[1], /e = uEdge\.x \+ uEdge\.y \* clamp\(e \* uEdge\.z, 0\.0, 1\.0\);/);
  assert.match(FRAG[1], /outColor = vec4\(\(c \* uNorm \* uScale \+ uBias\) \* e, 1\.0\);/);
});

/* Eğrinin kendisi çalıştırılıyor: doğrusal bir eğri de "kenarda koyu"
   verirdi ama kareyi ortasına kadar karartırdı. Karekök karartmayı kenara
   sıkıştırıyor. */
test('eğri: kenarda koyu, ortada tam parlaklık', () => {
  const f = (x, y, ed) => {
    let e = Math.min(Math.min(x, y), 1 - Math.max(x, y));
    e = Math.sqrt(Math.max(e, 0));
    return (1 - ed) + ed * Math.max(0, Math.min(1, e * 5));
  };
  const ed = 0.25;
  assert.ok(Math.abs(f(0, 0.5, ed) - (1 - ed)) < 1e-12, 'tam kenar en koyu');
  assert.ok(Math.abs(f(0.5, 0.5, ed) - 1) < 1e-12, 'merkez karartılmıyor');
  // 5.0'lik çarpan yüzünden karartma ilk %4'te bitiyor
  assert.ok(Math.abs(f(0.04, 0.5, ed) - 1) < 1e-12, 't*5 >= 1 olunca çarpan 1');
  assert.ok(f(0.005, 0.5, ed) < 1, 'çok kenarda hâlâ karartıyor');
  // Karartma yokken hiçbir yerde etkisi olmamalı
  for (const x of [0, 0.01, 0.3, 0.5]) assert.strictEqual(f(x, 0.5, 0), 1);
});

// ------------------------------------------------------------------- çizim

test('çizim: karartma yalnız İLK dikey geçişte', () => {
  /* MilkDrop kaynağı bunu ayrıca not ediyor: her kademede tekrarlanırsa
     çok bulanık kademelerin üst ve sol kenarında kalın siyah çizgiler
     çıkıyor. */
  assert.ok(BUILD, '_buildBlur bulunamadı');
  assert.match(BUILD[0], /setEdge\(false\);/);
  assert.match(BUILD[0], /setEdge\(i === 0\);/);
});

test('çizim: değer 0..1 aralığına kenetleniyor', () => {
  assert.match(BUILD[0], /Math\.max\(0, Math\.min\(1,/);
  assert.match(BUILD[0], /this\.preset\.get\('b1ed'\)/);
});

test('çizim: anahtar kapalıyken karartma yok', () => {
  assert.match(BUILD[0], /const ed = acc \? Math\.max/);
  assert.match(BUILD[0], /else gl\.uniform3f\(L\.uEdge, 1, 0, 5\.0\);/);
});
