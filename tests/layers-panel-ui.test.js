'use strict';
/* KATMAN PANOSU DÜZENİ (#622).
 *
 * Her katman bütün ayarlarıyla açık duruyordu: altı katmanlı gerçek bir
 * sahnede kart 4.356 piksel boyundaydı. Artık katmanlar kapalı geliyor,
 * başlık özetliyor, açık olanlar bu makinede hatırlanıyor ve alt bölümler
 * bir sekme şeridinde. Pano sahte bir DOM'la kuruluyor: `el` düğüm ağacı
 * döndürüyor, sınıf ve metinle aranıyor. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

function setup(layers, openIds) {
  const store = {};
  if (openIds) store['sv-layers-open'] = JSON.stringify(openIds);
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const cfg = window.SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = layers.map((l) => L.normalizeLayer(l));
  let renders = 0;
  const el = (tag, attrs, children) => {
    const node = { tag, attrs: attrs || {}, children: (children || []).filter(Boolean), style: {}, classList: { toggle() {}, add() {} } };
    node.appendChild = (c) => { node.children.push(c); return c; };
    node.setAttribute = () => {};
    node.getAttribute = (k) => node.attrs[k];
    return node;
  };
  window.SVLayers = L;
  window.SVPanel = {
    el,
    cfg: () => cfg,
    row: (label, ctrl) => el('div', { class: 'ctrl' }, [el('div', { class: 'row' }, [el('label', { class: 'lbl', text: label }), ctrl])]),
    push() {},
    apply: () => { renders++; },
    rerender: () => { renders++; },
    toast() {},
    confirm: async () => true,
  };
  delete require.cache[require.resolve('../src/admin/scene-panels.js')];
  require('../src/admin/scene-panels.js');
  const panel = window.SVScenePanels.layersPanel();
  return { panel, cfg, store, renders: () => renders };
}

const all = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) all(c, pred, out);
  return out;
};
const cls = (name) => (n) => typeof n.attrs.class === 'string' && n.attrs.class.split(/\s+/).includes(name);

const LAYERS = [
  { id: 'bg', kind: 'background', type: 'hexpulse', name: 'Arkaplan' },
  { id: 'v1', kind: 'visualizer', type: 'bars', name: 'Görselleştirici', blend: 'screen', opacity: 0.8 },
  { id: 'lg', kind: 'logo', type: 'back', name: 'Logo' },
];

test('katmanlar kapalı geliyor: başlık var, ayar gövdesi yok', () => {
  const { panel } = setup(LAYERS);
  const items = all(panel, cls('layer'));
  assert.strictEqual(items.length, 3, 'her katman bir satır');
  assert.strictEqual(all(panel, cls('layer-body')).length, 0, 'hiçbir katmanın ayarı açık değil');
  assert.strictEqual(all(panel, cls('layer-head')).length, 3);
});

test('başlık kaynağı, karışımı ve saydamlığı özetliyor', () => {
  const { panel } = setup(LAYERS);
  const smalls = all(panel, (n) => n.tag === 'small').map((n) => n.attrs.text);
  assert.ok(smalls.some((t) => /Barlar/.test(t) && /Ekran/.test(t) && /%80/.test(t)), 'özet: ' + smalls.join(' | '));
});

test('açık katman hatırlanıyor ve alt bölümler sekme şeridinde', () => {
  const { panel } = setup(LAYERS, ['v1']);
  const bodies = all(panel, cls('layer-body'));
  assert.strictEqual(bodies.length, 1, 'yalnız hatırlanan katman açık');
  const tabs = all(bodies[0], cls('layer-tab')).map((n) => n.attrs.text);
  assert.deepStrictEqual(tabs, ['Dönüşüm', 'Sese Tepki', 'Maske', 'Katman Efektleri', 'Grup ve Fader']);
  assert.strictEqual(all(bodies[0], cls('fold')).length, 0, 'eski katlanır başlıklar kalmadı');
});

test('aç/kapa durumu kaydediliyor, yeni eklenen katman açık geliyor', () => {
  const { panel, store, cfg } = setup(LAYERS);
  const toggle = all(panel, cls('layer-name'))[0];
  toggle.attrs.onclick();
  assert.deepStrictEqual(JSON.parse(store['sv-layers-open']), ['lg'], 'en üstteki (logo) açıldı');
  const add = all(panel, (n) => n.tag === 'button' && /Medya$/.test(n.attrs.text || ''))[0];
  add.attrs.onclick();
  const made = cfg.layers[cfg.layers.length - 1];
  assert.strictEqual(made.kind, 'media');
  assert.ok(JSON.parse(store['sv-layers-open']).includes(made.id), 'yeni katman açık');
});

test('kilitli katman açılamıyor', () => {
  const { panel } = setup([{ id: 'k', kind: 'visualizer', type: 'bars', locked: true }], ['k']);
  assert.strictEqual(all(panel, cls('layer-tabs')).length, 0);
  assert.ok(all(panel, (n) => /kilitli/.test(n.attrs.text || '')).length, 'kilit notu görünüyor');
});
