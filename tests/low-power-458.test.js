'use strict';
/* DÜŞÜK GÜÇ KİPİ (#458). Asıl kural: kapalıyken hiçbir şey değişmiyor, açıkken
   yalnız çizilen kopya değişiyor, dışa aktarım ve OBS kaynağı hiç etkilenmiyor. */
global.window = global.window || {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('../src/shared/defaults.js');
const LP = require('../src/shared/low-power.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8').replace(/\r\n/g, '\n');
const base = () => window.SV.defaultConfig();
const withMode = (lowPower, over) => {
  const c = base();
  c.power.lowPower = lowPower;
  return Object.assign(c, over || {});
};

test('varsayılan kapalı; kapalıyken aynı nesne dönüyor', () => {
  const c = base();
  assert.strictEqual(c.power.lowPower, 'off');
  assert.strictEqual(LP.apply(c, false), c);
  assert.strictEqual(LP.apply(c, true), c, 'pilde de kapalı');
  assert.strictEqual(LP.apply(null, true), null);
});

test('"pildeyken" yalnız pilde, "her zaman" her durumda', () => {
  const b = withMode('battery');
  assert.strictEqual(LP.apply(b, false), b);
  assert.notStrictEqual(LP.apply(b, true), b);
  assert.strictEqual(LP.active(b, true), true);
  assert.strictEqual(LP.active(b, false), false);
  const on = withMode('on');
  assert.notStrictEqual(LP.apply(on, false), on);
  assert.strictEqual(LP.active(on, false), true);
  assert.strictEqual(LP.active(withMode('bilinmeyen'), true), false);
});

test('sınırlar: kare hızı, çözünürlük, MilkDrop, önizleme', () => {
  const c = LP.apply(withMode('on'), false);
  assert.strictEqual(c.power.fpsCap, 30);
  assert.strictEqual(c.power.renderScale, 0.75);
  assert.strictEqual(c.power.previewRate, 'low');
  assert.strictEqual(c.milkdrop.maxSize, 1280);
  assert.strictEqual(c.milkdrop.mesh, 32);
  assert.strictEqual(c.milkdrop.renderScale, 1);
});

test('yalnız aşağı çekiyor: kullanıcının daha düşük seçimi kalıyor', () => {
  const c = withMode('on');
  c.power.fpsCap = 24;
  c.power.renderScale = 0.5;
  c.milkdrop = Object.assign({}, c.milkdrop, { maxSize: 960, mesh: 16, renderScale: 0.5 });
  const r = LP.apply(c, false);
  assert.strictEqual(r.power.fpsCap, 24);
  assert.strictEqual(r.power.renderScale, 0.5);
  assert.strictEqual(r.milkdrop.maxSize, 960);
  assert.strictEqual(r.milkdrop.mesh, 16);
  assert.strictEqual(r.milkdrop.renderScale, 0.5);
  const high = withMode('on');
  high.power.fpsCap = 120;
  assert.strictEqual(LP.apply(high, false).power.fpsCap, 30);
});

test('efektler kapanıyor ama yerinde kalıyor: modülasyon yanlış efekte yazmıyor', () => {
  const fx = [{ type: 'bloom', enabled: true, params: { a: 1 } }, { type: 'crt', enabled: true }];
  const c = withMode('on', { postfx: fx, layers: [{ id: 'a', postfx: [{ type: 'bloom', enabled: true }] }, { id: 'b' }] });
  const r = LP.apply(c, false);
  assert.strictEqual(r.postfx.length, 2);
  assert.ok(r.postfx.every((f) => f.enabled === false));
  assert.strictEqual(r.postfx[0].params.a, 1);
  assert.strictEqual(r.layers[0].postfx[0].enabled, false);
  assert.strictEqual(r.layers[1], c.layers[1], 'efektsiz katman kopyalanmıyor');
});

test('kayıtlı ayar değişmiyor', () => {
  const c = withMode('on', { postfx: [{ type: 'bloom', enabled: true }], layers: [{ id: 'a', postfx: [{ type: 'crt', enabled: true }] }] });
  const before = JSON.stringify(c);
  LP.apply(c, false);
  assert.strictEqual(JSON.stringify(c), before);
});

test('dışa aktarım ve web çıkışı bu kipi hiç görmüyor', () => {
  assert.doesNotMatch(read('src/exporter/index.html'), /low-power/);
  assert.doesNotMatch(read('src/exporter/exporter.js'), /SVLowPower/);
  // Web çıkışı sayfanın betiğini paylaşıyor; kapı köprüde, web-shim'de o yok
  assert.doesNotMatch(read('src/web/web-shim.js'), /getPowerSource/);
  assert.match(read('src/visualizer/visualizer.js'), /if \(window\.SVLowPower && window\.api\.getPowerSource\) cfg = /);
  for (const page of ['src/visualizer/index.html', 'src/admin/index.html']) assert.match(read(page), /shared\/low-power\.js/);
});

test('pencere ve önizleme: çizim kopyaya, güç kaynağı değişince yeniden', () => {
  const V = read('src/visualizer/visualizer.js');
  assert.match(V, /cfg = window\.SV\.deepMerge\(window\.SV\.defaultConfig\(\), newCfg\);\s*\/\*[\s\S]*?\*\/\s*if \(window\.SVLowPower && window\.api\.getPowerSource\) cfg = window\.SVLowPower\.apply\(cfg, onBattery\);/);
  assert.match(V, /window\.api\.onPowerSource\(followPower\)/);
  assert.match(V, /applyConfig\(rawCfg\)/);
  const P = read('src/admin/preview.js');
  assert.match(P, /if \(window\.SVLowPower\) cfg = window\.SVLowPower\.apply\(cfg, onBattery\);/);
  const M = read('src/main/main.js');
  assert.match(M, /ipcMain\.handle\('power:source'/);
  assert.match(M, /powerMonitor\.on\('on-battery', tell\);/);
  assert.match(M, /powerMonitor\.on\('on-ac', tell\);/);
  assert.match(M, /sendToVisualizers\('power-source', s\);/);
  for (const f of ['src/main/preload-admin.js', 'src/main/preload-visualizer.js']) {
    assert.match(read(f), /onPowerSource: \(cb\) =>/);
    assert.match(read(f), /getPowerSource: \(\) => ipcRenderer\.invoke\('power:source'\)/);
  }
});

test('ayar panelde ve çevirisi var', () => {
  assert.match(read('src/admin/admin.js'), /path: 'power\.lowPower'/);
  const i18n = read('src/shared/i18n.js');
  for (const s of ['Düşük Güç Kipi', 'Pildeyken', 'Her zaman', 'Kare hızını 30\'a indirir, efektleri kapatır, MilkDrop ve arka plan çözünürlüğünü düşürür. Dışa aktarımı ve OBS kaynağını etkilemez.']) {
    assert.ok(i18n.includes(s + "':") || i18n.includes(s.replace(/'/g, "\\'") + "':"), s);
  }
});
