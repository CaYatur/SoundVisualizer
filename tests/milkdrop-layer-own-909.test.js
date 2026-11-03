'use strict';
/* MILKDROP KATMANININ KENDİ PRESETİ (#909). Panel gerçek kodla, sahte DOM'da
   koşuyor; liste gerçek gibi metinsiz (#906). Seçimin nereye gittiği ve neye
   dokunmadığı burada sınanıyor; iki pencerede iki katmanın gerçekten farklı
   çizdiği canlı denetlendi. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
window.SVMilkdropCycle = require('../src/shared/milkdrop-cycle.js');
window.SVMilkdropLibrary = require('../src/shared/milkdrop-library.js');
const { leanPresets } = require('../src/shared/preset-lean.js');
const L = require('../src/visualizer/layers.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8').replace(/\r\n/g, '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => new Promise((r) => setImmediate(r));

const library = () => ['Alfa', 'Beta', 'Gama', 'Delta'].map((name, i) => ({
  id: 'u_' + name.toLowerCase(), name, kind: 'milkdrop', source: '[preset00]\nzoom=1.0' + i + '\n',
}));

function mkNode(tag, props, kids) {
  const n = { tag, attrs: {}, kids: [], on: {}, text: '', className: '', props: props || {} };
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.text = v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') n.on[k.slice(2)] = v;
    else if (v !== false && v != null) n.attrs[k] = String(v);
  }
  n.appendChild = (c) => { n.kids.push(c); return c; };
  n.addEventListener = (ev, f) => { n.on[ev] = f; };
  n.getAttribute = (k) => (k in n.attrs ? n.attrs[k] : null);
  n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
  n.removeAttribute = (k) => { delete n.attrs[k]; };
  n.focus = () => {};
  n.setSelectionRange = () => {};
  n.classList = {
    add: (...c) => { const s = new Set(n.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); n.className = [...s].join(' '); },
    remove: (...c) => { n.className = n.className.split(/\s+/).filter((x) => x && c.indexOf(x) < 0).join(' '); },
    contains: (c) => n.className.split(/\s+/).indexOf(c) >= 0,
    toggle: (c, on) => { if (on) n.classList.add(c); else n.classList.remove(c); },
  };
  const match = (x, sel) => (sel[0] === '.' ? x.className && x.className.split(/\s+/).indexOf(sel.slice(1)) >= 0 : x.tag === sel);
  n.querySelectorAll = (sel) => { const out = []; walk(n, (x) => { if (x !== n && match(x, sel)) out.push(x); }); return out; };
  n.querySelector = (sel) => n.querySelectorAll(sel)[0] || null;
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = v; n.kids = []; } });
  (kids || []).forEach((c) => c && n.kids.push(c));
  return n;
}
function walk(n, f) {
  if (!n || typeof n !== 'object') return;
  f(n);
  (n.kids || []).forEach((k) => walk(k, f));
  if (n.node) walk(n.node, f);
}
const findAll = (r, pred) => { const out = []; walk(r, (x) => { if (pred(x)) out.push(x); }); return out; };

async function fresh(layers) {
  delete require.cache[require.resolve('../src/admin/milkdrop-panel.js')];
  const cfg = window.SV.defaultConfig();
  cfg.layerStack = Object.assign({}, cfg.layerStack, { enabled: true });
  cfg.layers = layers;
  cfg.milkdrop = Object.assign({}, cfg.milkdrop, { presetId: 'u_alfa', name: 'Alfa', source: library()[0].source });
  const sections = mkNode('div', { id: 'sections' });
  const lib = library();
  const toasts = [];
  global.localStorage = { getItem: () => null, setItem() {} };
  global.document = {
    querySelector: (sel) => sections.querySelector(sel),
    getElementById: (id) => (id === 'sections' ? sections : null),
    activeElement: null,
  };
  window.SVPresets = undefined;
  window.SVMdFollow = null;
  window.SVI18n = undefined;
  window.SVMilkdropBuiltins = [];
  window.api = {
    listPresets: () => Promise.resolve(leanPresets(lib)),
    milkdropPresetSource: (id) => { const r = lib.find((x) => x.id === id); return Promise.resolve(r ? r.source : ''); },
    onMilkdropThumb() {}, onPresetsDelta() {},
  };
  window.SVPanel = {
    cfg: () => cfg, apply() {}, push() {}, rerender() {}, el: mkNode,
    row: (label, node) => ({ label, node, kids: [node] }),
    toast: (m, k) => toasts.push([m, k]), confirm: () => Promise.resolve(true),
  };
  window.SVScenePanels = { miniSlider: (label) => ({ label, kids: [] }) };
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await wait(5);
  const draw = () => { sections.kids = [M.panel()]; return sections; };
  const row = (name) => findAll(draw(), (n) => n.className === 'md-name' && n.text === name)[0];
  const click = async (name) => { const b = row(name); assert.ok(b, 'satır yok: ' + name); b.on.click(); await settle(); };
  return { M, cfg, lib, toasts, draw, click, row };
}

const mdLayer = (id, name) => ({ id, name, kind: 'visualizer', type: 'milkdrop', enabled: true, settings: {} });
const selector = (r) => findAll(r, (n) => n.label === 'Seçim Nereye')[0];

test('bağımsız katman yokken seçim eskisi gibi ortak ayara gidiyor', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const { cfg, lib, click, draw } = await fresh([a, b]);
  await click('Beta');
  assert.strictEqual(cfg.milkdrop.presetId, 'u_beta');
  assert.strictEqual(cfg.milkdrop.source, lib[1].source);
  assert.deepStrictEqual(a.settings, {});
  assert.deepStrictEqual(b.settings, {});
  assert.strictEqual(selector(draw()), undefined, 'gereksiz seçici');
});

test('Kendi Preseti açılınca ortak presetin kopyasıyla başlıyor, seçim o katmana gidiyor', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const { M, cfg, lib, click, draw } = await fresh([a, b]);
  M.setLayerOwn(cfg, b, true);
  assert.deepStrictEqual(b.settings.milkdrop, { independent: true, presetId: 'u_alfa', name: 'Alfa', source: lib[0].source });
  await click('Gama');
  assert.strictEqual(b.settings.milkdrop.presetId, 'u_gama');
  assert.strictEqual(b.settings.milkdrop.source, lib[2].source, 'metin de katmana');
  assert.strictEqual(b.settings.milkdrop.independent, true);
  assert.strictEqual(cfg.milkdrop.presetId, 'u_alfa', 'ortak seçim değişti');
  assert.strictEqual(cfg.milkdrop.source, lib[0].source);
  assert.deepStrictEqual(a.settings, {}, 'öteki katman değişti');
  assert.ok(selector(draw()));
});

test('seçiciyle ortak katmanlara dönülüyor; iki katman iki ayrı preset tutuyor', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const c = mdLayer('c', 'Üç');
  const { M, cfg, lib, click, draw } = await fresh([a, b, c]);
  M.setLayerOwn(cfg, b, true);
  await click('Beta');
  M.setLayerOwn(cfg, c, true);
  await click('Gama');
  assert.strictEqual(b.settings.milkdrop.presetId, 'u_beta');
  assert.strictEqual(c.settings.milkdrop.presetId, 'u_gama');
  const sel = selector(draw()).node;
  sel.value = '';
  sel.on.change();
  await click('Delta');
  assert.strictEqual(cfg.milkdrop.presetId, 'u_delta');
  assert.strictEqual(cfg.milkdrop.source, lib[3].source);
  assert.strictEqual(b.settings.milkdrop.presetId, 'u_beta');
  assert.strictEqual(c.settings.milkdrop.presetId, 'u_gama');
});

test('etkin satır hedefin preseti', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const { M, cfg, click, draw } = await fresh([a, b]);
  M.setLayerOwn(cfg, b, true);
  await click('Gama');
  const active = findAll(draw(), (n) => n.className && /(^| )md-item( |$)/.test(n.className) && /active/.test(n.className));
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].kids.find((k) => k && k.className === 'md-name').text, 'Gama');
});

test('Kendi Preseti kapanınca katman ortak presete dönüyor, seçim de ortak ayara', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const { M, cfg, click } = await fresh([a, b]);
  M.setLayerOwn(cfg, b, true);
  await click('Gama');
  M.setLayerOwn(cfg, b, false);
  assert.strictEqual(b.settings.milkdrop, undefined);
  await click('Delta');
  assert.strictEqual(cfg.milkdrop.presetId, 'u_delta');
});

test('hepsi bağımsızsa ortak seçenek yok: ortak seçim ekranda görünmezdi', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const { M, cfg, click, draw } = await fresh([a, b]);
  M.setLayerOwn(cfg, a, true);
  M.setLayerOwn(cfg, b, true);
  M.pickFor('');
  const sel = selector(draw()).node;
  assert.deepStrictEqual(sel.kids.map((o) => o.attrs.value), ['a', 'b']);
  await click('Beta');
  assert.strictEqual(a.settings.milkdrop.presetId, 'u_beta', 'ilk katman hedef');
  assert.strictEqual(cfg.milkdrop.presetId, 'u_alfa');
});

test('art arda seçimde son seçim kazanıyor, metin okunamazsa katman bozulmuyor', async () => {
  const a = mdLayer('a', 'Bir');
  const b = mdLayer('b', 'İki');
  const { M, cfg, lib, toasts, row } = await fresh([a, b]);
  M.setLayerOwn(cfg, b, true);
  const r1 = row('Beta');
  const r2 = row('Gama');
  r1.on.click();
  r2.on.click();
  await settle();
  assert.strictEqual(b.settings.milkdrop.presetId, 'u_gama');
  lib.splice(lib.findIndex((p) => p.id === 'u_beta'), 1);
  r1.on.click();
  await settle();
  assert.strictEqual(b.settings.milkdrop.presetId, 'u_gama');
  assert.strictEqual(toasts[toasts.length - 1][1], 'err');
});

test('ortak seçim barları MilkDrop\'a çevirmiyor: ortak katman zaten varsa ona gidiyor', async () => {
  const bars = { id: 'v', name: 'Barlar', kind: 'visualizer', type: 'bars', enabled: true, settings: {} };
  const a = mdLayer('a', 'Bir');
  const { cfg, click } = await fresh([bars, a]);
  await click('Beta');
  assert.strictEqual(bars.type, 'bars');
  assert.strictEqual(a.type, 'milkdrop');
  assert.strictEqual(cfg.milkdrop.presetId, 'u_beta');
});

test('MilkDrop katmanı yokken tek görselleştirici çevriliyor, bağımsız katmana dokunulmuyor', async () => {
  const bars = { id: 'v', name: 'Barlar', kind: 'visualizer', type: 'bars', enabled: true, settings: {} };
  const own = mdLayer('o', 'Kendi');
  own.settings.milkdrop = { independent: true, presetId: 'u_beta', name: 'Beta', source: 'x' };
  const { M, cfg } = await fresh([own, bars]);
  M.pointStackAtMilkdrop(cfg);
  assert.strictEqual(bars.type, 'milkdrop');
  assert.strictEqual(own.settings.milkdrop.presetId, 'u_beta');
});

test('motor: kendi geçişi kapalı bağımsız katman presetinde duruyor, lideri izlemiyor', () => {
  const E = read('src/visualizer/modes/milkdrop.js');
  const own = E.indexOf("if (own && cfg.milkdrop.ownAuto !== true) {");
  assert.ok(own > 0);
  assert.ok(own < E.indexOf('const FOLLOW_MS = 1500;'), 'izleme denetiminden önce');
  assert.ok(own > E.indexOf('const trackNew = this._trackChanged();'), 'parça takibi durmasın');
});

test('yığın: ortak seçimi bağımsız katman temsil etmiyor', () => {
  global.document = { createElement: () => ({ style: {}, getContext: () => null, classList: { add() {} } }) };
  const stack = new L.LayerStack(null, {});
  const live = (id) => ({ livePreset: () => ({ id }) });
  stack.entries = [
    { layer: { settings: { milkdrop: { independent: true } } }, mode: live('kendi') },
    { layer: { settings: {} }, mode: live('ortak') },
  ];
  assert.deepStrictEqual(stack.milkdropPreset(), { id: 'ortak' });
  stack.entries = [{ layer: { settings: { milkdrop: { independent: true } } }, mode: live('kendi') }];
  assert.strictEqual(stack.milkdropPreset(), null);
});

test('katman kartı: MilkDrop\'ta renk ve parlama yok, hassasiyet var', () => {
  const S = read('src/admin/scene-panels.js');
  const a = S.indexOf("if (l.kind === 'visualizer' && l.type === 'milkdrop') {");
  assert.ok(a > 0);
  const b = S.indexOf("if (l.kind === 'nowplaying' || (l.kind === 'visualizer' && l.type !== 'none' && l.type !== 'custom')) {");
  assert.ok(a < b, 'genel bloktan önce dönmeli');
  const block = S.slice(a, b);
  assert.match(block, /return out;/);
  assert.match(block, /miniSlider\('Hassasiyet'/);
  assert.doesNotMatch(block, /Renk Modu|Parlama/);
  // Motor gerçekten yalnız duyarlılığı okuyor; yeni okuma başlarsa kart da değişmeli
  const E = read('src/visualizer/modes/milkdrop.js');
  const reads = new Set((E.match(/cfg\.visualizer\.[a-zA-Z]+/g) || []).map((x) => x.split('.')[2]));
  assert.deepStrictEqual([...reads], ['sensitivity']);
});

test('ana süreç: kaydedilen presetin metni katmanın kopyasına da gidiyor', () => {
  const M = read('src/main/main.js');
  const fn = M.slice(M.indexOf('function followActivePreset(upsert) {'), M.indexOf('function broadcastPresetDelta('));
  assert.match(fn, /l\.settings\.milkdrop = follow\(l\.settings\.milkdrop\);/);
  assert.match(fn, /currentConfig\.milkdrop = follow\(currentConfig\.milkdrop\);/);
  assert.match(fn, /if \(!changed\) return;/);
});

test('metinler çevrilmiş', () => {
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Kendi Preseti', 'Seçim Nereye', 'Ortak katmanlar', 'Listeden seçilen preset bu katmana gider.', 'Kapalıyken ortak preseti gösterir.', 'MilkDrop Presetleri kartında bu katman için seçin']) {
    assert.ok(i18n.includes("'" + s + "':"), s);
  }
});
