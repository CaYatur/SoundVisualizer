'use strict';
/* Ayar depoları (#905): sahneler ve kütüphane ayrı dosyada, değişmeyen yazılmıyor. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Store = require('../src/main/settings-store.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-store-')); }
const cfg = () => ({ audio: { sensitivity: 1 }, scenes: [{ id: 's1', name: 'A', data: {} }], milkdropLibrary: { ratings: { x: 3 }, favorites: {}, tags: {}, textureRev: 0 } });

test('üç dosyaya ayrılıyor, okununca tek nesne', () => {
  const dir = tmp();
  const st = Store.create(dir);
  st.write(st.serialize(cfg()));
  const main = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.strictEqual(main.scenes, undefined);
  assert.strictEqual(main.milkdropLibrary, undefined);
  assert.strictEqual(main.audio.sensitivity, 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8')), cfg().scenes);
  assert.deepStrictEqual(st.merge(main), cfg());
});

test('yalnız değişen dosya yazılıyor, aynı nesne yeniden metne çevrilmiyor', () => {
  const dir = tmp();
  const writes = [];
  const st = Store.create(dir, { fs: Object.assign({}, fs, { writeFileSync: (f, t, o) => { writes.push(path.basename(f)); fs.writeFileSync(f, t, o); } }) });
  const c = cfg();
  st.write(st.serialize(c));
  assert.strictEqual(writes.length, 3);
  writes.length = 0;
  c.audio.sensitivity = 2;
  let stringified = 0;
  c.scenes.toJSON = function () { stringified++; return this.slice(); };
  const next = st.serialize(c);
  assert.strictEqual(stringified, 0, 'sahneler yeniden çevrilmedi');
  st.write(next);
  assert.deepStrictEqual(writes, ['settings.json']);
  writes.length = 0;
  st.write(st.serialize(Object.assign({}, c, { scenes: [{ id: 's2' }] })));
  assert.deepStrictEqual(writes, ['scenes.json'], 'yeni nesne, yeni içerik; ayar aynı');
});

test('parçalar önce yazılıyor; eksik yapılandırma sahneleri silmiyor', () => {
  const dir = tmp();
  const order = [];
  const st = Store.create(dir, { fs: Object.assign({}, fs, { writeFileSync: (f, t, o) => { order.push(path.basename(f)); fs.writeFileSync(f, t, o); } }) });
  st.write(st.serialize(cfg()));
  assert.strictEqual(order[order.length - 1], 'settings.json');
  st.write(st.serialize({ audio: { sensitivity: 3 } }));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'scenes.json'), 'utf8')), cfg().scenes);
});

test('eski biçim: dosyadaki dolu sahne öncelikli, v3.1.7nin boş listesi parçayı ezmiyor', () => {
  const dir = tmp();
  const st = Store.create(dir);
  st.write(st.serialize(cfg()));
  assert.deepStrictEqual(st.merge({ scenes: [{ id: 'eski' }] }).scenes, [{ id: 'eski' }]);
  assert.deepStrictEqual(st.merge({ scenes: [] }).scenes, cfg().scenes);
  const emptyLib = { ratings: {}, favorites: {}, tags: {}, textureRev: 0 };
  assert.deepStrictEqual(st.merge({ milkdropLibrary: emptyLib }).milkdropLibrary, cfg().milkdropLibrary);
  fs.writeFileSync(path.join(dir, 'scenes.json'), '{bozuk');
  assert.deepStrictEqual(st.merge({}).scenes, undefined, 'bozuk parça çökertmiyor');
  assert.strictEqual(st.merge(null), null);
});

test('öz test kapanışta üç dosyayı da eski hâline döndürüyor', () => {
  const dir = tmp();
  const st = Store.create(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"a":1}');
  const snap = st.snapshot();
  st.write(st.serialize(cfg()));
  assert.ok(fs.existsSync(path.join(dir, 'scenes.json')));
  st.restore(snap);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"a":1}');
  assert.strictEqual(fs.existsSync(path.join(dir, 'scenes.json')), false, 'önceden yoktu');
});

test('panel değişmeyen ağır anahtarı göndermiyor, ana süreç tamamlıyor', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /window\.api\.updateConfig\(fullPayload\(\)\)/);
  const main = read('src/main/main.js');
  assert.match(main, /const full = restoreKeptKeys\(config\)/);
  const fn = main.slice(main.indexOf('function restoreKeptKeys'), main.indexOf("ipcMain.on('update-config'"));
  assert.match(fn, /delete config\.__keep/);
  assert.match(fn, /KEPT_KEYS\.has\(k\)/, 'panelin yolladığı adla rastgele anahtar kopyalanmasın');
  assert.match(main, /settingsGuards = new Map/);
});
