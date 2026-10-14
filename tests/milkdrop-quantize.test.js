'use strict';
/* GERİ BESLEMEDE MILKDROP'UN 8 BİT YUVARLAMASI (#752 kalite turu).
 *
 * MilkDrop'un tamponu 8 bit ve her yazımda en yakın 1/255'e yuvarlıyor.
 * Ölçüldü (yamalı MilkDrop, 960x720, sabit davranışlı sentetik warp'lar):
 *
 *     warp                     MilkDrop    10 bit (önce)   şimdi
 *     +0,0025 / kare, 59. kare     59            39            60
 *     +0,0015 / kare, 59. kare      0            19             0
 *     x0,9 sönme, taban (shader)    4             1             4
 *     x0,9 sönme, taban (sabit)     4             1             4
 *
 * Tampon 10 bit kalıyor; yalnız WARP çıktısı yuvarlanıyor. Düz 8 bit tampon
 * warp'tan sonra çizilen yumuşak kenarlı çizgileri geri beslemede yutup
 * çizgi presetlerini karartıyordu ("vector exp 1", "Dark Tiles").
 * Comp geri beslenmiyor ve yuvarlanmıyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../src/shared/milkdrop-shader.js');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf-8');
const BODY = 'shader_body { ret = tex2D(sampler_main, uv).xyz + 0.004; }';
const QUANT = 'outColor = vec4(floor(clamp(ret, 0.0, 1.0) * 255.0 + 0.5) / 255.0, vBlend);';

test('preset warp shader\'ı uyum açıkken 8 bit seviyeye yuvarlıyor', () => {
  const g = T.translate(BODY, { stage: 'warp', acc: true }).glsl;
  assert.ok(g.includes(QUANT), 'yuvarlanmış çıkış bekleniyordu');
});

test('uyum kapalıyken warp yuvarlanmıyor', () => {
  const g = T.translate(BODY, { stage: 'warp', acc: false }).glsl;
  assert.ok(!g.includes(QUANT));
  assert.ok(g.includes('outColor = vec4(clamp(ret, 0.0, 1.0), vBlend);'));
});

test('comp hiç yuvarlanmıyor — geri beslenmiyor', () => {
  const g = T.translate(BODY, { stage: 'comp', acc: true }).glsl;
  assert.ok(!g.includes(QUANT));
  assert.ok(g.includes('outColor = vec4(clamp(ret, 0.0, 1.0), vBlend);'));
});

test('sabit warp da uyum açıkken aynı kuralla yuvarlıyor', () => {
  const frag = /const WARP_FIXED_FRAG = `([\s\S]*?)`;/.exec(CODE);
  assert.ok(frag, 'WARP_FIXED_FRAG bulunamadı');
  assert.match(frag[1], /uniform float uQuant;/);
  assert.match(frag[1], /if \(uQuant > 0\.0\) c = floor\(clamp\(c, 0\.0, 1\.0\) \* uQuant \+ 0\.5\) \/ uQuant;/);
  assert.match(CODE, /gl\.uniform1f\(this\.locWarpFixed\.uQuant, this\._wantAcc !== false \? 255 : 0\);/);
  assert.match(CODE, /uQuant: gl\.getUniformLocation\(this\.warpFixed, 'uQuant'\)/);
});

/* Kuralın kendisi: en yakın seviyeye, yarımda yukarı. MilkDrop'un ölçülen
   eşiği bu kartta 0,52–0,6 arasında (100,5 -> 100, 100,6 -> 101); D3D
   dönüşüme tolerans tanıyor ve eşik karta göre değişiyor. Standart kural
   seçildi, tek bir kartın eşiği değil. */
test('yuvarlama kuralı: x0,9 sönme 4/255\'te, +0,0015 sıfırda duruyor', () => {
  const q = (x) => Math.floor(Math.min(1, Math.max(0, x)) * 255 + 0.5) / 255;
  let a = 1;
  for (let i = 0; i < 200; i++) a = q(a * 0.9);
  /* 5 x 0,9 tam 4,5: GPU'nun tek duyarlıklı aritmetiği ve depolaması onu
     4'e, JS'in çift duyarlığı 5'e götürüyor. Ölçülen 4; önemli olan
     sönmenin SIFIRA İNMEDEN durması. */
  assert.ok(Math.round(a * 255) >= 4 && Math.round(a * 255) <= 5, 'taban ' + a * 255);
  let b = 0;
  for (let i = 0; i < 200; i++) b = q(b + 0.0015);
  assert.strictEqual(b, 0);
  let c = 0;
  for (let i = 0; i < 59; i++) c = q(c + 0.0025);
  assert.strictEqual(Math.round(c * 255), 59);
});
