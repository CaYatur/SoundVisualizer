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

  // Metin katmanı sentezi
  const cfgText = baseCfg();
  cfgText.logo = { enabled: true, src: 'data:,x' };
  cfgText.text = { enabled: true, content: 'Test Metni' };
  const out = L.synthesize(cfgText);
  assert.deepStrictEqual(out.map((l) => l.id), ['ly_bg', 'ly_vis', 'ly_text', 'ly_logo']);
  const txt = out.find((l) => l.id === 'ly_text');
  assert.strictEqual(txt.kind, 'visualizer');
  assert.strictEqual(txt.type, 'text');

  // Ana görselleştirici "text" ise fazladan metin katmanı sentezlenmez
  const cfgTextVis = baseCfg();
  cfgTextVis.visualizer = { type: 'text' };
  cfgTextVis.text = { enabled: true, content: 'Test Metni' };
  const outVis = L.synthesize(cfgTextVis);
  const textLayers = outVis.filter((l) => l.type === 'text');
  assert.strictEqual(textLayers.length, 1);
  assert.strictEqual(textLayers[0].id, 'ly_vis');

  // Metin kapalıyken sentezlenen listede yer almaz
  const cfgOff = baseCfg();
  cfgOff.text = { enabled: false, content: 'Test Metni' };
  assert.ok(!L.synthesize(cfgOff).some((l) => l.id === 'ly_text'));
});

// ---------------------------------------------------------- yığın anahtarı
test('makeTextLayer sabit yazı katmanı üretir', () => {
  const l = L.makeTextLayer({ name: 'Metin', source: 'static' });
  assert.strictEqual(l.kind, 'visualizer');
  assert.strictEqual(l.type, 'text');
  assert.strictEqual(l.name, 'Metin');
  assert.ok(l.id);
  const t = l.settings.text;
  assert.strictEqual(t.enabled, true);
  assert.strictEqual(t.source, 'static');
  assert.strictEqual(t.content, 'CAYADEV');
  assert.strictEqual(t.align, 'center');
});

test('makeTextLayer şarkı sözü katmanı üretir', () => {
  const l = L.makeTextLayer({ name: 'Şarkı Sözü', source: 'lyrics' });
  assert.strictEqual(l.kind, 'visualizer');
  assert.strictEqual(l.type, 'text');
  const t = l.settings.text;
  assert.strictEqual(t.enabled, true);
  assert.strictEqual(t.source, 'lyrics');
  assert.strictEqual(t.karaoke, true);
  assert.strictEqual(t.align, 'center');
  assert.strictEqual(t.lyricsFollow, false, 'platform bilinmeden izleme kapalı');
  assert.strictEqual(L.makeTextLayer({ source: 'lyrics', lyricsFollow: true }).settings.text.lyricsFollow, true, 'Windows paneli açık ister');
});

test('panel yeni söz katmanında izlemeyi yalnız Windows\'ta açar', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/admin/scene-panels.js'), 'utf8');
  assert.match(src, /lyricsFollow: isWindowsPlatform\(\)/);
});

test('makeTextLayer çalan parça katmanında alan varsayılanı both', () => {
  const l = L.makeTextLayer({ name: 'Metin', source: 'now' });
  assert.strictEqual(l.settings.text.source, 'now');
  assert.strictEqual(l.settings.text.field, 'both');
});

test('makeTextLayer sanatçı adı katmanı üretir', () => {
  const l = L.makeTextLayer({
    name: 'Sanatçı Adı', source: 'now', field: 'artist',
    content: 'ARTIST NAME', size: 0.032, weight: 500, y: 0.83,
  });
  assert.strictEqual(l.kind, 'visualizer');
  assert.strictEqual(l.type, 'text');
  const t = l.settings.text;
  assert.strictEqual(t.enabled, true);
  assert.strictEqual(t.source, 'now');
  assert.strictEqual(t.field, 'artist');
  assert.strictEqual(t.content, 'ARTIST NAME');
  assert.strictEqual(t.nowPlaying.artist, 'ARTIST NAME');
  assert.strictEqual(t.size, 0.032);
  assert.strictEqual(t.align, 'left');
});


test('makeNowPlayingLayer first-class kind', () => {
  const l = L.makeNowPlayingLayer({ name: 'Çalan Parça' });
  assert.strictEqual(l.kind, 'nowplaying');
  assert.strictEqual(l.type, 'nowplaying');
  assert.strictEqual(l.name, 'Çalan Parça');
  assert.ok(l.id);
  assert.strictEqual(l.settings.nowplaying.enabled, true);
  assert.strictEqual(l.settings.nowplaying.source, 'system');
  assert.strictEqual(l.settings.nowplaying.coverOverlay, false);
});

test('normalizeLayer forces nowplaying type for nowplaying kind', () => {
  const l = L.normalizeLayer({ kind: 'nowplaying', name: 'NP', type: 'bars' });
  assert.strictEqual(l.kind, 'nowplaying');
  assert.strictEqual(l.type, 'nowplaying');
});

test('KINDS includes nowplaying', () => {
  assert.ok(L.KINDS.indexOf('nowplaying') >= 0);
});

test('yığın açıkken kullanıcı listesi kullanılır', () => {
  const cfg = baseCfg();
  cfg.layers = [{ id: 'a', kind: 'visualizer', type: 'wave' }];
  cfg.layerStack = { enabled: true };
  const out = L.resolve(cfg);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'a');
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
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.id), ['a', 'b']);
});


test('yığın açıkken boş liste sentezlenmez (MilkDrop kalmaz)', () => {
  const cfg = baseCfg();
  cfg.visualizer = { type: 'milkdrop' };
  cfg.layers = [];
  cfg.layerStack = { enabled: true };
  assert.deepStrictEqual(L.resolve(cfg), []);
  // Yığın kapalıysa klasik sentez sürer
  cfg.layerStack = { enabled: false };
  const kinds = L.resolve(cfg).map((l) => l.kind + ':' + l.type);
  assert.ok(kinds.includes('visualizer:milkdrop'), kinds.join(','));
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


test('Çalan Parçayı İzle: Windows varsayılanı açık, döndür düğmesi açıkken gizli', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/admin/lyrics-lib-ui.js'), 'utf8');
  assert.match(src, /miniToggle\('Çalan Parçayı İzle'[\s\S]*?\{ def: true \}\)/);
  assert.doesNotMatch(src, /miniToggle\('Çalan Parçayı İzle'[^;]*?\{ def: false \}/);
});
