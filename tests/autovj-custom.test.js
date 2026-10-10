'use strict';
/* Auto VJ 'custom' source: user-chosen kinds, sequential or simultaneous
   steps, lock respect, normalize and sv_set_autovj validation. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const R = require('../src/shared/autovj.js');
const mcp = require('../src/shared/mcp.js');

const CTX = {
  scenes: [{ id: 's1', name: 'A', data: {} }, { id: 's2', name: 'B', data: {} }],
  builtinPalettes: [{ id: 'p1', colors: ['#000', '#fff'] }, { id: 'p2', colors: ['#f00'] }],
};

test('normalize: customKinds and customMode defaults and cleaning', () => {
  const d = R.defaults();
  assert.deepStrictEqual(d.customKinds, ['visualizers', 'backgrounds']);
  assert.strictEqual(d.customMode, 'sequential');
  const old = R.normalize({ source: 'visualizers' });
  assert.deepStrictEqual(old.customKinds, ['visualizers', 'backgrounds']);
  const n = R.normalize({ source: 'custom', customKinds: ['backgrounds', 'zzz', 'scenes', 'scenes', 'all'], customMode: 'simultaneous' });
  assert.strictEqual(n.source, 'custom');
  assert.deepStrictEqual(n.customKinds, ['scenes', 'backgrounds']);
  assert.strictEqual(n.customMode, 'simultaneous');
  assert.deepStrictEqual(R.normalize({ customKinds: [] }).customKinds, ['visualizers', 'backgrounds']);
  assert.strictEqual(R.normalize({ customMode: 'nope' }).customMode, 'sequential');
});

test('custom sequential rotates only through the selected kinds', () => {
  const a = { source: 'custom', customKinds: ['palettes', 'backgrounds'] };
  let st = null;
  const kinds = [];
  for (let i = 0; i < 6; i++) { const r = R.plan(a, CTX, st, 1); assert.ok(r.ok); kinds.push(r.kind); st = r.state; }
  assert.deepStrictEqual(kinds, ['palettes', 'backgrounds', 'palettes', 'backgrounds', 'palettes', 'backgrounds']);
  // Empty kinds are skipped; nothing usable -> EMPTY, not a silent fallback
  const skip = R.plan({ source: 'custom', customKinds: ['scenes', 'backgrounds'] }, {}, null, 1);
  assert.strictEqual(skip.kind, 'backgrounds');
  const none = R.plan({ source: 'custom', customKinds: ['scenes', 'palettes'] }, {}, null, 1);
  assert.deepStrictEqual([none.ok, none.code, none.kind], [false, 'EMPTY', 'custom']);
  assert.strictEqual(R.diagnose({ source: 'custom', customKinds: ['scenes'] }, {}).ok, false);
  assert.deepStrictEqual(R.diagnose({ source: 'custom', customKinds: ['scenes', 'visualizers'] }, {}).skipped, ['scenes']);
});

test('custom simultaneous changes every selected kind each step', () => {
  const a = { source: 'custom', customMode: 'simultaneous', customKinds: ['backgrounds', 'scenes', 'visualizers', 'palettes'] };
  const r1 = R.plan(a, CTX, null, 2);
  assert.ok(r1.ok);
  assert.strictEqual(r1.kind, 'custom');
  assert.deepStrictEqual(r1.steps.map((s) => s.kind), ['scenes', 'visualizers', 'palettes', 'backgrounds']);
  assert.strictEqual(r1.steps[1].items.length, 2);
  const r2 = R.plan(a, CTX, r1.state, 2);
  assert.notStrictEqual(r2.steps[0].item.id, r1.steps[0].item.id);
  // Missing scenes: the rest still change
  const r3 = R.plan(a, {}, null, 1);
  assert.deepStrictEqual(r3.steps.map((s) => s.kind), ['visualizers', 'backgrounds']);
});

test("'all' behaviour is unchanged by custom", () => {
  let st = null;
  const kinds = new Set();
  for (let i = 0; i < 8; i++) { const r = R.plan({ source: 'all', customKinds: ['palettes'], customMode: 'simultaneous' }, CTX, st, 1); assert.ok(!r.steps); kinds.add(r.kind); st = r.state; }
  assert.strictEqual(kinds.size, 4);
});

function loadAdmin(cfg) {
  const win = {
    SVAutoVJRules: R,
    SVLayers: { stackOn: () => true, setEffective: () => false },
    SVPanel: { cfg: () => cfg },
    SV: { GRADIENT_PRESETS: CTX.builtinPalettes },
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/admin/autovj.js'), 'utf8');
  vm.runInContext(src, vm.createContext({ window: win, document: {}, requestAnimationFrame: () => 0, console }));
  return win.SVAutoVJ;
}

test('simultaneous apply respects locked layers', () => {
  const cfg = {
    autovj: { source: 'custom', customMode: 'simultaneous', customKinds: ['visualizers', 'backgrounds'] },
    background: { type: 'aurora' }, visualizer: { type: 'bars' },
    layers: [
      { kind: 'background', type: 'aurora', locked: true },
      { kind: 'visualizer', type: R.VISUALIZERS[3] },
      { kind: 'visualizer', type: 'wave', locked: true },
    ],
  };
  const A = loadAdmin(cfg);
  const res = A.applySwitch();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.kind, 'custom');
  assert.strictEqual(cfg.layers[0].type, 'aurora');
  assert.strictEqual(cfg.layers[2].type, 'wave');
  // First sequential draw is the first cyclable visualizer
  assert.strictEqual(cfg.layers[1].type, R.VISUALIZERS[0]);
  // Everything locked: the switch reports failure instead of pretending
  cfg.layers[1].locked = true;
  assert.strictEqual(A.applySwitch().ok, false);
});

function mctx() {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  return {
    cfg, locale: () => 'en', getConfig: () => cfg,
    setConfig: (n) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, n); },
    noteWrite: () => 1, revision: () => 1, presets: { list: () => [] },
  };
}
const call = (n, a, c) => Promise.resolve(mcp.callTool(n, a, c));

test('sv_set_autovj: custom source, customKinds and customMode', async () => {
  const schema = mcp.tools('en').find((t) => t.name === 'sv_set_autovj').inputSchema;
  assert.ok(schema.properties.source.enum.indexOf('custom') >= 0);
  assert.deepStrictEqual(schema.properties.customMode.enum, ['sequential', 'simultaneous']);
  const c = mctx();
  const r = await call('sv_set_autovj', { source: 'custom', customKinds: ['backgrounds', 'scenes', 'scenes'], customMode: 'simultaneous' }, c);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(c.cfg.autovj.customKinds, ['scenes', 'backgrounds']);
  assert.strictEqual(c.cfg.autovj.customMode, 'simultaneous');
  for (const bad of [{ customKinds: [] }, { customKinds: ['all'] }, { customKinds: 'scenes' }, { customMode: 'both' }, { customKinds: ['custom'] }]) {
    const c2 = mctx();
    const before = JSON.stringify(c2.cfg.autovj);
    assert.strictEqual((await call('sv_set_autovj', bad, c2)).ok, false, JSON.stringify(bad));
    assert.strictEqual(JSON.stringify(c2.cfg.autovj), before);
  }
});
