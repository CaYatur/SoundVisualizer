'use strict';
/* Düzen editörü (#534): önizlemeyi taşır (ikinci çizici yok), yakalama ve
   klavye karşılıkları, erişilebilirlik ve çeviri. Canlı davranış öz testte
   ve elle doğrulandı; burada sözleşme korunuyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ED = read('src/admin/layout-editor.js');

test('panel betikleri yükleniyor ve düğme adlandırılmış', () => {
  const html = read('src/admin/index.html');
  const a = html.indexOf('<script src="preview.js"></script>');
  const b = html.indexOf('<script src="../shared/layout.js"></script>');
  const c = html.indexOf('<script src="layout-editor.js"></script>');
  assert.ok(a > 0 && b > a && c > b, 'sıra: preview → layout → layout-editor');
  assert.match(html, /id="layoutEditBtn"[^>]*aria-label="Düzen Editörü"/);
  assert.match(read('src/admin/admin.js'), /SVLayoutEditor\.open\(layBtn\)/);
});

test('önizleme taşınıyor, yeniden çizilmiyor; kapanınca yerine dönüyor', () => {
  assert.match(ED, /stageWrap\.appendChild\(stage\)/);
  assert.doesNotMatch(ED, /new\s+window\.SVLayers|SVLayers\.LayerStack|createStack/, 'ikinci çizici yok');
  assert.match(ED, /s\.home\.insertBefore\(s\.stage, s\.next\)/);
  assert.match(ED, /stack\.layoutBounds\(\)/, 'kutular çiziciden');
});

test('yakalama Alt ile kapanıyor; ok tuşları ve sayısal alanlar sürüklemenin karşılığı', () => {
  assert.match(ED, /if \(st\.snap && !m\.altKey\)/);
  assert.match(ED, /LY\(\)\.snapBox\(box, d\.guides, SNAP_PX \/ d\.rect\.width, SNAP_PX \/ d\.rect\.height\)/);
  // Kendi kutusuna yakalanmasın
  assert.match(ED, /elements\(\)\.filter\(\(x\) => x\.id !== id\)/);
  // Birikme hatası yok: her harekette başlangıçtan toplam kayma
  assert.match(ED, /Object\.keys\(startVals\)\.forEach\(\(k\) => LY\(\)\.setField/);
  assert.match(ED, /ArrowLeft: \[-1, 0\], ArrowRight: \[1, 0\], ArrowUp: \[0, -1\], ArrowDown: \[0, 1\]/);
  assert.match(ED, /ev\.shiftKey \? NUDGE \* 10 : NUDGE/);
  assert.match(ED, /type: 'number', class: 'num'/);
});

test('kipli pencere: adlar, odak tuzağı, Escape; kullanıcı içeriği çevrilmiyor', () => {
  assert.match(ED, /role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'layTitle'/);
  assert.match(ED, /'aria-label': e\.name \+ ' — ' \+ tr\('ok tuşlarıyla taşıyın'\)/);
  assert.match(ED, /if \(e\.key === 'Tab'\)/);
  assert.match(ED, /e\.key === 'Escape' && !st\.drag/);
  assert.match(ED, /class: 'lay-tag', text: e\.name, 'data-user-text': ''/);
  // Kılavuzlar yalnız sürüklerken
  assert.match(ED, /gx\.hidden = true;\s*\n\s*gy\.hidden = true;/);
  const css = read('src/admin/admin.css');
  assert.match(css, /\.lay-box:focus-visible \{ outline: 2px solid var\(--accent\)/);
  const i18n = read('src/shared/i18n.js');
  ["'Düzen Editörü': 'Layout Editor'", "'Güvenli alanlar': 'Safe areas'", "'ok tuşlarıyla taşıyın':", "'Yatay Merkez':", "'Yazı Boyu':", "'En Büyük Genişlik':"]
    .forEach((k) => assert.ok(i18n.includes(k), k));
});
