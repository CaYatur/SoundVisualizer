'use strict';
/* applyTimelineAt: palet ve görselleştirici dışa aktarımda t anında yazılır. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');

test('applyTimelineAt: Gece başlamadan Orman renkleri', () => {
  const cfg = SV.defaultConfig();
  cfg.background.gradient.colors = ['#000000', '#111111', '#222222', '#333333', '#444444'];
  const forest = SV.GRADIENT_PRESETS.find((g) => g.name === 'Orman');
  const night = SV.GRADIENT_PRESETS.find((g) => g.name === 'Gece');
  assert.ok(forest && night);
  const tl = TL.makeTimeline({
    tracks: [
      { id: 'a', kind: 'clip', clips: [{ id: 'f', type: 'palette', ref: 'Orman', start: 0, dur: 4 }] },
      { id: 'b', kind: 'clip', clips: [{ id: 'n', type: 'palette', ref: 'Gece', start: 2, dur: 4 }] },
    ],
  });
  const a = TL.applyTimelineAt(cfg, tl, 0.7);
  assert.deepStrictEqual(a.cfg.background.gradient.colors, forest.colors);
  const b = TL.applyTimelineAt(cfg, tl, 2.5);
  assert.deepStrictEqual(b.cfg.background.gradient.colors, night.colors);
  const c = TL.applyTimelineAt(cfg, tl, 0.7);
  assert.deepStrictEqual(c.cfg.background.gradient.colors, forest.colors);
});

test('applyTimelineAt: visualizer klip katman tipini yazar', () => {
  const cfg = SV.defaultConfig();
  cfg.layers = [
    { id: 'bg', kind: 'background', type: 'solid', enabled: true },
    { id: 'v1', kind: 'visualizer', type: 'bars', enabled: true, locked: false },
  ];
  const tl = TL.makeTimeline({
    tracks: [
      { id: 't', kind: 'clip', clips: [{ id: 'c', type: 'visualizer', ref: 'circular', start: 1, dur: 3 }] },
    ],
  });
  const before = TL.applyTimelineAt(cfg, tl, 0.2);
  assert.strictEqual(before.cfg.layers.find((l) => l.id === 'v1').type, 'bars');
  const mid = TL.applyTimelineAt(cfg, tl, 1.5);
  assert.strictEqual(mid.cfg.layers.find((l) => l.id === 'v1').type, 'circular');
  assert.ok(mid.applied);
});

test('applyTimelineAt: kilitli/text katmana visualizer yazılmaz', () => {
  const cfg = SV.defaultConfig();
  cfg.layers = [
    { id: 'tx', kind: 'visualizer', type: 'text', enabled: true },
    { id: 'lk', kind: 'visualizer', type: 'bars', enabled: true, locked: true },
    { id: 'ok', kind: 'visualizer', type: 'bars', enabled: true, locked: false },
  ];
  cfg.visualizer = { type: 'bars' };
  const tl = TL.makeTimeline({
    tracks: [{ id: 't', kind: 'clip', clips: [{ id: 'c', type: 'visualizer', ref: 'orb', start: 0, dur: 2 }] }],
  });
  const at = TL.applyTimelineAt(cfg, tl, 0.5);
  assert.strictEqual(at.cfg.layers.find((l) => l.id === 'tx').type, 'text');
  assert.strictEqual(at.cfg.layers.find((l) => l.id === 'lk').type, 'bars');
  assert.strictEqual(at.cfg.layers.find((l) => l.id === 'ok').type, 'orb');
});
