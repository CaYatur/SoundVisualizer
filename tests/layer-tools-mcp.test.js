'use strict';
/* Katman Ekle > MilkDrop kartı ve yeni MCP araçları:
 *  - sv_add_layer type milkdrop: hazır MilkDrop katmanı (varsayılan MD3 preset),
 *  - sv_duplicate_layer: yeni kimlikle hemen üstüne kopya, kilit korunuyor,
 *  - sv_lyrics_library: salt okunur şarkı sözü kitaplığı (yalnız Windows). */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
require('../src/shared/schema.js');
require('../src/shared/lyrics-clock.js');
require('../src/admin/lyrics-lib-ui.js');
const L = require('../src/visualizer/layers.js');
const mcp = require('../src/shared/mcp');

function ctx(cfg, extra) {
  return Object.assign({
    locale: () => 'en',
    getConfig: () => cfg,
    setConfig: (next) => { Object.keys(cfg).forEach((k) => { delete cfg[k]; }); Object.assign(cfg, next); },
  }, extra);
}
const base = (layers) => Object.assign(window.SV.defaultConfig(), {
  mcp: { enabled: true, mode: 'write' },
  layerStack: { enabled: true },
  layers: (layers || []).map((l) => L.normalizeLayer(l)),
});
const call = (name, cfg, args, extra) => Promise.resolve(mcp.callTool(name, args || {}, ctx(cfg, extra)));

/* ---------------------------------------------------------------- MilkDrop */

test('sv_add_layer type milkdrop: varsayılan MD3 presetle ortak seçime bağlı katman', async () => {
  const cfg = base([{ id: 'v', kind: 'visualizer', type: 'bars' }]);
  const r = await call('sv_add_layer', cfg, { kind: 'visualizer', type: 'milkdrop' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const made = cfg.layers[cfg.layers.length - 1];
  assert.strictEqual(made.type, 'milkdrop');
  assert.deepStrictEqual(r.milkdrop, { presetId: L.MD_DEFAULT_PRESET, own: false });
  assert.strictEqual(cfg.milkdrop.presetId, L.MD_DEFAULT_PRESET);
  assert.ok(cfg.milkdrop.source.length > 20);
  assert.strictEqual(cfg.layers[0].type, 'bars', 'diğer katmana dokunulmadı');
});

test('sv_add_layer type milkdrop: ortak preseti çizen varsa yeni katman kendi presetiyle bağımsız', async () => {
  const cfg = base([{ id: 'm', kind: 'visualizer', type: 'milkdrop' }]);
  cfg.milkdrop = Object.assign({}, cfg.milkdrop, { presetId: 'keep', name: 'Keep', source: 'x' });
  const r = await call('sv_add_layer', cfg, { kind: 'visualizer', type: 'milkdrop' });
  assert.strictEqual(r.milkdrop.own, true);
  const made = cfg.layers[cfg.layers.length - 1];
  assert.strictEqual(made.settings.milkdrop.independent, true);
  assert.strictEqual(made.settings.milkdrop.presetId, L.MD_DEFAULT_PRESET);
  assert.strictEqual(cfg.milkdrop.presetId, 'keep', 'ortak seçim değişmedi');
});

test('sv_add_layer presetId: yalnız milkdrop ile ve var olan presetle', async () => {
  const cfg = base([]);
  assert.match((await call('sv_add_layer', cfg, { kind: 'visualizer', type: 'bars', presetId: 'x' })).error, /only used with type milkdrop/);
  assert.match((await call('sv_add_layer', cfg, { kind: 'visualizer', type: 'milkdrop', presetId: 'yok' })).error, /not found/);
});

test('Katman Ekle > MilkDrop kartı: MilkDrop katmanı ekliyor, seçiyor ve MilkDrop rafını açıyor', () => {
  const cfg = base([{ id: 'v', kind: 'visualizer', type: 'bars' }]);
  const calls = [];
  const el = (tag, attrs, children) => {
    const node = { tag, attrs: attrs || {}, children: (children || []).filter(Boolean), style: {}, classList: { toggle() {}, add() {} } };
    node.appendChild = (c) => { node.children.push(c); return c; };
    node.setAttribute = (k, v) => { node.attrs[k] = v; };
    node.querySelector = () => null;
    node.getAttribute = (k) => node.attrs[k];
    return node;
  };
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem() {} };
  window.SVLayers = L;
  window.SVPanel = {
    sliderMax: (d) => d.max, el, cfg: () => cfg,
    row: (label, ctrl) => el('div', { class: 'ctrl' }, [el('label', { text: label }), ctrl]),
    push() {}, apply: () => calls.push('apply'), rerender() {}, toast() {}, confirm: async () => true,
    isModified: () => false, resetPath() {}, defaultAt: () => undefined,
  };
  window.SVSceneShell = { select: (id) => calls.push('select:' + id), setShelf: (s) => calls.push('shelf:' + s) };
  window.SVMilkdropPanel = { pickFor: (id) => calls.push('pick:' + id) };
  try {
    delete require.cache[require.resolve('../src/admin/scene-panels.js')];
    require('../src/admin/scene-panels.js');
    const row = window.SVScenePanels.layersPanel({ add: true });
    const flat = [];
    (function walk(n) { if (n && typeof n === 'object') { flat.push(n); (n.children || []).forEach(walk); } })(row);
    const btns = flat.filter((n) => n.tag === 'button');
    const i = btns.findIndex((n) => n.attrs['data-add'] === 'milkdrop');
    assert.ok(i > 0, 'kart var');
    assert.strictEqual(btns[i].attrs.text, 'MilkDrop');
    assert.strictEqual(btns[i].attrs.class, btns[i - 1].attrs.class, 'aynı kart biçimi');
    assert.match(btns[i - 1].attrs.text, /Görselleştirici/, 'Görselleştirici kartının hemen yanında');
    btns[i].attrs.onclick();
    const made = cfg.layers[cfg.layers.length - 1];
    assert.strictEqual(made.kind, 'visualizer');
    assert.strictEqual(made.type, 'milkdrop');
    assert.strictEqual(cfg.milkdrop.presetId, L.MD_DEFAULT_PRESET, 'boş ekranla açılmıyor');
    assert.deepStrictEqual(calls, ['pick:', 'select:' + made.id, 'shelf:milkdrop', 'apply']);
    assert.strictEqual(cfg.layers[0].type, 'bars');
  } finally {
    delete window.SVSceneShell;
    delete window.SVMilkdropPanel;
  }
});

/* ---------------------------------------------------------------- kopya */

test('sv_duplicate_layer: yeni kimlik, hemen üstte, ayarlar kopyalanıyor, solo kapalı', async () => {
  const cfg = base([
    { id: 'a', kind: 'visualizer', type: 'bars', name: 'Bars', opacity: 0.5, solo: true },
    { id: 'b', kind: 'text', type: 'text', name: 'Text' },
  ]);
  const r = await call('sv_duplicate_layer', cfg, { id: 'a' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(cfg.layers.map((l) => l.id).filter((id) => id !== r.layer.id), ['a', 'b']);
  const copy = cfg.layers[1];
  assert.strictEqual(copy.id, r.layer.id);
  assert.notStrictEqual(copy.id, 'a');
  assert.strictEqual(copy.type, 'bars');
  assert.strictEqual(copy.opacity, 0.5);
  assert.strictEqual(copy.solo, false);
  assert.strictEqual(copy.name, 'Bars (copy)');
  assert.strictEqual(r.sourceId, 'a');
  const named = await call('sv_duplicate_layer', cfg, { id: 'b', name: 'Başlık 2' });
  assert.strictEqual(named.layer.name, 'Başlık 2');
});

test('sv_duplicate_layer: kilitli katman kopyalanıyor, kopya kilitli; kaynak değişmiyor; izin ve bilinmeyen kimlik', async () => {
  const cfg = base([{ id: 'k', kind: 'visualizer', type: 'bars', locked: true }]);
  const src = JSON.stringify(cfg.layers[0]);
  const r = await call('sv_duplicate_layer', cfg, { id: 'k' });
  assert.strictEqual(r.locked, true);
  assert.strictEqual(JSON.stringify(cfg.layers[0]), src);
  assert.match((await call('sv_duplicate_layer', cfg, { id: 'yok' })).error, /not found/);
  const ro = base([{ id: 'a', kind: 'visualizer', type: 'bars' }]);
  ro.mcp.mode = 'read';
  assert.strictEqual((await call('sv_duplicate_layer', ro, { id: 'a' })).ok, false, 'salt okunur kipte yazmıyor');
  assert.strictEqual(ro.layers.length, 1);
  const tr = await call('sv_duplicate_layer', cfg, { id: 'k' }, { locale: () => 'tr' });
  assert.match(tr.layer.name, /\(kopya\)$/);
});

/* ---------------------------------------------------------------- şarkı sözü */

const LIB = [
  { id: 'l1', name: 'Bir Derdim Var', artist: 'mor ve ötesi', title: 'Bir Derdim Var' },
  { id: 'l2', name: 'Yalnızlık Senfonisi', artist: 'Duman', title: 'Yalnızlık Senfonisi' },
];
const lyricsCtx = (platform) => ({
  platform,
  lyricsLibrary: {
    list: () => LIB.slice(),
    read: (id) => (id === 'l1' ? Object.assign({ text: '[00:01.00] satır\n'.repeat(50) }, LIB[0]) : null),
  },
});

test('sv_lyrics_library Windows dışında açık hatayla duruyor', async () => {
  const cfg = base([]);
  for (const p of ['darwin', 'linux']) {
    const r = await call('sv_lyrics_library', cfg, {}, lyricsCtx(p));
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /only available on Windows/);
    assert.match(r.error, new RegExp(p));
  }
});

test('sv_lyrics_library: list, search, get (kısaltma) ve hatalar; yapılandırmaya yazmıyor', async () => {
  const cfg = base([]);
  const before = JSON.stringify(cfg);
  const x = lyricsCtx('win32');
  const all = await call('sv_lyrics_library', cfg, {}, x);
  assert.strictEqual(all.total, 2);
  assert.strictEqual((await call('sv_lyrics_library', cfg, { action: 'list', limit: 1 }, x)).truncated, true);
  const s = await call('sv_lyrics_library', cfg, { action: 'search', query: 'DUMAN' }, x);
  assert.deepStrictEqual(s.items.map((i) => i.id), ['l2']);
  const g = await call('sv_lyrics_library', cfg, { action: 'get', id: 'l1', maxChars: 100 }, x);
  assert.strictEqual(g.ok, true);
  assert.strictEqual(g.text.length, 100);
  assert.strictEqual(g.truncated, true);
  assert.ok(g.length > 100);
  assert.match((await call('sv_lyrics_library', cfg, { action: 'get', id: 'l9' }, x)).error, /not found/);
  assert.match((await call('sv_lyrics_library', cfg, { action: 'get' }, x)).error, /id is required/);
  assert.match((await call('sv_lyrics_library', cfg, { action: 'search' }, x)).error, /query is required/);
  assert.match((await call('sv_lyrics_library', cfg, { action: 'drop' }, x)).error, /list, search or get/);
  assert.strictEqual(JSON.stringify(cfg), before);
});

test('araçlar katalogda, TR/EN açıklamalı ve ana süreç bağlamı bağlı', () => {
  const names = mcp.tools ? mcp.tools().map((t) => t.name) : mcp.toolList().map((t) => t.name);
  for (const n of ['sv_duplicate_layer', 'sv_lyrics_library']) assert.ok(names.includes(n), n);
  const fs = require('fs');
  const path = require('path');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'src/main/mcp-server.js'), 'utf8');
  assert.match(srv, /lyricsLibrary: deps\.lyricsLibrary/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
  assert.match(main, /lyricsLibrary: \{\s*list: \(\) => lyricsLibrary\.list\(lyricsLibDir\(\)\)/);
});
