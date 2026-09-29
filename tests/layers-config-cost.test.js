'use strict';
/* Katman yapılandırmasının maliyeti (#621).

   `layerConfig` her karede her katman için çağrılıyor. Eskiden katmanın
   ayarı varsa bütün yapılandırmayı `deepMerge(cfg, over)` ile kopyalıyordu;
   gerçek bir 842 KB'lık ayar dosyasında görselleştiricinin CPU süresinin
   %87'si buydu. Bu testler iki şeyi sabitliyor:

     1. Sonuç eskisiyle AYNI (eski gövde aşağıda başvuru olarak duruyor).
     2. Katmanın dokunmadığı bölümler KOPYALANMIYOR: sahneler, kütüphane
        kayıtları ve presetler aynı nesne olarak geçiyor. Kopya geri gelirse
        maliyet yine sahne sayısıyla büyür. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');

const SV = window.SV;

// Eski gövde — yalnız karşılaştırma için
function oldLayerConfig(cfg, layer) {
  const over = layer.settings;
  const hasOverrides = over && Object.keys(over).length;
  const base = hasOverrides ? SV.deepMerge(cfg, over) : cfg;
  const def = SV.defaultConfig();
  if (layer.kind === 'background') {
    const defBg = def.background;
    const baseBg = (cfg && cfg.background) || defBg;
    const bgSettings = (layer.settings && layer.settings.background) || {};
    const paletteColors = (cfg && cfg.background && cfg.background.gradient && cfg.background.gradient.colors) || (baseBg.gradient && baseBg.gradient.colors);
    const mergedBg = SV.deepMerge(baseBg, bgSettings);
    if (mergedBg.gradient) mergedBg.gradient.colors = (bgSettings.gradient && bgSettings.gradient.colors) || paletteColors;
    mergedBg.type = layer.type || (cfg && cfg.background && cfg.background.type) || 'solid';
    return Object.assign({}, base, {
      background: mergedBg,
      custom: Object.assign({}, base.custom, { backgroundId: layer.presetId || (base.custom && base.custom.backgroundId) }),
    });
  }
  if (layer.kind === 'visualizer') {
    const baseVis = (cfg && cfg.visualizer) || def.visualizer;
    const visSettings = (layer.settings && layer.settings.visualizer) || {};
    const mergedVis = SV.deepMerge(baseVis, visSettings);
    mergedVis.type = layer.type || (cfg && cfg.visualizer && cfg.visualizer.type) || 'bars';
    const res = Object.assign({}, base, {
      visualizer: mergedVis,
      custom: Object.assign({}, base.custom, { visualizerId: layer.presetId || (base.custom && base.custom.visualizerId) }),
    });
    if (layer.type === 'text') {
      const textSettings = (layer.settings && layer.settings.text) || {};
      const defText = (cfg && cfg.text) || def.text;
      res.text = Object.assign({}, defText, base.text, textSettings, { enabled: layer.enabled !== false });
    }
    if (layer.type === 'nowplaying') {
      const npSettings = (layer.settings && layer.settings.nowplaying) || {};
      const defNp = (cfg && cfg.nowplaying) || def.nowplaying;
      res.nowplaying = Object.assign({}, defNp, base.nowplaying, npSettings, { enabled: layer.enabled !== false });
    }
    return res;
  }
  if (layer.kind === 'media') {
    const defMedia = (cfg && cfg.media) || def.media;
    const mediaSettings = (layer.settings && layer.settings.media) || {};
    return Object.assign({}, base, {
      media: Object.assign({}, defMedia, base.media, mediaSettings, { enabled: layer.enabled !== false }),
    });
  }
  return base;
}

// Gerçek ayar dosyasının biçimi: büyük sahne listesi ve kütüphane kayıtları
function bigCfg() {
  const cfg = SV.defaultConfig();
  cfg.scenes = [];
  for (let i = 0; i < 40; i++) cfg.scenes.push({ id: 's' + i, name: 'Sahne ' + i, data: SV.defaultConfig() });
  cfg.milkdropLibrary = Object.assign({}, cfg.milkdropLibrary, { ratings: {}, tags: {} });
  for (let i = 0; i < 3000; i++) cfg.milkdropLibrary.ratings['md_' + i] = (i % 5) + 1;
  cfg.visualizer.colorMode = 'custom';
  cfg.custom = { visualizerId: 'v0', backgroundId: 'b0' };
  return cfg;
}

const LAYERS = [
  { id: 'a', kind: 'background', type: 'gradient', settings: { background: { gradient: { colors: ['#000000', '#ffffff'] }, transparent: true } } },
  { id: 'b', kind: 'background', type: 'hexpulse', settings: { background: { transparentKey: 0.3 } } },
  { id: 'c', kind: 'background', type: 'solid' },
  { id: 'd', kind: 'visualizer', type: 'bars', settings: { visualizer: { color: '#ff0000', barCount: 32 } } },
  // Eski ayar: renk kipi yok, rainbow var — deepMerge'ün eşitlemesi korunmalı
  { id: 'e', kind: 'visualizer', type: 'wave', settings: { visualizer: { rainbow: true } } },
  { id: 'f', kind: 'visualizer', type: 'text', settings: { text: { content: 'merhaba', size: 0.1 } } },
  { id: 'g', kind: 'visualizer', type: 'nowplaying', settings: { nowplaying: { show: true } } },
  { id: 'h', kind: 'media', type: 'back', settings: { media: { src: 'x.mp4' } } },
  { id: 'i', kind: 'logo', type: 'back', settings: { logo: { enabled: true, src: 'data:,x' } } },
  // Yapılandırmada hiç olmayan bir bölüm
  { id: 'j', kind: 'visualizer', type: 'bars', settings: { brandNew: { a: 1 }, visualizer: { sensitivity: 2 } } },
  { id: 'k', kind: 'visualizer', type: 'milkdrop', presetId: 'p1', settings: {} },
  { id: 'l', kind: 'visualizer', type: 'bars' },
];

test('sonuç eski birleştirmeyle aynı — her katman türünde', () => {
  const cfg = bigCfg();
  for (const layer of LAYERS) {
    const got = L.layerConfig(cfg, layer);
    const want = oldLayerConfig(cfg, layer);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)), layer.id + ' farklı');
  }
});

test('katmanın dokunmadığı büyük bölümler kopyalanmıyor', () => {
  const cfg = bigCfg();
  for (const layer of LAYERS) {
    const got = L.layerConfig(cfg, layer);
    assert.strictEqual(got.scenes, cfg.scenes, layer.id + ': sahneler kopyalanmış');
    assert.strictEqual(got.milkdropLibrary, cfg.milkdropLibrary, layer.id + ': kütüphane kopyalanmış');
  }
});

test('ezilen bölüm kopya — yapılandırma ve katman ayarı değişmiyor', () => {
  const cfg = bigCfg();
  const before = JSON.stringify(cfg);
  const layer = JSON.parse(JSON.stringify(LAYERS[3]));
  const lb = JSON.stringify(layer);
  const got = L.layerConfig(cfg, layer);
  assert.notStrictEqual(got.visualizer, cfg.visualizer);
  got.visualizer.color = '#00ff00';
  assert.strictEqual(JSON.stringify(cfg), before, 'yapılandırma değişti');
  assert.strictEqual(JSON.stringify(layer), lb, 'katman ayarı değişti');
});

test('varsayılan yapılandırma her çağrıda yeniden kurulmuyor', () => {
  const cfg = bigCfg();
  const orig = SV.defaultConfig;
  let calls = 0;
  SV.defaultConfig = function () { calls++; return orig.apply(this, arguments); };
  try {
    for (let i = 0; i < 50; i++) for (const layer of LAYERS) L.layerConfig(cfg, layer);
  } finally { SV.defaultConfig = orig; }
  assert.ok(calls <= 1, 'defaultConfig ' + calls + ' kez çağrıldı');
});
