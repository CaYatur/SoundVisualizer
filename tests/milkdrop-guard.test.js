'use strict';
/* MilkDrop preset seçicisinin hedef koruması (katı hedefleme).
 *
 * Görsel ve Zemin raflarında mod yalnız uygun seçili katmana gidiyordu, MilkDrop
 * panelinin kendi seçicisinde ise kod düzeyinde bir koruma yoktu: seçim başka bir
 * katmandayken listeden, ◀ ▶ ya da Rastgele ile preset seçmek ilk görselleştiriciyi
 * sessizce MilkDrop'a çeviriyordu. Artık layers.js milkdropTarget tek kural:
 *  - seçili kilitsiz MilkDrop katmanı hedeftir,
 *  - katı kipte (varsayılan) başka seçim reddedilir, kilitli katman açığa çıkmaz,
 *  - seçim yoksa ortak MilkDrop katmanı; o da yoksa yeni MilkDrop katmanı eklenir,
 *  - Ayarlar > Modu Uygun Katmana Yönlendir açıksa eski davranış (ilk kilitsiz
 *    görselleştirici çevrilir).
 * MCP sv_load_preset layerId aynı kuralı kullanıyor ve açık hata veriyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');
const MDP = require('../src/admin/milkdrop-panel.js');
const mcp = require('../src/shared/mcp');

const vis = (id, type, extra) => Object.assign({ id, kind: 'visualizer', type, enabled: true, settings: {} }, extra);
const stack = (layers, auto) => ({
  layerStack: { enabled: true }, layers, visualizer: { type: 'bars' },
  milkdrop: { presetId: '', name: '', source: '' }, ui: { modeTargetAuto: !!auto },
  mcp: { enabled: true, mode: 'apply' },
});
const preset = { id: 'md_1', name: 'Test', source: 'shader_body { ret = 1; }' };

test('milkdropTarget: katı kip seçimi doğruluyor, eski kip yönlendiriyor', () => {
  const cfg = stack([vis('v', 'bars'), vis('m', 'milkdrop'), vis('k', 'milkdrop', { locked: true }), { id: 't', kind: 'text', type: 'text' }]);
  assert.strictEqual(L.milkdropTarget(cfg, { layerId: 'm' }).layer.id, 'm');
  const wrong = L.milkdropTarget(cfg, { layerId: 'v' });
  assert.strictEqual(wrong.error, 'WRONG_KIND');
  assert.strictEqual(wrong.convertible, true);
  assert.strictEqual(L.milkdropTarget(cfg, { layerId: 't' }).convertible, false);
  assert.strictEqual(L.milkdropTarget(cfg, { layerId: 'k' }).error, 'LOCKED');
  assert.strictEqual(L.milkdropTarget(cfg, { layerId: 'yok' }).error, 'NOT_FOUND');
  // Seçimsiz: ortak MilkDrop katmanı
  assert.strictEqual(L.milkdropTarget(cfg, {}).layer.id, 'm');
  // Eski kip: yanlış seçim ilk uygun katmana yönlenir (çevirmeden önce ortak katman)
  const r = L.milkdropTarget(cfg, { layerId: 'v', legacy: true });
  assert.strictEqual(r.layer.id, 'm');
  const noMd = stack([vis('v', 'bars')]);
  assert.deepStrictEqual(L.milkdropTarget(noMd, {}), { create: true }, 'katı kip başka katmanı çevirmiyor');
  const lg = L.milkdropTarget(noMd, { legacy: true });
  assert.strictEqual(lg.layer.id, 'v');
  assert.strictEqual(lg.convert, true);
  // Kilitli görselleştirici eski kipte de çevrilmez
  assert.deepStrictEqual(L.milkdropTarget(stack([vis('v', 'bars', { locked: true })]), { legacy: true }), { create: true });
});

test('panel yüklemesi katı kipte görselleştiriciyi çevirmeyip MilkDrop katmanı ekliyor', () => {
  const cfg = stack([vis('ly_vis', 'bars')]);
  const r = MDP.load(cfg, preset);
  assert.strictEqual(cfg.layers.find((l) => l.id === 'ly_vis').type, 'bars', 'dokunulmadı');
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.layer.type, 'milkdrop');
  assert.strictEqual(cfg.layers.length, 2);
  // İkinci yükleme aynı katmanı kullanıyor (yeni katman yığılmıyor)
  MDP.load(cfg, preset);
  assert.strictEqual(cfg.layers.length, 2);
});

test('panel seçicisi: seçim MilkDrop değilse ya da kilitliyse preset yazılmıyor, uyarı çıkıyor', () => {
  const toasts = [];
  let sel = null;
  const cfg = stack([vis('v', 'bars'), vis('m', 'milkdrop'), vis('k', 'milkdrop', { locked: true })]);
  window.SVPanel = { cfg: () => cfg, toast: (m, k) => toasts.push([m, k]), rerender() {} };
  window.SVSceneShell = { selected: () => sel };
  try {
    sel = cfg.layers[0];
    assert.strictEqual(MDP.pickBlocked(cfg).error, 'WRONG_KIND');
    assert.strictEqual(MDP.uiPickOk(cfg), false);
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(toasts[0][1], 'warn');
    sel = cfg.layers[2];
    assert.strictEqual(MDP.pickBlocked(cfg).error, 'LOCKED');
    sel = cfg.layers[1];
    assert.strictEqual(MDP.pickBlocked(cfg), null);
    assert.strictEqual(MDP.uiPickOk(cfg), true);
    sel = null;
    assert.strictEqual(MDP.uiPickOk(cfg), true, 'seçimsiz: ortak MilkDrop katmanı');
    // Eski kip (Yönlendir açık): yanlış seçim de bir MilkDrop katmanına yönlenir
    cfg.ui.modeTargetAuto = true;
    sel = cfg.layers[0];
    assert.strictEqual(MDP.uiPickOk(cfg), true);
  } finally {
    delete window.SVSceneShell;
    delete window.SVPanel;
  }
});

test('seçici yolları korumadan geçiyor (liste, ◀ ▶, Rastgele, Varsayılana Dön)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src/admin/milkdrop-panel.js'), 'utf8');
  assert.match(src, /const back = \(\) => \{ if \(uiPickOk\(cfg\)\) navBack\(cfg, md\); \};/);
  assert.match(src, /onclick: \(\) => \{ if \(uiPickOk\(cfg\)\) go\(cfg, randomPick\(cfg, md\)\); \},/);
  assert.ok((src.match(/uiPickOk\(cfg\)/g) || []).length >= 5, 'liste, geri, ileri, rastgele, varsayılan');
});

test('adoptVisualizer / adoptBackground kilitli katmanı değiştirmiyor (MIDI/OSC, şov adımları, MCP)', () => {
  const cfg = stack([vis('a', 'bars', { locked: true }), vis('b', 'circular')]);
  const got = L.adoptVisualizer(cfg, { type: 'wave' });
  assert.strictEqual(got.id, 'b');
  assert.strictEqual(cfg.layers[0].type, 'bars');
  const all = stack([vis('a', 'bars', { locked: true })]);
  const before = JSON.stringify(all);
  assert.strictEqual(L.adoptVisualizer(all, { type: 'wave' }), null);
  assert.strictEqual(JSON.stringify(all), before, 'hepsi kilitliyse hiçbir şey yazılmıyor');
  const bg = stack([{ id: 'g', kind: 'background', type: 'gradient', locked: true, enabled: true, settings: {} }]);
  const bgBefore = JSON.stringify(bg);
  assert.strictEqual(L.adoptBackground(bg, { type: 'solid' }), null);
  assert.strictEqual(JSON.stringify(bg), bgBefore);
});

/* ---- MCP ---- */
function ctx(cfg, extra) {
  return Object.assign({
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
    presets: (() => {
      const all = [{ id: 'u_md', name: 'Mine', kind: 'milkdrop', source: 'x' }, { id: 'u_vis', name: 'Shader', kind: 'visualizer' }];
      return { list: () => all, get: (id) => all.find((p) => p.id === id) || null };
    })(),
  }, extra);
}
const call = (name, cfg, args) => Promise.resolve(mcp.callTool(name, args || {}, ctx(cfg)));

test('MCP sv_load_preset layerId: yanlış tür, kilitli ve bilinmeyen katmanda açık hata, hiçbir şey yazılmıyor', async () => {
  const cfg = stack([vis('v', 'bars'), vis('k', 'milkdrop', { locked: true }), { id: 't', kind: 'text', type: 'text', enabled: true, settings: {} }]);
  const before = JSON.stringify(cfg);
  const wrong = await call('sv_load_preset', cfg, { id: 'u_md', layerId: 'v' });
  assert.strictEqual(wrong.ok, false);
  assert.match(wrong.error, /not MilkDrop/);
  assert.match(wrong.error, /sv_set_visualizer_type/);
  assert.match((await call('sv_load_preset', cfg, { id: 'u_md', layerId: 't' })).error, /sv_add_layer/);
  assert.match((await call('sv_load_preset', cfg, { id: 'u_md', layerId: 'k' })).error, /locked/);
  assert.match((await call('sv_load_preset', cfg, { id: 'u_md', layerId: 'yok' })).error, /not found/);
  assert.match((await call('sv_load_preset', cfg, { id: 'u_vis' })).error, /not MilkDrop/);
  assert.strictEqual(JSON.stringify(cfg), before);
});

test('MCP sv_load_preset: bağımsız katmana kendi preseti, ortak katmana ortak seçim; çizen yoksa uyarı', async () => {
  const own = vis('o', 'milkdrop', { settings: { milkdrop: { independent: true, presetId: 'a', name: '', source: '' } } });
  const cfg = stack([vis('s', 'milkdrop'), own]);
  const r = await call('sv_load_preset', cfg, { id: 'u_md', layerId: 'o' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.target, 'layer');
  assert.strictEqual(cfg.layers[1].settings.milkdrop.presetId, 'u_md');
  assert.strictEqual(cfg.milkdrop.presetId, '', 'ortak seçim değişmedi');
  const s = await call('sv_load_preset', cfg, { id: 'u_md', layerId: 's' });
  assert.strictEqual(s.target, 'shared');
  assert.deepStrictEqual(s.shownOn, ['s']);
  assert.strictEqual(cfg.milkdrop.presetId, 'u_md');
  const none = stack([vis('v', 'bars')]);
  const w = await call('sv_load_preset', none, { id: 'u_md' });
  assert.strictEqual(w.ok, true);
  assert.match(w.warning, /No layer draws/);
});

test('MCP: yerleşik MilkDrop presetleri listeleniyor ve yükleniyor', async () => {
  const cfg = stack([vis('s', 'milkdrop')]);
  const list = await call('sv_list_presets', cfg);
  const md = list.library.find((p) => p.id === L.MD_DEFAULT_PRESET);
  assert.ok(md, 'varsayılan MD3 preset listede');
  assert.strictEqual(md.builtin, true);
  assert.strictEqual(md.kind, 'milkdrop');
  const r = await call('sv_load_preset', cfg, { id: L.MD_DEFAULT_PRESET });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(cfg.milkdrop.presetId, L.MD_DEFAULT_PRESET);
  assert.ok(cfg.milkdrop.source.length > 20, 'kaynak da geldi');
});
