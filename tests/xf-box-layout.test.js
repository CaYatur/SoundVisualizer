'use strict';
/* Katman Grupları A/B kutusu: dar panelde düğme satırı üç eşit sütun,
   taşma yok. CSS ve group-panel sınıfını denetler. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('xf-box: dar panel için grid satırları tanımlı', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/admin/studio.css'), 'utf8');
  assert.match(css, /\.xf-box\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.ctrl\.xf-box > \.row[^}]*display:\s*grid\s*!important/s);
  assert.match(css, /\.xf-box > \.row\.xf-btns\s*\{[^}]*grid-template-columns:\s*repeat\(3/s);
  assert.match(css, /\.xf-box > \.row > \.btn[^}]*min-width:\s*0/s);
});

test('group-panel: A/Orta/B satırı xf-btns sınıfını kullanıyor', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src/admin/group-panel.js'), 'utf8');
  assert.match(js, /class: 'row xf-btns'/);
});
