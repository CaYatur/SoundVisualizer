/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* YENİ KATMANIN FABRİKA DEĞERLERİ: sahne varsayılandan uzaklaşmış olsa da telefonda eklenen
   katman fabrika değerleriyle başlar; motorun gördüğü değer (layerConfig) ölçülür. */
const test = require('node:test');
const assert = require('node:assert');

global.window = global.window || {};
window.SV = window.SV || {};
require('../../src/shared/defaults.js');
const L = require('../../src/visualizer/layers.js');
window.SVLayers = L;
const F = require('../../src/shared/layer-factory.js');

const def = window.SV.defaultConfig();
function dirtyScene() {
  const c = window.SV.defaultConfig();
  Object.assign(c.background.gradient, { speed: 1.7, warp: 1.9, style: 'soft', colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] });
  c.background.colorMode = 'rainbow';
  c.background.solidColor = '#112233';
  c.background.ink = Object.assign({}, c.background.ink, { blobs: 11 });
  Object.assign(c.visualizer, { colorMode: 'rainbow', rainbow: true, glow: 0.9 });
  Object.assign(c.text, { outline: 0.9, shadow: 0.9 });
  Object.assign(c.nowplaying, { size: 0.12, y: 0.2 });
  return c;
}

test('arkaplan katmanı motorda fabrika değerleriyle çizilir', () => {
  const c = dirtyScene();
  const made = F.make({ kind: 'background', type: 'gradient' }, c, { defaults: def });
  const seen = L.layerConfig(c, made).background;
  for (const k of ['speed', 'warp', 'style']) assert.strictEqual(seen.gradient[k], def.background.gradient[k], k);
  assert.strictEqual(seen.colorMode, def.background.colorMode);
  assert.strictEqual(seen.solidColor, def.background.solidColor);
});

test('renk paleti tohumlanmaz: tema kipi sahnenin canlı paletini izler', () => {
  const c = dirtyScene();
  const made = F.make({ kind: 'background', type: 'gradient' }, c, { defaults: def });
  assert.strictEqual(made.settings.background.gradient.colors, undefined);
  assert.deepStrictEqual(L.layerConfig(c, made).background.gradient.colors, c.background.gradient.colors);
});

test('modun kendi ayarları da fabrika değeriyle başlar', () => {
  const c = dirtyScene();
  const made = F.make({ kind: 'background', type: 'ink' }, c, { defaults: def });
  assert.strictEqual(L.layerConfig(c, made).background.ink.blobs, def.background.ink.blobs);
});

test('sahne fabrika değerindeyse katmana bir şey yazılmaz', () => {
  const c = window.SV.defaultConfig();
  const made = F.make({ kind: 'background', type: 'gradient' }, c, { defaults: def });
  assert.deepStrictEqual(made.settings, {});
});

test('katmanın kendi değeri korunur; mod değişince yalnız yeni modun ayarları yazılır', () => {
  const c = dirtyScene();
  const layer = L.normalizeLayer({ kind: 'background', type: 'ink', settings: { background: { ink: { blobs: 3 }, gradient: { speed: 0.2 } } } });
  F.seedFactoryBackground(layer, c, def, { modeOnly: true });
  assert.strictEqual(layer.settings.background.ink.blobs, 3);
  assert.strictEqual(layer.settings.background.gradient.speed, 0.2);
  assert.strictEqual(layer.settings.background.gradient.warp, undefined, 'ortak alanlara dokunulmaz');
  assert.strictEqual(layer.settings.background.colorMode, undefined, 'renk kipine dokunulmaz');
  layer.type = 'gradient';
  F.seedFactoryBackground(layer, c, def, { modeOnly: true });
  assert.strictEqual(layer.settings.background.gradient.warp, def.background.gradient.warp);
  assert.strictEqual(layer.settings.background.gradient.speed, 0.2);
});

test('Studio katmanı presetini taşır ve sahnenin görselleştirici değerlerini almaz', () => {
  const c = dirtyScene();
  const made = F.make({ kind: 'visualizer', type: 'custom', presetId: 'sh_x', name: 'X' }, c, { defaults: def });
  assert.strictEqual(made.presetId, 'sh_x');
  const seen = L.layerConfig(c, made).visualizer;
  assert.strictEqual(seen.colorMode, def.visualizer.colorMode);
  assert.strictEqual(seen.glow, def.visualizer.glow);
});

test('metin katmanı sahnenin metin ayarlarını almaz', () => {
  const c = dirtyScene();
  const made = F.make({ kind: 'text', preset: 0 }, c, { defaults: def });
  const seen = L.layerConfig(c, made).text;
  assert.strictEqual(seen.outline, def.text.outline);
  assert.strictEqual(seen.shadow, def.text.shadow);
  assert.strictEqual(made.settings.text.colorMode, def.visualizer.colorMode);
});

test('çalan parça katmanı sahnenin yerleşimini almaz', () => {
  const c = dirtyScene();
  const made = F.make({ kind: 'nowplaying' }, c, { defaults: def });
  const seen = L.layerConfig(c, made).nowplaying;
  assert.strictEqual(seen.size, def.nowplaying.size);
  assert.strictEqual(seen.y, def.nowplaying.y);
  assert.strictEqual(seen.enabled, true);
});
