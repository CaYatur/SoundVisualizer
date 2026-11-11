'use strict';
/* Sahne denetçisi kaydırması: MilkDrop Rastgele/Kilitle gibi yerinde
   yenilemeler scrollTop'u korumalı; farklı katman seçimi sıfırlamalı.
   scene-shell paintInspector / select kalıbını birim olarak ölçer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/admin/scene-shell.js'), 'utf8');

test('paintInspector: yeniden çizmeden önce kaydırmayı okuyor ve çift rAF ile uyguluyor', () => {
  assert.match(src, /prevBody\.scrollTop/);
  assert.match(src, /requestAnimationFrame\(\(\) => requestAnimationFrame\(applyInspScroll\)\)/);
  assert.match(src, /preventScroll:\s*true/);
});

test('select: farklı öğede inspector kaydırmasını sıfırlıyor', () => {
  assert.match(src, /if \(next !== sel\) \{[\s\S]*scrollOf\.inspector = 0/);
  assert.match(src, /#svInspector \.sv-insp[\s\S]*scrollTop = 0/);
});

test('MilkDrop Kilitle/Rastgele applyShelf yolundan geçiyor (tam panel yenilemesi)', () => {
  const md = fs.readFileSync(path.join(ROOT, 'src/admin/milkdrop-panel.js'), 'utf8');
  assert.match(md, /const rerender = \(\) => applyShelf\(\)/);
  assert.match(md, /onclick: \(\) => \{ control\(cfg\)\.locked = !locked; rerender\(\); \}/);
  assert.match(md, /onclick: \(\) => \{ if \(uiPickOk\(cfg\)\) go\(cfg, randomPick\(cfg, md\)\); \}/);
});
