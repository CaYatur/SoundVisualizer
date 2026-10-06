'use strict';
/* Görselleştirme açıkken ekran uyanık kalır (#695).

   Chromium tuval çizimi için ekranı uyanık tutmuyor; uygulama da hiçbir
   şey istemiyordu. Güç planında ekran kapanma süresi varsa gösteri
   ortasında çıkış kararıyordu. Görünür bir çıkış penceresi açıkken
   'prevent-display-sleep' tutulur; ayar varsayılan açık, kapatılabilir.
   Electron'un powerSaveBlocker'ı Windows, macOS ve Linux'ta çalışır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const M = read('src/main/main.js');

function rig() {
  const a = M.indexOf('let keepAwakeId = null;');
  const b = M.indexOf('function notifyVisualizerStatus()');
  assert.ok(a > 0 && b > a, 'blok');
  const held = new Map();
  let seq = 0;
  const ctx = {
    powerSaveBlocker: {
      start: (type) => { const id = ++seq; held.set(id, type); return id; },
      stop: (id) => { held.delete(id); },
      isStarted: (id) => held.has(id),
    },
    wins: [],
    currentConfig: { power: {} },
    quitting: false,
    setTimeout,
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
  };
  ctx.openWindows = () => ctx.wins;
  vm.createContext(ctx);
  vm.runInContext(M.slice(a, b) + '\nthis.api = { syncKeepAwake, watchKeepAwake };', ctx);
  const win = (visible, minimized) => ({ isVisible: () => visible, isMinimized: () => minimized });
  return { ctx, held, api: ctx.api, win };
}

test('pencere açıkken ekran uyanık tutulur, kapanınca bırakılır', () => {
  const { ctx, held, api, win } = rig();
  api.syncKeepAwake();
  assert.strictEqual(held.size, 0, 'pencere yokken tutulmamalı');
  ctx.wins = [win(true, false)];
  api.syncKeepAwake();
  assert.deepStrictEqual([...held.values()], ['prevent-display-sleep']);
  api.syncKeepAwake();
  assert.strictEqual(held.size, 1, 'ikinci kez başlatılmamalı');
  ctx.wins = [];
  api.syncKeepAwake();
  assert.strictEqual(held.size, 0);
});

test('küçültülen ya da gizli pencere ekranı tutmaz', () => {
  const { ctx, held, api, win } = rig();
  ctx.wins = [win(true, true), win(false, false)];
  api.syncKeepAwake();
  assert.strictEqual(held.size, 0);
  ctx.wins.push(win(true, false));
  api.syncKeepAwake();
  assert.strictEqual(held.size, 1);
});

test('ayar kapatılınca ve uygulama kapanırken bırakılır', () => {
  const { ctx, held, api, win } = rig();
  ctx.wins = [win(true, false)];
  api.syncKeepAwake();
  ctx.currentConfig.power.keepAwake = false;
  api.syncKeepAwake();
  assert.strictEqual(held.size, 0, 'kapalı ayar');
  ctx.currentConfig.power.keepAwake = true;
  api.syncKeepAwake();
  assert.strictEqual(held.size, 1);
  ctx.quitting = true;
  api.syncKeepAwake();
  assert.strictEqual(held.size, 0, 'kapanış');
});

/* Canlıda tam ekran pencere geri açılınca 'restore' gelmedi, yalnız
   'focus' geldi; durum da olaydan sonra güncelleniyor. Geri açılan pencere
   ekranı yeniden tutmuyordu. */
test('pencere olayları ekranı biraz sonra yeniden değerlendirir', async () => {
  const { ctx, held, api } = rig();
  const handlers = {};
  api.watchKeepAwake({ on: (ev, fn) => { handlers[ev] = fn; } });
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['closed', 'focus', 'hide', 'minimize', 'restore', 'show']);
  let minimized = true;
  ctx.wins = [{ isVisible: () => !minimized, isMinimized: () => minimized }];
  handlers.focus();
  minimized = false; // durum olaydan sonra güncelleniyor
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(held.size, 1, 'geri açılan pencere ekranı tutmalı');
});

test('ayar varsayılan açık, panelde ve İngilizcede var, her yoldan çağrılıyor', () => {
  global.window = global.window || {};
  const SV = require('../src/shared/defaults.js');
  const def = (SV.defaultConfig || global.window.SV.defaultConfig)();
  assert.strictEqual(def.power.keepAwake, true);
  const at = M.indexOf('function notifyVisualizerStatus()');
  assert.match(M.slice(at, at + 120), /syncKeepAwake\(\);/);
  assert.strictEqual((M.match(/watchKeepAwake\(win\);/g) || []).length, 2, 'ekran pencereleri ve yüzen pencere');
  assert.match(M, /syncCapture\(\);\s*syncKeepAwake\(\);\s*syncMcp\(\);/);
  assert.match(M, /syncKeepAwake\(\); \/\/ quitting/);
  const A = read('src/admin/admin.js');
  assert.match(A, /path: 'power\.keepAwake', label: 'Görselleştirme Açıkken Ekranı Uyanık Tut'/);
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'Görselleştirme Açıkken Ekranı Uyanık Tut': 'Keep the Display Awake While Visualizing'"));
});
