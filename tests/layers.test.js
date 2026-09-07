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
test('yığın kapalıyken liste korunur ama sahne sentezlenir', () => {
  const cfg = baseCfg();
  cfg.layers = [{ id: 'a', kind: 'visualizer', type: 'wave' }];
  cfg.layerStack = { enabled: false };
  const out = L.resolve(cfg);
  assert.strictEqual(cfg.layers.length, 1, 'liste silinmemeli');
  assert.ok(out.every((l) => l.id !== 'a'), 'kapalıyken kullanıcı katmanı çizilmemeli');
  assert.deepStrictEqual(out.map((l) => l.kind), ['background', 'visualizer']);
});

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

  // Logo koordinatları ve fallback değerleri güvenle hesaplanır
  const fakeLogo = { naturalWidth: 100, naturalHeight: 100, src: 'logo.png', style: { display: 'block' } };
  const drawn = [];
  const fakeCtx = {
    save() {}, restore() {},
    drawImage(...args) { drawn.push(args); },
  };
  const stack = new L.LayerStack(null, { logoEl: fakeLogo });
  stack.width = 1000;
  stack.height = 1000;

  const cfgLogo = { logo: { enabled: true, src: 'logo.png' } };
  stack._drawLogoToCanvas(fakeCtx, cfgLogo, { bass: 0 });
  assert.strictEqual(drawn.length, 1);
  const [img, dx, dy, dw, dh] = drawn[0];
  assert.strictEqual(img, fakeLogo);
  assert.strictEqual(dw, 220);
  assert.strictEqual(dh, 220);
  assert.strictEqual(dx, 390);
  assert.strictEqual(dy, 390);

  // LogoEl DOM elemanı LayerStack devredeyken gizli kalır
  stack._setSurface(null);
  assert.strictEqual(fakeLogo.style.display, 'none');

  // Metin çalan parça kaynakları (system, manual, fallback)
  require('../src/visualizer/modes/text.js');
  const TextMode = global.window.SVModes.text;
  function makeTextTestContext() {
    let filledText = '';
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      clearRect() {}, translate() {}, scale() {},
      fillText(txt) { filledText = txt; }, strokeText() {},
      measureText() { return { width: 50 }; },
    };
    const canvas = { width: 800, height: 600, getContext: () => ctx };
    return { canvas, getFilled: () => filledText };
  }

  // 1) nowSource: system canlı parçayı okur
  const t1 = makeTextTestContext();
  const m1 = new TextMode(t1.canvas);
  global.window.SVNowLive = {
    state: { has: true, playing: true, title: 'Live Song', artist: 'Live Artist' },
  };
  m1.draw({ level: 0, bass: 0 }, {
    visualizer: { type: 'text' },
    text: { enabled: true, source: 'now', nowSource: 'system', nowPlaying: { title: 'Manual Title', artist: 'Manual Artist' } },
  }, 0, 0.016);
  assert.strictEqual(t1.getFilled(), 'Live Song — Live Artist');

  // 2) nowSource: manual canlı parça olsa bile elle girileni kullanır
  const t2 = makeTextTestContext();
  const m2 = new TextMode(t2.canvas);
  m2.draw({ level: 0, bass: 0 }, {
    visualizer: { type: 'text' },
    text: { enabled: true, source: 'now', nowSource: 'manual', nowPlaying: { title: 'Manual Title', artist: 'Manual Artist' } },
  }, 0, 0.016);
  assert.strictEqual(t2.getFilled(), 'Manual Title — Manual Artist');

  // 3) nowSource: system canlı parça yoksa elle girilene düşer
  const t3 = makeTextTestContext();
  const m3 = new TextMode(t3.canvas);
  global.window.SVNowLive = { state: null };
  m3.draw({ level: 0, bass: 0 }, {
    visualizer: { type: 'text' },
    text: { enabled: true, source: 'now', nowSource: 'system', nowPlaying: { title: 'Fallback Title', artist: 'Fallback Artist' } },
  }, 0, 0.016);
  assert.strictEqual(t3.getFilled(), 'Fallback Title — Fallback Artist');

  // 4) Platform kısıtlaması (macOS/Linux'ta otomatik okuma devre dışı ve kilitli)
  global.window.SVPanel = {
    el(tag, attrs, children) { return { tag, attrs: attrs || {}, children: children || [] }; },
    row(label, ctrl) { return { type: 'row', label, ctrl }; },
    push() {},
  };
  delete require.cache[require.resolve('../src/admin/scene-panels.js')];
  global.window.SV_PLATFORM = { isWindows: false, isMac: true };
  require('../src/admin/scene-panels.js');
  const SP = global.window.SVScenePanels;
  assert.strictEqual(SP.isWindows(), false, 'macOS üzerinde isWindows false olmalı');

  let checked = false;
  const row = SP.miniToggle('Sistemden Otomatik Doldur', () => checked, (v) => { checked = v; }, null, {
    disabled: true,
    badge: 'Yalnızca Windows',
  });
  assert.strictEqual(row.type, 'row');
  assert.ok(row.label.children.some((c) => c.attrs && c.attrs.text === 'Yalnızca Windows'));
  assert.ok(row.ctrl.attrs.class.includes('disabled'));
  assert.strictEqual(row.ctrl.children[0].attrs.disabled, true);

  // 5) Logo ve Şarkı Kapağı / Logo Source testleri (auto, manual, track)
  const defaults = window.SV ? window.SV.defaultConfig() : require('../src/shared/defaults.js');
  assert.strictEqual(defaults.logo.source, 'auto', 'Varsayılan logo kaynağı auto olmalı');
  assert.strictEqual(defaults.text.showArtwork, true, 'Varsayılan metin kapak gösterme açık olmalı');

  // a) auto mod: şarkı kapağı varsa kapağı döndürür
  global.window.SVNowLive = { state: { has: true, artwork: 'data:image/png;base64,ARTWORK123' } };
  const autoCfgWithText = { text: { enabled: true, source: 'now', showArtwork: true } };
  assert.strictEqual(L.resolveLogoSrc({ source: 'auto', src: 'fallback.png' }, autoCfgWithText), 'data:image/png;base64,ARTWORK123');

  // b) auto mod: showArtwork kapalıysa yedek logoya (src) döner
  const autoCfgNoArt = { text: { enabled: true, source: 'now', showArtwork: false } };
  assert.strictEqual(L.resolveLogoSrc({ source: 'auto', src: 'fallback.png' }, autoCfgNoArt), 'fallback.png');

  // c) auto mod: canlı şarkı yoksa yedek logoya döner
  global.window.SVNowLive = { state: null };
  assert.strictEqual(L.resolveLogoSrc({ source: 'auto', src: 'fallback.png' }, autoCfgWithText), 'fallback.png');

  // d) manual mod: canlı kapak olsa dahi her zaman logoyu (src) döndürür
  global.window.SVNowLive = { state: { has: true, artwork: 'data:image/png;base64,ARTWORK123' } };
  assert.strictEqual(L.resolveLogoSrc({ source: 'manual', src: 'manual.png' }, autoCfgWithText), 'manual.png');

  // e) track mod: kapak varsa kapağı döndürür, yoksa null döner (asla logoya düşmez)
  assert.strictEqual(L.resolveLogoSrc({ source: 'track', src: 'manual.png' }, autoCfgWithText), 'data:image/png;base64,ARTWORK123');
  assert.strictEqual(L.resolveLogoSrc({ source: 'track', src: 'manual.png' }, {}), 'data:image/png;base64,ARTWORK123');
  global.window.SVNowLive = { state: null };
  assert.strictEqual(L.resolveLogoSrc({ source: 'track', src: 'manual.png' }, autoCfgWithText), null);

  // f) katmanlar (layers) dizisinde metin katmanı kapak bilgisi
  const cfgWithLayerArt = {
    layers: [
      { id: 'ly_txt', enabled: true, type: 'text', settings: { text: { enabled: true, source: 'now', showArtwork: true, nowPlaying: { artwork: 'data:image/png;base64,LAYERART' } } } }
    ]
  };
  assert.strictEqual(L.resolveLogoSrc({ source: 'auto', src: 'fallback.png' }, cfgWithLayerArt), 'data:image/png;base64,LAYERART');

  // g) katman sentezi: source auto ise src boş olsa bile logo katmanı oluşturulabilir
  const synthAuto = L.synthesize({ logo: { enabled: true, source: 'auto', src: '' } });
  assert.ok(synthAuto.some((l) => l.kind === 'logo'), 'auto modda logo katmanı sentezlenmeli');
  const synthManual = L.synthesize({ logo: { enabled: true, source: 'manual', src: '' } });
  assert.strictEqual(synthManual.some((l) => l.kind === 'logo'), false, 'manual modda src boşken logo katmanı sentezlenmemeli');
});
