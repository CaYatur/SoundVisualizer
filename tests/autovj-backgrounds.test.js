'use strict';
/* Auto VJ 'backgrounds' source: catalog, rotation, lock respect,
   normalize, and sv_set_autovj validation. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const R = require('../src/shared/autovj.js');
const MC = require('../src/shared/mode-catalog.js');
const mcp = require('../src/shared/mcp.js');

const USER = { id: 'u1', name: 'My Shader', engine: 'shader', kind: 'background' };
const OTHERS = [
  { id: 'u2', name: 'Vis', engine: 'shader', kind: 'visualizer' },
  { id: 'u3', name: 'Var', engine: 'variation', kind: 'background' },
  { id: 'sh_plasma', name: 'Built-in', engine: 'shader', kind: 'background', builtin: true },
];

test('backgrounds is a source and part of the all rotation', () => {
  assert.ok(R.SOURCES.indexOf('backgrounds') >= 0);
  assert.ok(R.KINDS.indexOf('backgrounds') >= 0);
  assert.deepStrictEqual(R.BACKGROUNDS, MC.cycleIds('background'));
  assert.ok(R.BACKGROUNDS.indexOf('custom') < 0);
  const seen = new Set();
  let st = null;
  for (let i = 0; i < 8; i++) {
    const res = R.plan({ source: 'all' }, { builtinPalettes: [{ id: 'p', colors: ['#000'] }] }, st, 1);
    assert.ok(res.ok);
    seen.add(res.kind);
    st = res.state;
  }
  assert.ok(seen.has('backgrounds') && seen.has('visualizers') && seen.has('palettes'));
  assert.ok(R.diagnose({ source: 'all' }, {}).kinds.indexOf('backgrounds') >= 0);
});

test('catalog: stock modes plus user Studio shader backgrounds only', () => {
  const list = R.catalog('backgrounds', { studioPresets: [USER].concat(OTHERS) });
  const ids = list.map((x) => x.id);
  assert.strictEqual(ids.length, R.BACKGROUNDS.length + 1);
  const p = list.find((x) => x.id === 'preset:u1');
  assert.strictEqual(p.presetId, 'u1');
  assert.strictEqual(p.label, 'My Shader');
  assert.ok(ids.indexOf('preset:u2') < 0 && ids.indexOf('preset:u3') < 0 && ids.indexOf('preset:sh_plasma') < 0);
});

test('sequential cycle walks picks in order and wraps', () => {
  const a = { source: 'backgrounds', picks: { backgrounds: [R.BACKGROUNDS[0], 'preset:u1'] } };
  const ctx = { studioPresets: [USER] };
  let st = null;
  const got = [];
  for (let i = 0; i < 4; i++) { const r = R.plan(a, ctx, st, 3); assert.strictEqual(r.items.length, 1); got.push(r.item.id); st = r.state; }
  assert.deepStrictEqual(got, [R.BACKGROUNDS[0], 'preset:u1', R.BACKGROUNDS[0], 'preset:u1']);
});

test('normalize: picks.backgrounds kept, junk dropped, old configs default to []', () => {
  assert.deepStrictEqual(R.normalize({}).picks.backgrounds, []);
  assert.deepStrictEqual(R.normalize({ picks: { scenes: ['a'] } }).picks.backgrounds, []);
  const n = R.normalize({ source: 'backgrounds', picks: { backgrounds: [R.BACKGROUNDS[1], 'zzz', 'preset:', 'preset:x', 5, null] } });
  assert.strictEqual(n.source, 'backgrounds');
  assert.deepStrictEqual(n.picks.backgrounds, [R.BACKGROUNDS[1], 'preset:x']);
  assert.strictEqual(R.normalize({ source: 'bogus' }).source, 'visualizers');
  assert.deepStrictEqual(R.defaults().picks.backgrounds, []);
});

test('backgroundLayers skips locked and hidden layers', () => {
  const layers = [
    { id: 'a', kind: 'background', type: 'aurora' },
    { id: 'b', kind: 'background', type: 'solid', locked: true },
    { id: 'c', kind: 'background', type: 'solid', enabled: false },
    { id: 'd', kind: 'visualizer', type: 'bars' },
  ];
  assert.deepStrictEqual(R.backgroundLayers(layers).map((l) => l.id), ['a']);
  // Visualizer side unchanged
  assert.deepStrictEqual(R.visualizerLayers(layers).map((l) => l.id), ['d']);
});

/* Admin apply step, loaded with a minimal window. */
function loadAdmin(stackOn) {
  const win = {
    SVAutoVJRules: R,
    SVLayers: { stackOn: () => stackOn },
    SVPanel: {},
  };
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/admin/autovj.js'), 'utf8');
  const ctx = vm.createContext({ window: win, document: {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, performance: { now: () => 0 }, console });
  vm.runInContext(src, ctx);
  return win.SVAutoVJ;
}

test('apply: unlocked layers change, locked layer is respected', () => {
  const A = loadAdmin(true);
  const cfg = { background: { type: 'aurora' }, layers: [
    { kind: 'background', type: 'aurora' },
    { kind: 'background', type: 'solid', locked: true, presetId: null },
  ] };
  assert.strictEqual(A.applyBackground(cfg, { id: 'preset:u1', presetId: 'u1' }), true);
  assert.strictEqual(cfg.layers[0].type, 'custom');
  assert.strictEqual(cfg.layers[0].presetId, 'u1');
  assert.strictEqual(cfg.layers[1].type, 'solid');
  assert.strictEqual(A.applyBackground(cfg, { id: R.BACKGROUNDS[0] }), true);
  assert.strictEqual(cfg.layers[0].type, R.BACKGROUNDS[0]);
  assert.strictEqual(cfg.layers[0].presetId, null);
  // Only a locked background in the stack: nothing changes
  const locked = { background: { type: 'aurora' }, layers: [{ kind: 'background', type: 'solid', locked: true }] };
  assert.strictEqual(A.applyBackground(locked, { id: R.BACKGROUNDS[0] }), false);
  assert.strictEqual(locked.layers[0].type, 'solid');
  assert.strictEqual(locked.background.type, 'aurora');
});

test('apply without stack: background.type and custom.backgroundId; transparent untouched', () => {
  const A = loadAdmin(false);
  const cfg = { background: { type: 'aurora' }, custom: { visualizerId: 'v' } };
  assert.strictEqual(A.applyBackground(cfg, { id: 'preset:u1', presetId: 'u1' }), true);
  assert.strictEqual(cfg.background.type, 'custom');
  assert.strictEqual(cfg.custom.backgroundId, 'u1');
  assert.strictEqual(cfg.custom.visualizerId, 'v');
  const tr = { background: { type: 'transparent', transparent: true } };
  assert.strictEqual(A.applyBackground(tr, { id: R.BACKGROUNDS[0] }), false);
  assert.strictEqual(tr.background.type, 'transparent');
});

function mctx() {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  return {
    cfg, locale: () => 'en', getConfig: () => cfg,
    setConfig: (n) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, n); },
    noteWrite: () => 1, revision: () => 1,
    presets: { list: () => [USER].concat(OTHERS), get: () => null },
  };
}
const call = (n, a, c) => Promise.resolve(mcp.callTool(n, a, c));

test('sv_set_autovj accepts backgrounds source and valid picks', async () => {
  const c = mctx();
  const schema = mcp.tools('en').find((t) => t.name === 'sv_set_autovj').inputSchema;
  assert.ok(schema.properties.source.enum.indexOf('backgrounds') >= 0);
  assert.ok(schema.properties.picks.properties.backgrounds);
  const r = await call('sv_set_autovj', { enabled: true, source: 'backgrounds', picks: { backgrounds: [R.BACKGROUNDS[0], 'preset:u1'] } }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(c.cfg.autovj.source, 'backgrounds');
  assert.deepStrictEqual(c.cfg.autovj.picks.backgrounds, [R.BACKGROUNDS[0], 'preset:u1']);
  assert.ok(Array.isArray(c.cfg.autovj.picks.scenes));
});

test('sv_set_autovj rejects unknown background ids', async () => {
  for (const picks of [
    { backgrounds: ['zzz'] }, { backgrounds: ['custom'] }, { backgrounds: [5] }, { backgrounds: 'aurora' },
    { backgrounds: ['preset:missing'] }, { backgrounds: ['preset:u2'] }, { backgrounds: ['preset:sh_plasma'] },
    { scenes: ['x'] }, [],
  ]) {
    const c = mctx();
    const before = JSON.stringify(c.cfg.autovj);
    const r = await call('sv_set_autovj', { picks }, c);
    assert.strictEqual(r.ok, false, JSON.stringify(picks));
    assert.strictEqual(JSON.stringify(c.cfg.autovj), before);
  }
  const c = mctx();
  assert.strictEqual((await call('sv_set_autovj', { source: 'bogus' }, c)).ok, false);
  // sv_patch_config also refuses a malformed background pick
  assert.strictEqual((await call('sv_patch_config', { path: 'autovj.picks.backgrounds', value: ['zzz'] }, c)).ok, false);
  assert.strictEqual((await call('sv_patch_config', { path: 'autovj.source', value: 'backgrounds' }, c)).ok, true);
});

test('transparent background layers are never switched', () => {
  const layers = [
    { kind: 'background', type: 'aurora', settings: { background: { transparent: true } } },
    { kind: 'background', type: 'transparent' },
    { kind: 'background', type: 'solid' },
  ];
  assert.deepStrictEqual(R.backgroundLayers(layers).map((l) => l.type), ['solid']);
  const A = loadAdmin(true);
  const cfg = { background: { type: 'aurora' }, layers: layers.slice(0, 2) };
  assert.strictEqual(A.applyBackground(cfg, { id: R.BACKGROUNDS[0] }), false);
  assert.strictEqual(cfg.layers[0].type, 'aurora');
  assert.strictEqual(cfg.layers[1].type, 'transparent');
  assert.strictEqual(cfg.background.type, 'aurora');
  const mixed = { background: { type: 'aurora' }, layers: layers.map((l) => Object.assign({}, l)) };
  assert.strictEqual(A.applyBackground(mixed, { id: R.BACKGROUNDS[0] }), true);
  assert.deepStrictEqual(mixed.layers.map((l) => l.type), ['aurora', 'transparent', R.BACKGROUNDS[0]]);
});

test('sv_set_autovj prunes deleted Studio presets already in picks, rejects new unknown ones', async () => {
  const c = mctx();
  assert.strictEqual((await call('sv_set_autovj', { picks: { backgrounds: ['preset:u1', R.BACKGROUNDS[0]] } }, c)).ok, true);
  // The preset is deleted
  c.presets.list = () => OTHERS;
  const r = await call('sv_set_autovj', { source: 'backgrounds', picks: { backgrounds: ['preset:u1', R.BACKGROUNDS[0]] } }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(c.cfg.autovj.picks.backgrounds, [R.BACKGROUNDS[0]]);
  // A never-saved unknown preset is still an error
  const bad = await call('sv_set_autovj', { picks: { backgrounds: ['preset:ghost'] } }, c);
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(c.cfg.autovj.picks.backgrounds, [R.BACKGROUNDS[0]]);
});

test('EN panel strings: Hepsi translated, count has a separator', () => {
  const fsx = require('fs');
  const pathx = require('path');
  const i18n = fsx.readFileSync(pathx.join(__dirname, '..', 'src/shared/i18n.js'), 'utf8');
  assert.match(i18n, /'Hepsi': 'All'/);
  const src = fsx.readFileSync(pathx.join(__dirname, '..', 'src/admin/autovj.js'), 'utf8');
  assert.ok(src.indexOf("text: ' ' + countText(") >= 0);
});
