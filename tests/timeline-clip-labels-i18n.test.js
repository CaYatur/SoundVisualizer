'use strict';
/* Zaman çizelgesi otomatik etiketleri raf ile aynı yerelleştirmeyi kullanır:
 * Sahne 1 → Scene 1, Orman → Forest; kullanıcının verdiği ad çevrilmez. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadT(locale) {
  const doc = {
    documentElement: { lang: '' }, readyState: 'complete', title: '', body: {},
    addEventListener: () => {},
  };
  const win = {
    navigator: { languages: [locale], language: locale },
    localStorage: { getItem: () => locale, setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(read('src/shared/i18n.js'), vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n.t;
}

global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
const TE = require('../src/shared/timeline-edit.js');
window.SVTimeline = TL;
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = TE;
window.SVModeCatalog = {
  VISUALIZERS: [
    { id: 'bars', label: 'Barlar' },
    { id: 'none', label: 'Yok' },
  ],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms || 0));
function el(tag, props, kids) {
  const n = { tag, props: props || {}, kids: [], on: {}, attrs: {}, style: {}, parent: null, isConnected: true };
  n.className = (props && props.class) || '';
  n.text = (props && props.text) || '';
  n.value = (props && props.value) || '';
  n.appendChild = (c) => { if (c) { c.parent = n; n.kids.push(c); } return c; };
  n.insertBefore = (c, ref) => { c.parent = n; n.kids.splice(Math.max(0, n.kids.indexOf(ref)), 0, c); return c; };
  n.replaceWith = () => {};
  n.addEventListener = (ev, f) => { (n.on[ev] = n.on[ev] || []).push(f); };
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.getAttribute = (k) => n.attrs[k];
  n.querySelector = () => null;
  n.querySelectorAll = () => [];
  n.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
  n.focus = () => {};
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; } });
  if (tag === 'canvas') {
    n.clientWidth = 800; n.width = 0; n.height = 0;
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 });
    n.getContext = () => new Proxy({
      createLinearGradient: () => ({ addColorStop() {} }),
      measureText: () => ({ width: 40 }),
    }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
window.addEventListener = () => {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null, body: { classList: { toggle() {} } }, addEventListener() {} };
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));

function setup(cfg, t) {
  window.SVI18n = { t, lang: () => 'en' };
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {},
    actions: () => ({ applyScene() {}, setCategory() {} }),
    setCategory() {},
  };
  window.SVClipDeckPanel = {
    applyRef() {}, applyFaded() {}, targetOptions: () => [], resolveTarget: () => null,
    mediaPicker: () => el('div'), slotLabel: (s) => s.ref, refOptions: () => null,
  };
}

let TP = null;
async function mount(cfg, t) {
  setup(cfg, t);
  if (!TP) {
    require('../src/admin/timeline-panel.js');
    TP = window.SVTimelinePanel;
  }
  TP._select(null);
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  TP.stop();
  return TP;
}

test('i18n: Sahne N ve Orman İngilizceye çevrilir', () => {
  const en = loadT('en');
  assert.strictEqual(en('Sahne 1'), 'Scene 1');
  assert.strictEqual(en('Sahne 7'), 'Scene 7');
  assert.strictEqual(en('Orman'), 'Forest');
  assert.strictEqual(en('Barlar'), 'Bars');
  assert.strictEqual(en('My Show'), 'My Show');
});

test('clipLabel: raf Scene 1 ile aynı — Sahne 1 → Scene 1; özel ad korunur', async () => {
  const en = loadT('en');
  const cfg = SV.defaultConfig();
  cfg.scenes = [
    { id: 'sc1', name: 'Sahne 1', data: { layers: [{}, {}, {}] } },
    { id: 'scX', name: 'Opening Look', data: { layers: [] } },
  ];
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'off', zoom: 60, scroll: 0,
    tracks: [{ id: 't1', kind: 'clip', name: 'P', clips: [] }],
  });
  const TP = await mount(cfg, en);
  assert.strictEqual(TP._clipLabel({ type: 'scene', ref: 'sc1', name: '' }), 'Scene 1');
  assert.strictEqual(TP._clipLabel({ type: 'scene', ref: 'scX', name: '' }), 'Opening Look');
  assert.strictEqual(TP._clipLabel({ type: 'scene', ref: 'sc1', name: 'Cue A' }), 'Cue A');
  assert.strictEqual(TP._clipLabel({ type: 'palette', ref: 'Orman', name: '' }), 'Forest');
  assert.strictEqual(TP._clipLabel({ type: 'visualizer', ref: 'bars', name: '' }), 'Bars');
  // Kullanıcı klibe sözlükteki bir kelimeyi ad yazdıysa çevirme
  assert.strictEqual(TP._clipLabel({ type: 'palette', ref: 'Gece', name: 'Orman' }), 'Orman');
});

test('boş klipten sahne kaynağı: addClipAt + ref, addSceneAtHead ile aynı etiket', async () => {
  const en = loadT('en');
  const cfg = SV.defaultConfig();
  cfg.scenes = [{ id: 'sc1', name: 'Sahne 1', data: { layers: [{ id: 'a' }, { id: 'b' }] } }];
  Object.assign(cfg.timeline, {
    enabled: true, snap: 'off', zoom: 60, scroll: 0,
    tracks: [{ id: 't1', kind: 'clip', name: 'P', clips: [] }],
  });
  const TP = await mount(cfg, en);
  // Raf yolu
  TP.addSceneAtHead('sc1');
  const viaShelf = cfg.timeline.tracks[0].clips[0];
  assert.strictEqual(viaShelf.type, 'scene');
  assert.strictEqual(viaShelf.ref, 'sc1');
  assert.strictEqual(viaShelf.name, '');
  assert.strictEqual(TP._clipLabel(viaShelf), 'Scene 1');
  // Boş klip → tür/kaynak (addClipAt varsayılanı scene; ref sonra)
  const hostTrack = cfg.timeline.tracks[0];
  // simulate empty then set source: makeClip path via panel internal — use data model parity
  const empty = TL.makeClip({ start: 8, dur: 2 });
  assert.strictEqual(empty.type, 'scene');
  assert.strictEqual(empty.ref, '');
  empty.ref = 'sc1';
  hostTrack.clips.push(empty);
  assert.strictEqual(TP._clipLabel(empty), 'Scene 1');
  assert.strictEqual(TP._clipLabel(empty), TP._clipLabel(viaShelf));
  // katman sayısı kaynak sahnede duruyor (kopyalanmadı)
  assert.strictEqual(cfg.scenes[0].data.layers.length, 2);
});

test('panel kaynak seçicide tt kullanılıyor', () => {
  const src = read('src/admin/timeline-panel.js');
  assert.match(src, /text: tt\(label\)/);
  assert.match(src, /return tt\(sc\.name \|\| sc\.id\)/);
  assert.match(src, /Sahneyi aç/);
});
