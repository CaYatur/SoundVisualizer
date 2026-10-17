'use strict';
/* MCP robustness (#768): every mutating tool either applies the input or
   returns a clear error; no-ops report changed:false. */
const test = require('node:test');
const assert = require('node:assert');
const mcp = require('../src/shared/mcp.js');
const layers = require('../src/visualizer/layers.js');

const FX = mcp.EFFECT_TYPES.includes('chroma') ? 'chroma' : mcp.EFFECT_TYPES[0];

function ctx(extraCfg) {
  const cfg = Object.assign({
    mcp: { enabled: true, mode: 'full' },
    layerStack: { enabled: true },
    layers: [
      { id: 'L1', kind: 'visualizer', type: 'bars', settings: { barCount: 64 }, postfx: [{ id: 'lf1', type: FX, enabled: true, params: { amount: 0.1 } }] },
      { id: 'L2', kind: 'visualizer', type: 'bars', locked: true, settings: {}, postfx: [{ id: 'lf2', type: FX, enabled: true, params: {} }] },
    ],
    postfx: [{ id: 'g1', type: FX, enabled: true, params: { amount: 0.004 } }],
    modulation: { enabled: true, macros: [] },
  }, extraCfg || {});
  let writes = 0;
  return {
    cfg: () => cfg, writes: () => writes,
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { writes++; Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => writes,
    revision: () => writes,
  };
}
const call = (name, args, c) => Promise.resolve(mcp.callTool(name, args, c));

// 1. postfx guard
test('#768-1 sv_set_layer_settings refuses postfx (settings and key forms) and names the right tools', async () => {
  const c = ctx();
  for (const args of [{ id: 'L1', settings: { postfx: [{ type: FX }] } }, { id: 'L1', key: 'postfx', value: [] }, { id: 'L1', settings: '{"postfx":[]}' }]) {
    const r = await call('sv_set_layer_settings', args, c);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /sv_add_layer_effect/);
    assert.match(r.error, /sv_set_layer_effect_param/);
  }
  const u = await call('sv_update_layer', { id: 'L1', patch: { settings: { postfx: [] } } }, c);
  assert.strictEqual(u.ok, false);
  assert.strictEqual(c.writes(), 0);
});

// 2. string params
test('#768-2 string params are parsed; invalid JSON, arrays, null and empty objects error', async () => {
  const c = ctx();
  const r = await call('sv_set_effect_param', { effectId: 'g1', params: '{"amount":0.03}' }, c);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.cfg().postfx[0].params.amount, 0.03);
  assert.deepStrictEqual(r.applied, { amount: 0.03 });
  const rl = await call('sv_set_layer_effect_param', { id: 'L1', effectId: 'lf1', params: '{"amount":0.5}' }, c);
  assert.strictEqual(rl.ok, true);
  assert.strictEqual(c.cfg().layers[0].postfx[0].params.amount, 0.5);
  for (const bad of ['{amount:', '[1,2]', [1], null, {}, '{}', 'null', 5]) {
    const x = await call('sv_set_effect_param', { effectId: 'g1', params: bad }, c);
    assert.strictEqual(x.ok, false, JSON.stringify(bad));
    assert.match(x.error, /params/);
  }
  const miss = await call('sv_set_layer_effect_param', { id: 'L1', effectId: 'lf1' }, c);
  assert.strictEqual(miss.ok, false);
  const add = await call('sv_add_effect', { type: FX, params: '{"amount":0.2}' }, c);
  assert.strictEqual(add.ok, true);
  assert.strictEqual(c.cfg().postfx[1].params.amount, 0.2);
  const addBad = await call('sv_add_layer_effect', { id: 'L1', type: FX, params: 'nope' }, c);
  assert.strictEqual(addBad.ok, false);
});

test('#768-2 unsafe keys are still refused after string parsing', async () => {
  const c = ctx();
  const r = await call('sv_set_effect_param', { effectId: 'g1', params: '{"__proto__":{"x":1}}' }, c);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /unsafe/i);
  const r2 = await call('sv_set_layer_settings', { id: 'L1', settings: '{"a":{"constructor":1}}' }, c);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(({}).x, undefined);
});

// 4. boolean coercion
test('#768-4 enabled accepts true/false and "true"/"false"; 0 and "yes" are rejected', async () => {
  const c = ctx();
  assert.strictEqual((await call('sv_set_effect_enabled', { effectId: 'g1', enabled: 'false' }, c)).ok, true);
  assert.strictEqual(c.cfg().postfx[0].enabled, false);
  assert.strictEqual((await call('sv_set_effect_enabled', { effectId: 'g1', enabled: 'TRUE' }, c)).ok, true);
  assert.strictEqual(c.cfg().postfx[0].enabled, true);
  for (const v of [0, 'yes', 1, null]) {
    const r = await call('sv_set_effect_enabled', { effectId: 'g1', enabled: v }, c);
    assert.strictEqual(r.ok, false, JSON.stringify(v));
    assert.match(r.error, /true or false/);
  }
  assert.strictEqual((await call('sv_set_layer_effect_enabled', { id: 'L1', effectId: 'lf1', enabled: 0 }, c)).ok, false);
  assert.strictEqual((await call('sv_add_effect', { type: FX, enabled: 'yes' }, c)).ok, false);
  const add = await call('sv_add_effect', { type: FX, enabled: 'false' }, c);
  assert.strictEqual(add.effect.enabled, false);
  assert.strictEqual((await call('sv_set_modulation_enabled', { enabled: 'false' }, c)).ok, true);
  assert.strictEqual(c.cfg().modulation.enabled, false);
});

// 5. unknown args
test('#768-5 mutating tools refuse calls whose arguments are all unknown', async () => {
  const c = ctx();
  const r = await call('sv_set_layer_settings', { patch: { barCount: 10 } }, c);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Unknown argument\(s\): patch.*takes:.*settings/);
  assert.strictEqual((await call('sv_set_text', { settings: {} }, c)).ok, false);
  // Known + unknown: applied and the extra is reported
  const ok = await call('sv_set_effect_param', { effectId: 'g1', params: { amount: 0.7 }, extra: 1 }, c);
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.ignored, ['extra']);
  // Read-only tools keep accepting stray arguments
  assert.strictEqual((await call('sv_get_visual_state', { whatever: 1 }, c)).ok, true);
});

// 6. changed flag
test('#768-6 a write that changes nothing reports changed:false and is not saved', async () => {
  const c = ctx();
  const r = await call('sv_set_effect_param', { effectId: 'g1', params: { amount: 0.004 } }, c);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(c.writes(), 0);
  const r2 = await call('sv_set_effect_param', { effectId: 'g1', params: { amount: 0.01 } }, c);
  assert.strictEqual(r2.changed, true);
  assert.strictEqual(c.writes(), 1);
});

// 7. read-after-write
test('#768-7 sv_set_layer_settings returns applied values and visual like the other layer tools', async () => {
  const c = ctx();
  const r = await call('sv_set_layer_settings', { id: 'L1', settings: '{"barCount":32}' }, c);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.applied, { barCount: 32 });
  assert.ok(r.visual && Array.isArray(r.visual.layers));
  assert.strictEqual(c.cfg().layers[0].settings.barCount, 32);
  const k = await call('sv_set_layer_settings', { id: 'L1', key: 'gap', value: 0.3 }, c);
  assert.deepStrictEqual(k.applied, { gap: 0.3 });
});

// Locked layers first
test('#768 locked layers are rejected before input validation', async () => {
  const c = ctx();
  for (const [name, args] of [
    ['sv_set_layer_effect_param', { id: 'L2', effectId: 'lf2', params: 'not json' }],
    ['sv_set_layer_effect_enabled', { id: 'L2', effectId: 'lf2', enabled: 'yes' }],
    ['sv_add_layer_effect', { id: 'L2', type: FX, params: '[1]' }],
    ['sv_set_layer_settings', { id: 'L2', settings: { postfx: [] } }],
  ]) {
    const r = await call(name, args, c);
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /lock/i, name);
  }
});

// 8. legacy cleanup
test('#768-8 stray layer settings.postfx is dropped on normalize and on the next write', async () => {
  const c = ctx();
  c.cfg().layers[0].settings.postfx = [{ type: FX }];
  const r = await call('sv_set_effect_param', { effectId: 'g1', params: { amount: 0.02 } }, c);
  assert.strictEqual(r.ok, true);
  assert.ok(!('postfx' in c.cfg().layers[0].settings));
  assert.deepStrictEqual(r.cleaned, { strayLayerSettingsPostfx: ['L1'] });
  assert.strictEqual(c.cfg().layers[0].postfx.length, 1, 'real chain untouched');
  assert.strictEqual(c.cfg().layers[0].settings.barCount, 64);
  const raw = { id: 'x', kind: 'visualizer', type: 'bars', settings: { a: 1, postfx: [] } };
  const n = layers.normalizeLayer(raw);
  assert.deepStrictEqual(n.settings, { a: 1 });
  assert.ok('postfx' in raw.settings, 'input object not mutated');
});

test('#768 coerce helpers', () => {
  assert.deepStrictEqual(mcp.coerceParams(undefined, false), { value: undefined });
  assert.ok(mcp.coerceParams(undefined, true).error);
  assert.deepStrictEqual(mcp.coerceParams('{"a":1}', true), { value: { a: 1 } });
  assert.deepStrictEqual(mcp.coerceBool(undefined, true), { value: true });
  assert.deepStrictEqual(mcp.coerceBool(' false ', true), { value: false });
  assert.ok(mcp.coerceBool('no', true).error);
});

test('#768-9 tools/list honours the compact profile from MCP settings', async () => {
  const c = ctx({ mcp: { enabled: true, mode: 'full', toolProfile: 'compact' } });
  const res = await mcp.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, c);
  const names = res.result.tools.map((t) => t.name);
  assert.deepStrictEqual(names.slice().sort(), mcp.COMPACT_TOOLS.slice().sort());
  // Tools outside the compact list stay callable
  assert.strictEqual((await call('sv_set_macro', { index: 0, value: 0.5 }, c)).ok, false); // no macro, but not "unknown tool"
  const full = await mcp.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx());
  assert.strictEqual(full.result.tools.length, mcp.tools('en').length);
  assert.strictEqual(mcp.normalizeMcp({ toolProfile: 'weird' }).toolProfile, 'full');
});

test('#768-5 unknown args next to a layer ref: accepted args listed, not "settings or key is required"', async () => {
  const c = ctx();
  const r = await call('sv_set_layer_settings', { id: 'L1', patch: { a: 1 } }, c);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /^Unknown argument\(s\): patch\. sv_set_layer_settings takes: .*settings.*key/);
  // Generic: same shape on another write tool
  const e = await call('sv_set_effect_param', { effectId: 'g1', values: { amount: 1 } }, c);
  assert.match(e.error, /^Unknown argument\(s\): values\. sv_set_effect_param takes: .*params/);
  assert.strictEqual(c.writes(), 0);
});

test('#768 sv_update_layer with fields at the top level errors with a "put inside patch" hint', async () => {
  const c = ctx();
  const r = await call('sv_update_layer', { id: 'L1', locked: true }, c);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Unknown argument\(s\): locked/);
  assert.match(r.error, /inside patch/);
  assert.notStrictEqual(c.cfg().layers[0].locked, true);
  const ok = await call('sv_update_layer', { id: 'L1', patch: { locked: true } }, c);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(c.cfg().layers[0].locked, true);
});

test('#768-8 keys dropped when settings were loaded are reported once by the next write', async () => {
  const c = ctx();
  let pending = ['Lx'];
  c.takeStartupCleaned = () => { const ids = pending; pending = []; return ids; };
  const r = await call('sv_set_effect_param', { effectId: 'g1', params: { amount: 0.05 } }, c);
  assert.deepStrictEqual(r.cleaned, { strayLayerSettingsPostfx: ['Lx'] });
  const r2 = await call('sv_set_effect_param', { effectId: 'g1', params: { amount: 0.06 } }, c);
  assert.strictEqual(r2.cleaned, undefined);
});

test('#768-8 main drops stray settings.postfx at load and wires takeStartupCleaned', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /return sanitizeLoaded\(SettingsGuard\.parse\(fs\.readFileSync\(SETTINGS_PATH\)\)\);/);
  assert.match(main, /\n  sanitizeLoaded\(currentConfig\); \/\/ stray layer settings\.postfx/);
  assert.match(main, /takeStartupCleaned: \(\) => \{/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'mcp-server.js'), 'utf8'), /takeStartupCleaned: deps\.takeStartupCleaned/);
});

test('#768-8 repeated settings reads at startup log and report each stray id once', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const a = main.indexOf('let startupCleaned = [];');
  const b = main.indexOf('\n}', main.indexOf('function sanitizeLoaded(cfg)')) + 2;
  const logs = [];
  const sandbox = { require: (m) => (m === '../shared/mcp' ? mcp : require(m)), console: { log: (s) => logs.push(s) } };
  vm.createContext(sandbox);
  vm.runInContext(main.slice(a, b) + '\nthis.api = { sanitizeLoaded, take: () => { const i = startupCleaned; startupCleaned = []; return i; } };', sandbox);
  const file = () => ({ layers: [{ id: 'A', settings: { postfx: [] } }, { id: 'B', settings: {} }] });
  sandbox.api.sanitizeLoaded(file()); // startup parse
  const again = sandbox.api.sanitizeLoaded(file()); // panel get-settings, file not saved yet
  assert.ok(!('postfx' in again.layers[0].settings), 'still cleaned on every read');
  assert.deepStrictEqual(logs, ['[settings] dropped stray layers[].settings.postfx on A']);
  assert.deepStrictEqual(Array.from(sandbox.api.take()), ['A']);
  sandbox.api.sanitizeLoaded(file()); // a later read before the save
  assert.deepStrictEqual(Array.from(sandbox.api.take()), [], 'reported once');
  assert.strictEqual(logs.length, 1);
});
