'use strict';
/* MCP aralık denetimi (#905): ajan panelin veremediği sayıyı yazamaz, verebildiğini
   yazabilir; diskte eskiden kalan değer başka bir yazımı durdurmaz. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const mcp = require('../src/shared/mcp.js');

function ctx() {
  const cfg = Object.assign(SV.defaultConfig(), { mcp: { enabled: true, mode: 'everything' } });
  return {
    cfg, platform: 'win32', locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    noteWrite: () => 1, revision: () => 1,
  };
}
const call = (c, tool, args) => Promise.resolve(mcp.callTool(tool, args, c));
const patch = (c, p, v) => call(c, 'sv_patch_config', { path: p, value: v });

test('ham yol: aralık dışı reddedilir, değer değişmez', async () => {
  const c = ctx();
  const before = c.cfg.visualizer.glow;
  for (const bad of [-0.1, 5.01, 99]) {
    const r = await patch(c, 'visualizer.glow', bad);
    assert.strictEqual(r.ok, false, String(bad));
    assert.match(JSON.stringify(r), /visualizer\.glow must be between 0 and 5/);
    assert.strictEqual(c.cfg.visualizer.glow, before);
  }
});

test('panelin genişletilmiş aralıkla verebildiği değer yazılabilir', async () => {
  const c = ctx();
  assert.strictEqual((await patch(c, 'visualizer.glow', 1)).ok, true);
  assert.strictEqual((await patch(c, 'visualizer.glow', 5)).ok, true);
  assert.strictEqual(c.cfg.visualizer.glow, 5);
  assert.strictEqual((await patch(c, 'visualizer.barCount', 800)).ok, true);
});

test('sert sınırlı ayar büyütülemez', async () => {
  const c = ctx();
  assert.strictEqual((await patch(c, 'audio.smoothing', 0.95)).ok, true);
  assert.strictEqual((await patch(c, 'audio.smoothing', 1)).ok, false);
  assert.strictEqual((await patch(c, 'feedback.decay', 1.2)).ok, false);
  assert.strictEqual((await patch(c, 'visualizer.spectrum.floorDb', -24)).ok, true);
  assert.strictEqual((await patch(c, 'visualizer.spectrum.floorDb', -10)).ok, false);
  assert.strictEqual((await patch(c, 'visualizer.spectrum.floorDb', -97)).ok, false);
});

test('tam sayı satırı küsurat almaz', async () => {
  const c = ctx();
  const r = await patch(c, 'visualizer.barCount', 32.5);
  assert.strictEqual(r.ok, false);
  assert.match(JSON.stringify(r), /visualizer\.barCount must be a whole number/);
});

test('nesne yazımı: alttaki yollar denetlenir, eskiden kalan değer durdurmaz', async () => {
  const c = ctx();
  // Eski sürümde yazılmış, bugünkü sınırın dışında bir değer
  c.cfg.visualizer.glow = 40;
  const legacy = Object.assign({}, c.cfg.visualizer, { sensitivity: 2 });
  assert.strictEqual((await patch(c, 'visualizer', legacy)).ok, true, 'değişmeyen eski değer engel olmaz');
  assert.strictEqual(c.cfg.visualizer.glow, 40);
  assert.strictEqual(c.cfg.visualizer.sensitivity, 2);
  const bad = Object.assign({}, c.cfg.visualizer, { sensitivity: 900 });
  const r = await patch(c, 'visualizer', bad);
  assert.strictEqual(r.ok, false);
  assert.match(JSON.stringify(r), /visualizer\.sensitivity must be between/);
  assert.strictEqual(c.cfg.visualizer.sensitivity, 2);
});

test('bölüm araçları da denetler', async () => {
  const c = ctx();
  let r = await call(c, 'sv_set_logo', { patch: { opacity: 50 } });
  assert.strictEqual(r.ok, false);
  assert.match(JSON.stringify(r), /logo\.opacity must be between/);
  r = await call(c, 'sv_set_logo', { patch: { opacity: 0.5 } });
  assert.strictEqual(r.ok, true);
  r = await call(c, 'sv_set_media', { patch: { opacity: 2 } });
  assert.strictEqual(r.ok, false, 'medya saydamlığı sert sınırlı');
  r = await call(c, 'sv_set_floating', { patch: { opacity: 0.1 } });
  assert.strictEqual(r.ok, false);
  assert.match(JSON.stringify(r), /floating\.opacity must be between 0\.2/);
});

test('MilkDrop döngüsü denetlenir, kovalı satır uçlarıyla sınırlı', async () => {
  const c = ctx();
  assert.strictEqual((await call(c, 'sv_set_milkdrop_cycle', { autoNext: 900 })).ok, false);
  assert.strictEqual((await call(c, 'sv_set_milkdrop_cycle', { autoNext: 30 })).ok, true);
  assert.strictEqual((await patch(c, 'milkdrop.mesh', 48)).ok, true);
  assert.strictEqual((await patch(c, 'milkdrop.mesh', 512)).ok, false);
});

test('katman ayarları: üç yazım yolu da denetlenir', async () => {
  const c = ctx();
  c.cfg.layers = [{ id: 'k1', name: 'K', enabled: true, kind: 'visualizer', type: 'bars', settings: { visualizer: { glow: 0.2 } } }];
  let r = await patch(c, 'layers.0.settings.visualizer.glow', 80);
  assert.strictEqual(r.ok, false);
  assert.match(JSON.stringify(r), /settings: visualizer\.glow must be between/);
  r = await call(c, 'sv_set_layer_settings', { id: 'k1', settings: { visualizer: { glow: 80 } } });
  assert.strictEqual(r.ok, false);
  r = await call(c, 'sv_set_layer_settings', { id: 'k1', key: 'visualizer', value: { glow: 80 } });
  assert.strictEqual(r.ok, false);
  r = await call(c, 'sv_set_layer_settings', { id: 'k1', settings: { visualizer: { glow: 0.7 } } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(c.cfg.layers[0].settings.visualizer.glow, 0.7);
});

test('sahne içindeki yol da aynı sınıra bağlı', async () => {
  const c = ctx();
  c.cfg.scenes = [{ id: 's1', name: 'S', visualizer: { glow: 0.2 } }];
  assert.strictEqual((await patch(c, 'scenes.0.visualizer.glow', 80)).ok, false);
  assert.strictEqual((await patch(c, 'scenes.0.visualizer.glow', 0.3)).ok, true);
});

test('şemada olmayan sayı serbest kalır, null dokunulmaz', async () => {
  const c = ctx();
  assert.strictEqual((await patch(c, 'visualizer.barSpan', null)).ok, true);
  assert.strictEqual((await patch(c, 'visualizer.barSpan', 0.5)).ok, true);
  assert.strictEqual((await patch(c, 'visualizer.barSpan', 7)).ok, false);
});
