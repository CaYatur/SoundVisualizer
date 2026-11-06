'use strict';
/* Şablon (Preset) rafı kart boyu: --sv-card değişkenine bağlı olmalı.
   Diğer sekmeler (sv-gal / md-grid) zaten bağlıydı; tpl-grid atlanmıştı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('shell: #svShelf .tpl-grid --sv-card kullanıyor', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/admin/shell.css'), 'utf8');
  assert.match(css, /#svShelf \.tpl-grid\s*\{[^}]*var\(--sv-card/s);
});

test('ui-cardsize: templates sekmesini de geziyor', () => {
  const js = fs.readFileSync(path.join(ROOT, 'scripts/ui-cardsize.js'), 'utf8');
  assert.match(js, /\['vis', 'bg', 'milkdrop', 'templates'\]/);
  assert.match(js, /\.tpl-grid/);
  assert.match(js, /\.tpl-card/);
});

test('scene-shell: kart boyu kaydırıcısı lib sekmelerinde (şablon dahil) görünür', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src/admin/scene-shell.js'), 'utf8');
  assert.match(js, /class: 'sv-card-size'/);
  assert.match(js, /setCardSize/);
  assert.match(js, /id: 'templates'/);
});
