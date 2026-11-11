'use strict';
/* Mod hedefi: Görsel / Zemin modu yalnız seçili (ya da MCP'de adı verilen) katmana
   gider. Türü uymayan ya da kilitli katman değişmez, açık bir hata döner. Eski
   davranış (uygun ilk katmana yönlendirme) `ui.modeTargetAuto` ile açılır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../src/visualizer/layers.js');
const mcp = require('../src/shared/mcp');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

function scene(extra) {
  return Object.assign({
    layerStack: { enabled: true },
    visualizer: { type: 'none' },
    background: { type: 'gradient' },
    layers: [
      { id: 'bg1', kind: 'background', type: 'gradient', enabled: true, settings: { background: { type: 'gradient' } } },
      { id: 'v1', kind: 'visualizer', type: 'bars', enabled: true, settings: { visualizer: { type: 'bars' } } },
      { id: 'v2', kind: 'visualizer', type: 'wave', enabled: true, settings: {} },
      { id: 'tx', kind: 'visualizer', type: 'text', enabled: true, settings: { text: {} } },
    ],
  }, extra || {});
}

test('modeTarget: seçili katman o türdense hedef odur', () => {
  const cfg = scene();
  assert.strictEqual(L.modeTarget(cfg, { kind: 'visualizer', layerId: 'v2' }).layer.id, 'v2');
  assert.strictEqual(L.modeTarget(cfg, { kind: 'background', layerId: 'bg1' }).layer.id, 'bg1');
});

test('modeTarget: tür uymuyorsa ya da kilitliyse hata, başka katmana gitmez', () => {
  const cfg = scene();
  const wrong = L.modeTarget(cfg, { kind: 'visualizer', layerId: 'bg1' });
  assert.strictEqual(wrong.error, 'WRONG_KIND');
  assert.strictEqual(wrong.layer.id, 'bg1');
  assert.strictEqual(L.modeTarget(cfg, { kind: 'background', layerId: 'v1' }).error, 'WRONG_KIND');
  cfg.layers[1].locked = true;
  assert.strictEqual(L.modeTarget(cfg, { kind: 'visualizer', layerId: 'v1' }).error, 'LOCKED');
  assert.strictEqual(L.modeTarget(cfg, { kind: 'visualizer', layerId: 'yok' }).error, 'NOT_FOUND');
  // Seçim yoksa yeni katman (raf "Yeni katman olarak eklenir" diyor)
  assert.deepStrictEqual(L.modeTarget(cfg, { kind: 'visualizer' }), { create: true });
});

test('modeTarget: eski davranış ayarı uygun en üstteki katmana yönlendirir', () => {
  const cfg = scene({ ui: { modeTargetAuto: true } });
  assert.strictEqual(L.modeTargetAuto(cfg), true);
  const r = L.modeTarget(cfg, { kind: 'visualizer', layerId: 'bg1' });
  assert.strictEqual(r.layer.id, 'tx', 'listede en üstteki görselleştirici türü');
  assert.strictEqual(r.redirected, true);
  cfg.layers[3].locked = true;
  assert.strictEqual(L.modeTarget(cfg, { kind: 'visualizer', layerId: 'bg1' }).layer.id, 'v2');
  assert.strictEqual(L.modeTarget(scene(), {}).create, true);
  assert.strictEqual(L.modeTargetAuto(scene()), false, 'varsayılan katı kural');
});

test('setLayerMode türü katmana ve kendi ayar bölümüne yazar', () => {
  const cfg = scene();
  const l = cfg.layers[1];
  L.setLayerMode(cfg, l, { type: 'circular', reveal: true });
  assert.strictEqual(l.type, 'circular');
  assert.strictEqual(l.settings.visualizer.type, 'circular');
  assert.strictEqual(cfg.layers[2].type, 'wave', 'öteki katman değişmedi');
});

test('varsayılan ayar kapalı ve Ayarlar kartında TR+EN anahtar var', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const def = global.window.SV.defaultConfig();
  assert.strictEqual(def.ui.modeTargetAuto, false);
  const admin = read('src/admin/admin.js');
  assert.match(admin, /path: 'ui\.modeTargetAuto', label: 'Modu Uygun Katmana Yönlendir'/);
  assert.match(admin, /'ui\.reduceMotion', 'ui\.modeTargetAuto'/);
  const src = read('src/shared/i18n.js');
  for (const k of ['Modu Uygun Katmana Yönlendir', 'Seçili katman bu rafa uymuyor', 'Uygun rafa geç', 'Seçimi kaldır', "Katmanı MilkDrop\\'a çevir"]) {
    assert.ok(src.indexOf("'" + k + "':") >= 0, 'EN çevirisi: ' + k);
  }
});

/* ---- MCP ---- */
function ctx(cfg) {
  return {
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
  };
}
const call = (name, cfg, args) => Promise.resolve(mcp.callTool(name, args || {}, ctx(cfg)));
const mcpCfg = (extra) => Object.assign(scene(extra), { mcp: { enabled: true, mode: 'apply' } });

test('MCP: layerId ile yalnız o görselleştirici katmanı değişir', async () => {
  const cfg = mcpCfg();
  const r = await call('sv_set_visualizer_type', cfg, { type: 'circular', layerId: 'v2' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.layerId, 'v2');
  assert.strictEqual(cfg.layers.find((l) => l.id === 'v2').type, 'circular');
  assert.strictEqual(cfg.layers.find((l) => l.id === 'v1').type, 'bars');
});

test('MCP: yanlış tür, kilitli ve bilinmeyen katman açık hata verir, hiçbir şey yazılmaz', async () => {
  const cfg = mcpCfg();
  const before = JSON.stringify(cfg);
  const a = await call('sv_set_visualizer_type', cfg, { type: 'circular', layerId: 'bg1' });
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /bg1.*background layer.*sv_set_visualizer_type only changes visualizer layers.*sv_set_background_type/);
  const b = await call('sv_set_background_type', cfg, { type: 'solid', layerId: 'v1' });
  assert.strictEqual(b.ok, false);
  assert.match(b.error, /visualizer layer.*only changes background layers/);
  const c = await call('sv_set_visualizer_type', cfg, { type: 'circular', layerId: 'nope' });
  assert.match(c.error, /not found.*sv_list_layers/);
  assert.strictEqual(JSON.stringify(cfg), before);
  cfg.layers[1].locked = true;
  const d = await call('sv_set_visualizer_type', cfg, { type: 'circular', layerId: 'v1' });
  assert.match(d.error, /locked/);
  assert.strictEqual(cfg.layers[1].type, 'bars');
});

test('MCP: birden çok aday varken layerId istenir; tek aday eski yoldan', async () => {
  const cfg = mcpCfg();
  const r = await call('sv_set_visualizer_type', cfg, { type: 'circular' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /2 visualizer layers; pass layerId.*v1 .*v2 /);
  const one = await call('sv_set_background_type', cfg, { type: 'solid' });
  assert.strictEqual(one.ok, true, JSON.stringify(one));
  assert.strictEqual(cfg.layers[0].type, 'solid');
  assert.strictEqual(one.layerId, 'bg1');
});

test('MCP: eski davranış ayarı açıkken yönlendirme raporlanır', async () => {
  const cfg = mcpCfg({ ui: { modeTargetAuto: true } });
  const r = await call('sv_set_visualizer_type', cfg, { type: 'circular', layerId: 'bg1' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.redirectedFrom, 'bg1');
  assert.strictEqual(cfg.layers[0].type, 'gradient', 'arkaplan değişmedi');
  const plain = await call('sv_set_visualizer_type', cfg, { type: 'wave' });
  assert.strictEqual(plain.ok, true, 'adaysız çağrı eski yoldan');
});

test('MCP şeması layerId alanını gösteriyor', () => {
  const src = read('src/shared/mcp.js');
  assert.match(src, /sv_set_visualizer_type: \{ props: \{[^\n]*layerId: sp\('string'/);
  assert.match(src, /sv_set_background_type: \{ props: \{[^\n]*layerId: sp\('string'/);
});

/* ---- Panel: raf kilidi ve uygulama ---- */
test('sahne rafı: uymayan seçimde kilit, katı uygulama, MilkDrop çevirme', () => {
  const shell = read('src/admin/scene-shell.js');
  assert.match(shell, /function shelfLock\(\)/);
  assert.match(shell, /wrap\.inert = true/);
  assert.match(shell, /window\.SVLayers\.modeTarget\(P\(\)\.cfg\(\), \{ kind: want, layerId: cur \? cur\.id : '' \}\)/);
  assert.doesNotMatch(shell, /if \(!l \|\| l\.kind !== want \|\| l\.locked\) l = list\.slice\(\)\.reverse\(\)/, 'sessiz yönlendirme kalktı');
});
