'use strict';
/* Katman satırı işlemleri (#957): ad değişikliği geri dönmesin, Kaldır çalışsın, sağ tık menüsü
   aynı yolu kullansın. Kök neden: katman düzenleyicisi her çizimde listeye yeni nesne yazıyordu,
   denetçinin tuttuğu katman listeden kopuyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8').replace(/\r\n/g, '\n');
const shellSrc = read('src/admin/scene-shell.js');
const panelsSrc = read('src/admin/scene-panels.js');
const layersSrc = read('src/visualizer/layers.js');
const i18n = read('src/shared/i18n.js');

// Kabuğu DOM'suz yükle: yalnız katman işlemleri sınanıyor
function load(cfg) {
  const store = new Map();
  const win = { SVPanel: { cfg: () => cfg, apply() { win.applied++; } }, applied: 0 };
  const sandbox = {
    window: win, document: { querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    setTimeout, console,
  };
  sandbox.module = { exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(layersSrc, sandbox);
  if (!win.SVLayers) win.SVLayers = sandbox.module.exports.SVLayers || sandbox.module.exports;
  vm.runInContext(shellSrc, sandbox);
  return win;
}
const mk = () => ({ layers: [
  { id: 'a', kind: 'background', type: 'gradient', name: 'Arkaplan' },
  { id: 'b', kind: 'visualizer', type: 'bars', name: 'Görselleştirici' },
  { id: 'c', kind: 'logo', name: 'Logo', locked: true },
] });

test('ad değişikliği güncel katmana yazılır, nesne yenilense de kalır', () => {
  const cfg = mk();
  const w = load(cfg);
  const stale = cfg.layers[1];
  cfg.layers[1] = Object.assign({}, stale); // düzenleyicinin yenilemesi gibi
  assert.ok(w.SVSceneShell.layerAct.rename('b', '  Yeni Ad  '));
  assert.strictEqual(cfg.layers[1].name, 'Yeni Ad');
  assert.ok(w.applied > 0);
  // Kayıt/yeniden yükleme: JSON gidiş-dönüşünde ad korunur
  assert.strictEqual(JSON.parse(JSON.stringify(cfg)).layers[1].name, 'Yeni Ad');
  assert.strictEqual(w.SVSceneShell.layerAct.rename('b', '   '), false, 'boş ad yazılmaz');
});

test('Kaldır katmanı kimlikle siler, kilitliyi silmez', () => {
  const cfg = mk();
  const w = load(cfg);
  cfg.layers[0] = Object.assign({}, cfg.layers[0]);
  assert.ok(w.SVSceneShell.layerAct.remove('a'));
  assert.deepStrictEqual(cfg.layers.map((l) => l.id), ['b', 'c']);
  assert.strictEqual(w.SVSceneShell.layerAct.remove('c'), false);
  assert.strictEqual(w.SVSceneShell.layerAct.remove('yok'), false);
});

test('çoğalt, taşı ve bayraklar', () => {
  const cfg = mk();
  const w = load(cfg);
  const A = w.SVSceneShell.layerAct;
  const id = A.duplicate('b');
  assert.ok(id && id !== 'b');
  assert.strictEqual(cfg.layers[2].id, id);
  assert.match(cfg.layers[2].name, /kopya/);
  assert.ok(A.move('a', 1));
  assert.deepStrictEqual(cfg.layers.map((l) => l.id).slice(0, 2), ['b', 'a']);
  assert.strictEqual(A.move('b', -1), false, 'en altta');
  A.flag('a', 'enabled');
  assert.strictEqual(cfg.layers[1].enabled, false);
  A.flag('a', 'muted');
  assert.strictEqual(cfg.layers[1].muted, true);
});

test('düzenleyici katmanı yerinde normalize eder (kimlik korunur)', () => {
  assert.match(panelsSrc, /Object\.assign\(raw, window\.SVLayers\.normalizeLayer\(raw\)\)/);
  assert.doesNotMatch(panelsSrc, /const l = \(list\[i\] = window\.SVLayers\.normalizeLayer\(raw\)\);/);
});

test('sağ tık menüsü: aynı işlemler, klavye, Esc ve çeviriler', () => {
  assert.match(shellSrc, /oncontextmenu: \(e\) => \{ e\.preventDefault\(\);[^\n]*openLayerMenu\(/);
  assert.match(shellSrc, /e\.key === 'ContextMenu' \|\| \(e\.key === 'F10' && e\.shiftKey\)/);
  for (const k of ['rename', 'duplicate', 'visible', 'solo', 'mute', 'lock', 'up', 'down', 'remove']) assert.ok(shellSrc.includes(`key: '${k}'`), k);
  assert.match(shellSrc, /item\('trash', 'Kaldır', \(\) => act\.remove\(id\)/);
  assert.match(shellSrc, /onclick: \(\) => act\.remove\(l\.id\)/, 'denetçideki Kaldır aynı yol');
  // Pencere sınırı ve Esc / dışarı tık placeMenu'de
  assert.match(shellSrc, /window\.innerWidth - r\.width - 8/);
  assert.match(shellSrc, /e\.key === 'Escape'/);
  for (const k of ['Yeniden Adlandır', 'Çoğalt', 'Gizle', 'Göster', 'Solo', 'Soloyu Kapat', 'Sessiz', 'Sesi Aç', 'Kilitle', 'Kilidi Aç', 'Öne Taşı', 'Arkaya Taşı', 'Kaldır', 'kopya']) {
    assert.ok(new RegExp(`^\\s*'${k}':`, 'm').test(i18n), 'EN çevirisi yok: ' + k);
  }
});
