/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* PANELİN OKUNABİLİRLİĞİ (erişilebilirlik).

   3.1.5'te panel yazılarının dörtte biri 8.5–10.5 px'ti ve renk
   şablonlarının adları 10 px soluk yazıydı; kullanıcılar okuyamadı. Bu
   testler şunlar geri gelirse düşer:
     - CSS'te ya da panel betiklerinde 11 px'ten küçük bir yazı,
     - Arayüz Boyutu'nun görselleştirici penceresine sızması ya da adımların
       panelle ana süreç arasında ayrışması,
     - Hareketleri Azalt ve Windows karşıtlık kipi kurallarının silinmesi. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const U = require('../src/shared/ui-scale');
const A = require('../src/shared/ui-contrast-audit');
const S = require('./helpers/theme-scan');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---------------------------------------------------------------------------
// Yazı boyutu
// ---------------------------------------------------------------------------
const PANEL_CSS = ['src/admin/admin.css', 'src/admin/studio.css', 'src/admin/bridge.css', 'src/bridge-status/status.css'];

test('panel CSS\'inde 11 px\'ten küçük yazı yok', () => {
  const small = [];
  PANEL_CSS.forEach((file) => {
    S.cssRules(read(file)).forEach((r) => {
      r.decls.forEach((d) => {
        if (d.prop !== 'font-size' && d.prop !== 'font') return;
        const m = /([0-9.]+)px/.exec(d.value);
        if (m && parseFloat(m[1]) < A.MIN_PX) small.push(file + ' "' + r.sel + '" ' + d.value);
        // em/rem/% ile küçültmek de aynı sonuca çıkar
        const rel = /(?:^|\s)([0-9.]+)(em|rem)\b/.exec(d.value);
        if (d.prop === 'font-size' && rel && parseFloat(rel[1]) < 1) small.push(file + ' "' + r.sel + '" ' + d.value);
      });
    });
  });
  assert.deepStrictEqual(small, []);
});

test('panel betiklerinde satır içi küçük yazı yok', () => {
  const small = [];
  ['src/admin', 'src/bridge-status'].forEach((dir) => {
    fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js')).forEach((f) => {
      const src = read(dir + '/' + f);
      // Tuval yazıları da (zaman çizelgesi, eşleme): ctx.font = '600 11px …'
      const re = /font-size:\s*([0-9.]+)px|fontSize\s*=\s*['"]([0-9.]+)px|\.font\s*=\s*['"`](?:[a-z0-9]+\s+)*?([0-9.]+)px/g;
      let m;
      while ((m = re.exec(src))) {
        const v = parseFloat(m[1] || m[2] || m[3]);
        if (v < A.MIN_PX) small.push(dir + '/' + f + ' ' + m[0]);
      }
    });
  });
  assert.deepStrictEqual(small, []);
});

test('renk şablonlarının adı gövde yazısı renginde ve ölçülüyor', () => {
  const r = S.cssRules(read('src/admin/admin.css')).find((x) => x.sel === '.preset .name');
  assert.ok(r, '.preset .name kuralı');
  const v = (p) => (r.decls.find((d) => d.prop === p) || {}).value;
  assert.strictEqual(v('color'), 'var(--text)');
  assert.ok(parseFloat(v('font-size')) >= 11.5, v('font-size'));
  // Öz testin taraması kartı değil yalnız renk şeridini atlıyor
  const audit = read('src/shared/ui-contrast-audit.js');
  assert.match(audit, /'\.preset \.swatch'/);
  assert.doesNotMatch(audit, /'\.preset',/);
});

/* Taramanın küçük yazıyı gerçekten yakaladığı: en küçük DOM taklidi */
function fakeDoc(items) {
  const body = { nodeType: 1, tagName: 'BODY', parentElement: null, classList: [], id: '' };
  const els = items.map((it, i) => ({
    nodeType: 1, tagName: 'SPAN', id: 'e' + i, classList: [], parentElement: body,
    firstChild: null, childNodes: [{ nodeType: 3, nodeValue: it.text }],
    closest: () => null,
    getBoundingClientRect: () => ({ width: 50, height: 14, top: 10, bottom: 24, left: 0, right: 50 }),
    style: it,
  }));
  els.forEach((e) => { e.firstChild = e.childNodes[0]; e.childNodes[0].nextSibling = null; });
  body.querySelectorAll = () => els;
  const style = (e) => (e === body
    ? { display: 'block', visibility: 'visible', opacity: '1', backgroundImage: 'none', backgroundColor: 'rgb(255, 255, 255)' }
    : { display: 'inline', visibility: 'visible', opacity: '1', color: 'rgb(0, 0, 0)', backgroundImage: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: e.style.px + 'px', fontWeight: '400' });
  return { doc: { body }, win: { innerWidth: 800, innerHeight: 600, getComputedStyle: style } };
}

test('ekran taraması: 11 px altı yazıyı ayrı listede veriyor', () => {
  const { doc, win } = fakeDoc([{ text: 'büyük', px: 12 }, { text: 'küçük', px: 10 }, { text: 'sınır', px: 11 }]);
  const r = A.audit(doc, win, { pageBg: 'rgb(255, 255, 255)' });
  assert.strictEqual(r.checked, 3);
  assert.deepStrictEqual(r.fails, []);
  assert.deepStrictEqual(r.tiny.map((x) => [x.text, x.px]), [['küçük', 10]]);
  assert.strictEqual(A.audit(doc, win, { pageBg: 'rgb(255, 255, 255)', minPx: 13 }).tiny.length, 3);
});

test('öz test küçük yazıyı hata sayıyor', () => {
  const m = read('src/main/main.js');
  const i = m.indexOf('Arayüz temaları: ekrandaki yazıların karşıtlığı (#770)');
  const step = m.slice(i, i + 8000);
  assert.match(step, /r\.tiny\.forEach/);
  assert.match(step, /tinyCount: tiny\.length/);
  assert.match(step, /smaller than 11 px/);
});

// ---------------------------------------------------------------------------
// Arayüz Boyutu
// ---------------------------------------------------------------------------
test('ui-scale: adımlar, en yakın adıma oturma, ileri/geri/sıfır', () => {
  assert.deepStrictEqual(U.STEPS, [0.9, 1, 1.1, 1.25, 1.5]);
  assert.strictEqual(U.normalize(undefined), 1);
  assert.strictEqual(U.normalize('abc'), 1);
  assert.strictEqual(U.normalize(-2), 1);
  assert.strictEqual(U.normalize(1.25), 1.25);
  assert.strictEqual(U.normalize(1.3), 1.25);
  assert.strictEqual(U.normalize(9), 1.5, 'üst sınır');
  assert.strictEqual(U.normalize(0.2), 0.9, 'alt sınır');
  assert.strictEqual(U.step(1, 1), 1.1);
  assert.strictEqual(U.step(1.5, 1), 1.5, 'en büyükte kalır');
  assert.strictEqual(U.step(1, -1), 0.9);
  assert.strictEqual(U.step(0.9, -1), 0.9, 'en küçükte kalır');
  assert.strictEqual(U.step(1.5, 0), 1);
});

test('ui-scale: Ctrl/Cmd + − 0 tuşları, başka tuşlar değil', () => {
  const k = (o) => U.zoomKey(Object.assign({ type: 'keyDown', control: true }, o));
  assert.strictEqual(k({ key: '+' }), 1);
  assert.strictEqual(k({ key: '=', code: 'Equal' }), 1, 'ABD düzeninde Shift olmadan');
  assert.strictEqual(k({ key: '+', code: 'NumpadAdd' }), 1);
  assert.strictEqual(k({ key: '-' }), -1);
  assert.strictEqual(k({ key: '-', code: 'NumpadSubtract' }), -1);
  assert.strictEqual(k({ key: '0' }), 0);
  assert.strictEqual(k({ key: '0', code: 'Numpad0' }), 0);
  // Türkçe Q: `-` tuşu ABD'nin = konumunda, `*` tuşu ABD'nin - konumunda
  assert.strictEqual(k({ key: '-', code: 'Equal' }), -1, 'Türkçe Q Ctrl −');
  assert.strictEqual(k({ key: '*', code: 'Minus' }), null, 'Türkçe Q Ctrl *');
  assert.strictEqual(k({ key: '+', code: 'Digit4', shift: true }), 1, 'Türkçe Q Shift+4 = +');
  assert.strictEqual(U.zoomKey({ type: 'keyDown', meta: true, key: '+' }), 1, 'macOS Cmd');
  assert.strictEqual(U.zoomKey({ type: 'keyDown', key: '+' }), null, 'Ctrl olmadan yazı yazılıyor');
  assert.strictEqual(k({ key: '+', alt: true }), null, 'AltGr / Alt bileşimleri');
  assert.strictEqual(k({ type: 'keyUp', key: '+' }), null);
  assert.strictEqual(k({ key: 'k' }), null, 'Ctrl K arama');
  assert.strictEqual(k({ key: '1' }), null);
  assert.strictEqual(U.zoomKey(null), null);
});

test('panel: Arayüz Boyutu seçenekleri ui-scale adımlarıyla aynı, ayar kökü ve arama sözcükleri var', () => {
  const s = read('src/admin/admin.js');
  const i = s.indexOf("path: 'ui.scale'");
  assert.ok(i > 0);
  const block = s.slice(i, i + 900);
  const values = Array.from(block.slice(0, block.indexOf('hint:')).matchAll(/value: ([0-9.]+)/g)).map((m) => Number(m[1]));
  assert.deepStrictEqual(values, U.STEPS);
  assert.match(block, /group: 'Erişilebilirlik'/);
  assert.match(s, /roots: \['ui\.theme', 'ui\.scale', 'ui\.reduceMotion',/);
  const main = s.slice(s.indexOf("id: 'settings-main'"), s.indexOf("id: 'settings-updates'"));
  ['erişilebilirlik', 'yazı boyutu', 'zoom', 'accessibility', 'contrast'].forEach((w) => assert.ok(main.includes("'" + w + "'"), w));
  // Denetimlerin kendi sözcükleri aramaya giriyor
  assert.match(s, /advanced: !!def\.advanced,\s*keywords: def\.keywords \|\| \[\],/);
  // Seçenekli denetim ipucunu gösteriyor
  const seg = s.slice(s.indexOf('function segmentCtrl(def)'), s.indexOf('function selectCtrl(def)'));
  assert.match(seg, /def\.hint \? el\('div'/);
});

test('ana süreç: boyut yalnız panel ve köprü penceresine, kısayollar ayarı değiştiriyor', () => {
  const m = read('src/main/main.js');
  // Yakınlaştırma tek yerden; görselleştirici ve yardımcı pencereler 1'de
  assert.strictEqual((m.match(/setZoomFactor\(/g) || []).length, 1);
  assert.strictEqual((m.match(/setZoomLevel\(/g) || []).length, 0);
  assert.match(m, /function syncAdminZoom\(\) \{\s*applyZoom\(adminWin\);\s*applyZoom\(bridgeWin\);\s*\}/);
  assert.match(m, /if \(SHOTS\) return uiScale\.DEFAULT;/, 'README görüntüleri %100');
  assert.match(m, /watchZoomKeys\(adminWin\);/);
  assert.match(m, /watchZoomKeys\(win\);/);
  const w = m.slice(m.indexOf('function watchZoomKeys(win)'), m.indexOf('function watchZoomKeys(win)') + 600);
  assert.match(w, /event\.preventDefault\(\);\s*stepAdminZoom\(dir\);/);
  assert.match(w, /did-finish-load/);
  // Panelin kopyası tazeleniyor; yoksa bir sonraki gönderim eski değere döner
  const st = m.slice(m.indexOf('function stepAdminZoom(dir)'), m.indexOf('function stepAdminZoom(dir)') + 500);
  assert.match(st, /applyConfigPatch\(\{ ui: /);
  assert.match(st, /notifyAdmin\('external-config', currentConfig\)/);
  // Her ayar gönderiminde uygulanıyor
  assert.match(m, /function syncAdminBackground\(\) \{\s*syncBridgeWinTheme\(\);\s*syncAdminZoom\(\);/);
});

test('ana süreç: pencere zemini sistemin karşıtlık isteğini izliyor', () => {
  const m = read('src/main/main.js');
  assert.match(m, /nativeTheme\.shouldUseHighContrastColors \|\| nativeTheme\.inForcedColorsMode/);
  assert.match(m, /uiThemes\.resolve\(adminUiTheme\(cfg\), nativeTheme\.shouldUseDarkColors, osMoreContrast\(\)\)/);
});

test('varsayılanlar: %100 ve hareketler açık; eski ayar dosyası varsayılanı alır', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  const SV = global.window.SV;
  const d = SV.defaultConfig();
  assert.strictEqual(d.ui.scale, 1);
  assert.strictEqual(d.ui.reduceMotion, false);
  const old = SV.deepMerge(SV.defaultConfig(), { ui: { theme: 'cayadev' } });
  assert.strictEqual(old.ui.scale, 1);
  assert.strictEqual(old.ui.theme, 'cayadev');
  assert.strictEqual(SV.deepMerge(SV.defaultConfig(), { ui: { scale: 1.5 } }).ui.scale, 1.5);
});

// ---------------------------------------------------------------------------
// Hareket ve zorunlu renkler
// ---------------------------------------------------------------------------
test('Hareketleri Azalt: ayar ve sistem tercihi panelin geçişlerini kapatıyor', () => {
  const css = read('src/admin/admin.css');
  assert.match(css, /:root\[data-reduce-motion\] \*,/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{/);
  assert.match(css, /transition-duration: \.001ms !important/);
  const s = read('src/admin/admin.js');
  assert.match(s, /window\.SVUiTheme\.setReduceMotion\(!!\(cfg && cfg\.ui && cfg\.ui\.reduceMotion === true\)\)/);
  // Görselleştirici panelin CSS'ini yüklemiyor
  assert.doesNotMatch(read('src/visualizer/index.html'), /admin\.css/);
});

test('Windows karşıtlık kipi: yalnız zeminle çizilen durumlar sistem rengiyle', () => {
  const css = read('src/admin/admin.css');
  const i = css.indexOf('@media (forced-colors: active)');
  assert.ok(i > 0);
  const b = css.slice(i, i + 1500);
  assert.match(b, /\.switch input:checked \+ \.track \{ forced-color-adjust: none; background: Highlight;/);
  assert.match(b, /\.switch \.track::after \{ forced-color-adjust: none; background: CanvasText; \}/);
  assert.match(b, /input\[type=range\]::-webkit-slider-thumb \{ forced-color-adjust: none; background: Highlight;/);
  assert.match(b, /outline: 2px solid Highlight/);
  // Kullanıcının renkleri ve tema önizlemeleri sistem rengine boyanmaz
  ['.ui-theme-preview', '.preset .swatch', '.tpl-swatch', 'input[type=color]'].forEach((x) => assert.ok(b.includes(x), x));
});

test('çeviri: erişilebilirlik metinleri İngilizce', () => {
  const I = read('src/shared/i18n.js');
  const s = read('src/admin/admin.js');
  const i = s.indexOf("path: 'ui.scale'");
  const block = s.slice(i - 200, i + 1800);
  const keys = ['Erişilebilirlik', 'Arayüz Boyutu', 'Hareketleri Azalt'];
  Array.from(block.matchAll(/hint: '([^']+)'/g)).forEach((m) => keys.push(m[1]));
  assert.ok(keys.length >= 5);
  keys.forEach((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(I, new RegExp("'" + esc + "': '[^']+'"), k);
  });
});
