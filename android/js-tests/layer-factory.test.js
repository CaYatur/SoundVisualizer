/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* KATMAN ÜRETİCİSİ (src/shared/layer-factory.js) ve KATMANLAR SEKMESİ (Faz 3.3).

   Telefonda eklenen katman masaüstünde eklenenle aynı olmalı. Masaüstünün ekleme kodu
   src/admin/scene-panels.js'te kaldı (panel testleri o dosyayı metin olarak dilimliyor);
   burada iki kopyanın aynı kaldığı denetleniyor: etiket listeleri, metin kalıpları ve
   görselleştirici tohumlaması aynı girdide aynı sonuç. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
global.window = global.window || {};
window.SV = window.SV || {};
require('../../src/shared/defaults.js');
const L = require('../../src/visualizer/layers.js');
window.SVLayers = L;
const F = require('../../src/shared/layer-factory.js');
const panel = read('src/admin/scene-panels.js');

/* scene-panels.js'teki bir sabitin dizi değeri (ilk tanımı). */
function panelConst(name) {
  const at = panel.indexOf('const ' + name + ' = [');
  assert.ok(at >= 0, name + ' panelde yok');
  let depth = 0;
  let i = panel.indexOf('[', at);
  const start = i;
  for (; i < panel.length; i++) {
    if (panel[i] === '[') depth++;
    else if (panel[i] === ']' && --depth === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function('return ' + panel.slice(start, i + 1))();
}

test('karışım, bant ve metin kalıpları panelinkilerle aynı', () => {
  assert.deepStrictEqual(F.BLEND_LABELS, panelConst('BLEND_LABELS'));
  assert.deepStrictEqual(F.BAND_LABELS, panelConst('BAND_LABELS'));
  assert.deepStrictEqual(F.TEXT_ADD_PRESETS, panelConst('TEXT_ADD_PRESETS'));
  assert.deepStrictEqual(F.SPRITE_MOTIONS, panelConst('SPRITE_MOTIONS'));
  // Karışım listesi motorun kümesini ve 'add'i kapsıyor
  const ids = F.BLEND_LABELS.map(([v]) => v);
  for (const b of L.BLEND_MODES) assert.ok(ids.includes(b), b);
  assert.ok(ids.includes('add'));
});

test('görselleştirici tohumlaması panelinkiyle aynı sonucu veriyor', () => {
  const body = panel.slice(panel.indexOf('function seedFactoryVisualizer'), panel.indexOf('function miniSegment'));
  // eslint-disable-next-line no-new-func
  const seedPanel = new Function('P', 'window', body + '\nreturn seedFactoryVisualizer;')(() => ({}), {});
  const def = window.SV.defaultConfig();
  const cases = [
    { visualizer: Object.assign({}, def.visualizer, { glow: 0.8, sensitivity: 1.4, gap: 0.1, barCount: 64 }) },
    { visualizer: Object.assign({}, def.visualizer) },
    {},
  ];
  for (const cfg of cases) {
    const a = seedPanel({ kind: 'visualizer', type: 'bars', settings: {} }, cfg, def);
    const b = F.seedFactoryVisualizer({ kind: 'visualizer', type: 'bars', settings: {} }, cfg, def);
    assert.deepStrictEqual(b, a);
  }
  const own = F.seedFactoryVisualizer({ settings: { visualizer: { glow: 0.3 } } }, cases[0], def);
  assert.strictEqual(own.settings.visualizer.glow, 0.3, 'katmanın kendi değeri ezilmez');
});

test('yeni katmanlar masaüstündeki gibi kuruluyor', () => {
  const def = window.SV.defaultConfig();
  const cfg = JSON.parse(JSON.stringify(def));
  cfg.visualizer.glow = 0.9;
  const bars = F.make({ kind: 'visualizer', type: 'bars' }, cfg, { defaults: def });
  assert.strictEqual(bars.kind, 'visualizer');
  assert.strictEqual(bars.type, 'bars');
  assert.ok(bars.id && bars.id.startsWith('ly_'));
  assert.strictEqual(bars.settings.visualizer.glow, def.visualizer.glow, 'sahnenin farklı değeri yerine fabrika değeri');
  const bg = F.make({ kind: 'background', type: 'ink' }, cfg);
  assert.strictEqual(bg.kind, 'background');
  assert.strictEqual(bg.type, 'ink');
  // MilkDrop: ilki ortak preseti kullanır, ortak katman varken ikincisi bağımsız
  window.SVMilkdropPack = [{ id: L.MD_DEFAULT_PRESET, name: 'Varsayılan', source: '[preset00]' }];
  const md1 = F.make({ kind: 'milkdrop' }, cfg);
  assert.strictEqual(md1.type, 'milkdrop');
  assert.ok(!(md1.settings.milkdrop && md1.settings.milkdrop.independent));
  assert.strictEqual(cfg.milkdrop.presetId, L.MD_DEFAULT_PRESET, 'ortak preset boşken sahneye yazılır');
  cfg.layers = [md1];
  const md2 = F.make({ kind: 'milkdrop' }, cfg);
  assert.strictEqual(md2.settings.milkdrop.independent, true);
  assert.strictEqual(md2.settings.milkdrop.presetId, L.MD_DEFAULT_PRESET);
  delete window.SVMilkdropPack;
  // Metin kalıpları ve çalan parça
  const txt = F.make({ kind: 'text', preset: 0 }, cfg);
  assert.strictEqual(txt.type, 'text');
  assert.strictEqual(txt.settings.text.source, 'static');
  assert.strictEqual(F.make({ kind: 'text', preset: 1 }, cfg).settings.text.lyricsFollow, false, 'telefonda sistem sözü izleme yok');
  assert.strictEqual(F.make({ kind: 'nowplaying' }, cfg).kind, 'nowplaying');
  // Galeriden: video → medya (dosya kaynağı), görsel → görsel nesne, logo → elle seçilen resim
  const v = F.makeMedia('video', { url: 'https://appassets.androidplatform.net/content/eA', name: 'klip.mp4' }, def);
  assert.strictEqual(v.kind, 'media');
  assert.deepStrictEqual([v.settings.media.enabled, v.settings.media.source, v.settings.media.file, v.settings.media.fileName], [true, 'file', 'https://appassets.androidplatform.net/content/eA', 'klip.mp4']);
  assert.strictEqual(v.settings.media.fit, def.media.fit);
  const im = F.makeMedia('image', { dataUrl: 'data:image/png;base64,AA', name: 'yıldız.png' }, def);
  assert.strictEqual(im.kind, 'sprites');
  assert.strictEqual(im.settings.images.items.length, 1);
  assert.strictEqual(im.settings.images.items[0].src, 'data:image/png;base64,AA');
  const lg = F.makeMedia('logo', { dataUrl: 'data:image/png;base64,AA' }, def);
  assert.deepStrictEqual([lg.kind, lg.settings.logo.enabled, lg.settings.logo.source, lg.settings.logo.src], ['logo', true, 'manual', 'data:image/png;base64,AA']);
  // Kopya: yeni kimlik, solo kapalı, ad "(kopya)"
  const dup = F.duplicate(Object.assign({}, bars, { solo: true, name: 'Tayf' }));
  assert.notStrictEqual(dup.id, bars.id);
  assert.strictEqual(dup.solo, false);
  assert.strictEqual(dup.name, 'Tayf (kopya)');
});

test('üretici mod küçük resimlerinin anahtarına girmiyor (resimler eskimesin)', () => {
  const T = require('../../src/main/mode-thumbs.js');
  const files = T.pageFiles(root);
  assert.ok(!files.includes('src/shared/layer-factory.js'));
  for (const f of ['src/mobile/shell.js', 'src/mobile/shell-layers.js', 'src/mobile/shell-controls.js']) assert.ok(!files.includes(f), f);
});

test('küçük resim dizini: her katalog modunun resmi var (düz renk hariç)', () => {
  const { build } = require('../tools/thumb-index.js');
  const r = build(root);
  assert.deepStrictEqual(r.missing, [], 'resimler eski: node scripts/gen-mode-thumbs.js');
  global.window = global.window || {};
  require('../../src/shared/mode-catalog.js');
  const C = window.SVModeCatalog;
  for (const [id] of C.layerPairs('visualizer')) assert.ok(r.index.vis[id], 'vis:' + id);
  for (const [id] of C.layerPairs('background')) if (id !== 'solid') assert.ok(r.index.bg[id], 'bg:' + id);
  for (const k of Object.values(r.index.vis).concat(Object.values(r.index.bg))) {
    assert.ok(fs.existsSync(path.join(root, 'assets', 'mode-thumbs', k + '.webp')), k);
  }
});

test('katmanlar sekmesi ayarı yerinde değiştirmiyor: kopya, yeni dizi, patch', () => {
  const js = read('src/mobile/shell-layers.js');
  // Ayar yazımının tek yolu: commit(list) → patch({ layers }) ya da kopya üzerinde set
  assert.ok(/function commit\(list\) \{ own\(\(\) => A\(\)\.config\.patch\(\{ layers: list \}\)\); \}/.test(js));
  assert.ok(js.includes('const next = JSON.parse(JSON.stringify(list[i]));'));
  assert.ok(!/\.layers\.push\(|\.layers\.splice\(/.test(js), 'asıl dizi yerinde değişmez');
  // Sürükleme: tutamaç touch-action: none (yoksa tarayıcı kaydırmayı alıp pointercancel gönderir)
  assert.ok(/#sv-shell \.grip \{[^}]*touch-action: none/.test(read('src/mobile/shell.css')));
  // Kilitli katman düzenlenmez
  assert.ok(js.includes("disabled: l.locked ? true : null"));
});
