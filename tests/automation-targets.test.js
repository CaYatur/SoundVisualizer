/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Otomasyon ve modülasyon hedef kataloğu (modulation-panel.js targetCatalog).
   Eksikler kullanıcı denemesinde bulundu: MilkDrop'un ayrı duyarlılığı
   (Ses Girişi → Kazanç) "Ses · Kazanç" diye duruyordu ve aralığı yoktu;
   hedeflerin 104'ünde aralık, 57'sinde Türkçe ad yoktu; Hassasiyet 0–1
   sanılıyordu; yazı, Çalan Parça, medya ve geri besleme listede değildi;
   katmanın kendi ayarı (23 katman kendi Hassasiyet'ini taşıyordu) hiçbir
   hedefle sürülemiyordu. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

require('../src/shared/defaults.js');
require('../src/shared/mode-catalog.js');
require('../src/shared/schema.js');
const L = require('../src/visualizer/layers.js');
const MOD = require('../src/shared/modulation.js');
const TL = require('../src/shared/timeline.js');
window.SVLayers = L;
window.SVModulation = MOD;
require('../src/admin/modulation-panel.js');

const SV = window.SV;
const MP = window.SVModulationPanel;
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// İki görselleştirici katmanı, her biri kendi Hassasiyet değeriyle
function scene() {
  const cfg = SV.defaultConfig();
  cfg.layerStack = Object.assign({}, cfg.layerStack, { enabled: true });
  cfg.layers = [
    L.normalizeLayer({ id: 'a', kind: 'visualizer', type: 'bars', name: 'Barlar', settings: { visualizer: { sensitivity: 0.5 } } }),
    L.normalizeLayer({ id: 'b', kind: 'visualizer', type: 'milkdrop', name: 'MilkDrop', settings: { visualizer: { sensitivity: 0.9 } } }),
  ];
  return cfg;
}
const find = (cat, p) => cat.find((o) => o.path === p);

test('MilkDrop ses girişi kendi grubunda, adı ve aralığı panelden, duyarlılık diye bulunuyor', () => {
  const cat = MP.targetCatalog(scene());
  const g = find(cat, 'audio.milkdrop.gain');
  assert.ok(g, 'hedef listede');
  assert.strictEqual(g.group, 'MilkDrop Ses Girişi');
  assert.strictEqual(g.label, 'Kazanç');
  assert.deepStrictEqual([g.min, g.max], [0, 4]);
  assert.match(g.keys, /duyarlılık/);
  assert.strictEqual(find(cat, 'audio.milkdrop.gateThreshold').label, 'Filtre Eşiği');
  assert.strictEqual(find(cat, 'audio.sensitivity').group, 'Ses', 'genel ses ayarı kendi grubunda kalıyor');
});

test('aralık panel kaydırıcısınınki: Hassasiyet 1\'in üstüne sürülebiliyor', () => {
  const cat = MP.targetCatalog(scene());
  const s = find(cat, 'audio.sensitivity');
  const r = window.SVSchema.rangeFor('audio.sensitivity');
  assert.deepStrictEqual([s.min, s.max], [r.min, r.max]);
  assert.ok(s.max > 1);
  // Hiçbir hedef ham anahtardan üretilmiş adla ya da aralıksız kalmıyor
  // (kovalı ağ sıklığı / iç çözünürlük bu katalogda değil)
  for (const o of cat) {
    assert.ok(o.min != null && o.max != null, 'aralık yok: ' + o.path);
    // modulation-panel.js humanize: "gateThreshold" → "Gate Threshold"
    const key = o.path.split('.').pop();
    const raw = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    const human = raw.charAt(0).toUpperCase() + raw.slice(1);
    assert.ok(o.label !== human || human === key, 'ham ad: ' + o.path + ' = ' + o.label);
  }
});

test('katmanın kendi ayarı hedef ve otomasyon onu sürüyor', () => {
  const cfg = scene();
  const cat = MP.targetCatalog(cfg);
  const second = find(cat, 'layers.1.settings.visualizer.sensitivity');
  assert.ok(second, 'ikinci katmanın Hassasiyet\'i listede');
  assert.match(second.group, /^Katman 2 · MilkDrop/);
  // Genel yol yalnız ilk canlı katmana yöneliyor; ikinci katman ancak kendi yoluyla
  const tl = { tracks: [
    { id: 't1', kind: 'automation', target: second.path, min: second.min, max: second.max, keys: [{ t: 0, v: 1 }, { t: 10, v: 1 }] },
    { id: 't2', kind: 'automation', target: 'audio.milkdrop.gain', min: 0, max: 4, keys: [{ t: 0, v: 0.5 }, { t: 10, v: 0.5 }] },
  ] };
  const auto = TL.applyAutomation(cfg, tl, 5);
  assert.strictEqual(auto.missing, null, JSON.stringify(auto.missing));
  assert.strictEqual(auto.applied, 2);
  const drawn = L.layerConfig(auto.cfg, auto.cfg.layers[1]);
  assert.strictEqual(drawn.visualizer.sensitivity, second.max);
  assert.strictEqual(L.layerConfig(auto.cfg, auto.cfg.layers[0]).visualizer.sensitivity, 0.5, 'ilk katman değişmedi');
  // MilkDrop modu sesi çizdiği yapılandırmanın audio.milkdrop'undan okuyor (milkdrop.js _mdIn.update)
  assert.strictEqual(drawn.audio.milkdrop.gain, 2);
  assert.match(read('src/visualizer/modes/milkdrop.js'), /this\._mdIn\.update\(audio, cfg && cfg\.audio && cfg\.audio\.milkdrop, dt\)/);
});

test('eksik bölümler listede: yazı, Çalan Parça, medya, geri besleme, MilkDrop, ana opaklık', () => {
  const cat = MP.targetCatalog(scene());
  for (const p of ['text.size', 'nowplaying.coverSize', 'media.kenBurns', 'feedback.zoom', 'milkdrop.blendTime', 'master']) {
    assert.ok(find(cat, p), 'yok: ' + p);
  }
  assert.strictEqual(find(cat, 'milkdrop.blendTime').label, 'Geçiş Süresi');
  // Motoru yeniden kuran ya da sürülmesi anlamsız alanlar dışarıda
  for (const p of ['milkdrop.mesh', 'milkdrop.renderScale', 'media.inPoint', 'background.transparentKey']) {
    assert.ok(!find(cat, p), 'olmamalı: ' + p);
  }
});

test('panel tablosunun ad ve aralıkları kaynağıyla aynı', () => {
  const src = read('src/admin/modulation-panel.js');
  const light = read('src/admin/lighting-general.js');
  const scene = read('src/admin/scene-panels.js');
  const admin = read('src/admin/admin.js');
  const rows = [...src.matchAll(/^    '([a-zA-Z.]+)': \['([^']+)'(?:, (-?[0-9.]+), (-?[0-9.]+))?\],/gm)];
  assert.ok(rows.length > 150, 'tablo okunamadı: ' + rows.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [, p, label, min, max] of rows) {
    const key = p.split('.').pop();
    if (p.startsWith('lighting.')) {
      assert.match(light, new RegExp("rangeRow\\('" + esc(key) + "', '" + esc(label) + "', " + esc(min) + ', ' + esc(max)), p);
    } else {
      assert.ok(scene.indexOf("'" + label + "'") >= 0 || admin.indexOf("'" + label + "'") >= 0
        || read('src/admin/milkdrop-panel.js').indexOf("'" + label + "'") >= 0, 'panelde yok: ' + p + ' = ' + label);
    }
  }
});

test('yeni grup ve adların İngilizcesi var', () => {
  const i18n = read('src/shared/i18n.js');
  for (const s of ['MilkDrop Ses Girişi', 'Tayf Ölçümü', 'Çalan Parça', 'Ana Opaklık', 'Çıkış', 'Yazı', 'Medya', 'Geri Besleme', 'Filtre Eşiği', 'Kapak Boyutu', 'Esneme Eşiği']) {
    assert.ok(i18n.indexOf("'" + s + "':") >= 0, 'çeviri yok: ' + s);
  }
});
