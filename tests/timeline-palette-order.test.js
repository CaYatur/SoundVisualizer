'use strict';
/* Renk şablonu klipleri: yalnız t anında etkin olanlar uygulanır; alt
 * parçadaki Gece bitince / henüz başlamadan üstteki Orman yeniden yazılır.
 * Seçim ateşlemeyi ezmez. Anında uygula kapalıyken de oynatma yolu doğru. */
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../src/shared/defaults.js');
const SV = global.window.SV;
const TL = require('../src/shared/timeline.js');
const TE = require('../src/shared/timeline-edit.js');
window.SVTimeline = TL;
window.SVClipDeck = require('../src/shared/clipdeck.js');
window.SVTimelineEdit = TE;

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
    n.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 40 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const walk = (n, f) => { if (!n || typeof n !== 'object') return; f(n); (n.kids || []).forEach((k) => walk(k, f)); };
const find = (root, pred) => { let r = null; walk(root, (n) => { if (!r && pred(n)) r = n; }); return r; };

const winOn = {};
window.addEventListener = (ev, f) => { (winOn[ev] = winOn[ev] || []).push(f); };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { documentElement: {}, querySelector: () => null, body: { classList: { toggle() {} } }, addEventListener() {} };
const intervals = [];
const realSetInterval = global.setInterval;
global.setInterval = (f, ms) => { const id = realSetInterval(f, ms); intervals.push(id); return id; };
test.after(() => intervals.forEach((id) => clearInterval(id)));

const fired = [];
function setup(cfg) {
  window.SVPanel = {
    cfg: () => cfg, el,
    row: (label, node) => el('div', { class: 'row' }, [el('label', { text: label }), node]),
    push() {}, apply() {}, rerender() {}, confirm: () => Promise.resolve(true), toast() {},
    actions: () => ({ applyScene() {} }),
  };
  window.SVClipDeckPanel = {
    applyRef: (type, ref) => { fired.push([type, ref]); },
    applyFaded: (type, ref, fade) => { fired.push([type, ref, fade]); },
    targetOptions: () => [],
    resolveTarget: () => null,
    mediaPicker: () => el('div'),
    slotLabel: (s) => s.ref,
    refOptions: () => null,
  };
}

function forestNightCfg(extra) {
  const cfg = SV.defaultConfig();
  Object.assign(cfg.timeline, {
    enabled: true,
    applyEditsImmediately: false,
    snap: 'off',
    zoom: 60,
    scroll: 0,
    followPlayhead: false,
    tracks: [
      { id: 'trForest', kind: 'clip', name: 'Parça 2', clips: [
        { id: 'cForest', type: 'palette', ref: 'Orman', name: '', start: 0, dur: 4 },
      ] },
      { id: 'trNight', kind: 'clip', name: 'Track 3', clips: [
        { id: 'cNight', type: 'palette', ref: 'Gece', name: '', start: 2, dur: 4 },
      ] },
    ],
  }, extra || {});
  return cfg;
}

let TP = null;
async function mount(cfg) {
  setup(cfg);
  if (!TP) {
    require('../src/admin/timeline-panel.js');
    TP = window.SVTimelinePanel;
  }
  TP._select(null);
  fired.length = 0;
  const host = el('div', { class: 'host' });
  host.appendChild(TP.panel());
  await wait(5);
  TP.stop(); // önceki testten kalan lastAppliedClip temizlensin
  fired.length = 0;
  return { host, TP };
}

test('activeClipsAt: Gece başlamadan yalnız Orman etkin', () => {
  const tl = TL.makeTimeline(forestNightCfg().timeline);
  const at07 = TL.activeClipsAt(tl, 0.7);
  assert.strictEqual(at07.length, 1);
  assert.strictEqual(at07[0].clip.ref, 'Orman');
  const at25 = TL.activeClipsAt(tl, 2.5);
  assert.strictEqual(at25.length, 2);
  assert.deepStrictEqual(at25.map((e) => e.clip.ref), ['Orman', 'Gece']);
  const at45 = TL.activeClipsAt(tl, 4.5);
  assert.strictEqual(at45.length, 1);
  assert.strictEqual(at45[0].clip.ref, 'Gece');
});

test('clipLabel: yerleşik Orman İngilizcede Forest; özel ad çevrilmez', async () => {
  const cfg = forestNightCfg();
  await mount(cfg);
  const vm = require('vm');
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/shared/i18n.js'), 'utf8');
  function loadT(locale) {
    const doc = { documentElement: { lang: '' }, readyState: 'complete', title: '', body: {}, addEventListener() {} };
    const win = {
      navigator: { languages: [locale], language: locale },
      localStorage: { getItem: () => locale, setItem() {} },
      alert() {}, confirm() {}, document: doc,
      MutationObserver: function () { this.observe = () => {}; },
      Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    };
    win.window = win;
    vm.runInContext(src, vm.createContext(win), { filename: 'i18n.js' });
    return win.SVI18n.t;
  }
  const en = loadT('en');
  const tr = loadT('tr-TR');
  assert.strictEqual(en('Orman'), 'Forest');
  assert.strictEqual(en('Gece'), 'Night');
  assert.strictEqual(tr('Orman'), 'Orman');
  // Panel clipLabel tt kullanıyor: boş ad + ref → çevrilmiş etiket
  window.SVI18n = { t: en, lang: () => 'en' };
  assert.strictEqual(TP._clipLabel({ type: 'palette', ref: 'Orman', name: '' }), 'Forest');
  assert.strictEqual(TP._clipLabel({ type: 'palette', ref: 'Orman', name: 'My Forest' }), 'My Forest');
  window.SVI18n = { t: tr, lang: () => 'tr' };
  assert.strictEqual(TP._clipLabel({ type: 'palette', ref: 'Orman', name: '' }), 'Orman');
});

/* Yalıtılmış mod: palet canlı yapılandırmaya YAZILMAZ; bileşimde zamanlı
   değiştirici. Seçim çıkışı etkilemez; geri sarınca Orman geri gelir. */
test('Timeline kullan: Orman/Gece sırası bileşimde, seçim etkisiz, geri sarma doğru', () => {
  global.window.SVTimeline = TL;
  require('../src/shared/schema.js');
  require('../src/visualizer/layers.js');
  const TC = require('../src/shared/timeline-compose.js');
  const cfg = forestNightCfg();
  cfg.scenes = [{ id: 'sc', data: { layerStack: { enabled: true }, layers: [{ id: 'bg', kind: 'background', type: 'gradient', enabled: true, opacity: 1 }] } }];
  cfg.timeline.tracks.push({ id: 'trS', kind: 'clip', name: 'S', clips: [{ id: 'cs', type: 'scene', ref: 'sc', start: 0, dur: 8 }] });
  const tl = TL.makeTimeline(cfg.timeline);
  const cols = (t) => TC.composeAt(cfg, tl, t).cfg.layers[0].settings.background.gradient.colors;
  const pal = (n) => SV.GRADIENT_PRESETS.find((g) => g.name === n).colors;
  assert.deepStrictEqual(cols(0.7), pal('Orman'));
  assert.deepStrictEqual(cols(2.5), pal('Orman'), 'üstteki parça (Orman) önde');
  assert.deepStrictEqual(cols(4.5), pal('Gece'));
  assert.deepStrictEqual(cols(0.7), pal('Orman'), 'geri sarınca Orman');
  assert.ok(!cfg.background.gradient.colors || JSON.stringify(cfg.background.gradient.colors) !== JSON.stringify(pal('Gece')), 'elle ayar yazılmadı');
});
