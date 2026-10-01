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
  assert.match(sceneSrc, /cfg\.background\.colorMode\s*=\s*m/);
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
