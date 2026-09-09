'use strict';
/* BLUR ZİNCİRİNİN KAYNAĞI.
 *
 * MilkDrop bulanık kopyaları warp'ın ÇIKTISINDAN değil GİRDİSİNDEN alıyor.
 * `BlurPasses()` warp'tan sonra çağrılıyor ama kaynağı `m_lpVS[0]`, yani
 * warp'a beslenen tampon; kaynağın kendi yorumu da bunu söylüyor
 * (milkdropfs.cpp:1479-1481):
 *
 *     // Note: Warped blit just rendered from VS0 to VS1.
 *     SetTexture(0, (i == 0) ? m_lpVS[0] : m_lpBlur[i - 1]);
 *
 * Tamponlar kare SONUNDA takas edildiği için (1149-1151) `m_lpVS[0]` bir
 * önceki karenin TAMAMLANMIŞ hâli: warp'ın üstüne o karede çizilmiş
 * şekiller, dalgalar ve kenarlıklar dâhil.
 *
 * Motor `dst.tex` veriyordu. İçerik aynı şekilleri taşıyor ama bir kez
 * FAZLA warp'lanmış oluyordu; güçlü zoom ya da dönüş taşıyan presetlerde
 * bloom yerinde durmayıp akış boyunca sürüklüyor ve decay kadar sönüyordu.
 * Korpusun %71,3'ü (7.379 preset) GetBlur okuduğu için etki geniş: tohumlu
 * 900'lük kesitte görüntü üreten 861 -> 865, patlamış 21 -> 19, donmuş 8 -> 6.
 *
 * Bu testler kaynak metnini okuyor. GL'siz koşuyorlar çünkü suite Node'da
 * çalışıyor; pinlenen şey davranışın kendisi değil, onu üreten TEK satır —
 * geri dönmesi kolay ve gözle fark edilmesi zor bir değişiklik olduğu için.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');

/* Yorumlar çıkarılıyor: aşağıdaki iddiaların hepsi ÇALIŞAN koda dair.
   Yorumda geçen `dst.tex` bir testi düşürmemeli. */
const BARE = CODE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const DRAW = BARE.slice(BARE.indexOf('draw(audio, cfg, t, dt)'));

// ------------------------------------------------------------------ kaynak

test('blur kaynağı warp GİRDİSİ (src), çıktısı (dst) değil', () => {
  assert.match(DRAW, /this\._buildBlur\(src\.tex[,)]/,
    '_buildBlur src.tex ile çağrılmalı — MilkDrop m_lpVS[0]');
  assert.doesNotMatch(DRAW, /this\._buildBlur\(dst\.tex[,)]/,
    'dst.tex bir kez fazla warp\'lanmış görüntü');
});

test('blur ve dokulu şekiller AYNI tampondan besleniyor', () => {
  /* MilkDrop\'ta ikisi de `m_lpVS[0]`: dokulu şekil `sampler_main`
     üzerinden, blur zinciri doğrudan. Biri değişip diğeri kalırsa kaynak
     ikiye ayrılır ve fark sessizce sürüklenir. */
  const blur = /this\._buildBlur\(([a-z]+)\.tex[,)]/.exec(DRAW);
  const shape = /this\._shapeSrcTex = ([a-z]+)\.tex/.exec(DRAW);
  assert.ok(blur, '_buildBlur çağrısı bulunamadı');
  assert.ok(shape, '_shapeSrcTex ataması bulunamadı');
  assert.strictEqual(blur[1], shape[1],
    'blur ve dokulu şekil aynı tamponu okumalı');
});

// -------------------------------------------------------------------- sıra

test('sıra: warp -> blur -> çizimler', () => {
  /* Konum kaynak kadar önemli. Warp geçişi blur\'dan ÖNCE olduğu için warp
     shader\'ı bir önceki karenin bulanık dokularını, comp shader\'ı ise bu
     karede üretilenleri örnekliyor. MilkDrop\'ta gecikme aynen böyle:
     1021 warp, 1058 blur, 1099 comp. */
  const warp = DRAW.indexOf('_drawWarpPass');
  const blur = DRAW.indexOf('_buildBlur');
  const shapes = DRAW.indexOf('_drawShapes');
  const comp = DRAW.indexOf('_drawCompPass');
  assert.ok(warp > 0 && blur > warp, 'blur warp geçişinden sonra gelmeli');
  assert.ok(shapes > blur, 'şekiller blur zincirinden sonra çizilmeli');
  assert.ok(comp > blur, 'comp geçişi bu karenin blur dokularını okumalı');
});

test('tampon her karede dönüyor — src gerçekten ÖNCEKİ kare', () => {
  /* Bu olmadan `src` bir önceki karenin son hâli olmaz ve yukarıdaki
     kaynak seçimi MilkDrop\'un m_lpVS[0]\'ıyla eşleşmez. */
  assert.match(DRAW, /const src = this\.targets\[this\.cur\]/);
  assert.match(DRAW, /const dst = this\.targets\[1 - this\.cur\]/);
  assert.match(DRAW, /this\.cur = 1 - this\.cur/);
});
