'use strict';
/* MilkDrop hareket vektörleri: "MilkDrop'taki gibi aynalı" seçeneği (#750).
   MilkDrop 2 vektörün yönünü ağın dikey aynalanmış satırından okuyor;
   BeatDrop bunu 14.10'da düzeltti. Varsayılan düzeltilmiş alan kalıyor,
   aynalı hâl ek seçenek. Ölçüldü (960x720, kare 59, kaba fark 0..255):
   aynalı kip stok MilkDrop'a Align 1,66 / Sun Above Sea 0,53 / Y slide 0,95,
   düzeltilmiş kip yamalı MilkDrop'a 0,82 / 1,73 / 0,92; çapraz eşleşmeler
   12,9 / 31,2 / 6,6. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('varsayılan düzeltilmiş alan; aynalı yalnız seçilince', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  assert.strictEqual(global.window.SV.defaultConfig().milkdrop.motionVectors, 'fixed');
  const eng = read('src/visualizer/modes/milkdrop.js');
  // Yalnız açıkça 'mirrored' aynalıyor; yazım hatası düzeltilmiş alana düşer
  assert.match(eng, /this\._mvMirror = !!\(cfg\.milkdrop && cfg\.milkdrop\.motionVectors === 'mirrored'\);/);
  // Aynalama yalnız uyum açıkken (eski yaklaşım kendi vektörlerini çiziyor)
  assert.match(eng, /const mir = acc && this\._mvMirror;/);
});

test('aynalı kip: konum aynı, yön aynalanmış satırdan, dikey fark ters', () => {
  const eng = read('src/visualizer/modes/milkdrop.js');
  const i = eng.indexOf('_drawMotionVectors(gl, GW, GH) {');
  const body = eng.slice(i, eng.indexOf('\n    }\n', i));
  assert.match(body, /const ys = mir \? 1 - y : y;\s*\n\s*sampleUV\(x, ys, uv\);/);
  assert.match(body, /let ddy = \(uv\[1\] - 0\.5 \/ GH - ys\) \* L;/);
  assert.match(body, /ex = x \+ ddx; ey = mir \? y - ddy : y \+ ddy;/);
  // Durgun iz iki kipte de ekranda sağ-aşağı
  assert.match(body, /ddx = minLen; ddy = mir \? minLen : -minLen;/);
  // Başlangıç noktası (konum) aynalanmıyor
  assert.match(body, /push\(x, y\);\s*\n\s*push\(ex, ey\);/);
});

test('panelde seçenek ve İngilizce karşılıkları var', () => {
  const panel = read('src/admin/milkdrop-panel.js');
  assert.match(panel, /P\(\)\.row\('Hareket Vektörleri'/);
  assert.match(panel, /md\.motionVectors === 'mirrored' \? 'mirrored' : 'fixed'/);
  const dict = read('src/shared/i18n.js');
  assert.ok(dict.includes("'Hareket Vektörleri': 'Motion Vectors'"));
  assert.ok(dict.includes("'Presetin istediği yön (düzeltilmiş)': 'As the preset asks (corrected)'"));
  assert.ok(dict.includes("taki gibi aynalı': 'Mirrored, as in MilkDrop'"));
});
