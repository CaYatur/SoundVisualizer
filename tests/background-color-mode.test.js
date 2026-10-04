'use strict';
/* background.colorMode: theme | solid | rainbow — one resolve path for Admin + Layers. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const defaultsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'defaults.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'scene-panels.js'), 'utf8');
const npSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'nowplaying.js'), 'utf8');
const layersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'layers.js'), 'utf8');

function loadSV() {
  const ctx = { window: {}, console };
  ctx.window = ctx;
  vm.runInNewContext(defaultsSrc, ctx);
  return ctx.window.SV || ctx.SV;
}

test('kaynak: resolveBackgroundColors disa acik', () => {
  assert.match(defaultsSrc, /function resolveBackgroundColors\s*\(/);
  assert.match(defaultsSrc, /colorMode:\s*'theme'/);
  assert.match(defaultsSrc, /resolveBackgroundColors,/);
});

test('factory: visualizer + background colorMode default to theme', () => {
  const SV = loadSV();
  const cfg = SV.defaultConfig();
  assert.strictEqual(cfg.visualizer.colorMode, 'theme');
  assert.strictEqual(cfg.visualizer.rainbow, false);
  assert.strictEqual(cfg.background.colorMode, 'theme');
  /* Source of truth in defaults.js — visualizer must not default to rainbow. */
  assert.match(defaultsSrc, /visualizer:\s*\{[\s\S]*?colorMode:\s*'theme'/);
  assert.doesNotMatch(defaultsSrc, /visualizer:\s*\{[\s\S]*?colorMode:\s*'rainbow'/);
});

test('resolve: theme gradient.colors kullanir', () => {
  const SV = loadSV();
  const cols = ['#111111', '#222222', '#333333', '#444444', '#555555'];
  const out = SV.resolveBackgroundColors({ background: { colorMode: 'theme', gradient: { colors: cols } } });
  assert.strictEqual(JSON.stringify(out), JSON.stringify(cols));
});

test('resolve: solid solidColor x5', () => {
  const SV = loadSV();
  const out = SV.resolveBackgroundColors({ background: { colorMode: 'solid', solidColor: '#abcdef' } });
  assert.strictEqual(JSON.stringify(out), JSON.stringify(['#abcdef', '#abcdef', '#abcdef', '#abcdef', '#abcdef']));
});

test('resolve: rainbow sabit spektrum', () => {
  const SV = loadSV();
  const a = SV.resolveBackgroundColors({ background: { colorMode: 'rainbow' } });
  const b = SV.resolveBackgroundColors({ background: { colorMode: 'rainbow', gradient: { colors: ['#000','#000','#000','#000','#000'] } } });
  assert.strictEqual(a.length, 5);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.notStrictEqual(a[0], '#000');
});

test('kaynak: Admin Background Renk Modu segmenti', () => {
  assert.match(adminSrc, /path:\s*'background\.colorMode'/);
  assert.match(adminSrc, /value:\s*'solid'[\s\S]*value:\s*'theme'[\s\S]*value:\s*'rainbow'/);
});

test('kaynak: Layers Background Renk Modu miniSegment', () => {
  assert.match(sceneSrc, /setBgColorMode|getBgColorMode|colorMode/);
  assert.match(sceneSrc, /\['solid',\s*'Düz Renk'\]/);
  assert.match(sceneSrc, /setB\('colorMode', m\)/);
  assert.doesNotMatch(sceneSrc, /cfg\.background\.colorMode\s*=\s*m/);
});

test('kaynak: nowplaying colorMode (custom/theme/rainbow) uygular', () => {
  assert.match(npSrc, /colorMode === 'custom'/);
  assert.match(npSrc, /colorMode === 'rainbow'/);
  assert.match(npSrc, /cfg\.visualizer && cfg\.visualizer\.colorMode/);
});

test('kaynak: NP ve text panelleri Renk Modu segmenti kullanir', () => {
  const npPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'nowplaying-panel.js'), 'utf8');
  const textPanel = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'text-panel.js'), 'utf8');
  assert.match(npPanel, /miniSegment\('Renk Modu'/);
  assert.match(npPanel, /nowplaying\.colorDim/);
  assert.match(npPanel, /nowplaying\.colorBar/);
  assert.match(textPanel, /miniSegment\('Renk Modu'/);
  assert.match(textPanel, /text\.colorHighlight/);
});

test('kaynak: text.js colorMode uygular', () => {
  const textSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'text.js'), 'utf8');
  assert.match(textSrc, /colorMode === 'custom'/);
  assert.match(textSrc, /colorMode === 'rainbow'/);
});

test('kaynak: Admin NP solid modunda uc renk', () => {
  assert.match(adminSrc, /path: 'nowplaying\.color'/);
  assert.match(adminSrc, /path: 'nowplaying\.colorDim'/);
  assert.match(adminSrc, /path: 'nowplaying\.colorBar'/);
});

test('kaynak: Admin Background Renk Modu solidColor\'dan once', () => {
  const modeAt = adminSrc.indexOf("path: 'background.colorMode'");
  const solidAt = adminSrc.indexOf("path: 'background.solidColor'");
  assert.ok(modeAt > 0 && solidAt > 0, 'ikisi de olmali');
  assert.ok(modeAt < solidAt, 'Renk Modu, Duz Renk secicisinden once gelmeli');
});

test('kaynak: renk sablonlari asla gizlenmez (usesPalette stripte cagrilmaz)', () => {
  /* Keep usesPalette helper for Background card sliders, but the
     Renkler ve Hazır Şablonlar strip must not call it. */
  assert.match(adminSrc, /const usesPalette\s*=\s*\(\)\s*=>/);
  const stripAt = adminSrc.indexOf("title: 'Renkler ve Hazır Şablonlar'");
  assert.ok(stripAt > 0, 'Renkler ve Hazır Şablonlar karti yok');
  const stripBlock = adminSrc.slice(stripAt, adminSrc.indexOf('controls:', stripAt));
  assert.match(stripBlock, /show:\s*\(\)\s*=>\s*true/);
  assert.doesNotMatch(stripBlock, /usesPalette\s*\(/);
  assert.doesNotMatch(stripBlock, /show:\s*\([^)]*colorMode/);
});

test('kaynak: layerConfig theme uses live cfg palette (dynamic theme / presets)', () => {
  assert.match(layersSrc, /mode === 'theme'/);
  assert.match(layersSrc, /live theme palette|Live shared palette|live = \(cfg && cfg\.background/);
  assert.match(layersSrc, /resolveBackgroundColors/);
  assert.match(adminSrc, /sync live theme into background layers/);
});

test('layerConfig: theme ignores stale layer-local colors', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const L = require('../src/visualizer/layers.js');
  const live = ['#aa0000', '#bb0000', '#cc0000', '#dd0000', '#ee0000'];
  const stale = ['#111111', '#222222', '#333333', '#444444', '#555555'];
  const cfg = {
    background: { type: 'gradient', colorMode: 'theme', gradient: { colors: live.slice() } },
    visualizer: { type: 'bars' },
    layerStack: { enabled: true },
    layers: [],
  };
  const layer = L.normalizeLayer({
    id: 'ly_bg', kind: 'background', type: 'gradient',
    settings: { background: { colorMode: 'theme', gradient: { colors: stale.slice(), speed: 0.9 } } },
  });
  const out = L.layerConfig(cfg, layer);
  assert.deepStrictEqual(out.background.gradient.colors, live);
  assert.strictEqual(out.background.gradient.speed, 0.9);
  assert.strictEqual(out.background.colorMode, 'theme');
});

test('layerConfig katmanın kendi arkaplan renk kipini korur', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const L = require('../src/visualizer/layers.js');
  const live = ['#aa0000', '#bb0000', '#cc0000', '#dd0000', '#ee0000'];
  const cfg = {
    background: {
      type: 'gradient', colorMode: 'theme', solidColor: '#111111',
      gradient: { colors: live.slice() },
    },
    visualizer: { type: 'bars', colorMode: 'theme' },
    nowplaying: { color: '#ffffff' },
    layerStack: { enabled: true },
    layers: [],
  };
  const solid = L.layerConfig(cfg, L.normalizeLayer({
    id: 's', kind: 'background', type: 'gradient',
    settings: { background: { colorMode: 'solid', solidColor: '#abcdef', gradient: { colors: ['#010101'] } } },
  }));
  assert.strictEqual(solid.background.colorMode, 'solid');
  assert.strictEqual(solid.background.solidColor, '#abcdef');
  assert.ok(solid.background.gradient.colors.every((c) => String(c).toLowerCase() === '#abcdef'));
  const inherit = L.layerConfig(cfg, L.normalizeLayer({
    id: 'i', kind: 'background', type: 'gradient',
    settings: { background: { gradient: { speed: 0.4 } } },
  }));
  assert.strictEqual(inherit.background.colorMode, 'theme');
  assert.deepStrictEqual(inherit.background.gradient.colors, live);
  const np = L.layerConfig(cfg, L.normalizeLayer({
    id: 'n', kind: 'nowplaying', type: 'nowplaying',
    settings: { visualizer: { colorMode: 'rainbow', glow: 0.5 }, nowplaying: { colorMode: 'rainbow' } },
  }));
  assert.strictEqual(np.visualizer.colorMode, 'rainbow');
  assert.strictEqual(np.visualizer.glow, 0.5);
  assert.strictEqual(np.nowplaying.colorMode, 'rainbow');
  const text = L.layerConfig(cfg, L.normalizeLayer({
    id: 't', kind: 'visualizer', type: 'text',
    settings: { text: { content: 'A', colorMode: 'custom' } },
  }));
  assert.strictEqual(text.visualizer.colorMode, 'custom');
  assert.strictEqual(text.text.colorMode, 'custom');
  assert.strictEqual(cfg.visualizer.colorMode, 'theme');
});
