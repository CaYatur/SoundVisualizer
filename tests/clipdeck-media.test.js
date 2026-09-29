'use strict';
/* Klip destesi CD-3 (#637): video, görsel ve shader yuvaları seçilen
 * HEDEFE uygulanıyor. Önce model bu türleri tanıyor ama ateşlenince hiçbir
 * şey yapmıyordu (arayüz de öyle diyordu).
 *
 * Hedefler: 'media' (ana medya), 'vis' / 'bg' (ana görselleştirici ve
 * arkaplan), 'layer:<kimlik>', 'img:<nesne>', 'limg:<katman>:<nesne>'.
 */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const CD = require('../src/shared/clipdeck.js');
const TL = require('../src/shared/timeline.js');
window.SVClipDeck = CD;
window.SVTimeline = TL;
window.SVTimelineEdit = require('../src/shared/timeline-edit.js');
window.SVPresets = {
  list: [
    { id: 'pv', name: 'Neon Tünel', kind: 'visualizer', engine: 'shader' },
    { id: 'pb', name: 'Plazma Zemin', kind: 'background', engine: 'shader' },
    { id: 'px', name: 'Formül', kind: 'visualizer', engine: 'formula' },
  ],
  get(id) { return this.list.find((p) => p.id === id) || null; },
  byKind(k) { return this.list.filter((p) => p.kind === k); },
};

function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true, childNodes: [] };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };
window.addEventListener = () => {};
window.removeEventListener = () => {};

let DP = null;
let applied = 0;
function mount(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() { applied++; }, rerender() {}, confirm: () => Promise.resolve(true), toast() {}, actions: () => ({ applyScene() {} }),
  };
  window.SVTimelinePanel = null;
  window.SVTransition = { TRANSITION_IDS: [], TRANSITIONS: {} };
  if (!DP) {
    require('../src/admin/clipdeck-panel.js');
    DP = window.SVClipDeckPanel;
  }
  return DP.panel();
}

function cfgOf() {
  const cfg = SV.defaultConfig();
  cfg.clipdeck.enabled = true;
  cfg.clipdeck.decks = [{ id: 'deck', name: 'A', rows: 2, cols: 2, rowNames: {}, colNames: {}, slots: [] }];
  cfg.images = { enabled: false, items: [{ id: 'i1', src: 'data:image/png;base64,AAA' }, { id: 'i2', src: '' }] };
  cfg.layers = [
    { id: 'lm', kind: 'media', name: 'Kamera', settings: { media: { source: 'webcam', fit: 'contain' } } },
    { id: 'lv', kind: 'visualizer', type: 'bars', name: 'Ön' },
    { id: 'lt', kind: 'visualizer', type: 'text', name: 'Yazı' },
    { id: 'lb', kind: 'background', type: 'plasma', name: 'Zemin' },
    { id: 'ls', kind: 'sprites', name: 'Logolar', settings: { images: { items: [{ id: 's1', src: '' }] } } },
  ];
  return cfg;
}

test('model: yuva hedefi kayıttan sağ çıkıyor', () => {
  const deck = CD.makeDeck({ rows: 1, cols: 1, slots: [{ row: 0, col: 0, type: 'video', ref: 'file:///a.mp4', target: 'layer:lm' }] });
  const again = CD.makeDeck(JSON.parse(JSON.stringify(CD.serializeDeck(deck))));
  assert.strictEqual(CD.getSlot(again, 0, 0).target, 'layer:lm');
  assert.strictEqual(CD.makeSlot({}).target, '');
});

test('hedef listesi: türe uygun yerler; metin katmanı shader hedefi değil', () => {
  const cfg = cfgOf();
  mount(cfg);
  const ids = (t) => DP.targetOptions(t).map((o) => o[0]);
  assert.deepStrictEqual(ids('video'), ['media', 'layer:lm']);
  assert.deepStrictEqual(ids('shader'), ['vis', 'bg', 'layer:lv', 'layer:lb']);
  assert.deepStrictEqual(ids('image'), ['img:i1', 'img:i2', 'limg:ls:s1']);
  assert.deepStrictEqual(ids('scene'), []);
});

test('video: ana medyaya ya da medya katmanına; katmanın diğer ayarları korunuyor', () => {
  const cfg = cfgOf();
  mount(cfg);
  assert.ok(DP.applyRef('video', 'file:///clip.mp4', 'media'));
  assert.deepStrictEqual([cfg.media.source, cfg.media.file, cfg.media.enabled], ['file', 'file:///clip.mp4', true]);
  assert.ok(DP.applyRef('video', 'file:///b.mp4', 'layer:lm'));
  assert.deepStrictEqual(cfg.layers[0].settings.media, { source: 'file', fit: 'contain', file: 'file:///b.mp4', enabled: true });
});

test('shader: ana görselleştirici, ana arkaplan ya da katman', () => {
  const cfg = cfgOf();
  mount(cfg);
  assert.ok(DP.applyRef('shader', 'pv', 'vis'));
  assert.deepStrictEqual([cfg.visualizer.type, cfg.custom.visualizerId], ['custom', 'pv']);
  assert.ok(DP.applyRef('shader', 'pb', 'bg'));
  assert.deepStrictEqual([cfg.background.type, cfg.custom.backgroundId], ['custom', 'pb']);
  assert.ok(DP.applyRef('shader', 'pb', 'layer:lb'));
  assert.deepStrictEqual([cfg.layers[3].type, cfg.layers[3].presetId], ['custom', 'pb']);
});

test('görsel: nesnenin resmini değiştiriyor (ana liste ve sprite katmanı)', () => {
  const cfg = cfgOf();
  mount(cfg);
  assert.ok(DP.applyRef('image', 'data:image/png;base64,BBB', 'img:i2'));
  assert.strictEqual(cfg.images.items[1].src, 'data:image/png;base64,BBB');
  assert.strictEqual(cfg.images.enabled, true);
  assert.ok(DP.applyRef('image', 'data:image/png;base64,CCC', 'limg:ls:s1'));
  assert.strictEqual(cfg.layers[4].settings.images.items[0].src, 'data:image/png;base64,CCC');
});

test('silinmiş hedef ilk uygun hedefe düşüyor; hedef yoksa uygulanmıyor', () => {
  const cfg = cfgOf();
  mount(cfg);
  assert.ok(DP.applyRef('video', 'file:///c.mp4', 'layer:gitti'));
  assert.strictEqual(cfg.media.file, 'file:///c.mp4', 'ilk hedef: ana medya');
  cfg.images.items = [];
  cfg.layers = [];
  const before = JSON.stringify(cfg.images);
  assert.strictEqual(DP.applyRef('image', 'data:image/png;base64,X', ''), false);
  assert.strictEqual(JSON.stringify(cfg.images), before);
});

test('ateşlenen medya yuvası kendi hedefine uygulanıyor', () => {
  const cfg = cfgOf();
  cfg.clipdeck.defaultQuantize = 'off';
  cfg.clipdeck.decks[0].slots = [{ row: 0, col: 0, type: 'shader', ref: 'pb', target: 'layer:lb', quantize: 'off' }];
  mount(cfg);
  const e = DP.engine();
  DP.launchSlot(0, 0);
  e.update(1e6, TL.makeTempoMap([{ t: 0, bpm: 120 }]));
  assert.deepStrictEqual([cfg.layers[3].type, cfg.layers[3].presetId], ['custom', 'pb']);
  assert.notStrictEqual(cfg.visualizer.type, 'custom', 'ana görselleştiriciye dokunulmadı');
});

test('düzenleyici: boş yuvada altı tür; görsel yuvası nesne yoksa ne yapılacağını söylüyor', () => {
  const cfg = cfgOf();
  DP._select({ row: 1, col: 1 });
  let root = mount(cfg);
  const typeBtns = [];
  walk(root, (n) => { if (n.tag === 'button' && n.props.title === 'Bu türde bir yuva oluştur') typeBtns.push(n.text); });
  assert.strictEqual(typeBtns.length, 6, typeBtns.join(','));
  cfg.images.items = [];
  cfg.layers = [];
  cfg.clipdeck.decks[0].slots = [{ row: 1, col: 1, type: 'image', ref: '' }];
  root = mount(cfg);
  assert.ok(find(root, (n) => /henüz nesne yok/.test(n.text)), 'yol gösteren not');
  assert.ok(find(root, (n) => n.tag === 'button' && /Görsel Seç/.test(n.text)), 'görsel seçme düğmesi');
});
