'use strict';
/* ŞEFFAF ARKAPLAN (#563 ile birlikte bildirildi).
 *
 * Masaüstü penceresi "Şeffaf Arkaplan" açıkken hiçbir sürümde saydam
 * olmuyordu; yayın katmanı da efekt zinciri açıkken olmuyordu:
 *   1. visualizer.js body'ye SATIR İÇİ renk yazıyordu (düz renk ya da siyah)
 *      ve bu `.sv-transparent body { background: transparent }` kuralını
 *      eziyordu. Pencere şeffaf doğuyor, sayfa opak boyuyordu.
 *   2. Efekt zincirinin (post-FX) her geçişi alfayı 1 yazıyordu: tek bir
 *      efekt açıkken yüzey tümüyle opaktı — OBS katmanında da.
 *   3. Arkaplan efektleri pencerenin her pikselini boyuyordu.
 * Buradaki testler saf kuralları ve kaynağın bu kuralları kullandığını
 * sınıyor; GPU tarafını öz test (`--smoke`) pikselleri okuyarak ölçüyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/visualizer/layers.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
const norm = (v) => String(v).replace(/\s+/g, ' ').trim();

test('saydam mod: yayın katmanı türü ya da şeffaf arkaplan', () => {
  assert.strictEqual(L.seeThrough({ background: { type: 'transparent' } }), true);
  assert.strictEqual(L.seeThrough({ background: { type: 'solid', transparent: true } }), true);
  assert.strictEqual(L.seeThrough({ background: { type: 'liquid', transparent: true } }), true);
  assert.strictEqual(L.seeThrough({ background: { type: 'solid', transparent: false } }), false);
  assert.strictEqual(L.seeThrough({}), false);
  assert.strictEqual(L.seeThrough(null), false);
});

/* Karartma panik düğmesi: saydam bir karartma ekranı söndürmek yerine
   masaüstünü gösterirdi. Yayın katmanı da karartmada siyah gösteriyor. */
test('karartma şeffaf pencerede de siyah', () => {
  const cfg = { isBlackout: true, background: { type: 'gradient', transparent: true } };
  assert.strictEqual(L.seeThrough(cfg), false);
  assert.strictEqual(L.pageBackground(cfg), '#000');
});

/* Hatanın kendisi: şeffaf arkaplan + düz renk -> body düz rengi boyuyordu. */
test('sayfa zemini: şeffaf arkaplanda boyanmıyor', () => {
  assert.strictEqual(L.pageBackground({
    background: { type: 'solid', solidColor: '#08080f', transparent: true },
  }), 'transparent');
  assert.strictEqual(L.pageBackground({ background: { type: 'gradient', transparent: true } }), 'transparent');
  assert.strictEqual(L.pageBackground({ background: { type: 'transparent' } }), 'transparent');
});

test('sayfa zemini: saydam değilken eskisi gibi', () => {
  assert.strictEqual(L.pageBackground({ background: { type: 'solid', solidColor: '#123456' } }), '#123456');
  assert.strictEqual(L.pageBackground({ background: { type: 'gradient' } }), '#000');
  assert.strictEqual(L.pageBackground({}), '#000');
});

test('eşik: varsayılan, sınırlar, bozuk değer', () => {
  assert.strictEqual(L.keyThreshold({ background: {} }), 0.2);
  assert.strictEqual(L.keyThreshold({ background: { transparentKey: 0.5 } }), 0.5);
  assert.strictEqual(L.keyThreshold({ background: { transparentKey: 3 } }), 1);
  assert.strictEqual(L.keyThreshold({ background: { transparentKey: 0 } }), 1 / 255);
  assert.strictEqual(L.keyThreshold({ background: { transparentKey: 'x' } }), 0.2);
  // Panel varsayılanı ile kod varsayılanı aynı
  assert.match(read('src/shared/defaults.js'), /transparentKey: 0\.2,/);
});

/* Matris SVG feColorMatrix olarak uygulanıp sonucu ölçülüyor: alfa satırı
   (r+g+b)/(3*eşik), renk satırları birim. */
test('renk matrisi: siyah saydam, eşiğin üstü tam görünür, renk değişmiyor', () => {
  const apply = (cfg, r, g, b) => {
    const m = L.keyMatrix(cfg).split(/\s+/).map(Number);
    assert.strictEqual(m.length, 20, 'feColorMatrix 20 değer ister');
    const px = [r, g, b, 1];
    return [0, 1, 2, 3].map((row) => Math.min(1, Math.max(0,
      m[row * 5] * px[0] + m[row * 5 + 1] * px[1] + m[row * 5 + 2] * px[2] +
      m[row * 5 + 3] * px[3] + m[row * 5 + 4])));
  };
  const cfg = { background: { transparentKey: 0.2 } };
  assert.deepStrictEqual(apply(cfg, 0, 0, 0), [0, 0, 0, 0], 'siyah tam saydam');
  assert.strictEqual(apply(cfg, 1, 1, 1)[3], 1, 'beyaz tam görünür');
  const dim = apply(cfg, 0.1, 0.1, 0.1);
  assert.ok(Math.abs(dim[3] - 0.5) < 1e-4, 'eşiğin yarısı yarı saydam: ' + dim[3]);
  assert.deepStrictEqual(dim.slice(0, 3), [0.1, 0.1, 0.1], 'renk değişmiyor');
  assert.strictEqual(apply(cfg, 0, 0, 1)[3], 1, 'doygun mavi görünür kalıyor');
  const zero = { background: { transparentKey: 0 } };
  assert.strictEqual(apply(zero, 0, 0, 0)[3], 0, 'eşik 0: saf siyah yine saydam');
  assert.strictEqual(apply(zero, 0.01, 0.01, 0.01)[3], 1, 'eşik 0: geri kalan her şey görünür');
});

test('görselleştirici: gövdenin zeminini pageBackground veriyor', () => {
  const src = read('src/visualizer/visualizer.js');
  assert.match(src, /document\.body\.style\.background = pageBg/);
  assert.match(src, /document\.documentElement\.style\.background = pageBg/);
  assert.ok(!/bgType === 'transparent' \? 'transparent'/.test(src), 'eski satır içi ifade geri gelmiş');
});

test('görselleştirici: arkaplan süzgeci kuruluyor ve iki yola da veriliyor', () => {
  const src = read('src/visualizer/visualizer.js');
  assert.match(src, /createElementNS\(NS, 'feColorMatrix'\)/);
  assert.match(src, /setAttribute\('id', 'sv-bg-key'\)/);
  assert.match(src, /keyMatrixEl\.setAttribute\('values', L\.keyMatrix\(c\)\)/);
  assert.match(src, /stack\.setKeyFilter\(on \? 'url\(#sv-bg-key\)' : null\)/);
  // CSS kompozit yolu
  assert.match(read('src/visualizer/visualizer.css'), /url\(#sv-bg-key\)/);
  assert.match(read('src/visualizer/visualizer.css'), /canvas\.sv-bgkey/);
  // tek yüzey yolu (efekt zinciri, geçiş) ve giden sahne
  const layers = read('src/visualizer/layers.js');
  assert.match(layers, /classList\.add\('sv-bg'\)/);
  assert.match(layers, /if \(this\.keyFilter && layerWantsKey\(l, cfg\)\) ctx\.filter = this\.keyFilter;/);
  assert.match(layers, /out\.keyFilter = this\.keyFilter;/);
});

test('efekt zinciri: saydam modda alfa geri kazanılıyor', () => {
  const src = read('src/visualizer/postfx.js');
  assert.match(src, /render\(source, audio, t, dt, seeThrough\)/);
  assert.match(src, /UNPACK_PREMULTIPLY_ALPHA_WEBGL, !toScreen/);
  assert.match(src, /gl\.bindFramebuffer\(gl\.FRAMEBUFFER, last && toScreen \? null : this\.fbo\[write\]\)/);
  assert.match(src, /if \(!toScreen\) this\._resolveAlpha\(inputTex, chainSpreads\(this\.chain\)\)/);
  assert.match(src, /float a = max\(src\.a, glow\)/);
  assert.match(src, /uSpread/);
  assert.match(src, /texture\(uPrev, vUV\)/);
  assert.match(src, /def\.displaces/);
  assert.match(src, /def\.spreads/);
  assert.match(read('src/visualizer/layers.js'), /this\.postfx\.render\(src, audio, t, dt, seeThrough\(cfg\)\)/);
});

test('yığın: arkaplan katmanının şeffaflığı seeThrough sayılır', () => {
  const stacked = {
    background: { type: 'liquid', transparent: false },
    layerStack: { enabled: true },
    layers: [{
      id: 'ly_bg', kind: 'background', type: 'liquid', enabled: true,
      settings: { background: { transparent: true } },
    }],
  };
  assert.strictEqual(L.seeThrough(stacked), true);
  assert.strictEqual(L.layerWantsKey(stacked.layers[0], stacked), true);
  stacked.layers[0].settings.background.transparent = false;
  assert.strictEqual(L.seeThrough(stacked), false);
  assert.strictEqual(L.layerWantsKey(stacked.layers[0], stacked), false);
});

test('katman panosu: yığın açıkken en üstte tek şeffaf arkaplan anahtarı', () => {
  const src = read('src/admin/scene-panels.js');
  const i = src.indexOf('function layersPanel(');
  assert.ok(i > 0, 'layersPanel bulunamadı');
  const end = src.indexOf('function effectsPanel(', i);
  const body = src.slice(i, end > i ? end : i + 8000);
  const stackRow = body.indexOf("P().row('Katman Yığınını Kullan'");
  const transRow = body.indexOf("P().row('Şeffaf Arkaplan'");
  assert.ok(stackRow > 0, 'yığın anahtarı yok');
  assert.ok(transRow > stackRow, 'şeffaf arkaplan anahtarı yığın anahtarından sonra, listenin üstünde olmalı');
  const assign = body.indexOf('cfg.background.transparent = v');
  assert.ok(assign > stackRow, 'anahtar kök background.transparent yazmıyor');
});

test('Spout/Syphon şeffaf arkaplanı kapalı tutar, GPU yayını bozulmaz', () => {
  const share = read('src/main/texture-share.js');
  assert.match(share, /offscreen: \{ useSharedTexture: true \}/);
  assert.ok(!/sendRgbaBuffer/.test(share), 'CPU bitmap yolu Spout yayını düşürüyordu');
  const main = read('src/main/main.js');
  assert.match(main, /function configForTextureShare\(/);
  assert.match(main, /c\.background\.transparent = false/);
  assert.match(main, /configForTextureShare\(payload\)/);
});

test('Windows şeffaf pencere tam ekran kullanmıyor', () => {
  const src = read('src/main/main.js');
  assert.match(src, /fullscreen: !see/);
  assert.match(src, /opts\.resizable = false/);
  assert.match(src, /function recreateVisualizerWindows\(/);
});

test('haritalama: saydam modda alfa geri kazanılıyor', () => {
  const src = read('src/visualizer/mapper.js');
  assert.match(src, /uniform float uSee;/);
  assert.match(src, /gl\.clearColor\(0, 0, 0, see \? 0 : 1\)/);
  assert.match(src, /gl\.uniform1f\(this\.loc\.uSee, see \? 1 : 0\)/);
  assert.match(read('src/visualizer/visualizer.js'), /mapper\.render\(src, out, window\.SVLayers\.seeThrough\(c\)\)/);
});

/* Panelin yeni metinleri İngilizce sözlükte olmalı (kaynaktan çıkarılıyor:
   i18n.js tarayıcıya bağlı, Node'da require edilemiyor). */
test('panel: eşik kaydırıcısı ve notlar iki dilde', () => {
  const src = read('src/shared/i18n.js');
  const body = src.slice(src.indexOf('const EN = {'), src.indexOf('const EN_NORMALIZED'));
  const STR = "'((?:[^'\\\\]|\\\\.)*)'";
  const re = new RegExp(STR + '\\s*:\\s*' + STR, 'g');
  const dict = new Map();
  let m;
  while ((m = re.exec(body))) dict.set(norm(m[1]), m[2]);

  const admin = read('src/admin/admin.js');
  const i = admin.indexOf("path: 'background.transparent'");
  assert.ok(i > 0, 'şeffaf arkaplan denetimi bulunamadı');
  const block = admin.slice(i, i + 1600);
  assert.match(block, /path: 'background\.transparentKey'/);
  const texts = [];
  const tre = /(?:label|text): '((?:[^'\\]|\\.)*)'/g;
  while ((m = tre.exec(block))) texts.push(m[1]);
  assert.ok(texts.length >= 4, 'beklenen metinler okunamadı: ' + texts.length);
  for (const s of texts) {
    const en = dict.get(norm(s));
    assert.ok(en, 'sözlükte yok: ' + s.slice(0, 70));
    assert.ok(!/[çğıöşüÇĞİÖŞÜ]/.test(en), 'çevirisi Türkçe kalmış: ' + en);
  }
});
