/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Alt sahne yığınlarının yaşam süresi ve render çağrı sırası. Gerçek piksel
   eşitliği ayrıca scripts/ui-tl-render.js ile Electron'da ölçülür. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/visualizer/timeline-render.js');
function harness() {
  const calls = [], stacks = [], transitions = [];
  let seq = 0;
  function canvas() {
    const c = { id: ++seq, width: 0, height: 0 };
    const ctx = { canvas: c, save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {}, drawImage(image) { calls.push(['image', image.id, this.globalAlpha]); } };
    c.getContext = () => ctx; return c;
  }
  const r = new Renderer({ canvas, compositor: () => ({ compose(ctx, from, to, w, h, type, p, params) { transitions.push({ type, p, params }); } }), stack() {
    const s = { id: stacks.length, width: 0, height: 0,
      setConfig(cfg) { this.cfg = cfg; this.configs = (this.configs || 0) + 1; },
      setPostFX(fx) { this.fx = fx; this.postfx = { hasWork: () => !!fx.length, resize() {}, canvas: canvas(), render() { calls.push(['fx', fx.map((f) => f.type)]); } }; },
      syncMedia() {}, resize(w, h) { this.width = w; this.height = h; },
      _ensureComp() { if (!this.compCanvas) { this.compCanvas = canvas(); this.compCtx = this.compCanvas.getContext(); } },
      drawTo(ctx, audio, cfg, t) { calls.push(['scene', cfg.geometry.zoom, t]); },
      _assetModes() { return [this.id]; }, dispose() { this.disposed = true; },
    }; stacks.push(s); return s;
  } });
  return { r, calls, stacks, transitions, ctx: canvas().getContext() };
}
const unit = (id, zoom, fx, op = 1) => ({ id, opacity: op, localTime: 2, cfg: { geometry: { zoom }, postfx: fx.map((type) => ({ type })), layers: [], transition: { enabled: false } }, transition: null });
test('each scene is rendered and processed before group opacity, reused, disposed at end', () => {
  const h = harness(), a = unit('a', 2, ['grade']), b = unit('b', 3, ['vignette'], 0.4);
  h.r.draw(h.ctx, { units: [a, b], time: 1.5 }, {}, 77, 0, 64, 32);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'scene'), [['scene', 2, 1.5], ['scene', 3, 1.5]]);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fx'), [['fx', ['grade']], ['fx', ['vignette']]]);
  assert.ok(h.calls.some((c) => c[0] === 'image' && c[2] === 0.4));
  assert.equal(h.stacks[0].compCanvas.width, 64); assert.equal(h.stacks[0].compCanvas.height, 32);
  h.r.draw(h.ctx, { units: [a, b], time: 1.75 }, {}, 78, 0, 64, 32);
  assert.equal(h.stacks.length, 2); assert.equal(h.stacks[0].configs, 1);
  h.r.draw(h.ctx, { units: [a], time: 3 }, {}, 80, 0, 64, 32);
  assert.equal(h.stacks[1].disposed, true); assert.deepEqual(h.r.assetModes(), [0]);
  h.r.draw(h.ctx, { units: [], time: 5 }, {}, 82, 0, 64, 32);
  assert.equal(h.stacks[0].disposed, true); assert.equal(h.r.children.size, 0);
});
test('nonfade style/easing progress and params reach actual compositor, independent of previous frame', () => {
  const h = harness(), a = unit('a', 2, []);
  for (const p of [0, 0.5, 1, 0.25]) {
    a.transition = { type: 'wipe', p, params: { direction: 'left' } };
    h.r.draw(h.ctx, { units: [a], time: p }, {}, 100, 0.016, 64, 32);
  }
  assert.deepEqual(h.transitions.map((r) => r.p), [0, 0.5, 1, 0.25]);
  assert.ok(h.transitions.every((r) => r.type === 'wipe' && r.params.direction === 'left'));
});
test('offline preparation creates current media players before seeking with clip-local time', async () => {
  const h = harness(), a = unit('a', 2, []);
  h.r.prepare({ units: [a] });
  const times = []; h.stacks[0]._mediaPool = new Map([['file', { seekTo(t) { times.push(t); return true; } }]]);
  a.localTime = 3.75;
  assert.equal(await h.r.seekMedia({ units: [a] }), true); assert.deepEqual(times, [3.75]);
  h.stacks[0]._mediaPool.set('file', { seekTo() { return false; } });
  assert.equal(await h.r.seekMedia({ units: [a] }), false, 'missing/unreadable media is reported, not a stale frame');
  h.r.dispose(); assert.equal(h.stacks[0].disposed, true);
});

test('scene readouts are forwarded from active child stacks; hidden/expired clips do not own monitors', () => {
  const h = harness(), a = unit('a', 1, []), b = unit('b', 2, []);
  h.r.prepare({ units: [a, b] });
  h.stacks[0].milkdropMonitor = () => 10; h.stacks[1].milkdropMonitor = () => 20;
  h.stacks[0].milkdropLayers = () => ({ 'tl~a~md': 'one' }); h.stacks[1].milkdropLayers = () => ({ 'tl~b~md': 'two' });
  assert.equal(h.r.read('milkdropMonitor'), 20);
  b.opacity = 0; assert.equal(h.r.read('milkdropMonitor'), 10);
  assert.deepEqual(h.r.layerReadouts(), { 'tl~a~md': 'one', 'tl~b~md': 'two' });
  h.r.prepare({ units: [a] }); assert.equal(h.r.read('milkdropMonitor'), 10);
});
