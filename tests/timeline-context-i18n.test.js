'use strict';
/* Zaman şeridi sağ tık menüsü: İngilizce arayüzde Türkçe kalan satırlar
   (Buraya klip ekle, Parçayı yukarı/aşağı/sil, Çift tık rozeti vb.).
   openMenu metni ve kbd rozetini tt() ile çeviriyor; sözlük eksikse bu test kırılır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/

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

function menuLiterals() {
  const src = read('src/admin/timeline-panel.js');
  const i = src.indexOf('function contextMenuAt');
  const j = src.indexOf('function openMenu', i);
  assert.ok(i > 0 && j > i, 'contextMenuAt / openMenu bulunamadı');
  const blk = src.slice(i, j);
  const out = new Set();
  for (const m of blk.matchAll(/\badd\((?:[^,\n(]+\?\s*)?'([^']+)'/g)) out.add(m[1]);
  for (const m of blk.matchAll(/\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { out.add(m[1]); out.add(m[2]); }
  for (const m of blk.matchAll(/add\('[^']*',\s*'([^']+)'/g)) out.add(m[1]);
  return [...out];
}

test('timeline context: openMenu kbd rozetini de çeviriyor', () => {
  const src = read('src/admin/timeline-panel.js');
  assert.match(src, /key \? el\('kbd', \{ text: tt\(key\) \}\)/);
});

test('timeline context: İngilizcede Türkçe menü satırı kalmıyor', () => {
  const en = loadT('en');
  const skip = /^(Ctrl|Alt|Shift|Del|M|I|O|R|\?|S|%[0-9]+|Solo)$/;
  const left = menuLiterals().filter((s) => !skip.test(s) && TR_CHARS.test(en(s)));
  assert.deepStrictEqual(left, []);
});

test('timeline context: bildirilen satırlar doğru İngilizce', () => {
  const en = loadT('en');
  assert.strictEqual(en('Buraya klip ekle'), 'Add clip here');
  assert.strictEqual(en('Çift tık'), 'Double-click');
  assert.strictEqual(en('Parçayı yukarı'), 'Move track up');
  assert.strictEqual(en('Parçayı aşağı'), 'Move track down');
  assert.strictEqual(en('Parçayı sil…'), 'Delete track…');
  assert.strictEqual(en('Buraya nokta ekle'), 'Add point here');
  assert.strictEqual(en('İşarete git'), 'Go to marker');
});

test('timeline context: Türkçe kaynak metinler değişmiyor', () => {
  const tr = loadT('tr-TR');
  assert.strictEqual(tr('Buraya klip ekle'), 'Buraya klip ekle');
  assert.strictEqual(tr('Parçayı sil…'), 'Parçayı sil…');
  assert.strictEqual(tr('Çift tık'), 'Çift tık');
});

test('timeline context: openMenu dizi parçalarını ayrı çeviriyor', () => {
  const src = read('src/admin/timeline-panel.js');
  assert.match(src, /function menuText\(text\)/);
  assert.match(src, /Array\.isArray\(text\)/);
  assert.match(src, /\['Geçiş türü: '/);
  assert.match(src, /\['Geçiş eğrisi: '/);
});

test('timeline context: bileşik geçiş satırları İngilizcede Türkçe kalmıyor', () => {
  const en = loadT('en');
  const parts = (arr) => arr.map((p) => en(p)).join('');
  const type = parts(['Geçiş türü: ', 'sahne varsayılanı', ' …']);
  const ease = parts(['Geçiş eğrisi: ', 'Sahne varsayılanını kullan', ' …']);
  assert.strictEqual(type, 'Transition type: scene default …');
  assert.strictEqual(ease, 'Transition ease: Use scene default …');
  assert.ok(!TR_CHARS.test(type) && !TR_CHARS.test(ease));
  assert.strictEqual(en('Rengi parçadan al'), 'Use track colour');
  assert.strictEqual(en('Kafada klip ekle'), 'Add clip at playhead');
});
