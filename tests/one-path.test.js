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

test('panel, ana süreç ve şablon aynı kurala bağlı; anahtarın metni kalmadı', () => {
  const admin = read('src/admin/admin.js');
  const push = admin.slice(admin.indexOf('function push(immediate)'), admin.indexOf('if (isBlackedOut())'));
  assert.match(push, /ensureStack\(cfg\)/);
  const main = read('src/main/main.js');
  const hub = main.slice(main.indexOf('function applyIncomingConfig'), main.indexOf('redundancyGuard(config, opts)'));
  assert.match(hub, /ensureStack\(config\)/);
  const i18n = read('src/shared/i18n.js');
  for (const gone of ['Katman Yığınını Kullan', 'Katmanlara Geç', 'Katman yığını kapalı.']) assert.ok(!i18n.includes(gone), gone);
  assert.ok(i18n.includes("'Katman Listesini Oluştur':"));
});
