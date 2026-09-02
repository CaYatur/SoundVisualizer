'use strict';
/* Katman listesi: sıra sözleşmesi ve yığın anahtarı.

   Sıra testinin sebebi somut: panel listeyi dizi sırasında çiziyordu, oysa
   dizinin 0. öğesi EN ALTA boyanıyor. Kullanıcının "en üstteki" dediği katman
   görüntüde en alttaydı. Düzeltme dizide değil gösterimde yapıldı — çünkü
   gruplar, A/B çapraz geçişi ve maske hedefleri hep aynı diziye indeksle
   bakıyor. Aşağıdaki testler o sözleşmeyi sabitliyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js'); // window.SV — birleştirme testleri için
const L = require('../src/visualizer/layers.js');

const baseCfg = () => ({
  background: { type: 'gradient' },
  visualizer: { type: 'bars' },
  media: { enabled: false },
  images: { enabled: false },
  logo: { enabled: false },
  layers: [],
});

// --------------------------------------------------------------- sıralama
test('sentezlenen liste alttan üste sıralanır', () => {
  const cfg = baseCfg();
  cfg.logo = { enabled: true, src: 'data:,x' };
  const out = L.synthesize(cfg);
  const kinds = out.map((l) => l.kind);
  assert.deepStrictEqual(kinds, ['background', 'visualizer', 'logo']);
  // 0. öğe en altta boyanır, son öğe en üstte
  assert.strictEqual(kinds[0], 'background', 'arkaplan en altta olmalı');
  assert.strictEqual(kinds[kinds.length - 1], 'logo', 'logo en üstte olmalı');
});

test('medya katmanı öne alındığında görselleştiricinin üstüne çıkar', () => {
  const cfg = baseCfg();
  cfg.media = { enabled: true, layer: 'front' };
  const kinds = L.synthesize(cfg).map((l) => l.kind);
  assert.ok(kinds.indexOf('media') > kinds.indexOf('visualizer'), kinds.join(' > '));
});

test('medya katmanı arkada kaldığında görselleştiricinin altında kalır', () => {
  const cfg = baseCfg();
  cfg.media = { enabled: true, layer: 'back' };
  const kinds = L.synthesize(cfg).map((l) => l.kind);
  assert.ok(kinds.indexOf('media') < kinds.indexOf('visualizer'), kinds.join(' > '));
});

// ---------------------------------------------------------- yığın anahtarı
test('yığın kapalıyken liste korunur ama sahne sentezlenir', () => {
  const cfg = baseCfg();
  cfg.layers = [{ id: 'a', kind: 'visualizer', type: 'wave' }];
  cfg.layerStack = { enabled: false };
  const out = L.resolve(cfg);
  assert.strictEqual(cfg.layers.length, 1, 'liste silinmemeli');
  assert.ok(out.every((l) => l.id !== 'a'), 'kapalıyken kullanıcı katmanı çizilmemeli');
  assert.deepStrictEqual(out.map((l) => l.kind), ['background', 'visualizer']);
});

test('yığın açıkken kullanıcı listesi kullanılır', () => {
  const cfg = baseCfg();
  cfg.layers = [{ id: 'a', kind: 'visualizer', type: 'wave' }];
  cfg.layerStack = { enabled: true };
  const out = L.resolve(cfg);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'a');
});

test('anahtar hiç yoksa dolu liste açık sayılır (eski ayar dosyaları)', () => {
  const cfg = baseCfg();
  cfg.layers = [{ id: 'a', kind: 'visualizer', type: 'wave' }];
  delete cfg.layerStack;
  assert.strictEqual(L.stackOn(cfg), true);
  assert.strictEqual(L.resolve(cfg)[0].id, 'a');
});

/* Bu test gerçek yükleme yolunu taklit ediyor.

   Panel kaydedilmiş ayarları deepMerge(defaultConfig(), saved) ile açıyor,
   yani eksik anahtarlar VARSAYILANDAN dolar. Varsayılan `enabled: false`
   olsaydı v3.0.0 öncesi her ayar dosyası açıkça false alır ve dolu bir
   katman listesi olan kullanıcının sahnesi sessizce arkaplan+görselleştirici
   ikilisine dönerdi. Anahtarı yalnızca silerek test etmek bu yolu HİÇ
   denemiyordu; aşağıdaki birleştirme onu deniyor. */
test('v3.0.0 öncesi ayar dosyası varsayılanlarla birleşince katmanlarını korur', () => {
  const SV = global.window.SV || require('../src/shared/defaults.js');
  const kaydedilmis = {
    background: { type: 'gradient' },
    visualizer: { type: 'bars' },
    layers: [
      { id: 'a', kind: 'visualizer', type: 'wave' },
      { id: 'b', kind: 'background', type: 'nebula' },
    ],
  };
  const cfg = SV.deepMerge(SV.defaultConfig(), kaydedilmis);
  assert.strictEqual(L.stackOn(cfg), true, 'yığın açık kalmalı');
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.id), ['a', 'b']);
});

test('katmanı olmayan eski ayar dosyası yalın sahnede kalır', () => {
  const SV = global.window.SV || require('../src/shared/defaults.js');
  const cfg = SV.deepMerge(SV.defaultConfig(), { background: { type: 'gradient' }, visualizer: { type: 'bars' } });
  assert.strictEqual(L.stackOn(cfg), false);
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.kind), ['background', 'visualizer']);
});

test('anahtar hiç yoksa boş liste kapalı sayılır', () => {
  const cfg = baseCfg();
  delete cfg.layerStack;
  assert.strictEqual(L.stackOn(cfg), false);
});

// ------------------------------------------------------ görünürlük kuralları
test('kapalı ve sessiz katmanlar çizilmez', () => {
  const cfg = baseCfg();
  cfg.layerStack = { enabled: true };
  cfg.layers = [
    { id: 'a', kind: 'visualizer', enabled: false },
    { id: 'b', kind: 'visualizer', muted: true },
    { id: 'c', kind: 'visualizer' },
  ];
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.id), ['c']);
});

test('solo varken yalnızca solo katmanlar çizilir', () => {
  const cfg = baseCfg();
  cfg.layerStack = { enabled: true };
  cfg.layers = [
    { id: 'a', kind: 'visualizer' },
    { id: 'b', kind: 'visualizer', solo: true },
    { id: 'c', kind: 'visualizer' },
  ];
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.id), ['b']);
});

test('solo katman sıradaki yerini korur', () => {
  const cfg = baseCfg();
  cfg.layerStack = { enabled: true };
  cfg.layers = [
    { id: 'a', kind: 'background', solo: true },
    { id: 'b', kind: 'visualizer' },
    { id: 'c', kind: 'logo', solo: true },
  ];
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.id), ['a', 'c']);
});

// ------------------------------------------------------------ grup kazancı
test('grup opaklığı katmana çarpan olarak iner', () => {
  const cfg = baseCfg();
  cfg.layerGroups = { alt: { opacity: 0.5 } };
  const g = L.groupGain(cfg, L.normalizeLayer({ kind: 'visualizer', group: 'alt' }));
  assert.ok(Math.abs(g - 0.5) < 1e-9, String(g));
});

test('sessiz grup katmanı tamamen gizler', () => {
  const cfg = baseCfg();
  cfg.layerGroups = { alt: { opacity: 1, muted: true } };
  assert.strictEqual(L.groupGain(cfg, L.normalizeLayer({ kind: 'visualizer', group: 'alt' })), 0);
});

test('grupsuz katman grup ayarlarından etkilenmez', () => {
  const cfg = baseCfg();
  cfg.layerGroups = { alt: { opacity: 0, muted: true } };
  assert.strictEqual(L.groupGain(cfg, L.normalizeLayer({ kind: 'visualizer' })), 1);
});
