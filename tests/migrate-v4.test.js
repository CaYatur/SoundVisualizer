'use strict';
/* Tek yönlü göç (#905). Ekrandaki görüntü korunuyor: `npm run golden -- --software`. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const M = require('../src/shared/migrate-v4.js');
const L = require('../src/visualizer/layers.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const classic = (extra) => Object.assign({
  background: { type: 'gradient' }, visualizer: { type: 'wave', glow: 0.5 }, logo: { enabled: false }, images: { enabled: false },
  media: { enabled: false }, text: { enabled: false }, layers: [], layerStack: { enabled: false },
}, extra || {});

test('klasik sahne katman listesine dönüyor, klasik alanlar devre dışı kalıyor', () => {
  const d = classic();
  const r = L.toStack(d);
  assert.deepStrictEqual(r, { changed: true, archived: false });
  assert.strictEqual(d.layerStack.enabled, true);
  assert.deepStrictEqual(d.layers.map((x) => x.kind), ['background', 'visualizer']);
  assert.strictEqual(d.layers[1].type, 'wave');
  assert.strictEqual(d.layers[1].settings.visualizer.glow, 0.5);
  assert.strictEqual(d.visualizer.type, 'none', 'iki kez çizilmesin');
  assert.strictEqual(d.layerStack.classicBackup.visualizerType, 'wave');
});

test('yığını kapalı sahnede görünen kalır, eski katmanlar arşive gider', () => {
  const old = [{ id: 'ly_old', kind: 'visualizer', type: 'bars' }];
  const d = classic({ layers: clone(old) });
  assert.deepStrictEqual(L.toStack(d), { changed: true, archived: true });
  assert.deepStrictEqual(d.layerStack.archivedLayers, old);
  assert.strictEqual(d.layers.find((x) => x.kind === 'visualizer').type, 'wave', 'ekrandaki klasik içerik');
  assert.ok(!d.layers.some((x) => x.id === 'ly_old'));
});

test('katmanlı sahneye dokunulmuyor; bayraksız dolu liste açık sayılıyor', () => {
  const on = classic({ layers: [{ id: 'a', kind: 'visualizer', type: 'bars' }], layerStack: { enabled: true } });
  const before = clone(on);
  assert.deepStrictEqual(L.toStack(on), { changed: false, archived: false });
  assert.deepStrictEqual(on, before);
  const implicit = classic({ layers: [{ id: 'a', kind: 'visualizer', type: 'bars' }], layerStack: {} });
  L.toStack(implicit);
  assert.strictEqual(implicit.layerStack.enabled, true);
  assert.strictEqual(implicit.layers[0].id, 'a');
  assert.strictEqual(implicit.layerStack.archivedLayers, undefined);
});

test('göç: kök ve sahneler bir kez, ikinci çalıştırma aynı sonucu veriyor', () => {
  const cfg = classic({ scenes: [
    { id: 's1', name: 'Klasik', data: classic() },
    { id: 's2', name: 'Eski Katmanlı', data: classic({ layers: [{ id: 'x', kind: 'logo' }] }) },
    { id: 's3', name: 'Bos', data: {} },
    null,
  ] });
  assert.strictEqual(M.needsMigration(cfg), true);
  const r = M.migrate(cfg);
  assert.deepStrictEqual(r, { changed: true, archived: ['Eski Katmanlı'] });
  assert.strictEqual(cfg.docVersion, M.DOC_VERSION);
  assert.strictEqual(cfg.scenes[0].data.layerStack.enabled, true);
  assert.deepStrictEqual(cfg.scenes[2].data, {}, 'görüntü taşımayan sahne');
  assert.strictEqual(M.needsMigration(cfg), false);
  const once = clone(cfg);
  assert.deepStrictEqual(M.migrate(cfg), { changed: false, archived: [] });
  assert.deepStrictEqual(clone(cfg), once);
  // Bayrak yokken de ikinci geçiş aynı listeyi verir: dosya kaydedilene kadar her okuma çeviriyor
  const a = classic();
  const b = classic();
  M.migrate(a);
  M.migrate(b);
  assert.deepStrictEqual(a, b);
});

test('yeni kurulum çevrilmiyor; ana süreç önce yedekliyor ve yedeğin üstüne yazmıyor', () => {
  assert.strictEqual(M.needsMigration(global.window.SV.defaultConfig()), false);
  const main = read('src/main/main.js');
  const fn = main.slice(main.indexOf('function migrateLoaded'), main.indexOf('function loadSettings'));
  assert.ok(fn.indexOf('copyFileSync') > 0 && fn.indexOf('copyFileSync') < fn.indexOf('migrateV4.migrate(cfg)'), 'önce yedek');
  assert.match(fn, /!fs\.existsSync\(SETTINGS_V3_BACKUP\)/);
  assert.match(main, /sanitizeLoaded\(migrateLoaded\(SettingsGuard\.parse\(fs\.readFileSync\(SETTINGS_PATH\)\)\)\)/);
  assert.match(main, /sanitizeLoaded\(migrateLoaded\(currentConfig\)\)/);
  assert.match(main, /sanitizeLoaded\(migrateLoaded\(loaded\)\)/);
  const html = read('src/admin/index.html');
  assert.ok(html.indexOf('../visualizer/layers.js') < html.indexOf('../shared/migrate-v4.js'));
  const admin = read('src/admin/admin.js');
  assert.match(admin, /SVMigrateV4\.migrateScene\(s\.data\)/);
  assert.match(admin, /SVMigrateV4\.migrate\(sanitized\)/);
});
