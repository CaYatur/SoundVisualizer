'use strict';
/* Kimlik çakışması.

   Kimlikler "zaman + 0..65535 rastgele" biçimindeydi. Aynı milisaniyede
   üretilen iki kimlik 1/65536 olasılıkla aynı çıkıyordu; binlerce presetlik
   bir içe aktarımda (paket ya da bulunan kütüphane) bu kesinliğe yakın ve
   bir preset ötekinin dosyasının üstüne yazılıyor. CI'da paket içe aktarım
   testi tam olarak buna düştü: iki preset aynı kimliği aldı ve ikincinin
   kitaplık kaydı birincinin puanını sildi. Artık süreç içi bir sayaç var. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
global.window = global.window || {};
require('../src/shared/defaults.js');
require('../src/shared/presets.js');
const IS = global.window.SVPresets;

test('paket içe aktarımı: 20 000 preset aynı milisaniyelerde bile ayrı kimlik alıyor', () => {
  const presets = [];
  for (let i = 0; i < 20000; i++) presets.push({ name: 'p' + i, kind: 'milkdrop', engine: 'milkdrop', source: '[preset00]\n' });
  const read = IS.readImported({ format: 'svpack', presets });
  assert.strictEqual(read.ok, true);
  const ids = new Set(read.presets.map((p) => p.id));
  assert.strictEqual(ids.size, 20000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,80}$/, 'depo dosya adıyla uyumlu');
});

test('depo: kimliksiz toplu kayıtta her preset kendi dosyasına yazılıyor', () => {
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
    return origLoad.apply(this, arguments);
  };
  let STORE;
  try { STORE = require('../src/main/presets-store.js'); } finally { Module._load = origLoad; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-ids-'));
  try {
    STORE.setDir(dir);
    const list = [];
    for (let i = 0; i < 3000; i++) list.push({ kind: 'milkdrop', name: 'p' + i, source: '[preset00]\nfDecay=0.9' + (i % 10) + '\n' });
    const saved = STORE.saveMany(list);
    assert.strictEqual(saved.length, 3000);
    assert.strictEqual(new Set(saved.map((p) => p.id)).size, 3000, 'kimlikler ayrı');
    assert.strictEqual(fs.readdirSync(dir).length, 3000, 'hiçbir dosya ötekinin üstüne yazılmadı');
  } finally {
    STORE.setDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('katman ve efekt kimlikleri de sayaçlı', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
  assert.match(read('visualizer/layers.js'), /layerIdSeq = \(layerIdSeq \+ 1\)/);
  assert.match(read('visualizer/postfx.js'), /fxIdSeq = \(fxIdSeq \+ 1\)/);
});
