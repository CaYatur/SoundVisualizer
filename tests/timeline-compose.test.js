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

test('scene effects stay in the scene render unit only within interval; missing source contributes nothing', () => {
  const cfg = baseCfg();
  const tl = tlWith([{ id: 'a', clips: [
    { id: 'c1', type: 'scene', ref: 'sc_a', start: 0, dur: 1 },
    { id: 'c2', type: 'scene', ref: 'deleted', start: 1, dur: 1 },
  ] }]);
  assert.strictEqual(TC.composeAt(cfg, tl, 0.5).cfg.timelineComposition.units[0].cfg.postfx.length, 1);
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

test('live output path (visualizer/preview) equals export composeAt; rebuild only on layer-set change; OFF restores', () => {
  const cfg = baseCfg();
  cfg.timeline = { useTimeline: true, tracks: [
    { id: 'v', clips: [{ id: 'v1', type: 'visualizer', ref: 'spectrum', start: 1, dur: 1, fadeIn: 0.5 }] },
    { id: 's', clips: [{ id: 's1', type: 'scene', ref: 'sc_a', start: 0, dur: 4 }] },
  ] };
  const st = {};
  for (const t of [0, 0.5, 1, 1.25, 1.5, 2, 3.9, 4.5]) {
    const a = TC.live(cfg, t, st).cfg;
    const b = TC.composeAt(cfg, TL.makeTimeline(cfg.timeline), t).cfg;
    assert.deepStrictEqual(a.layers, b.layers, 'same frame at ' + t);
    assert.deepStrictEqual(a.postfx, b.postfx);
  }
  const s2 = {};
  assert.ok(TC.live(cfg, 0.2, s2).rebuild);
  assert.ok(!TC.live(cfg, 0.3, s2).rebuild);
  assert.ok(TC.live(cfg, 1.1, s2).rebuild);
  assert.ok(!TC.live(cfg, 1.2, s2).rebuild, 'fade opacity alone does not rebuild');
  cfg.timeline.useTimeline = false;
  const off = TC.live(cfg, 1.2, s2);
  assert.ok(off.restore && off.rebuild);
  assert.strictEqual(off.cfg, cfg, 'OFF draws manual cfg object itself');
});

test('consumers wire the same composition', () => {
  const fs = require('fs');
  const path = require('path');
  const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  assert.match(rd('src/visualizer/visualizer.js'), /TC\.live\(cfg, showT, tlLive\)/);
  assert.match(rd('src/admin/preview.js'), /TC\.live\(cfg,/);
  assert.match(rd('src/exporter/exporter.js'), /SVTimelineCompose\.composeAt\(cfg, exportTl, t\)/);
  for (const f of ['src/admin/index.html', 'src/visualizer/index.html', 'src/exporter/index.html', 'src/web/overlay.html'])
    assert.match(rd(f), /timeline-compose\.js/, f);
});

test('overlapping scenes preserve their own effects, groups, crossfade, geometry, milkdrop and settings', () => {
  const cfg = baseCfg();
  Object.assign(cfg.scenes[0].data, { geometry: { zoom: 2 }, milkdrop: { presetId: 'one' }, layerGroups: { A: { opacity: 0.2 } }, crossfade: { enabled: true, value: 0.2 } });
  Object.assign(cfg.scenes[1].data, { postfx: [{ id: 'fx2', type: 'blur' }], geometry: { zoom: 3 }, milkdrop: { presetId: 'two' }, layerGroups: { A: { opacity: 0.8 } }, crossfade: { enabled: true, value: 0.8 } });
  const before = JSON.stringify(cfg);
  const tl = tlWith([
    { id: 'up', clips: [{ id: 'a', type: 'scene', ref: 'sc_a', start: 0, dur: 5, opacity: 0.4 }] },
    { id: 'dn', clips: [{ id: 'b', type: 'scene', ref: 'sc_b', start: 0, dur: 5 }] },
  ]);
  const r = TC.composeAt(cfg, tl, 2);
  const [bottom, top] = r.cfg.timelineComposition.units;
  assert.strictEqual(bottom.id, 'b'); assert.strictEqual(top.id, 'a');
  assert.strictEqual(bottom.cfg.postfx[0].id, 'fx2'); assert.strictEqual(top.cfg.postfx[0].id, 'fx1');
  assert.strictEqual(top.opacity, 0.4); assert.strictEqual(top.cfg.layers[0].opacity, 1, 'group opacity applied once, after FX');
  assert.strictEqual(bottom.cfg.geometry.zoom, 3); assert.strictEqual(top.cfg.geometry.zoom, 2);
  assert.strictEqual(bottom.cfg.milkdrop.presetId, 'two'); assert.strictEqual(top.cfg.milkdrop.presetId, 'one');
  assert.strictEqual(bottom.cfg.layerGroups.A.opacity, 0.8); assert.strictEqual(top.cfg.layerGroups.A.opacity, 0.2);
  assert.strictEqual(bottom.cfg.crossfade.value, 0.8); assert.strictEqual(top.cfg.crossfade.value, 0.2);
  assert.deepStrictEqual(r.cfg.postfx, [], 'no double global effect');
  assert.strictEqual(JSON.stringify(cfg), before);
});

test('all supported transition styles preserve params, timing, easing and rewind identity', () => {
  const TR = require('../src/shared/transition.js');
  const cfg = baseCfg();
  for (const type of TR.TRANSITION_IDS.filter((id) => id !== 'cut')) {
    const tl = tlWith([{ id: 's', clips: [{ id: 'a', type: 'scene', ref: 'sc_a', start: 2, dur: 2, fade: 1, transType: type, transEase: 'linear' }] }]);
    cfg.scenes[0].data.transition = { type: 'cut', params: { direction: 'left', softness: 0.2 } };
    assert.ok(TC.composeAt(cfg, tl, 1.99).black, type);
    const at = (t) => TC.composeAt(cfg, tl, t).cfg.timelineComposition.units[0];
    assert.strictEqual(at(2).transition.p, 0, type);
    const mid = at(2.5); assert.strictEqual(mid.transition.type, type); assert.strictEqual(mid.transition.p, 0.5);
    assert.strictEqual(mid.transition.params.direction, 'left');
    assert.strictEqual(at(3).transition, null);
    assert.deepStrictEqual(at(2.5), mid, 'rewind pure: ' + type);
    assert.ok(TC.composeAt(cfg, tl, 4).black, 'end does not retain outgoing scene');
  }
});

test('palette local colors are timed, deep isolated, serialization safe; image is sprite not video', () => {
  const cfg = baseCfg(); const palette = SV.GRADIENT_PRESETS[0];
  const tl = tlWith([
    { id: 'p', clips: [{ id: 'p1', type: 'palette', ref: palette.name, start: 1, dur: 1 }] },
    { id: 's', clips: [{ id: 's1', type: 'scene', ref: 'sc_a', start: 0, dur: 4 }] },
  ]);
  const p = tl.tracks[0].clips[0]; TC.ensureLocal(cfg, p).data.background.gradient.colors = ['#ff0000', '#00ff00'];
  const saved = TL.makeTimeline(JSON.parse(JSON.stringify({ tracks: tl.tracks })));
  const r = TC.composeAt(cfg, saved, 1.5);
  assert.deepStrictEqual(r.cfg.timelineComposition.units[0].cfg.background.gradient.colors, ['#ff0000', '#00ff00']);
  assert.notDeepStrictEqual(TC.composeAt(cfg, saved, 2).cfg.background.gradient.colors, ['#ff0000', '#00ff00']);
  const im = tlWith([{ id: 'im', clips: [{ id: 'i', type: 'image', ref: 'data:image/png;base64,AA', start: 0, dur: 1 }] }]);
  assert.strictEqual(TC.composeAt(cfg, im, 0.5).cfg.layers[0].kind, 'sprites');
});

test('global blackout overrides timeline without mutating clips, then restores current composition', () => {
  const cfg = baseCfg(); const tl = tlWith([{ id: 's', clips: [{ id: 's', type: 'scene', ref: 'sc_a', start: 0, dur: 3 }] }]);
  const saved = JSON.stringify(tl);
  cfg.isBlackout = true; assert.ok(TC.composeAt(cfg, tl, 1).black);
  assert.strictEqual(TC.composeAt(cfg, tl, 1).cfg.timelineComposition.units.length, 0);
  cfg.isBlackout = false; assert.ok(!TC.composeAt(cfg, tl, 1).black);
  assert.strictEqual(JSON.stringify(tl), saved);
});
