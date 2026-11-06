/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* "Timeline kullan" modu + klip düzenleme hedefi — panel üzerinden durumlu
 * entegrasyon: mod döngüleri elle ayarı birebir korur, kapalıyken çıkışa
 * dokunulmaz, geri sarma eski katmanı bırakmaz, seçim çıkış değildir,
 * normal panelden eklenen katman yalnız klibin alt katmanı olur. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/schema.js');
require('../src/visualizer/layers.js');
window.SVShowClock = require('../src/shared/showclock.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
window.SVTimeline = TL;
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = require('../src/shared/timeline-edit.js');
window.SVTimelineCompose = require('../src/shared/timeline-compose.js');
window.SVUndo = require('../src/admin/undo.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));
function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.insertBefore = (c, ref) => { c.parent = n; n.kids.splice(Math.max(0, n.kids.indexOf(ref)), 0, c); return c; };
  n.replaceWith = () => {};
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  n.focus = () => {};
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800; n.width = 0; n.height = 0;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 });
    n.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 40 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
window.addEventListener = () => {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null, body: { classList: { toggle() {} } }, addEventListener() {} };
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));

const fired = [];
let pushes = 0;
let rerenders = 0;
function setup(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() { if (window.SVTimelineTarget) window.SVTimelineTarget.sync(cfg); pushes++; }, apply() {}, rerender() { rerenders++; }, confirm: () => Promise.resolve(true), toast() {},
    actions: () => ({ applyScene() {} }),
  };
  window.SVClipDeckPanel = {
    applyRef: (type, ref) => { fired.push([type, ref]); },
    applyFaded: (type, ref) => { fired.push([type, ref]); },
    targetOptions: () => [], resolveTarget: () => null,
    mediaPicker: () => el('div'), slotLabel: (s) => s.ref, refOptions: () => null,
  };
}

let TP = null;
async function mount(cfg) {
  setup(cfg);
  if (!TP) { require('../src/admin/timeline-panel.js'); require('../src/admin/timeline-target.js'); TP = window.SVTimelinePanel; }
  window.SVUndoHistory = window.SVUndo.create({
    keys: window.SVSchema.SCENE_KEYS, get: (k) => cfg[k],
    set: (k, v) => { if (v === undefined) delete cfg[k]; else cfg[k] = v; }, apply() {}, changed() {},
  });
  TP._select(null);
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  TP.stop();
  fired.length = 0;
  return TP;
}

function manualCfg() {
  const cfg = SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = [{ id: 'man_vis', kind: 'visualizer', type: 'bars', enabled: true, opacity: 1 }];
  cfg.postfx = [{ id: 'man_fx', type: 'glow' }];
  cfg.scenes = [
    { id: 'sc_sad', name: 'Üzgün', data: { layerStack: { enabled: true }, layers: [
      { id: 's_bg', kind: 'background', type: 'gradient', enabled: true, opacity: 1 },
    ] } },
  ];
  Object.assign(cfg.timeline, {
    enabled: true, // eski kayıt: "Çıkışa Bağlı" açık kalmış
    applyEditsImmediately: false,
    snap: 'off', zoom: 60, scroll: 0, followPlayhead: false,
    tracks: [
      { id: 'trV', kind: 'clip', name: 'V', clips: [{ id: 'cVis', type: 'visualizer', ref: 'spectrum', start: 4, dur: 2 }] },
      { id: 'trS', kind: 'clip', name: 'S', clips: [
        { id: 'cS1', type: 'scene', ref: 'sc_sad', start: 0, dur: 8 },
        { id: 'cS2', type: 'scene', ref: 'sc_sad', start: 10, dur: 2 },
      ] },
      { id: 'trA', kind: 'clip', name: 'A', clips: [{ id: 'cAct', type: 'action', ref: 'nextScene', start: 1, dur: 1 }] },
    ],
  });
  delete cfg.timeline.useTimeline;
  return cfg;
}
const SCENE_KEYS = () => window.SVSchema.SCENE_KEYS;
const manualOf = (cfg) => JSON.stringify(SCENE_KEYS().map((k) => [k, cfg[k]]));
const visCount = (r) => r.cfg.layers.filter((l) => l.kind === 'visualizer').length;
const settle = () => wait(5);

test('default OFF; old enabled:true save does not switch output on; OFF fires nothing', async () => {
  assert.strictEqual(SV.defaultConfig().timeline.useTimeline, false);
  assert.ok(!('applyEditsImmediately' in SV.defaultConfig().timeline), 'old preference removed');
  const cfg = manualCfg();
  const TP = await mount(cfg);
  assert.strictEqual(cfg.timeline.enabled, false, 'migrated to OFF');
  assert.ok(!('applyEditsImmediately' in cfg.timeline));
  const before = manualOf(cfg);
  for (const t of [0.5, 1.5, 5, 11]) TP._applyAt(t);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' });
  TP._followTarget();
  await settle();
  assert.deepStrictEqual(fired, [], 'OFF: no destructive apply');
  assert.strictEqual(manualOf(cfg), before, 'OFF: selecting a clip never touches manual settings');
  assert.ok(!cfg.timeline.editTarget);
});

test('ON keeps playhead without auto-start; OFF pauses, keeps playhead; cycles + JSON keep manual exact', async () => {
  const cfg = manualCfg();
  const TP = await mount(cfg);
  TP.seek(3.25);
  const before = manualOf(cfg);
  for (let i = 0; i < 4; i++) {
    TP.useTimeline(true);
    assert.strictEqual(TP.transport().playing, false, 'no auto-start');
    assert.ok(Math.abs(TP.transport().time - 3.25) < 1e-9);
    assert.strictEqual(cfg.timeline.useTimeline, true);
    assert.ok(window.SVTimelineCompose.modeOn(cfg));
    TP.play();
    TP.useTimeline(false);
    assert.strictEqual(TP.transport().playing, false, 'OFF pauses');
    TP.seek(3.25);
    assert.strictEqual(manualOf(cfg), before);
    const round = JSON.parse(JSON.stringify(cfg));
    assert.strictEqual(manualOf(round), before, 'serialized manual intact');
  }
  assert.deepStrictEqual(fired, []);
});

test('t754/t755: 0 no vis -> play into future vis -> stop -> rewind 0: no extra visualizer', async () => {
  const cfg = manualCfg();
  const TP = await mount(cfg);
  TP.useTimeline(true);
  const r0 = TP.composeNow();
  assert.strictEqual(visCount(r0), 0);
  TP.seek(5);
  const r5 = TP.composeNow();
  assert.strictEqual(visCount(r5), 1);
  assert.strictEqual(r5.cfg.layers[r5.cfg.layers.length - 1].type, 'spectrum');
  TP.stop();
  const back = TP.composeNow();
  assert.strictEqual(visCount(back), 0, 'rewind restores the scene without the visualizer');
  assert.deepStrictEqual(back.cfg.layers.map((l) => l.type), ['gradient']);
  // gap / end black
  TP.seek(9); assert.ok(TP.composeNow().black);
  TP.seek(13); assert.ok(TP.composeNow().black);
  assert.strictEqual(cfg.layers[0].type, 'bars', 'manual visualizer layer untouched');
  assert.deepStrictEqual(fired, []);
  TP.useTimeline(false);
});

test('actions fire once on continuous forward play only, not on seek/rewind/projection', async () => {
  const cfg = manualCfg();
  const TP = await mount(cfg);
  TP.useTimeline(true);
  TP.seek(1.5);
  TP._applyAt(1.5);
  assert.deepStrictEqual(fired, [], 'seek into action does not fire');
  TP.seek(0.9);
  TP._applyAt(0.9);
  TP.play();
  TP._applyAt(0.95);
  TP._applyAt(1.05);
  TP._applyAt(1.1);
  assert.deepStrictEqual(fired, [['action', 'nextScene']]);
  TP.stop();
  TP._applyAt(0);
  TP._applyAt(1.2);
  assert.deepStrictEqual(fired, [['action', 'nextScene']], 'stop/rewind/jump do not retrigger');
  TP.useTimeline(false);
});

test('t762: select scene clip -> add layer via normal panel -> clip-local child only within parent', async () => {
  const cfg = manualCfg();
  const TP = await mount(cfg);
  TP.useTimeline(true);
  const manual = manualOf(cfg);
  const sourceBefore = JSON.stringify(cfg.scenes);
  // Gelecekteki (10–12 sn) ikinci klibi seç: kafa 0'da
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS2' });
  TP._followTarget();
  assert.deepStrictEqual(cfg.timeline.editTarget, { trackId: 'trS', clipId: 'cS2' });
  assert.deepStrictEqual(cfg.layers.map((l) => l.id), ['s_bg'], 'panels now show the clip copy');
  // Sahneler sayfası: yeni katman ekle (panel cfg.layers'a ekler, push eder)
  cfg.layers.push(window.SVLayers.normalizeLayer({ id: 'child_new', kind: 'visualizer', type: 'particles' }));
  window.SVPanel.push(true);
  // Seçim çıkış değildir: kafa 0'da gelecekteki klip/katman görünmez
  const at0 = TP.composeNow();
  assert.ok(!at0.cfg.layers.some((l) => l.type === 'particles'), 'future selection no output leak');
  TP.seek(11);
  const at11 = TP.composeNow();
  assert.ok(at11.cfg.layers.some((l) => l.type === 'particles'), 'child visible in parent interval');
  TP.seek(12.5);
  assert.ok(TP.composeNow().black, 'child disappears with parent');
  TP.seek(2);
  assert.ok(!TP.composeNow().cfg.layers.some((l) => l.type === 'particles'), 'other instance of same source unaffected');
  assert.strictEqual(JSON.stringify(cfg.scenes), sourceBefore, 'source scene intact');
  assert.strictEqual(cfg.timeline.tracks.length, 3, 'no unrelated top-level clip/track added');
  // Hedef değiştir: ilk klip; sonra seçim yok -> elle ayar birebir geri
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' });
  TP._followTarget();
  assert.deepStrictEqual(cfg.layers.map((l) => l.id), ['s_bg'], 'cS1 has its own copy without child');
  TP._select(null);
  TP._followTarget();
  assert.ok(!cfg.timeline.editTarget && !cfg.timeline.manualBaseline);
  assert.strictEqual(manualOf(cfg), manual, 'manual restored exactly');
  // Kayıt/yükleme: alt katman klipte kalıcı
  const saved = JSON.parse(JSON.stringify(cfg.timeline));
  const tl = TL.makeTimeline(saved);
  const r = window.SVTimelineCompose.composeAt(cfg, tl, 11);
  assert.ok(r.cfg.layers.some((l) => l.type === 'particles'));
  TP.useTimeline(false);
});

test('undo is scoped per edit target; switching does not leak into manual', async () => {
  const cfg = manualCfg();
  const TP = await mount(cfg);
  TP.useTimeline(true);
  const manual = manualOf(cfg);
  const U = window.SVUndoHistory;
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' });
  TP._followTarget();
  cfg.layers[0].opacity = 0.4;
  U.settleNow();
  assert.ok(U.canUndo());
  U.undo();
  window.SVPanel.push(true);
  assert.strictEqual(cfg.layers[0].opacity, 1);
  U.redo();
  window.SVPanel.push(true);
  assert.strictEqual(cfg.timeline.tracks[1].clips[0].local.data.layers[0].opacity, 0.4);
  TP._select(null);
  TP._followTarget();
  assert.strictEqual(U.canUndo(), false, 'manual scope has no clip steps');
  assert.strictEqual(manualOf(cfg), manual);
  TP.useTimeline(false);
});

test('mode OFF ends editing and restores manual; crash recovery restores manual on load', async () => {
  const cfg = manualCfg();
  const TP = await mount(cfg);
  TP.useTimeline(true);
  const manual = manualOf(cfg);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' });
  TP._followTarget();
  const crashed = JSON.parse(JSON.stringify(cfg)); // oturum ortasında kaydedilmiş
  TP.useTimeline(false);
  assert.strictEqual(manualOf(cfg), manual);
  assert.ok(!cfg.timeline.editTarget);
  assert.ok(window.SVTimelineTarget.recover(crashed));
  assert.strictEqual(manualOf(crashed), manual, 'restart recovery');
});

test('deleted edited clip and missing source: target closes, manual back, nothing written', async () => {
  const cfg = manualCfg();
  cfg.timeline.tracks[1].clips.push({ id: 'cMiss', type: 'scene', ref: 'gone', start: 20, dur: 1 });
  const TP = await mount(cfg);
  TP.useTimeline(true);
  const manual = manualOf(cfg);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cMiss' });
  TP._followTarget();
  assert.ok(!cfg.timeline.editTarget, 'missing source not editable');
  assert.strictEqual(manualOf(cfg), manual);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' });
  TP._followTarget();
  TP.remove();
  assert.ok(!cfg.timeline.editTarget);
  assert.strictEqual(manualOf(cfg), manual);
  TP.useTimeline(false);
});

test('canonical persistence never contains editor roots or session fields, even during edit', async () => {
  const cfg = manualCfg(); const TP = await mount(cfg); TP.useTimeline(true);
  const manual = manualOf(cfg);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); TP._followTarget();
  cfg.layers.push({ id: 'clipChild', kind: 'visualizer', type: 'wave' }); window.SVPanel.push(true);
  const canonical = window.SVTimelineTarget.persistent(cfg);
  assert.strictEqual(manualOf(canonical), manual);
  assert.ok(!canonical.timeline.editTarget && !canonical.timeline.manualBaseline);
  assert.strictEqual(canonical.timeline.tracks[1].clips[0].local.data.layers.length, 2);
  const reopened = JSON.parse(JSON.stringify(canonical)); window.SVTimelineTarget.recover(reopened);
  assert.strictEqual(manualOf(reopened), manual); TP.useTimeline(false);
});

test('AutoVJ/actions explicitly target manual model, not selected clip; OFF reveals deliberate changes', async () => {
  const cfg = manualCfg(); const TP = await mount(cfg); TP.useTimeline(true);
  const source = JSON.stringify(cfg.scenes);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); TP._followTarget();
  const clipBefore = JSON.stringify(cfg.timeline.tracks[1].clips[0].local);
  window.SVTimelineTarget.withManual(() => {
    assert.strictEqual(cfg.layers[0].id, 'man_vis');
    cfg.layers[0].type = 'radialWave'; window.SVPanel.push(true);
  });
  assert.strictEqual(cfg.layers[0].id, 's_bg', 'editor target restored');
  assert.strictEqual(JSON.stringify(cfg.timeline.tracks[1].clips[0].local), clipBefore);
  assert.strictEqual(window.SVTimelineTarget.persistent(cfg).layers[0].type, 'radialWave');
  assert.strictEqual(JSON.stringify(cfg.scenes), source);
  TP.useTimeline(false); assert.strictEqual(cfg.layers[0].type, 'radialWave', 'explicit remote intent retained');
});

test('MCP/remote model adoption preserves editor target and clip, while retaining incoming manual settings', async () => {
  const cfg = manualCfg(); const TP = await mount(cfg); TP.useTimeline(true);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); TP._followTarget();
  const incoming = JSON.parse(JSON.stringify(window.SVTimelineTarget.persistent(cfg)));
  incoming.layers[0].type = 'tunnel'; incoming.postfx = [{ id: 'remote_fx', type: 'blur' }];
  const clipBefore = JSON.stringify(incoming.timeline.tracks[1].clips[0].local);
  window.SVTimelineTarget.adoptIncoming(incoming, cfg);
  setup(incoming); window.SVTimelineTarget.sync(incoming);
  assert.strictEqual(incoming.layers[0].id, 's_bg', 'editor still displays clip');
  assert.strictEqual(JSON.stringify(incoming.timeline.tracks[1].clips[0].local), clipBefore);
  const persisted = window.SVTimelineTarget.persistent(incoming);
  assert.strictEqual(persisted.layers[0].type, 'tunnel'); assert.strictEqual(persisted.postfx[0].id, 'remote_fx');
  window.SVTimelineTarget.clear();
  assert.strictEqual(incoming.layers[0].type, 'tunnel'); TP.useTimeline(false);
});

test('mode ON no selection cannot write protected manual model; palette edits are local; action is not visual target', async () => {
  const cfg = manualCfg();
  cfg.timeline.tracks.push({ id: 'p', clips: [{ id: 'p1', type: 'palette', ref: SV.GRADIENT_PRESETS[0].name, start: 1, dur: 2 }] });
  const TP = await mount(cfg); TP.useTimeline(true); const before = manualOf(cfg);
  cfg.layers[0].type = 'accidental'; window.SVPanel.push(true);
  assert.strictEqual(manualOf(cfg), before, 'no selection edit rejected');
  TP._select({ kind: 'clip', trackId: 'p', clipId: 'p1' }); TP._followTarget();
  assert.strictEqual(cfg.timeline.editTarget.clipId, 'p1');
  cfg.background.gradient.colors[0] = '#123456'; window.SVPanel.push(true);
  assert.strictEqual(cfg.timeline.tracks[3].clips[0].local.data.background.gradient.colors[0], '#123456');
  TP._select({ kind: 'clip', trackId: 'trA', clipId: 'cAct' }); TP._followTarget();
  assert.ok(!cfg.timeline.editTarget, 'action has no pretend visual target');
  assert.strictEqual(manualOf(cfg), before); TP.useTimeline(false);
});

test('switch target repeatedly: undo scopes retain only their own edits, no stale baseline snapshots', async () => {
  const cfg = manualCfg(); const TP = await mount(cfg); TP.useTimeline(true); const before = manualOf(cfg);
  const pick = (id) => { TP._select({ kind: 'clip', trackId: 'trS', clipId: id }); TP._followTarget(); };
  const U = window.SVUndoHistory;
  pick('cS1'); cfg.layers[0].opacity = 0.3; U.settleNow(); window.SVPanel.push(true);
  pick('cS2'); cfg.layers[0].opacity = 0.7; U.settleNow(); window.SVPanel.push(true);
  pick('cS1'); U.undo(); window.SVPanel.push(true); assert.strictEqual(cfg.layers[0].opacity, 1);
  assert.strictEqual(cfg.timeline.tracks[1].clips[1].local.data.layers[0].opacity, 0.7);
  U.redo(); window.SVPanel.push(true); assert.strictEqual(cfg.layers[0].opacity, 0.3);
  pick('cS2'); U.undo(); window.SVPanel.push(true); assert.strictEqual(cfg.layers[0].opacity, 1);
  TP.useTimeline(false); assert.strictEqual(manualOf(cfg), before);
});

test('selected clip source/type change reloads target without writing the old source copy into new type', async () => {
  const cfg = manualCfg(); const TP = await mount(cfg); TP.useTimeline(true); const before = manualOf(cfg);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); TP._followTarget();
  const c = cfg.timeline.tracks[1].clips[0];
  c.type = 'visualizer'; c.ref = 'bars';
  window.SVTimelineTarget.reloadFromClip(false);
  assert.strictEqual(cfg.layers[0].type, 'bars'); assert.strictEqual(cfg.layers[0].kind, 'visualizer');
  c.type = 'action'; c.ref = 'nextScene';
  window.SVTimelineTarget.reloadFromClip(false);
  assert.ok(!cfg.timeline.editTarget); assert.strictEqual(manualOf(cfg), before);
  TP.useTimeline(false);
});

test('async editor callbacks are invalidated on selection, source change, mode exit; locked tracks cannot become targets', async () => {
  const cfg = manualCfg(); const TP = await mount(cfg); TP.useTimeline(true);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); TP._followTarget();
  const capture = window.SVTimelineTarget.capture(); assert.ok(capture());
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS2' }); TP._followTarget(); assert.ok(!capture());
  const next = window.SVTimelineTarget.capture(); TP.useTimeline(false); assert.ok(!next());
  cfg.timeline.tracks[1].locked = true; TP.useTimeline(true);
  TP._select({ kind: 'clip', trackId: 'trS', clipId: 'cS1' }); TP._followTarget();
  assert.ok(!cfg.timeline.editTarget, 'locked track read-only'); TP.useTimeline(false);
});
