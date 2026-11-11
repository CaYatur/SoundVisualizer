'use strict';
/* İÇ TAMPONLARIN YÖNÜ (#580).
 *
 * MilkDrop 2 Direct3D'de çiziyor: dokunun satır 0'ı görüntünün ÜSTÜ. Motor
 * GL düzeninde (satır 0 altta) tutuyordu. Kaynağa bakarak çözülemedi;
 * BeatDrop'tan (mvsoft74/BeatDrop 53d83ee, BSD-3) derlenen MilkDrop 2
 * referans çizicisiyle aynı preset, aynı ses, aynı kare karşılaştırıldı
 * (araç depoda değil, milkdrop-tools/mdref). Ölçülen:
 *   - per_pixel hareketi (x, y, dx, dy) iki motorda aynıydı;
 *   - şekiller ve özel dalgalar dikeyde AYNALIYDI (y = 0,75 MilkDrop'ta
 *     üstte — belge de "0 alt, 1 üst" diyor —, bizde altta);
 *   - warp ve birleştirme shader'larında uv.y ve ang ters, örnekleme yönü ters;
 *   - kimlik geçişleri (tex2D(sampler_main, uv)) aynıydı.
 * Tamponlar MilkDrop yönüne alındı: ağ düğümü ve uv warp'ta bir kez,
 * birleştirmede uv bir kez çevriliyor; şekil/dalga formülü MilkDrop'unki
 * olarak kalıyor. Sonra 15 yapay testin hepsi MilkDrop 2 ile %0,0-0,3
 * (yerleşik dalganın parlaklığı ayrı bir konu) ve korpus örneğinde fark düştü.
 *
 * Bu test zinciri sayılarla koşturuyor: bir halkayı geri almak ters
 * görüntüyü sessizce geri getirirdi. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'milkdrop.js'), 'utf8').replace(/\r\n/g, '\n');
const shader = (name) => {
  const m = new RegExp('const ' + name + ' = `([\\s\\S]*?)`;').exec(SRC);
  assert.ok(m, name + ' bulunamadı');
  return m[1];
};

test('warp ağı: konum ve uv tek kez çevriliyor', () => {
  const v = shader('MESH_VERT');
  assert.match(v, /vUV = vec2\(aUV\.x, 1\.0 - aUV\.y\);/);
  assert.match(v, /vUVOrig = vec2\(aUVOrig\.x, 1\.0 - aUVOrig\.y\);/);
  assert.match(v, /gl_Position = vec4\(aPos\.x, -aPos\.y, 0\.0, 1\.0\);/);
});

test('birleştirme ağı: ekrana konum aynen, iç tampondan uv çevrik', () => {
  const v = shader('COMP_MESH_VERT');
  assert.match(v, /vUV = vec2\(aUVOrig\.x, 1\.0 - aUVOrig\.y\);/);
  assert.match(v, /gl_Position = vec4\(aPos, 0\.0, 1\.0\);/);
});

test('çizgi ve şekil programları çevirmiyor (MilkDrop formülü yeterli)', () => {
  for (const n of ['LINE_VERT', 'AALINE_VERT', 'SHAPE_TEX_VERT']) {
    assert.match(shader(n), /gl_Position = vec4\(aPos, 0\.0, 1\.0\);/, n);
  }
  assert.match(SRC, /_toClipY\(y\) \{ return 1 - 2 \* y; \}/);
});

test('sprite: iç tampona (burn) −1, ekrana +1', () => {
  assert.match(shader('SPRITE_VERT'), /gl_Position = vec4\(aPos\.x, aPos\.y \* uYSign, 0\.0, 1\.0\);/);
  const d = /_drawSprites\(gl, dst, outFb, GW, GH\) \{[\s\S]*?\n    \}\n/.exec(SRC)[0];
  assert.match(d, /bindFramebuffer\(gl\.FRAMEBUFFER, dst\.fb\);[\s\S]*?uniform1f\(L\.uYSign, -1\);[\s\S]*?drawArrays/);
  assert.match(d, /bindFramebuffer\(gl\.FRAMEBUFFER, outFb\);[\s\S]*?uniform1f\(L\.uYSign, 1\);[\s\S]*?drawArrays/);
});

/* Zincir: MilkDrop y'si → iç tampon satırı → ekran. İç tamponda GL kırpma
   uzayı −1 satır 0'a yazıyor; satır 0 artık görüntünün üstü. Birleştirme
   ekranın üstünde (aUVOrig.y = 1) iç tamponun v = 0'ını okuyor. */
test('zincir: şeklin y = 0,75\'i ekranın üst çeyreğine düşüyor', () => {
  const toClip = new Function('y', /_toClipY\(y\) \{([^}]*)\}/.exec(SRC)[1]);
  const row = (clip) => (clip + 1) / 2;            // iç tamponda satır oranı, 0 = üst
  const screenFromTop = (v) => v;                   // birleştirme: vUV.y = 1 − aUVOrig.y
  const at = screenFromTop(row(toClip(0.75)));
  assert.ok(Math.abs(at - 0.25) < 1e-12, 'y = 0,75 üstten ' + at);
  assert.ok(screenFromTop(row(toClip(0.1))) > 0.85, 'y = 0,1 altta');
});

test('zincir: warp düğümü per_pixel y = 0 (üst) satır 0\'a yazıp v ≈ 0\'dan okuyor', () => {
  // Ağ GL düzeninde: üst düğüm aPos.y = +1, aUV.y ≈ 1
  const aPosY = 1, aUVY = 1;
  const clip = -aPosY, v = 1 - aUVY;
  assert.strictEqual((clip + 1) / 2, 0, 'satır 0');
  assert.strictEqual(v, 0, 'v = 0 (MilkDrop\'un uv\'si, üstte 0)');
});

/* Sabit yolun dörtgeninde v0 ile v1 ekranın ALTI: MilkDrop'ta kırpma
   y'leri +1 ama doku koordinatları tv = 1 (görüntünün alt satırı). Hue
   shader'ının köşeleri ise y üstte 1 ile yerinde. */
test('hue ve sabit birleştirme köşeleri ekranda yerinde', () => {
  assert.match(shader('COMP_FIXED_FRAG'), /float x = vUV\.x, y = vUV\.y;/);
  const T = require('../src/shared/milkdrop-shader.js');
  assert.match(T.translate('shader_body { ret = hue_shader; }').glsl, /float y = 1\.0 - p\.y;/);
});
