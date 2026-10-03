'use strict';
/* Studio / MCP changes must hit the layer stack the output already draws,
   and a preset saved while the store is still reading the folder must stay
   in the list. Restarting the app was the only refresh. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

/* CI does not install Electron. The preset store only needs app.getPath
   until setDir points it at a temp folder. */
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
  return origLoad.apply(this, arguments);
};

global.window = global.window || {};
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');
const mcp = require('../src/shared/mcp');
const store = require('../src/main/presets-store');

function scene() {
  return {
    background: { type: 'gradient' },
    visualizer: { type: 'bars', color: '#fff' },
    custom: { visualizerId: null },
    media: { enabled: false },
    images: { enabled: false },
    logo: { enabled: false },
    text: { enabled: false },
    layers: [
      { id: 'ly_vis', kind: 'visualizer', type: 'bars', enabled: false, muted: true, presetId: null, settings: { visualizer: { type: 'bars' } } },
    ],
    layerStack: { enabled: true },
  };
}

test('adoptVisualizer retargets the live layer instead of only the classic field', () => {
  const cfg = scene();
  const layer = L.adoptVisualizer(cfg, { type: 'custom', presetId: 'usr_live' });
  assert.strictEqual(layer.type, 'custom');
  assert.strictEqual(layer.presetId, 'usr_live');
  assert.strictEqual(layer.enabled, true);
  assert.strictEqual(layer.muted, false);
  assert.strictEqual(layer.settings.visualizer.type, 'custom');
  const drawn = L.resolve(cfg).filter((l) => l.kind === 'visualizer');
  assert.strictEqual(drawn.length, 1);
  assert.strictEqual(drawn[0].type, 'custom');
  assert.strictEqual(drawn[0].presetId, 'usr_live');
});

test('revealLayer turns a hidden visualizer on when the stack was not driving', () => {
  const cfg = scene();
  cfg.layerStack.enabled = false;
  const layer = cfg.layers[0];
  L.revealLayer(cfg, layer);
  assert.strictEqual(L.stackOn(cfg), true);
  assert.strictEqual(layer.enabled, true);
  assert.strictEqual(layer.muted, false);
  assert.ok(L.resolve(cfg).some((l) => l.id === 'ly_vis' && l.type === 'bars'));
});

test('MCP visualizer type and layer enable update the stack that is drawn', async () => {
  const cfg = scene();
  cfg.mcp = { enabled: true, mode: 'write' };
  const ctx = {
    locale: function () { return 'en'; },
    getConfig: function () { return cfg; },
    setConfig: function (next) {
      Object.keys(cfg).forEach(function (k) { delete cfg[k]; });
      Object.assign(cfg, next);
    },
  };
  const typed = await mcp.callTool('sv_set_visualizer_type', { type: 'circle' }, ctx);
  assert.strictEqual(typed.ok, true, JSON.stringify(typed));
  assert.strictEqual(cfg.layers[0].type, 'circle');
  assert.strictEqual(cfg.layers[0].enabled, true);
  cfg.layers[0].enabled = false;
  cfg.layers[0].muted = true;
  const shown = await mcp.callTool('sv_set_layer_enabled', { id: 'ly_vis', enabled: true }, ctx);
  assert.strictEqual(shown.ok, true, JSON.stringify(shown));
  assert.strictEqual(cfg.layers[0].enabled, true);
  assert.strictEqual(cfg.layers[0].muted, false);
  assert.strictEqual(L.stackOn(cfg), true);
  assert.ok(L.resolve(cfg).some((l) => l.type === 'circle'));
});

test('a preset saved while the folder is still warming is in the list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-presets-'));
  store.setDir(dir);
  const warming = store.warm();
  const saved = store.save({ id: 'usr_warm', name: 'Warm', kind: 'visualizer', engine: 'shader', shader: 'void main(){}' });
  assert.strictEqual(saved.ok, true);
  await warming;
  const ids = store.list().map((p) => p.id);
  assert.ok(ids.indexOf('usr_warm') >= 0, ids.join(','));
  store.setDir(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
