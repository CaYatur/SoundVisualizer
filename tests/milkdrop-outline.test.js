'use strict';
/* ŞEKİL KENARLIĞI ve HAREKET VEKTÖRLERİ — kalınlık ve çözünürlük telafisi.
 *
 * İki ayrı eksik vardı ve ikisi de aynı yerde birleşiyordu:
 *
 * 1. `thick` motora HİÇ ULAŞMIYORDU. Ayrıştırıcı `thickOutline`ı okuyordu
 *    ama çizim tarafı onu hiç görmüyordu — kenarlık her zaman tek çizim.
 *    MilkDrop ise `its = thick ? 4 : 1` ile dört kez çiziyor, bir teksellik
 *    2x2 karenin köşelerine kaydırarak (milkdropfs.cpp:2247-2259).
 *    Üstelik `thick` MilkDrop'ta GİRDİ-ÇIKTI: state.cpp:496 onu
 *    `var_pf_thick ... // i/o` diye kaydediyor, yani şeklin per_frame kodu
 *    da yazabiliyor. Korpusta 15 preset yazıyor.
 *
 * 2. ÇÖZÜNÜRLÜK TELAFİSİ yoktu. Dalga şeridi 2019'dan beri telafi ediliyor
 *    (`_lineDraws`, referans 320) ama kenarlık ve hareket vektörleri tek
 *    piksel kalıyordu. 1920 genişlikte MilkDrop'un 512'lik tamponunda bir
 *    teksel olan çizgi bizde dörtte bir kalınlıkta çiziliyordu — aynı
 *    karedeki dalga telafi edilmiş, kenarlık edilmemişti.
 *
 * Korpus: 15.989 açık şekil bloğunun 2.961'i (%18,5; 1.821 preset, %17,6)
 * kenarlık çiziyor. Bunların 425'i (309 preset, %3,0) `thickOutline` da
 * istiyor. Hareket vektörünü 884 preset (%8,6) çiziyor.
 *
 * ÖLÇÜLDÜ (512x384, `decay=0`, shader yok, dolgu tümüyle saydam — yani
 * yalnız o karenin kenarlığının bıraktığı ışık, döngünün kazancı karışmadan):
 *
 *     durum                        önce    sonra
 *     kenarlık, thick yok           380      920
 *     kenarlık, thickOutline=1      380     1300
 *     kenarlık, denklemde thick=1   380     1300
 *     kenarlık, denklemde thick=0   380      920
 *     hareket vektörleri           9140    23444
 *
 * Dört kenarlık satırının ÖNCE sütununda aynı sayının durması, `thick`in
 * hiçbir yoldan motora ulaşmadığının kendisidir.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const MD = require('../src/shared/milkdrop.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BARE = CODE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const INPUTS = { time: 1, fps: 60, frame: 1, bass: 1, mid: 1, treb: 1,
  bass_att: 1, mid_att: 1, treb_att: 1 };
const preset = (lines) => new MD.Preset(lines.join('\n') + '\n', { seed: 7 });

// ------------------------------------------------------- thick girdi-çıktı

test('thick dosyadaki thickOutline\'dan tohumlanıyor', () => {
  const acik = preset(['shapecode_0_enabled=1', 'shapecode_0_thickOutline=1']);
  acik.frame(INPUTS);
  assert.strictEqual(+acik.shapeFrame(acik.shapes[0], 0, {}).thick, 1);

  const kapali = preset(['shapecode_0_enabled=1', 'shapecode_0_thickOutline=0']);
  kapali.frame(INPUTS);
  assert.strictEqual(+kapali.shapeFrame(kapali.shapes[0], 0, {}).thick, 0);
});

test('thick YAZILABİLİR — denklem dosyayı eziyor', () => {
  /* state.cpp:496 `var_pf_thick ... // i/o`. Korpusta 15 preset yazıyor;
     yalnız başlıktan okumak onları yanlış çizerdi. */
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_thickOutline=0',
    'shape_0_per_frame1=thick = 1;',
  ]);
  p.frame(INPUTS);
  assert.strictEqual(+p.shapeFrame(p.shapes[0], 0, {}).thick, 1);
});

test('thick her karede DOSYA değerine dönüyor', () => {
  /* Şeklin öteki değişkenleri gibi: MilkDrop yükleyiciyi her kare ve her
     örnek için yeniden koşturuyor, yani denklem birikmiyor. */
  const p = preset([
    'shapecode_0_enabled=1',
    'shapecode_0_thickOutline=1',
    'shape_0_per_frame1=thick = thick - 1;',
  ]);
  for (let f = 0; f < 3; f++) {
    p.frame(INPUTS);
    assert.strictEqual(+p.shapeFrame(p.shapes[0], 0, {}).thick, 0,
      (f + 1) + '. karede thick birikmiş');
  }
});

// ---------------------------------------------------- çizim tarafı

test('kenarlık ŞİŞİRİLEN yoldan çiziliyor ve thick\'i taşıyor', () => {
  /* Çarpan 4 değil 2: MilkDrop'un dört çizimi bir teksellik 2x2 karenin
     köşelerinde, yani DOĞRUSAL kalınlık iki katı. Dalga da aynı çarpanı
     kullanıyor (`wave_thick ? 2 : 1`). */
  assert.match(BARE, /this\._strip\(gl, gl\.LINE_LOOP, d, n, -1, GW, GH, o\.thick \? 2 : 1\);/);
  assert.doesNotMatch(BARE, /gl\.drawArrays\(gl\.LINE_LOOP/,
    'doğrudan LINE_LOOP çizimi kalmamalı');
});

test('hareket vektörleri de şişiriliyor, ama thick ile değil', () => {
  /* MilkDrop vektörleri KALINLAŞTIRMIYOR (milkdropfs.cpp:1314, tek bir
     LINELIST). Telafi yalnızca çözünürlük için, o yüzden çarpan 1. */
  assert.match(BARE, /this\._strip\(gl, gl\.LINES, d, count, -1, GW, GH, 1\);/);
});

test('vektörler hâlâ tampon dolunca BOŞALTILIYOR, kesilmiyor', () => {
  /* 64x48'lik bir ızgara 3072 vektör, çizgi tamponu 512 düğümlük. Şişirmeyi
     eklerken bu döngüyü kaybetmek ızgaranın yalnız üst şeridini çizerdi. */
  const fn = /_drawMotionVectors\(gl, GW, GH\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(fn, '_drawMotionVectors bulunamadı');
  assert.match(fn[0], /const flush = \(\) => \{/);
  assert.match(fn[0], /if \(count \+ 2 > 512\) flush\(\);/, 'tampon sınırı denetimi kalmalı');
});

test('şişirme çizgi biçimlerinin HEPSİNDE, noktalarda değil', () => {
  const fn = /_strip\(gl, kind, d, n, breakAt, GW, GH, thickMul\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(fn, '_strip bulunamadı');
  assert.match(fn[0],
    /if \(kind !== gl\.LINE_STRIP && kind !== gl\.LINE_LOOP && kind !== gl\.LINES\) return;/);
});

test('kenar yumuşatma üç çizgi biçiminde de aynı ayardan sürülüyor', () => {
  /* `lineStyle` dalgada, şekil kenarlığında ve hareket vektörlerinde aynı
     anda geçerli: biri yumuşak öteki tırtıklı çizilseydi ayar yarım kalırdı.
     Kenarlık KAPALI şerit (`closed`), vektörler bağımsız parçalar. */
  const fn = BARE.slice(BARE.indexOf('_strip(gl, kind, d, n, breakAt, GW, GH, thickMul)'));
  assert.match(fn, /const aa = this\._lineStyle !== 'milkdrop' && this\.aaProg;/);
  assert.match(fn, /this\._aaSegments\(gl, d, n, GW, GH, thickMul\);/);
  assert.match(fn, /this\._aaStrip\(gl, d, n, breakAt, GW, GH, thickMul, kind === gl\.LINE_LOOP\);/);
});

test('bağımsız parçalar TEK şeritte, parça başına çizim çağrısıyla değil', () => {
  /* 64x48'lik bir ızgara 3072 vektör demek; parça başına bir çizim çağrısı
     kareyi tek başına yerdi. Dejenere bağlantı sıfır alanlı üçgen üretiyor,
     yani aradaki `side` değeri hiç örneklenmiyor. */
  const fn = /_aaSegments\(gl, d, n, GW, GH, thickMul\) \{[\s\S]*?\n    \}/.exec(BARE);
  assert.ok(fn, '_aaSegments bulunamadı');
  assert.strictEqual((fn[0].match(/drawArrays/g) || []).length, 1,
    'tek bir çizim çağrısı olmalı');
  assert.match(fn[0], /gl\.TRIANGLE_STRIP/);
  assert.match(fn[0], /if \(w \+ 6 > kapasite\) bosalt\(\);/,
    'tampon dolunca boşaltılmalı — parça başına altı tepe');
});
