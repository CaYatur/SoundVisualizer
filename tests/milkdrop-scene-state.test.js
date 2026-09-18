'use strict';
/* PUANLAR VE KİLİT SAHNEYE AİT DEĞİL.
 *
 * Sahne kaydı `milkdrop` bloğunu bütünüyle saklayıp geri yüklüyor
 * (admin.js snapshotScene / applyScene, control.js nextScene) ve şablon onu
 * varsayılana döndürüyor (templates.js apply). #569 puanları o bloğa
 * yazıyordu: eski bir sahneye geçmek, Otomatik VJ'nin bir sahne çekmesi ya
 * da bir şablon denemek kullanıcının verdiği bütün puanları silerdi; kilit
 * de sahneyle birlikte gelip giderdi. İkisi artık ayrı, sahne listelerinde
 * olmayan iki blokta: `milkdropLibrary` ve `milkdropControl`. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const T = require('../src/shared/templates.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const SV = global.window.SV;

// Bir dosyadaki `SCENE_KEYS` dizisinin öğeleri
function sceneKeys(file) {
  const m = /SCENE_KEYS = \[([\s\S]*?)\]/.exec(read(file));
  assert.ok(m, file + ': SCENE_KEYS bulunamadı');
  return m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
}

test('sahne listeleri milkdrop bloğunu taşıyor, puanları ve kilidi taşımıyor', () => {
  for (const f of ['src/admin/admin.js', 'src/admin/control.js', 'src/shared/templates.js']) {
    const keys = sceneKeys(f);
    assert.ok(keys.includes('milkdrop'), f + ': milkdrop sahnenin parçası olmalı');
    assert.ok(!keys.includes('milkdropLibrary'), f + ': puanlar sahneye girmemeli');
    assert.ok(!keys.includes('milkdropControl'), f + ': kilit sahneye girmemeli');
  }
});

test('varsayılan: puanlar ve kilit milkdrop bloğunun DIŞINDA', () => {
  const d = SV.defaultConfig();
  assert.deepStrictEqual(d.milkdropLibrary.ratings, {});
  assert.strictEqual(d.milkdropControl.locked, false);
  assert.strictEqual(d.milkdrop.ratings, undefined);
  assert.strictEqual(d.milkdrop.locked, undefined);
});

test('şablon uygulamak puanlara ve kilide dokunmuyor', () => {
  const cfg = SV.defaultConfig();
  cfg.milkdropLibrary.ratings = { md_a: 4, md_b: 0 };
  cfg.milkdropControl.locked = true;
  cfg.milkdrop.autoNext = 12;
  const tpl = T.TEMPLATES[0];
  const out = T.apply(cfg, tpl, { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone });
  assert.deepStrictEqual(out.milkdropLibrary.ratings, { md_a: 4, md_b: 0 });
  assert.strictEqual(out.milkdropControl.locked, true);
  // Karşılaştırma için: sahnenin parçası olan milkdrop bloğu şablonla sıfırlanıyor
  assert.strictEqual(out.milkdrop.autoNext, SV.defaultConfig().milkdrop.autoNext);
});

test('eski ayar dosyası yeni blokları varsayılanla alıyor', () => {
  const eski = SV.deepMerge(SV.defaultConfig(), { milkdrop: { autoNext: 5 } });
  assert.deepStrictEqual(eski.milkdropLibrary.ratings, {});
  assert.strictEqual(eski.milkdropControl.locked, false);
});
