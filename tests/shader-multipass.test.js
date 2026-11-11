'use strict';
/* ÇOK GEÇİŞLİ STUDIO SHADER (#905). Kod //@pass A…D ve //@pass image bölümlerine ayrılıyor;
   tamponlar sırayla, kendi ping-pong çiftinde çiziliyor. İşaret yoksa eski tek geçiş yolu.
   Gerçek WebGL bağlamında ölçüldü (Electron, panel sayfası): iz biriktiren A tamponu 1. karede
   16, 60. karede 102 yanan piksel, boyut değişiminden sonra 118 (taşındı); B, A'nın bu karesini
   okuyor (ilk karede kırmızı 255 = 0,5 x 2); tampon 3,5 saklıyor (ekranda /4 → 223, RGBA16F);
   B'deki sözdizimi hatası `pass: 'B'`, özgün metnin 5. satırı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

global.window = global.window || {};
require('../src/visualizer/modes/shaderhost.js');
const MP = global.window.SVShaderPasses;

test('işaret yoksa tek geçiş: ayrıştırıcı hiçbir şey döndürmüyor', () => {
  assert.strictEqual(MP.splitPasses('void mainImage(out vec4 o, in vec2 p){ o = vec4(1.0); }'), null);
  // Satır içindeki "@pass" sözcüğü işaret değil
  assert.strictEqual(MP.splitPasses('float x; // see @pass notes\nvoid mainImage(out vec4 o, in vec2 p){}'), null);
});

test('bölümler, ortak kod, kanallar ve satır numaraları', () => {
  const src = ['// başlık', '//@common', 'float f(){ return 1.0; }', '//@pass B', 'void mainImage(out vec4 o, in vec2 p){ o = vec4(2.0); }',
    '//@pass a channels=self, spectrum', 'void mainImage(out vec4 o, in vec2 p){ o = vec4(f()); }', '//@pass image channels=B,a', 'void mainImage(out vec4 o, in vec2 p){ o = texture(iChannel0, p); }'].join('\n');
  const mp = MP.splitPasses(src);
  assert.strictEqual(mp.error, null);
  assert.deepStrictEqual(mp.common.map((c) => c.line), [1, 3], 'işaretten önceki satırlar da ortak');
  assert.deepStrictEqual(mp.passes.map((p) => p.id), ['A', 'B'], 'çizim sırası A, B, C, D');
  assert.deepStrictEqual(mp.passes[0].channels, ['prev', 'spectrum'], 'self = kendi önceki karesi');
  assert.strictEqual(mp.passes[0].line, 7);
  assert.deepStrictEqual(mp.image.channels, ['B', 'A']);
  const s = MP.passSource(mp, mp.image, 'uniform float uX;\n');
  assert.match(s, /#define iChannel0 sv_bufB\n#define iChannel1 sv_bufA\n#define iChannel2 sv_prev\n#define iChannel3 sv_media\n/, 'eksik kanallar varsayılan');
  assert.match(s, /#line 1\n\/\/ başlık\n#line 3\nfloat f\(\)/);
  assert.match(s, /#line 9\nvoid mainImage/, 'hata satırları özgün metne');
  assert.ok(s.indexOf('uniform sampler2D sv_bufD;') > 0);
  assert.doesNotMatch(MP.PRELUDE_MP, /#define iChannel/, 'çok geçişte kanal tanımı geçişin kendisinde');
});

test('hatalar: görüntü geçişi yok, bilinmeyen ad, aynı geçiş, bilinmeyen kanal', () => {
  assert.strictEqual(MP.splitPasses('//@pass A\nvoid mainImage(out vec4 o, in vec2 p){}').error.message, 'Görüntü geçişi yok: //@pass image bölümü ekleyin.');
  const e1 = MP.splitPasses('//@pass E\nx\n//@pass image\ny').error;
  assert.strictEqual(e1.message, 'Geçiş adı A, B, C, D ya da image olmalı.');
  assert.strictEqual(e1.line, 1);
  assert.strictEqual(MP.splitPasses('//@pass A\nx\n//@pass A\ny\n//@pass image\nz').error.line, 3);
  assert.strictEqual(MP.splitPasses('//@pass image channels=foo\nz').error.message, 'Bilinmeyen kanal; kullanılabilenler: spectrum, wave, prev, media, A, B, C, D.');
  // Hata metinleri İngilizcede de var
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Görüntü geçişi yok: //@pass image bölümü ekleyin.', 'Geçiş adı A, B, C, D ya da image olmalı.', 'Aynı geçiş iki kez tanımlanmış.', 'Bilinmeyen kanal; kullanılabilenler: spectrum, wave, prev, media, A, B, C, D.']) {
    assert.ok(i18n.includes("'" + k + "':"), k);
  }
});

test('görüntü geçişi önceki kareyi okuyorsa geri besleme tamponu açılıyor', () => {
  assert.strictEqual(MP.imageNeedsPrev({ code: 'o = texture(sv_bufA, p);', channels: null }), false);
  assert.strictEqual(MP.imageNeedsPrev({ code: 'o = texture(sv_prev, p);', channels: null }), true);
  assert.strictEqual(MP.imageNeedsPrev({ code: 'o = texture(iChannel2, p);', channels: null }), true, 'varsayılan iChannel2 = prev');
  assert.strictEqual(MP.imageNeedsPrev({ code: 'o = texture(iChannel2, p);', channels: ['A', 'B', 'C'] }), false);
});

test('motor: tamponlar görüntüden önce, sırayla; boyut değişince içerik taşınıyor', () => {
  const s = read('src/visualizer/modes/shaderhost.js');
  assert.match(s, /if \(this\._mp\) this\._renderBufs\(W, H, frame\);\s*\n\s*gl\.useProgram\(this\.program\);/);
  assert.match(s, /frame\(u, p\.tex\[p\.cur\]\);/, 'tampon geçişinde sv_prev kendi önceki karesi');
  const ens = s.slice(s.indexOf('    _ensureBufs(W, H) {'), s.indexOf('    _bindBufs(u) {'));
  assert.match(ens, /gl\.blitFramebuffer\(0, 0, old\.w, old\.h, 0, 0, W, H, gl\.COLOR_BUFFER_BIT, gl\.LINEAR\);/);
  assert.match(s, /gl\.getExtension\('EXT_color_buffer_float'\)\s*\?\s*\{ internal: gl\.RGBA16F, type: gl\.HALF_FLOAT \}/);
  // Tek geçiş yolu değişmedi: setSource işaret yoksa eski derlemeye düşüyor
  assert.match(s, /const mp = splitPasses\(userCode\);\s*if \(mp\) return this\._setMulti\(mp, controls\);/);
});

test('ISF: PASSES hedefleri A–D tamponlarına, her geçiş kendi PASSINDEX değeriyle', () => {
  require('../src/shared/presets.js');
  const P = global.window.SVPresets;
  const isf = '/*{"INPUTS":[],"PASSES":[{"TARGET":"bufferA","PERSISTENT":true},{"TARGET":"bufferB"},{}]}*/\n' +
    'void main(){ if (PASSINDEX == 0) gl_FragColor = vec4(1.0); else if (PASSINDEX == 1) gl_FragColor = IMG_NORM_PIXEL(bufferA, isf_FragNormCoord); else gl_FragColor = IMG_NORM_PIXEL(bufferB, isf_FragNormCoord); }';
  const r = P.fromISF(isf, 'deneme');
  assert.ok(r.ok);
  const mp = MP.splitPasses(r.preset.shader);
  assert.strictEqual(mp.error, null);
  assert.deepStrictEqual(mp.passes.map((p) => p.id), ['A', 'B']);
  assert.match(mp.passes[1].code, /#define PASSINDEX 1\n#define bufferA sv_bufA\n#define bufferB sv_bufB/);
  assert.match(mp.image.code, /#define PASSINDEX 2/);
  assert.deepStrictEqual(r.notes, ['Çok geçişli ISF shader\'ı: hedefler sırayla A, B, C, D tamponlarına bağlandı.']);
  // Eşlenemeyen düzen eskisi gibi tek geçişe
  const many = '/*{"PASSES":[{"TARGET":"a"},{"TARGET":"b"},{"TARGET":"c"},{"TARGET":"d"},{"TARGET":"e"},{}]}*/\nvoid main(){ gl_FragColor = vec4(1.0); }';
  const r2 = P.fromISF(many, 'x');
  assert.strictEqual(MP.splitPasses(r2.preset.shader), null);
  assert.ok(r2.notes.some((n) => /tek geçişe indirgendi/.test(n)));
});

test('yerleşik örnek: Mürekkep Akışı iki geçişli, adı ve açıklaması İngilizcede', () => {
  require('../src/shared/presets-shaders.js');
  const p = global.window.SVPresets.get('sh_ink_flow');
  assert.ok(p && p.kind === 'background');
  const mp = MP.splitPasses(p.shader);
  assert.strictEqual(mp.error, null);
  assert.deepStrictEqual(mp.passes.map((x) => x.id), ['A']);
  assert.ok(mp.common.length === 1 && /sv_fbm/.test(mp.common[0].code), 'ortak GLSL kitaplığı her geçişte');
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Mürekkep Akışı', 'Kalıcılık', 'Çok geçişli: mürekkep bir akış alanında sürükleniyor, spektrumun üç bandı yeni renk bırakıyor.']) assert.ok(i18n.includes("'" + k + "':"), k);
  assert.ok(read('src/admin/studio.js').includes("'// Çok geçiş: //@pass A … //@pass D tamponlar, //@pass image ekran; sv_bufA…sv_bufD',"));
});
