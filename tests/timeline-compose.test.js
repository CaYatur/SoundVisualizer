/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Yalıtılmış Timeline bileşimi — durumlu davranış testleri. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/schema.js');
require('../src/visualizer/layers.js');
const TL = require('../src/shared/timeline.js');
const TC = require('../src/shared/timeline-compose.js');
const SV = global.window.SV;

function baseCfg() {
  const cfg = SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = [{ id: 'man1', kind: 'visualizer', type: 'bars', enabled: true, opacity: 1 }];
  cfg.scenes = [
    { id: 'sc_a', name: 'Üzgün', data: { layerStack: { enabled: true }, layers: [
      { id: 'a_bg', kind: 'background', type: 'gradient', enabled: true, opacity: 1, settings: { background: { type: 'gradient', gradient: { colors: ['#111111', '#222222'] } } } },
      { id: 'a_vis', kind: 'visualizer', type: 'wave', enabled: true, opacity: 1 },
    ], postfx: [{ id: 'fx1', type: 'bloom' }] } },
    { id: 'sc_b', name: 'B', data: { layerStack: { enabled: true }, layers: [{ id: 'b_vis', kind: 'visualizer', type: 'circle', enabled: true, opacity: 1 }] } },
  ];
  return cfg;
}
function tlWith(tracks) {
  return TL.makeTimeline({ tracks });
}
const types = (r) => r.cfg.layers.map((l) => l.type);
const vis = (r) => r.cfg.layers.filter((l) => l.kind === 'visualizer').length;

test('rewind after future visualizer clip removes the extra layer (t754/t755)', () => {
  const cfg = baseCfg();
  const before = JSON.stringify(cfg);
  const tl = tlWith([
    { id: 'top', clips: [{ id: 'v1', type: 'visualizer', ref: 'spectrum', start: 4, dur: 2 }] },
    { id: 'bot', clips: [{ id: 's1', type: 'scene', ref: 'sc_a', start: 0, dur: 10 }] },
  ]);
  const t0 = TC.composeAt(cfg, tl, 0);
  assert.deepStrictEqual(types(t0), ['gradient', 'wave']);
  const t5 = TC.composeAt(cfg, tl, 5);
  assert.deepStrictEqual(types(t5), ['gradient', 'wave', 'spectrum']);
  // durdur → başa sar: aynı kaynak sahne, ek görselleştirici yok
  const back = TC.composeAt(cfg, tl, 0);
  assert.deepStrictEqual(types(back), ['gradient', 'wave']);
  assert.strictEqual(vis(back), 1);
  assert.strictEqual(JSON.stringify(cfg), before, 'manual cfg/sources untouched');
});

test('exact boundaries, fractional times, gap and end are BLACK', () => {
  const cfg = baseCfg();
  const tl = tlWith([{ id: 'a', clips: [
    { id: 'c1', type: 'scene', ref: 'sc_a', start: 0.5, dur: 1.25 },
    { id: 'c2', type: 'scene', ref: 'sc_b', start: 3, dur: 1 },
  ] }]);
  assert.ok(TC.composeAt(cfg, tl, 0.49).black);
  assert.ok(!TC.composeAt(cfg, tl, 0.5).black);
  assert.ok(!TC.composeAt(cfg, tl, 1.74).black);
  assert.ok(TC.composeAt(cfg, tl, 1.75).black, 'end exclusive');
  const gap = TC.composeAt(cfg, tl, 2);
  assert.ok(gap.black);
  assert.strictEqual(gap.cfg.layers.length, 0);
  assert.deepStrictEqual(gap.cfg.postfx, []);
  assert.deepStrictEqual(types(TC.composeAt(cfg, tl, 3)), ['circle']);
  assert.ok(TC.composeAt(cfg, tl, 4.5).black, 'after end: black, no last-frame hold');
});

test('two clips of the same source are independent; ids unique', () => {
  const cfg = baseCfg();
  const tl = tlWith([
    { id: 'up', clips: [{ id: 'x1', type: 'scene', ref: 'sc_b', start: 0, dur: 4 }] },
    { id: 'dn', clips: [{ id: 'x2', type: 'scene', ref: 'sc_b', start: 0, dur: 4 }] },
  ]);
  TC.ensureLocal(cfg, tl.tracks[0].clips[0]).data.layers[0].type = 'tunnel';
  const r = TC.composeAt(cfg, tl, 1);
  assert.deepStrictEqual(types(r), ['circle', 'tunnel'], 'bottom track behind, top in front');
  const ids = r.cfg.layers.map((l) => l.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(cfg.scenes[1].data.layers[0].type, 'circle', 'source scene intact');
});

test('child layer added to a clip-local copy lives only in parent interval and survives save/load', () => {
  const cfg = baseCfg();
  cfg.timeline = { tracks: [{ id: 'a', clips: [{ id: 'c1', type: 'scene', ref: 'sc_a', start: 2, dur: 3 }] }] };
  let tl = tlWith(cfg.timeline.tracks);
  const loc = TC.ensureLocal(cfg, tl.tracks[0].clips[0]);
  loc.data.layers.push({ id: 'child1', kind: 'visualizer', type: 'particles', enabled: true, opacity: 1 });
  // kaydet / yeniden yükle
  const saved = JSON.parse(JSON.stringify({ tracks: tl.tracks }));
  tl = TL.makeTimeline(saved);
  assert.ok(tl.tracks[0].clips[0].local);
  assert.ok(TC.composeAt(cfg, tl, 1).black);
  assert.ok(types(TC.composeAt(cfg, tl, 3)).includes('particles'));
  assert.ok(TC.composeAt(cfg, tl, 5).black);
  assert.strictEqual(cfg.scenes[0].data.layers.length, 2, 'source scene not mutated');
  assert.strictEqual(tl.tracks.length, 1, 'no unrelated top-level clip added');
});

test('duplicated clip local copy is deep-isolated with fresh layer ids', () => {
  const cfg = baseCfg();
  const tl = tlWith([{ id: 'a', clips: [{ id: 'c1', type: 'scene', ref: 'sc_b', start: 0, dur: 2 }] }]);
  const c = tl.tracks[0].clips[0];
  TC.ensureLocal(cfg, c);
  const dup = TL.makeClip(Object.assign(JSON.parse(JSON.stringify(c)), { id: 'c2', start: 2 }));
  TC.cloneLocalFor(dup);
  dup.local.data.layers[0].type = 'tunnel';
  assert.strictEqual(c.local.data.layers[0].type, 'circle');
  assert.notStrictEqual(c.local.data.layers[0].id, dup.local.data.layers[0].id);
});

test('palette is a timed modifier over visuals across tracks; top wins; no persistence', () => {
  const cfg = baseCfg();
  const pal = SV.GRADIENT_PRESETS[0];
  const tl = tlWith([
    { id: 'p', clips: [{ id: 'p1', type: 'palette', ref: pal.name, start: 1, dur: 1 }] },
    { id: 's', clips: [{ id: 's1', type: 'scene', ref: 'sc_a', start: 0, dur: 4 }] },
  ]);
  const bg = (r) => r.cfg.layers[0].settings.background.gradient.colors;
  assert.deepStrictEqual(bg(TC.composeAt(cfg, tl, 0.5)), ['#111111', '#222222']);
  assert.deepStrictEqual(bg(TC.composeAt(cfg, tl, 1.5)), pal.colors);
  assert.deepStrictEqual(bg(TC.composeAt(cfg, tl, 2.5)), ['#111111', '#222222']);
  // palet tek başına siyahı renklendirmez
  const solo = tlWith([{ id: 'p', clips: [{ id: 'p1', type: 'palette', ref: pal.name, start: 0, dur: 1 }] }]);
  assert.ok(TC.composeAt(cfg, solo, 0.5).black);
});

test('scene effects come from the top scene only within interval; missing source contributes nothing', () => {
  const cfg = baseCfg();
  const tl = tlWith([{ id: 'a', clips: [
    { id: 'c1', type: 'scene', ref: 'sc_a', start: 0, dur: 1 },
    { id: 'c2', type: 'scene', ref: 'deleted', start: 1, dur: 1 },
  ] }]);
  assert.strictEqual(TC.composeAt(cfg, tl, 0.5).cfg.postfx.length, 1);
  const miss = TC.composeAt(cfg, tl, 1.5);
  assert.ok(miss.black);
  assert.deepStrictEqual(miss.cfg.postfx, []);
});

test('mute/solo, opacity and fades follow existing semantics', () => {
  const cfg = baseCfg();
  const tl = tlWith([
    { id: 'm', muted: true, clips: [{ id: 'v', type: 'visualizer', ref: 'spectrum', start: 0, dur: 4 }] },
    { id: 's', opacity: 0.5, clips: [{ id: 's1', type: 'scene', ref: 'sc_b', start: 0, dur: 4, fadeIn: 2 }] },
  ]);
  const r = TC.composeAt(cfg, tl, 1);
  assert.deepStrictEqual(types(r), ['circle']);
  assert.ok(Math.abs(r.cfg.layers[0].opacity - 0.25) < 1e-9);
});

test('selection is not output: future clip composition depends on time only', () => {
  const cfg = baseCfg();
  const tl = tlWith([{ id: 'a', clips: [{ id: 'f', type: 'visualizer', ref: 'spectrum', start: 10, dur: 1 }] }]);
  assert.ok(!TC.clipActiveAt(tl, 'f', 0));
  TC.ensureLocal(cfg, tl.tracks[0].clips[0]);
  assert.ok(TC.composeAt(cfg, tl, 0).black);
});

test('type/source change drops stale local copy', () => {
  const cfg = baseCfg();
  const c = TL.makeClip({ id: 'c', type: 'scene', ref: 'sc_a' });
  TC.ensureLocal(cfg, c);
  c.ref = 'sc_b';
  assert.ok(TC.dropStaleLocal(c));
  assert.ok(!c.local);
});
