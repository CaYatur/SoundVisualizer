'use strict';
/* PUAN VERİLMEMİŞ PRESET PUANSIZ GÖRÜNÜYOR (#587).
 *
 * Yıldızlar eskiden presetin kendi `fRating`ini gösteriyordu: hiç puan
 * verilmemiş bir preset beş yıldızla geliyordu (korpusun %95'i dosyada 5
 * yazıyor) ve bir puan verip başka presete geçince yıldızlar "bozuk"
 * görünüyordu. Artık yalnız kullanıcının verdiği puan yıldız oluyor.
 *
 * Seçim bundan ETKİLENMİYOR: rastgele sıra puan verilmemiş presette yine
 * dosyadaki puanı kullanıyor (MilkDrop'un kuralı). Testler ikisini birden
 * sabitliyor — gösterimi seçime "eşitlemek" için ağırlığı değiştiren biri
 * burada takılmalı. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
const C = require('../src/shared/milkdrop-cycle.js');

const SV = global.window.SV;
const milk = (r) => 'MILKDROP_PRESET_VERSION=201\n[preset00]\nfRating=' + r + '\nfDecay=0.98\n';
const LIB = [
  { id: 'm1', name: 'Beş', kind: 'milkdrop', source: milk(5) },
  { id: 'm2', name: 'Bir', kind: 'milkdrop', source: milk(1) },
  { id: 'm3', name: 'Sıfır', kind: 'milkdrop', source: milk(0) },
];

// Sahte panel ortamı: el() öğeleri düz nesne olarak kuruyor
async function freshPanel() {
  const key = require.resolve('../src/admin/milkdrop-panel.js');
  delete require.cache[key];
  const cfg = SV.defaultConfig();
  const el = (tag, props) => ({ tag, props: props || {} });
  window.api = { listPresets: () => Promise.resolve(LIB) };
  window.SVPanel = { cfg: () => cfg, apply() {}, rerender() {}, el, row: el };
  window.SVMdFollow = null;
  const M = require('../src/admin/milkdrop-panel.js');
  M.init();
  await new Promise((r) => setImmediate(r));
  return { M, cfg };
}

function wrapStub() {
  const w = {
    kids: [],
    cls: {},
    appendChild(k) { this.kids.push(k); },
    classList: { toggle: (c, on) => { w.cls[c] = on; } },
  };
  Object.defineProperty(w, 'textContent', { set() { w.kids = []; }, get() { return ''; } });
  return w;
}

const stars = (w) => w.kids.map((k) => k.props.text).join('');
const lit = (w) => w.kids.filter((k) => / on$| on /.test(k.props.class + ' ')).length;

test('puan verilmemiş preset boş görünüyor — dosyada 5 yazsa da', async () => {
  const { M, cfg } = await freshPanel();
  cfg.milkdrop.presetId = 'm1';
  const w = wrapStub();
  M.fillStars(w, cfg);
  assert.strictEqual(stars(w), '0☆☆☆☆☆');
  assert.strictEqual(lit(w), 0);
  assert.strictEqual(w.cls['md-unrated'], true);
});

test('dosyada 0 yazan preset "0" düğmesini yakmıyor', async () => {
  const { M, cfg } = await freshPanel();
  cfg.milkdrop.presetId = 'm3';
  const w = wrapStub();
  M.fillStars(w, cfg);
  assert.strictEqual(lit(w), 0, '0 kullanıcının verdiği puan değilse yanmamalı');
});

test('verilen puan yıldız oluyor, 0 da', async () => {
  const { M, cfg } = await freshPanel();
  cfg.milkdrop.presetId = 'm1';
  cfg.milkdropLibrary.ratings = { m1: 3 };
  const w = wrapStub();
  M.fillStars(w, cfg);
  assert.strictEqual(stars(w), '0★★★☆☆');
  assert.strictEqual(lit(w), 3);
  assert.strictEqual(w.cls['md-unrated'], false);
  cfg.milkdropLibrary.ratings = { m1: 0 };
  M.fillStars(w, cfg);
  assert.strictEqual(stars(w), '0☆☆☆☆☆');
  assert.strictEqual(lit(w), 1, 'yalnız 0 düğmesi');
});

test('başka presete geçince önceki puan taşınmıyor', async () => {
  const { M, cfg } = await freshPanel();
  cfg.milkdropLibrary.ratings = { m1: 4 };
  cfg.milkdrop.presetId = 'm1';
  const w = wrapStub();
  M.fillStars(w, cfg);
  assert.strictEqual(lit(w), 4);
  cfg.milkdrop.presetId = 'm2';
  M.fillStars(w, cfg);
  assert.strictEqual(stars(w), '0☆☆☆☆☆', 'puansız preset boş');
  assert.strictEqual(lit(w), 0);
});

test('seçim ağırlığı değişmedi: puan verilmemiş preset dosyasındaki puanla', () => {
  assert.strictEqual(C.ratingOf(LIB[0], {}), 5);
  assert.strictEqual(C.ratingOf(LIB[1], {}), 1);
  assert.strictEqual(C.ratingOf(LIB[2], {}), 0);
});

test('"artır" puansız bir preseti seyrekleştirmiyor: adım dosyadaki puandan', async () => {
  const { M, cfg } = await freshPanel();
  M.act('Next'); // m1, dosyada 5
  M.act('RateUp');
  assert.strictEqual(cfg.milkdropLibrary.ratings.m1, 5, 'boş yıldızdan 1\'e inmemeli');
  M.act('RateDown');
  assert.strictEqual(cfg.milkdropLibrary.ratings.m1, 4);
});
