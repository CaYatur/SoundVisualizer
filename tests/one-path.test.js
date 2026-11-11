'use strict';
/* Tek yol katman listesi (#905). Motorun klasik dalları Aşama 2'de siliniyor; bu dosya
   ürünün oraya bir daha düşmediğini denetliyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const L = require('../src/visualizer/layers.js');
const T = require('../src/shared/templates.js');

const SV = global.window.SV;
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('yeni kurulum ilk açılışta katman listesi', () => {
  const cfg = SV.defaultConfig();
  L.ensureStack(cfg);
  assert.strictEqual(cfg.layerStack.enabled, true);
  assert.ok(cfg.layers.length > 0);
  assert.strictEqual(cfg.visualizer.type, 'none', 'iki kez çizilmesin');
});

test('dışarıdan kapatılsa da liste kalır, yığın açılır', () => {
  const layers = [{ id: 'a', kind: 'visualizer', type: 'bars' }];
  const cfg = SV.defaultConfig();
  cfg.layers = layers.slice();
  cfg.layerStack = { enabled: false };
  L.ensureStack(cfg);
  assert.strictEqual(cfg.layerStack.enabled, true);
  assert.deepStrictEqual(cfg.layers, layers);
  assert.strictEqual(cfg.layerStack.archivedLayers, undefined, 'arşiv yalnız göçte');
});

test('kullanıcı listeyi boşalttıysa yeniden doldurulmaz', () => {
  const cfg = SV.defaultConfig();
  cfg.layerStack = { enabled: true };
  cfg.layers = [];
  L.ensureStack(cfg);
  assert.deepStrictEqual(cfg.layers, []);
  assert.doesNotThrow(() => L.ensureStack(null));
});

test('her şablon katman listesi olarak açılıyor', () => {
  const env = { defaultConfig: SV.defaultConfig, deepMerge: SV.deepMerge, clone: SV.clone };
  for (const start of [SV.defaultConfig(), Object.assign(SV.defaultConfig(), { layerStack: { enabled: false } })]) {
    for (const tpl of T.TEMPLATES) {
      const out = T.apply(start, tpl, env);
      assert.strictEqual(out.layerStack.enabled, true, tpl.id);
      assert.ok(Array.isArray(out.layers) && out.layers.length > 0, tpl.id + ': liste boş');
    }
  }
});

test('sıfırlama görselleştiriciyi geri getiriyor: kök alanlar yedekten', () => {
  const cfg = SV.defaultConfig();
  cfg.visualizer.type = 'wave';
  cfg.logo.enabled = true;
  cfg.logo.source = 'auto';
  L.ensureStack(cfg);
  assert.strictEqual(cfg.visualizer.type, 'none');
  cfg.layers = []; // son katman silindi
  /* Yığın açıkken boş liste bilinçli boş sahne: klasik alanlardan
     arkaplan/MilkDrop geri sentezlenmez. Sıfırlama (rebuildStack) geri getirir. */
  assert.deepStrictEqual(L.resolve(cfg).map((l) => l.kind), [], 'boş liste boş kalmalı');
  L.rebuildStack(cfg);
  const drawn = L.resolve(cfg);
  assert.strictEqual(drawn.find((l) => l.kind === 'visualizer').type, 'wave');
  assert.ok(drawn.some((l) => l.kind === 'logo'));
  assert.strictEqual(cfg.visualizer.type, 'none', 'iki kez çizilmesin');
  assert.strictEqual(cfg.layerStack.enabled, true);
  // Yedek görselleştiricisizse sıfırlama yine görselleştirici verir: düğme bunu söylüyor
  const none = SV.defaultConfig();
  none.visualizer.type = 'none';
  L.ensureStack(none);
  L.rebuildStack(none);
  assert.strictEqual(L.resolve(none).find((l) => l.kind === 'visualizer').type, 'bars');
  assert.doesNotThrow(() => L.rebuildStack(null));
});

test('arşivdeki katmanlarla liste kayıpsız yer değiştiriyor', () => {
  const old = [{ id: 'eski', kind: 'visualizer', type: 'bars' }];
  const now = [{ id: 'yeni', kind: 'visualizer', type: 'wave' }];
  const cfg = { layers: now.slice(), layerStack: { enabled: true, archivedLayers: old.slice() } };
  assert.strictEqual(L.swapArchived(cfg), true);
  assert.deepStrictEqual(cfg.layers, old);
  assert.deepStrictEqual(cfg.layerStack.archivedLayers, now);
  L.swapArchived(cfg);
  assert.deepStrictEqual(cfg.layers, now);
  assert.deepStrictEqual(cfg.layerStack.archivedLayers, old);
  assert.strictEqual(L.swapArchived({ layers: [], layerStack: {} }), false);
  assert.strictEqual(L.swapArchived(null), false);
});

test('panel, ana süreç ve şablon aynı kurala bağlı; anahtarın metni kalmadı', () => {
  const admin = read('src/admin/admin.js');
  const push = admin.slice(admin.indexOf('function push(immediate)'), admin.indexOf('if (isBlackedOut())'));
  assert.match(push, /ensureStack\(cfg\)/);
  const main = read('src/main/main.js');
  const hub = main.slice(main.indexOf('function applyIncomingConfig'), main.indexOf('redundancyGuard(config, opts)'));
  assert.match(hub, /ensureStack\(config\)/);
  const i18n = read('src/shared/i18n.js');
  for (const gone of ["'Katman Yığınını Kullan'", "'Katmanlara Geç'", "'Katman yığını kapalı."]) assert.ok(!i18n.includes(gone), gone);
  assert.ok(i18n.includes("'Katman Listesini Oluştur':"));
  assert.ok(i18n.includes("'Arşivdeki Katmanlara Geç':"));
  const panel = read('src/admin/scene-panels.js');
  assert.doesNotMatch(panel, /kartlarından sürül/, 'o kartlar artık sahneyi sürmüyor');
  assert.doesNotMatch(panel, /cfg\.layers = \[\];\s*rerender/, 'sıfırlama listeyi boş bırakmasın');
  assert.match(panel, /rebuildStack\(cfg\)/);
  assert.match(panel, /swapArchived\(cfg\)/);
});
