'use strict';
/* MilkDrop preset üreticisinin arayüzü (#579).
 *
 * Üretilen preset KAYDEDİLMEDEN yükleniyor. Kaydedilmemiş bir kimliğin
 * dokunduğu her yol burada: puan, favori ve etiket yazılmıyor (kayıt
 * kütüphanede olmayan bir kimliğe yapışıp kalırdı), ◀ geçmişteki kaydı
 * atlıyor, "Kaydet" ekrandakini değil üreticinin son sonucunu yazıyor ve
 * kaydedilince aynı kimlik listeye girip düğmeler açılıyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
require('../src/shared/milkdrop-cycle.js');
require('../src/shared/milkdrop-library.js');
const G = require('../src/shared/milkdrop-generator.js');

const SV = global.window.SV;
const milk = (r) => '[preset00]\nfRating=' + r + '\nfDecay=0.98\n';
const LIB = [
  { id: 'm1', name: 'Bir', kind: 'milkdrop', source: milk(5) },
  { id: 'm2', name: 'İki', kind: 'milkdrop', source: milk(4) },
];

// Sahte panel ortamı: el() öğeleri düz nesne olarak kuruyor, çocuklarıyla
async function fresh() {
  for (const f of ['../src/admin/milkdrop-panel.js', '../src/admin/milkdrop-gen.js']) {
    delete require.cache[require.resolve(f)];
  }
  const cfg = SV.defaultConfig();
  const el = (tag, props, kids) => ({ tag, props: props || {}, kids: kids || [] });
  const toasts = [];
  const saved = [];
  let applies = 0;
  window.SVMdGen = G;
  window.SVPresets = undefined;
  window.SVMdFollow = null;
  window.SVI18n = undefined;
  // Depo gibi: kaydedilen, sonraki listede
  window.api = {
    listPresets: () => Promise.resolve(LIB.concat(saved.map((p) => Object.assign({}, p)))),
    savePreset: (p) => {
      saved.push(p);
      return Promise.resolve({ ok: true, preset: Object.assign({}, p, { updatedAt: 1 }) });
    },
  };
  window.SVPanel = {
    cfg: () => cfg,
    apply() { applies++; },
    rerender() {},
    el,
    row: (label, node) => el('row', { label }, [node]),
    toast: (m, k) => toasts.push([m, k]),
  };
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  const GP = require('../src/admin/milkdrop-gen.js');
  return { M, GP, cfg, toasts, saved, applies: () => applies };
}

// Ağaçta koşulu sağlayan ilk düğüm
function find(node, pred) {
  if (!node || typeof node !== 'object') return null;
  if (pred(node)) return node;
  for (const k of node.kids || []) {
    const hit = find(k, pred);
    if (hit) return hit;
  }
  return null;
}
function findAll(node, pred, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object') return acc;
  if (pred(node)) acc.push(node);
  for (const k of node.kids || []) findAll(k, pred, acc);
  return acc;
}

function wrapStub() {
  const w = { kids: [], cls: {}, appendChild(k) { this.kids.push(k); }, classList: { toggle: (c, on) => { w.cls[c] = on; } } };
  Object.defineProperty(w, 'textContent', { set() { w.kids = []; }, get() { return ''; } });
  return w;
}

test('üretilen preset kaydedilmeden yükleniyor', async () => {
  const { GP, cfg, saved, applies } = await fresh();
  GP.regenerate();
  const last = GP.state().last;
  assert.ok(last && /^md_gen1_/.test(last.id));
  assert.strictEqual(cfg.milkdrop.presetId, last.id);
  assert.strictEqual(cfg.milkdrop.source, last.source);
  assert.strictEqual(cfg.milkdrop.name, last.name);
  assert.strictEqual(cfg.visualizer.type, 'milkdrop', 'sahne MilkDrop motoruna geçmeli');
  assert.ok(applies() > 0, 'yapılandırma gönderilmeli');
  assert.deepStrictEqual(saved, [], 'önizleme kütüphaneye yazılmamalı');
});

test('kaydedilmemiş önizlemede puan, favori ve etiket yazılmıyor', async () => {
  const { M, GP, cfg } = await fresh();
  GP.regenerate();
  const id = GP.state().last.id;
  const w = wrapStub();
  M.fillStars(w, cfg);
  assert.strictEqual(w.kids.length, 1);
  assert.strictEqual(w.kids[0].props.text, '—', 'yıldızlar yerine boş işaret');
  assert.strictEqual(M.act('Favorite'), false);
  assert.strictEqual(M.act('RateUp'), false);
  assert.strictEqual(M.act('RateDown'), false);
  const lib = cfg.milkdropLibrary || {};
  for (const k of ['ratings', 'favorites', 'tags']) {
    assert.ok(!lib[k] || !Object.prototype.hasOwnProperty.call(lib[k], id), k + ' kaydedilmemiş kimliğe yazıldı');
  }
});

test('önizleme yalnız kaynağı olan bir preseti yüklüyor', async () => {
  const { M, cfg } = await fresh();
  const before = JSON.stringify(cfg.milkdrop);
  assert.strictEqual(M.preview(null), false);
  assert.strictEqual(M.preview({ id: 'md_gen1_x' }), false);
  assert.strictEqual(M.preview({ id: '', source: '[preset00]\n' }), false);
  assert.strictEqual(JSON.stringify(cfg.milkdrop), before, 'geçersiz önizleme ayara dokunmamalı');
});

test('◀ geçmişteki kaydedilmemiş önizlemeyi atlıyor', async () => {
  const { M, GP, cfg } = await fresh();
  M.preview(LIB[0]);
  GP.regenerate();
  M.preview(LIB[1]);
  assert.strictEqual(cfg.milkdrop.presetId, 'm2');
  M.act('Prev');
  assert.strictEqual(cfg.milkdrop.presetId, 'm1', 'önizlemede durmamalı, ondan önceki presete dönmeli');
});

test('önizlemeden "sonraki" listenin başından sürüyor', async () => {
  const { M, GP, cfg } = await fresh();
  GP.regenerate();
  M.act('Next');
  assert.strictEqual(cfg.milkdrop.presetId, 'm1');
});

test('kaydedince aynı kimlik listeye giriyor ve favori açılıyor', async () => {
  const { M, GP, cfg, saved, toasts } = await fresh();
  GP.regenerate();
  const last = GP.state().last;
  await GP.save();
  assert.strictEqual(saved.length, 1);
  assert.deepStrictEqual(saved[0], {
    id: last.id, kind: 'milkdrop', name: last.name, source: last.source, author: 'Üretici',
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(toasts.some(([m, k]) => k === 'ok' && /kaydedildi/.test(m)), JSON.stringify(toasts));
  // Liste yenilendi: aynı kimlik artık tanınıyor
  assert.strictEqual(M.act('Favorite'), true);
  assert.strictEqual(cfg.milkdropLibrary.favorites[last.id], true);
  const w = wrapStub();
  M.fillStars(w, cfg);
  assert.strictEqual(w.kids.length, 6, 'kaydedilince yıldızlar açılmalı');
});

test('"Kaydet" ekrandakini değil üreticinin son sonucunu yazıyor', async () => {
  const { GP, cfg, saved } = await fresh();
  GP.regenerate();
  const last = GP.state().last;
  // Otomatik geçiş o arada başka bir presete geçti
  cfg.milkdrop.presetId = 'm2';
  cfg.milkdrop.source = LIB[1].source;
  cfg.milkdrop.name = LIB[1].name;
  await GP.save();
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].id, last.id);
  assert.strictEqual(saved[0].source, last.source);
});

test('aynı preseti iki kez kaydetmek aynı kimliği yazıyor', async () => {
  const { GP, saved } = await fresh();
  GP.regenerate();
  await GP.save();
  await GP.save();
  assert.strictEqual(saved.length, 2);
  assert.strictEqual(saved[0].id, saved[1].id, 'depo aynı dosyanın üstüne yazmalı');
});

test('kod alanı: geçersiz kod yüklemiyor, geçerli kod aynı preseti getiriyor', async () => {
  const { GP, cfg, toasts } = await fresh();
  const before = cfg.milkdrop.presetId;
  GP.fromCode('101-0-0-0-a');
  assert.strictEqual(cfg.milkdrop.presetId, before);
  assert.ok(toasts.some(([, k]) => k === 'err'));
  GP.fromCode(' 72-15-060-88-2N9C ');
  const d = G.decode('72-15-60-88-2n9c');
  const want = G.generate({ axes: d.axes, seed: d.seed });
  assert.strictEqual(cfg.milkdrop.presetId, 'md_gen1_72-15-60-88-2n9c');
  assert.strictEqual(cfg.milkdrop.source, want.source);
  assert.deepStrictEqual(GP.state().axes, d.axes);
});

test('kaydırıcı sürüklerken yüklemiyor, bırakınca aynı tohumla yüklüyor', async () => {
  const { GP, cfg } = await fresh();
  GP.fromCode('50-50-50-50-k3x9ab');
  const tree = GP.panel();
  const ranges = findAll(tree, (n) => n.tag === 'input' && n.props.type === 'range');
  assert.strictEqual(ranges.length, 4);
  const energy = ranges[0];
  const id0 = cfg.milkdrop.presetId;
  energy.props.oninput({ target: { value: '80' } });
  assert.strictEqual(cfg.milkdrop.presetId, id0, 'sürüklerken yeniden yüklenmemeli');
  energy.props.onchange({ target: { value: '80' } });
  assert.strictEqual(cfg.milkdrop.presetId, 'md_gen1_80-50-50-50-k3x9ab', 'tohum aynı kalmalı');
});

test('🎲 eksenleri bırakıp tohumu değiştiriyor', async () => {
  const { GP, cfg } = await fresh();
  GP.fromCode('30-60-40-70-abc');
  const btn = find(GP.panel(), (n) => n.tag === 'button' && /🎲/.test(String(n.props.text)));
  btn.props.onclick();
  const d = G.decode(cfg.milkdrop.presetId.replace(/^md_gen1_/, ''));
  assert.ok(d, cfg.milkdrop.presetId);
  assert.deepStrictEqual(d.axes, { energy: 30, warmth: 60, density: 40, motion: 70 });
  assert.notStrictEqual(d.seed, parseInt('abc', 36), 'tohum değişmeli');
  assert.strictEqual(GP.state().seed, d.seed);
});

test('ilk üretimden önce "Kaydet" kapalı; sonra açık ve durum yazıyor', async () => {
  const { GP } = await fresh();
  const btn = (tree) => find(tree, (n) => n.tag === 'button' && /Kaydet/.test(String(n.props.text)));
  assert.strictEqual(btn(GP.panel()).props.disabled, true);
  GP.regenerate();
  const tree = GP.panel();
  assert.strictEqual(btn(tree).props.disabled, false);
  assert.ok(find(tree, (n) => n.props && n.props.text === 'Önizleme — kaydedilmedi'));
  assert.ok(find(tree, (n) => n.props && n.props.text === GP.state().last.name));
});

test('kart bağlı: bölüm, denetim, betik sırası ve çeviriler', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');
  const admin = read('src/admin/admin.js');
  assert.match(admin, /case 'mdgenpanel':\s*\n\s*return window\.SVMdGenPanel \? window\.SVMdGenPanel\.panel\(\) : null;/);
  const i = admin.indexOf("id: 'mdgen',");
  assert.ok(i > 0, 'bölüm yok');
  const block = admin.slice(i, i + 600);
  assert.match(block, /category: 'studio'/);
  assert.match(block, /controls: \[\{ type: 'mdgenpanel' \}\]/);
  const title = /title: '([^']+)'/.exec(block)[1];
  const desc = /desc: '([^']+)'/.exec(block)[1];
  const i18n = read('src/shared/i18n.js');
  for (const s of [title, desc]) assert.ok(i18n.indexOf("'" + s + "':") >= 0, 'sözlükte yok: ' + s);
  const html = read('src/admin/index.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('../shared/milkdrop-generator.js') > 0, 'üretici yüklenmiyor');
  assert.ok(at('milkdrop-panel.js"') < at('milkdrop-gen.js"'), 'panel üreticiden önce yüklenmeli');
  assert.ok(at('../shared/milkdrop-generator.js') < at('milkdrop-gen.js"'));
  /* Karışım bölümü yalnız SVMdMix varsa çiziliyor: betik düşerse bölüm
     sessizce kaybolur, ne bir test ne duman testi düşerdi (#579). */
  assert.ok(at('../shared/milkdrop-mashup.js') > 0, 'karışım modülü yüklenmiyor');
  assert.ok(at('../shared/milkdrop-mashup.js') < at('milkdrop-gen.js"'), 'karışım modülü panelden sonra');
});
