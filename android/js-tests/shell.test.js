/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOBİL ARAYÜZ KABUĞU (src/mobile/shell.js, shell.css; PLAN Faz 3).

   Onaylı taslağın kuralları kodda da tutuluyor: renk yalnız temadan, :root
   CaYaDev'in aynısı, dokunma hedefi en az 48 dp, her metnin İngilizcesi var.
   Kabuk uygulamada sayfanın betiklerinden sonra kuruluyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/mobile/shell.css');
const js = read('src/mobile/shell.js');

function rootVars(text) {
  const block = /:root\s*\{([^}]*)\}/.exec(text)[1];
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

test(':root CaYaDev temasının aynısı (SVUiThemes.apply CaYaDev\'de satır içi değerleri siliyor)', () => {
  global.window = global.window || {};
  const T = require('../../src/shared/ui-themes.js');
  const want = T.byId('cayadev').tokens;
  const got = rootVars(css);
  assert.deepStrictEqual(Object.keys(got).sort(), [...T.TOKEN_NAMES].sort());
  for (const n of T.TOKEN_NAMES) assert.strictEqual(got[n], want[n], n);
});

/* Dokunulan öğeler: kuralın bildirdiği boy en az 48 px. */
function ruleProps(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  assert.ok(m, 'kural yok: ' + selector);
  const out = {};
  for (const p of m[1].split(';')) {
    const i = p.indexOf(':');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
}
const px = (v) => (v ? parseFloat(v) : 0);

test('dokunma hedefleri en az 48 dp (PLAN 3.7)', () => {
  const iconbtn = ruleProps('#sv-shell .iconbtn');
  assert.ok(px(iconbtn.width) >= 48 && px(iconbtn.height) >= 48);
  assert.ok(px(ruleProps('#sv-shell .chip').height) >= 48, 'kaynak çipi bir düğme');
  assert.ok(px(ruleProps('#sv-shell .pill').height) >= 48);
  assert.ok(px(ruleProps('#sv-shell .scene').width) >= 48 && px(ruleProps('#sv-shell .scene')['min-height']) >= 48);
  const nav = ruleProps('#sv-shell .nav');
  // Gezinme çubuğu 68 px, iç boşluk 6: düğmeler 56 px
  assert.ok(px(nav.height) - 12 >= 48);
  assert.ok(px(ruleProps('#sv-shell .nav button')['min-width']) >= 48);
  // Geniş düzende ray düğmeleri: boy en az 48, ray 80 px (düğme genişliği 80 − 12)
  const wide = css.slice(css.indexOf('@media (min-width: 840px)'));
  const railBtn = /#sv-shell \.nav button \{([^}]*)\}/.exec(wide);
  assert.ok(railBtn && px(/height:\s*([\d.]+)px/.exec(railBtn[1])[1]) >= 48);
  assert.ok(/\.iconbtn \{[^}]*flex: none/.test(css), 'üst bilgide sıkışınca ikon düğmeleri küçülmesin');
});

/* Arayüz metinleri: dosyadaki tırnaklı Türkçe dizgiler (yorum satırları dışında).
   Eşleşme sırayla ilerliyor; tek harflik dizgiler ('b') sırayı kaydırmasın diye
   önce bütün dizgiler alınıyor, sonra süzülüyor. */
function uiStrings(text) {
  const src = text.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const out = new Set();
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    const t = m[1];
    if (t.length < 2 || /^(web|src|\.\.|#|--|data-|aria-|ly_|md_|svi|sv-)/.test(t) || /^[A-Z_]+$/.test(t)) continue;
    if (!/^[A-ZÇĞİÖŞÜ]/.test(t) && !/[çğıöşüÇĞİÖŞÜ]/.test(t)) continue;
    out.add(t);
  }
  return out;
}
// Arayüz metni olmayan dizgiler (iç adlar, hata iletileri, birleşik metnin parçaları)
const NOT_UI = new Set(['DOMContentLoaded', 'About ', 'Kalan yaklaşık ', 'SVLayers yok', 'Add ', ' katmanını ekle', 'SVAudio', 'Türkçe\\u200B', 'Başlatılamadı: ', 'İçe aktarılamadı: ', 'Import failed: ',
  'Changes every ', 'Her ', ' saniyede değişir', ' ölçüde değişir', ' atlandı', ' zaten kitaplıkta', ' preset değil', 'Scene ', 'Sahne ', 'Version ', 'Sürüm ', 'WebView ',
  'SoundVisualizer', 'English', 'AndroidX, Media3', 'Apache License 2.0', 'Geist, Geist Mono', 'SIL Open Font License 1.1',
  'nin yaptığı gibi), görselleştirici shader', 'Ekran\\u200B']);

test('kabuğun her metninin İngilizcesi i18n.js\'te', () => {
  const i18n = read('src/shared/i18n.js');
  const strings = new Set();
  for (const f of ['src/mobile/shell.js', 'src/mobile/shell-controls.js', 'src/mobile/shell-layers.js', 'src/shared/layer-factory.js',
    'src/mobile/shell-audio.js', 'src/mobile/shell-library.js', 'src/mobile/shell-display.js', 'src/mobile/shell-settings.js', 'src/mobile/autovj.js',
    'src/mobile/shell-export.js', 'src/mobile/export-ui.js']) {
    for (const s of uiStrings(read(f))) if (!NOT_UI.has(s)) strings.add(s);
  }
  for (const s of ['Otomatik VJ', 'Demo ses', 'Sistem sesi', 'Katmanlar', 'Sahne sınıra yakın:']) assert.ok(strings.has(s), 'okunamadı: ' + s);
  const missing = [...strings].filter((s) => !i18n.includes("'" + s + "':"));
  assert.deepStrictEqual(missing, []);
});

test('kabuk uygulamada sunucudan ve temalardan sonra yükleniyor, yalnız görselleştirici sayfasında kuruluyor', () => {
  const kt = read('android/app/src/main/java/com/cayadev/visualizer/web/WebShell.kt');
  const order = ['android-host.js', 'ui-themes.js', 'mode-catalog.js', 'shared/autovj.js', 'layer-factory.js', 'text-fold.js', 'mobile/autovj.js', 'mobile/shell.js', 'shell-controls.js',
    'shell-layers.js', 'shell-audio.js', 'shell-library.js', 'shell-display.js', 'shell-settings.js', 'shell-export.js', 'export-ui.js'].map((f) => kt.indexOf(f));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), 'sıra: ' + order);
  assert.ok(js.includes("indexOf('src/visualizer/') !== 0) return;"));
  // Yazı tipi APK'ya kopyalanıyor (shell.css ../admin/fonts'u istiyor)
  assert.ok(read('android/app/build.gradle.kts').includes('"src/admin/fonts/**"'));
  assert.ok(css.includes("url('../admin/fonts/Geist-Variable.woff2')"));
});

test('kabuk ekran koruyucusunun üstünde (motorun örtüsü z-index 2147483000)', () => {
  const vis = read('src/visualizer/visualizer.js');
  const saver = Number(/z-index:(\d+);pointer-events:none;background:#000/.exec(vis)[1]);
  assert.ok(Number(ruleProps('#sv-shell')['z-index']) > saver);
});
