'use strict';
/* Katman denetçisinde moda özgü bölümler yalnız kendi modunda (tablo, bütün modlar).
   Söze çevrilen metin katmanı hazır "Şarkı Sözü" katmanıyla aynı başlıyor: Windows'ta
   çalan parçayı izler ve denetçi Söz Kütüphanesi sekmesine geçer. Gelişmiş motorlar
   (3B Geometri, Geri Besleme) okumadıkları renk kipi / parlama denetimini göstermez. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/schema.js');
require('../src/shared/mode-catalog.js');
require('../src/shared/lyrics-clock.js');
require('../src/admin/lyrics-lib-ui.js');
const L = require('../src/visualizer/layers.js');
const MC = window.SVModeCatalog;

function harness(layers, win) {
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  window.SV_PLATFORM = { isWindows: !!win, isMac: false };
  const cfg = window.SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = layers.map((l) => L.normalizeLayer(l));
  const el = (tag, attrs, children) => {
    const node = { tag, attrs: attrs || {}, children: (children || []).filter(Boolean), style: {}, classList: { toggle() {}, add() {}, remove() {} } };
    node.appendChild = (c) => { node.children.push(c); return c; };
    node.setAttribute = (k, v) => { node.attrs[k] = v; };
    node.getAttribute = (k) => node.attrs[k];
    node.querySelector = () => null;
    Object.defineProperty(node, 'innerHTML', { set() { node.children.length = 0; }, get() { return ''; } });
    return node;
  };
  window.SVLayers = L;
  window.SVPanel = {
    sliderMax: (d) => d.max, el, cfg: () => cfg,
    row: (label, ctrl) => el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), ctrl])]),
    push() {}, apply() {}, rerender() {}, toast() {}, confirm: async () => true, isModified: () => false, resetPath() {}, defaultAt: () => undefined,
    sectionCard: () => null,
  };
  delete require.cache[require.resolve('../src/admin/scene-panels.js')];
  require('../src/admin/scene-panels.js');
  return { cfg, panel: (id) => window.SVScenePanels.layersPanel({ only: id }) };
}
const all = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) all(c, pred, out);
  return out;
};
const tabs = (panel) => all(panel, (n) => n.attrs && n.attrs.role === 'tab').map((n) => n.attrs['data-k']);
const activeTab = (panel) => (all(panel, (n) => n.attrs && n.attrs.role === 'tab' && n.attrs['aria-selected'] === 'true')[0] || { attrs: {} }).attrs['data-k'];
const labels = (panel) => all(panel, (n) => n.attrs && (n.attrs.class === 'lbl' || n.attrs['aria-label'])).map((n) => n.attrs.text || n.attrs['aria-label']);

test('görselleştiriciyi söze çevirmek: çalan parçayı izle açık, Söz Kütüphanesi sekmesi açılır (Windows)', () => {
  const h = harness([{ id: 'v', kind: 'visualizer', type: 'bars' }], true);
  // Kaynak: barlar → metin
  let p = h.panel('v');
  const kind = all(p, (n) => n.tag === 'select' && n.attrs['aria-label'] === 'Kaynak')[0];
  kind.attrs.onchange({ target: { value: 'text' } });
  const layer = h.cfg.layers[0];
  window.SVLayers.normalizeLayer(layer);
  p = h.panel('v');
  assert.ok(!tabs(p).includes('lyricslib'), 'sabit metinde kütüphane yok');
  const src = all(p, (n) => n.tag === 'select' && n.attrs['aria-label'] === 'Metin Kaynağı')[0];
  assert.ok(src, 'Metin Kaynağı seçicisi');
  src.attrs.onchange({ target: { value: 'lyrics' } });
  assert.strictEqual(h.cfg.layers[0].settings.text.source, 'lyrics');
  assert.strictEqual(h.cfg.layers[0].settings.text.lyricsFollow, true);
  p = h.panel('v');
  assert.ok(tabs(p).includes('lyricslib'), 'Söz Kütüphanesi sekmesi: ' + tabs(p).join(','));
  assert.strictEqual(activeTab(p), 'lyricslib', 'denetçi kütüphaneye geçti');
  // Tek seferlik: sonraki çizimde kullanıcının seçtiği sekme korunur
  const second = h.panel('v');
  assert.ok(tabs(second).includes('lyricslib'));
});

test('Windows dışında kütüphane sekmesi yok, izleme kapalı kalır (tasarım gereği)', () => {
  const h = harness([{ id: 't', kind: 'visualizer', type: 'text', settings: { text: { source: 'static' } } }], false);
  const p = h.panel('t');
  all(p, (n) => n.tag === 'select' && n.attrs['aria-label'] === 'Metin Kaynağı')[0].attrs.onchange({ target: { value: 'lyrics' } });
  assert.notStrictEqual(h.cfg.layers[0].settings.text.lyricsFollow, true);
  assert.ok(!tabs(h.panel('t')).includes('lyricslib'));
});

test('tablo: her görselleştirici modunda yalnız kendi bölümleri', () => {
  const skip = { none: 1, custom: 1, text: 1, nowplaying: 1, milkdrop: 1 };
  const ids = MC.VISUALIZERS.map((m) => m.id).filter((id) => !skip[id]);
  assert.ok(ids.length > 40);
  for (const id of ids) {
    const h = harness([{ id: 'v', kind: 'visualizer', type: id }], true);
    const p = h.panel('v');
    const lb = labels(p);
    const t = tabs(p);
    const engine = MC.is('visualizer', id, 'engine');
    assert.strictEqual(lb.includes('Renk Modu'), !engine, id + ': Renk Modu');
    assert.strictEqual(lb.includes('Parlama (Glow)'), !engine && id !== 'spectrogram', id + ': Parlama');
    assert.strictEqual(lb.includes('Bar Sayısı'), MC.is('visualizer', id, 'bands'), id + ': Bar Sayısı');
    assert.strictEqual(t.includes('spectrum'), MC.is('visualizer', id, 'bands'), id + ': Tayf Ölçümü');
    assert.ok(!t.includes('lyricslib') && !t.includes('type'), id + ': metin sekmeleri yok');
    assert.ok(lb.includes('Hassasiyet'), id + ': Hassasiyet her modda');
  }
});

test('tablo: arkaplan modları görselleştirici / metin bölümü göstermez', () => {
  for (const m of MC.BACKGROUNDS.filter((x) => x.id !== 'none' && x.id !== 'custom')) {
    const h = harness([{ id: 'b', kind: 'background', type: m.id }], true);
    const p = h.panel('b');
    const lb = labels(p);
    const t = tabs(p);
    assert.ok(!lb.includes('Bar Sayısı') && !lb.includes('Metin Kaynağı'), m.id);
    assert.ok(!t.includes('spectrum') && !t.includes('lyricslib'), m.id);
  }
});
