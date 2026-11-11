'use strict';
/* Zaman sayfası kısayol listesi (#957) İngilizce arayüzde Türkçe kalıyordu:
   satırlar yeniden yazılmış ama sözlüğe girmemişti, ui-audit 15 metin
   yakaladı. Bu test SHORTCUTS tablosundaki her metni çeviri tablosundan
   geçirip İngilizcede Türkçe harf kalmadığını doğrular. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;

function loadT(locale) {
  const doc = {
    documentElement: { lang: '' }, readyState: 'complete', title: '', body: {},
    addEventListener: () => {},
  };
  const win = {
    navigator: { languages: [locale], language: locale },
    localStorage: { getItem: () => locale, setItem: () => {} },
    alert: () => {}, confirm: () => {}, document: doc,
    MutationObserver: function () { this.observe = () => {}; },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  win.window = win;
  vm.runInContext(read('src/shared/i18n.js'), vm.createContext(win), { filename: 'i18n.js' });
  return win.SVI18n.t;
}

function shortcutTexts() {
  const src = read('src/admin/timeline-panel.js');
  const i = src.indexOf('const SHORTCUTS = [');
  assert.ok(i > 0, 'SHORTCUTS tablosu bulunamadı');
  const blk = src.slice(i, src.indexOf('];', i));
  const out = [];
  for (const m of blk.matchAll(/\['([^']*)', '([^']*)'\]/g)) out.push(m[1], m[2]);
  return out;
}

test('Zaman kısayolları: tablo okunuyor', () => {
  assert.ok(shortcutTexts().length >= 40);
});

test('Zaman kısayolları: İngilizcede Türkçe metin kalmıyor', () => {
  const en = loadT('en');
  const left = shortcutTexts().filter((s) => TR_CHARS.test(en(s)));
  assert.deepStrictEqual(left, []);
});
