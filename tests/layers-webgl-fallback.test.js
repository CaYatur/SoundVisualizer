'use strict';
/* K1 + M2 regression (Linux box / WebGL-blocklist + no-audio).
 *
 * K1: GradientMode constructor throws when WebGL is missing. Old code set
 *     e.mode=null but left e.gl=true and never assigned e.ctx → fillStyle
 *     TypeError every frame.
 * M2: Live visualizer cleared+returned when !audio.ready, so MilkDrop never
 *     reached draw()/_initGL. Idle/zero buffers must still call mode.draw.
 */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

const ROOT = path.join(__dirname, '..');
const layersSrc = () => fs.readFileSync(path.join(ROOT, 'src/visualizer/layers.js'), 'utf8');

function fakeCanvas() {
  const ctx2d = {
    fillStyle: '#unset',
    fills: 0,
    clears: 0,
    clearRect() { this.clears++; },
    fillRect() { this.fills++; },
    save() {},
    restore() {},
    setTransform() {},
    drawImage() {},
  };
  return {
    width: 320,
    height: 180,
    style: {},
    classList: { add() {} },
    parentNode: null,
    getContext(type) {
      if (type === '2d') return ctx2d;
      return null;
    },
    _ctx2d: ctx2d,
  };
}

function installDocument() {
  global.document = {
    createElement(tag) {
      assert.strictEqual(tag, 'canvas');
      return fakeCanvas();
    },
  };
}

// ---------------------------------------------------------------- source lock

test('K1 source: gradient catch falls back to 2D solid (not gl=true alone)', () => {
  const s = layersSrc();
  const block = /if \(layer\.type === 'gradient'\) \{[\s\S]*?else if \(window\.SVBackgrounds/.exec(s);
  assert.ok(block, 'gradient create block missing');
  const body = block[0];
  assert.match(body, /catch\s*\{/);
  assert.match(body, /e\.gl\s*=\s*false/);
  assert.match(body, /e\.ctx\s*=\s*e\.canvas\.getContext\('2d'\)/);
  assert.match(body, /e\.solid\s*=\s*true/);
  /* Old bug: e.gl=true AFTER the catch, so failure still looked like GL. */
  assert.doesNotMatch(body, /catch\s*\{\s*e\.mode\s*=\s*null;\s*\}\s*e\.gl\s*=\s*true/);
});

test('K1 source: background draw guards null ctx before fillStyle', () => {
  const s = layersSrc();
  const i = s.indexOf('_drawEntryRaw(e, audio, cfg, t, dt, live)');
  assert.ok(i > 0);
  const raw = s.slice(i, i + 1200);
  assert.match(raw, /if\s*\(\s*!e\.ctx\s*\)\s*return/);
  const fill = raw.indexOf('e.ctx.fillStyle');
  const guard = raw.indexOf('if (!e.ctx) return');
  assert.ok(guard > 0 && guard < fill, 'null-ctx guard must precede fillStyle');
});

test('M2 source: visualizer draw is not gated on audio.ready', () => {
  const src = layersSrc();
  const i = src.indexOf('_drawEntryRaw(e, audio, cfg, t, dt, live)');
  assert.ok(i > 0);
  const raw = src.slice(i, i + 2200);
  const start = raw.indexOf("if (l.kind === 'visualizer' || l.kind === 'nowplaying')");
  assert.ok(start >= 0, 'visualizer branch missing');
  const nextKind = raw.indexOf("if (l.kind ===", start + 10);
  const vis = raw.slice(start, nextKind > start ? nextKind : start + 800);
  assert.doesNotMatch(vis, /!audio\s*\|\|\s*!audio\.ready|!audio\.ready/);
  assert.match(vis, /e\.mode\.draw\(audio/);
});

test('K1: WebGL gradient ctor throw → 2D solid entry (gl false, ctx set)', () => {
  installDocument();
  window.SVModes = window.SVModes || {};
  window.SVModes.gradient = function () {
    throw new Error('WebGL desteklenmiyor');
  };
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const layer = L.normalizeLayer({ id: 'ly_bg', kind: 'background', type: 'gradient' });
  const e = stack._create(layer, 'ly_bg', { background: { type: 'gradient', solidColor: '#112233' } });
  assert.strictEqual(e.mode, null);
  assert.strictEqual(e.gl, false, 'failed WebGL must not leave gl=true');
  assert.ok(e.ctx, '2D ctx fallback required');
  assert.strictEqual(e.solid, true);
});

test('K1: failed-gradient entry draws solid without TypeError', () => {
  installDocument();
  window.SVModes = window.SVModes || {};
  window.SVModes.gradient = function () {
    throw new Error('WebGL desteklenmiyor');
  };
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const cfg = { background: { type: 'gradient', solidColor: '#abcdef' } };
  const layer = L.normalizeLayer({ id: 'ly_bg', kind: 'background', type: 'gradient' });
  const e = stack._create(layer, 'ly_bg', cfg);
  assert.doesNotThrow(() => stack._drawEntryRaw(e, { ready: false }, cfg, 0, 1 / 60));
  assert.strictEqual(e.ctx.fillStyle, '#abcdef');
  assert.ok(e.ctx.fills > 0, 'solid fillRect should run');
});

test('K1: pre-fix bad state (gl=true, mode=null, ctx=null) does not throw', () => {
  /* Defensive path if an older revive/_create left the bad flags. */
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  const e = {
    layer: L.normalizeLayer({ id: 'ly_bg', kind: 'background', type: 'gradient' }),
    key: 'ly_bg',
    canvas: fakeCanvas(),
    ctx: null,
    mode: null,
    gl: true,
    solid: false,
  };
  assert.doesNotThrow(() =>
    stack._drawEntryRaw(e, { ready: true }, { background: { type: 'gradient', solidColor: '#000' } }, 0, 1 / 60)
  );
});

// ---------------------------------------------------------------- M2 behaviour

test('M2: visualizer mode.draw runs when audio.ready is false', () => {
  const stack = new L.LayerStack(null, {});
  stack.width = 320;
  stack.height = 180;
  let draws = 0;
  const mode = {
    draw(audio) {
      draws++;
      assert.ok(audio, 'audio object passed');
      assert.strictEqual(audio.ready, false);
    },
  };
  const canvas = fakeCanvas();
  const e = {
    layer: L.normalizeLayer({ id: 'ly_vis', kind: 'visualizer', type: 'milkdrop' }),
    key: 'ly_vis',
    canvas,
    ctx: canvas._ctx2d,
    mode,
    gl: false,
  };
  const audio = { ready: false, level: 0, bass: 0, mid: 0, treble: 0 };
  const cfg = { visualizer: { type: 'milkdrop' }, layerStack: { enabled: true } };
  stack._drawEntryRaw(e, audio, cfg, 0, 1 / 60);
  assert.strictEqual(draws, 1, 'MilkDrop-style mode must init/draw without a real frame');
  assert.strictEqual(canvas._ctx2d.clears, 0, 'must not clear+return on !ready');
});

test('M2: visualizer still draws when audio.ready is true (real path)', () => {
  const stack = new L.LayerStack(null, {});
  stack.width = 64;
  stack.height = 64;
  let draws = 0;
  const mode = { draw() { draws++; } };
  const canvas = fakeCanvas();
  const e = {
    layer: L.normalizeLayer({ id: 'ly_vis', kind: 'visualizer', type: 'bars' }),
    key: 'ly_vis',
    canvas,
    ctx: canvas._ctx2d,
    mode,
    gl: false,
  };
  stack._drawEntryRaw(e, { ready: true, level: 0.4, bass: 0.2, mid: 0.2, treble: 0.1 }, {
    visualizer: { type: 'bars' },
  }, 1, 1 / 60);
  assert.strictEqual(draws, 1);
});

test('M2: missing audio object still clears (no crash)', () => {
  const stack = new L.LayerStack(null, {});
  stack.width = 64;
  stack.height = 64;
  let draws = 0;
  const canvas = fakeCanvas();
  const e = {
    layer: L.normalizeLayer({ id: 'ly_vis', kind: 'visualizer', type: 'bars' }),
    key: 'ly_vis',
    canvas,
    ctx: canvas._ctx2d,
    mode: { draw() { draws++; } },
    gl: false,
  };
  stack._drawEntryRaw(e, null, { visualizer: { type: 'bars' } }, 0, 1 / 60);
  assert.strictEqual(draws, 0);
  assert.ok(canvas._ctx2d.clears > 0);
});


// ---------------------------------------------------------------- K1 admin signal

test('K1 source: webglFallback flag + sync + admin event', () => {
  const src = layersSrc();
  assert.match(src, /e\.webglFallback\s*=\s*true/);
  assert.match(src, /_syncGradientWebGLFallback\s*\(/);
  assert.match(src, /hasGradientWebGLFallback\s*\(/);
  assert.match(src, /sv-gradient-webgl-fallback/);
  assert.match(src, /isGradientWebGLFallback/);
});

test('K1: failed gradient sets hasGradientWebGLFallback after setConfig', () => {
  installDocument();
  window.SVModes = window.SVModes || {};
  window.SVModes.gradient = function () {
    throw new Error('WebGL desteklenmiyor');
  };
  const stack = new L.LayerStack(null, {});
  stack.width = 64;
  stack.height = 64;
  assert.strictEqual(stack.hasGradientWebGLFallback(), false);
  stack.setConfig({
    background: { type: 'gradient', solidColor: '#112233' },
    visualizer: { type: 'none' },
    layerStack: { enabled: false },
  });
  assert.strictEqual(stack.hasGradientWebGLFallback(), true, 'fallback flag after WebGL ctor throw');
  const e = stack.entries.find((x) => x.layer && x.layer.type === 'gradient');
  assert.ok(e, 'gradient entry present');
  assert.strictEqual(e.webglFallback, true);
  assert.strictEqual(e.gl, false);
  assert.strictEqual(e.solid, true);
});

test('K1: successful gradient clears webglFallback flag', () => {
  installDocument();
  window.SVModes = window.SVModes || {};
  window.SVModes.gradient = function () {
    this.resize = function () {};
    this.draw = function () {};
  };
  const stack = new L.LayerStack(null, {});
  stack.width = 64;
  stack.height = 64;
  stack.setConfig({
    background: { type: 'gradient', solidColor: '#112233' },
    visualizer: { type: 'none' },
    layerStack: { enabled: false },
  });
  assert.strictEqual(stack.hasGradientWebGLFallback(), false);
  const e = stack.entries.find((x) => x.layer && x.layer.type === 'gradient');
  assert.ok(e);
  assert.strictEqual(e.gl, true);
  assert.strictEqual(!!e.webglFallback, false);
});

test('K1 admin/i18n: notice string + keys wired', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'src/shared/i18n.js'), 'utf8');
  const admin = fs.readFileSync(path.join(ROOT, 'src/admin/admin.js'), 'utf8');
  const panels = fs.readFileSync(path.join(ROOT, 'src/admin/scene-panels.js'), 'utf8');
  const tr = 'WebGL yok / desteklenmiyor: gradyan düz renge düştü';
  const en = 'WebGL missing / unsupported: gradient fell back to solid color';
  assert.ok(i18n.includes(tr), 'TR i18n key missing');
  assert.ok(i18n.includes(en), 'EN i18n value missing');
  assert.ok(admin.includes(tr), 'admin notice text missing');
  assert.ok(admin.includes('data-sv-webgl-fallback-note'), 'admin note marker missing');
  assert.ok(admin.includes('isGradientWebGLFallback'), 'admin show() helper missing');
  assert.ok(panels.includes(tr), 'layers panel notice text missing');
  assert.ok(panels.includes('data-sv-webgl-fallback-note'), 'layers panel marker missing');
});
