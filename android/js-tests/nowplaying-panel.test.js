'use strict';
/* Çalan Parça katmanının telefondaki ayarları masaüstündekilerle aynı alanları yazmalı; kapaktan
   renk teması da masaüstündeki hedef kurallarına uymalı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function desktopKeys() {
  const src = read('src/admin/scene-panels.js');
  const a = src.indexOf('function nowplayingLayerControls(');
  const b = src.indexOf('/* Metin kartı da yığın açıkken gizlenir');
  const body = src.slice(a, b);
  const keys = new Set();
  for (const m of body.matchAll(/b\.(?:get|set)\('([a-zA-Z]+)'/g)) keys.add(m[1]);
  for (const m of body.matchAll(/showToggle\('([a-zA-Z]+)'/g)) keys.add('show.' + m[1]);
  const cover = src.slice(src.indexOf("if (l.type === 'nowplaying') {\n        out.push.apply(out, nowplayingLayerControls"), src.indexOf("out.push(miniSlider('Hassasiyet', () => getV('sensitivity'", src.indexOf('nowplayingLayerControls(l, cfg, rerender));')));
  for (const m of cover.matchAll(/getCover\('([a-zA-Z]+)'/g)) keys.add(m[1]);
  return keys;
}

test('masaüstündeki bütün Çalan Parça alanları telefonda da var', () => {
  const keys = desktopKeys();
  assert.ok(keys.size > 35, 'masaüstü alanları okunamadı: ' + keys.size);
  const mobile = read('src/mobile/shell-nowplaying.js');
  const missing = [...keys].filter((k) => {
    if (k.startsWith('show.')) return !new RegExp("show\\('" + k.slice(5) + "'|setShow\\('" + k.slice(5) + "'").test(mobile);
    return !new RegExp("b\\.(get|put)\\('" + k + "'").test(mobile);
  });
  assert.deepStrictEqual(missing, []);
});

test('yeni arayüzde renkli emoji yok', () => {
  for (const f of ['src/mobile/shell-nowplaying.js', 'src/mobile/dynamic-theme.js']) {
    assert.strictEqual(/\p{Extended_Pictographic}/u.test(read(f).replace(/©|×/g, '')), false, f);
  }
});

const { patchFor, isFallback } = require('../../src/mobile/dynamic-theme.js');
const RES = { colors: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'], color: '#aa0000', color2: '#00aa00' };
const base = () => ({
  background: { colorMode: 'theme', gradient: { colors: ['#000000'] } },
  visualizer: { colorMode: 'theme', color: '#ffffff', color2: '#eeeeee' },
  layerStack: { enabled: true },
  layers: [
    { kind: 'background', settings: { background: { colorMode: 'theme' } } },
    { kind: 'background', settings: { background: { colorMode: 'solid' } } },
    { kind: 'visualizer', settings: { visualizer: { colorMode: 'theme' } } },
    { kind: 'visualizer', settings: { visualizer: { colorMode: 'custom', color: '#123456' } } },
    { kind: 'visualizer', settings: { visualizer: { rainbow: true } } },
  ],
});

test('renkler yalnız renk teması kipindeki öğelere yazılır', () => {
  const cfg = base();
  const p = patchFor(cfg, RES, {});
  assert.deepStrictEqual(p.background.gradient.colors, RES.colors.slice(0, 5));
  assert.strictEqual(p.visualizer.color, '#aa0000');
  assert.deepStrictEqual(p.layers[0].settings.background.gradient.colors, RES.colors.slice(0, 5));
  assert.strictEqual(p.layers[1].settings.background.gradient, undefined);
  assert.strictEqual(p.layers[2].settings.visualizer.color2, '#00aa00');
  assert.strictEqual(p.layers[3].settings.visualizer.color, '#123456');
  assert.strictEqual(p.layers[4].settings.visualizer.color, undefined);
  assert.deepStrictEqual(cfg, base(), 'ayarın kendisi değişmemeli');
});

test('hedef anahtarları kapalıysa o bölüm yazılmaz', () => {
  const p = patchFor(base(), RES, { applyToBackground: false, applyToVisualizer: false });
  assert.strictEqual(p.background, undefined);
  assert.strictEqual(p.visualizer, undefined);
  assert.strictEqual(patchFor(base(), null, {}), null);
});

test('okunamayan kapağın yedek paleti uygulanmaz', () => {
  const AT = require('../../src/shared/adaptive-theme.js');
  assert.strictEqual(isFallback(AT, Object.assign({ modeUsed: 'artwork' }, AT.fallbackPalette())), true);
  assert.strictEqual(isFallback(AT, Object.assign({ modeUsed: 'random' }, AT.fallbackPalette())), false);
  assert.strictEqual(isFallback(AT, Object.assign({ modeUsed: 'artwork' }, RES)), false);
});
