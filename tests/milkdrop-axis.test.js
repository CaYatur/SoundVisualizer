'use strict';
/* AĞIN DİKEY EKSENİ.
 *
 * MilkDrop düğüm dönüşümünü v ekseni yukarıdan aşağı akan bir uzayda
 * yapıyor (`y = 0` üst). Bizim doku eksenimiz OpenGL'inki, `v = 0` altta.
 * Motor eskiden dönüşümü doğrudan kendi ekseninde yapıyordu: kendi içinde
 * tutarlıydı, hiçbir hata vermiyordu, yalnız `dy`, `cy` ve dönme yönü
 * aynadan bakıyordu.
 *
 * Yön bir deneyle ölçüldü: merkezde sabit bir şekil, `dy = +0,02`, başka
 * hareket yok. Düzeltmeden önce iz YUKARI, sonra AŞAĞI uzuyor — MilkDrop'un
 * cebriyle aynı yön. Testler kaynağa bakıyor, çünkü asıl kanıt GPU'da ve
 * başlıksız bir WebGL2 bağlamı olmadan burada çalıştırılamıyor; ama yanlış
 * olduğunda kaynakta bıraktığı iz kesin.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const MESH = /_buildWarpMesh\(\) \{[\s\S]*?\n    \}/.exec(BODY);

test('ağ: denklemlere giren y MilkDrop yönünde', () => {
  assert.ok(MESH, '_buildWarpMesh bulunamadı');
  /* `1 - w`: ağın alt satırı (w = 0) MilkDrop'un y = 1'i. Ters çevrilmezse
     `y`yi okuyan her per_pixel bloğu aynadan hesaplıyor — korpusta
     presetlerin %30,0'ı `y` okuyor. */
  assert.match(MESH[0], /const my = acc \? 1 - w : w;/);
  assert.match(MESH[0], /this\.preset\.pixel\(u, my, rad, ang, this\._pix\)/);
});

test('ağ: dönüşüm MilkDrop uzayında başlıyor', () => {
  /* Zumun başlangıç noktası `w` kalsaydı `cy` yine aynadan çalışırdı:
     dönüşümün TAMAMI aynı uzayda olmalı, yalnız girdi değil. */
  assert.match(MESH[0], /let sv = \(my - cy\) \/ z \+ cy;/);
});

test('ağ: doku koordinatı kendi eksenine geri çevriliyor', () => {
  /* Geri çevirme olmadan görüntünün kendisi baş aşağı çizilirdi. Dönüşüm
     MilkDrop uzayında yapılıyor, dokuya yazılan değer bizim uzayımızda. */
  assert.match(MESH[0], /const fv = acc \? 1 - sv : sv;/);
  assert.match(MESH[0], /v\[o \+ 3\] = isFinite\(fv\) \? fv : w;/);
});

test('ağ: anahtar kapalıyken eski davranış aynen kalıyor', () => {
  /* Eski davranış bir "MilkDrop uyumu" değil, ama kullanıcıların aylardır
     izlediği görüntü. Anahtar kapalıyken `my === w` ve `fv === sv`, yani
     dosyadaki dönüşüm satır satır eskisiyle aynı sonucu veriyor. */
  assert.match(MESH[0], /const acc = this\._wantAcc !== false;/);
  const my = /const my = acc \? ([^:]+): (\w+);/.exec(MESH[0]);
  const fv = /const fv = acc \? ([^:]+): (\w+);/.exec(MESH[0]);
  assert.ok(my && fv, 'anahtarlı satırlar bulunamadı');
  assert.strictEqual(my[2], 'w');
  assert.strictEqual(fv[2], 'sv');
});

test('çizim katmanı: şekil ve dalga ekseni zaten MilkDrop yönünde', () => {
  /* Ters olan yalnız ağdı. Bu test o ayrımı sabitliyor: biri düzeltilip
     diğeri düzeltilirse ikisi yeniden birbirinden ayrılır. */
  assert.match(BODY, /_toClipY\(y\) \{ return 1 - 2 \* y; \}/);
});
