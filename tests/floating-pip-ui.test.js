'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8');

test('PiP anahtarı Ekran kartında ve durumla senkron', () => {
  const admin = read('src/admin/admin.js');
  assert.match(admin, /case 'floatingtoggle':/);
  assert.match(admin, /function floatingToggleCtrl/);
  assert.match(admin, /data-sv-floating-toggle/);
  assert.match(admin, /updateFloatingToggles/);
  assert.match(admin, /setStatus\(open, displayIds, floating\)/);
  assert.match(admin, /onVisualizerStatus\(\(d\) => setStatus\(d\.open, d\.displayIds, d\.floating\)\)/);
  /* Ust cubuk Ekranlar menusunun en altinda da PiP */
  assert.match(admin, /class: 'dm-pip'/);
  const display = admin.slice(admin.indexOf("id: 'display'"), admin.indexOf("id: 'display'") + 900);
  assert.match(display, /floatingtoggle/);
  assert.doesNotMatch(display, /toggleFloating/);
});

test('gorsellestirici F11 windowed: surukleme + geometri kilidi', () => {
  const main = read('src/main/main.js');
  assert.match(main, /leave-full-screen/);
  assert.match(main, /enter-full-screen/);
  assert.match(main, /applyGeometryLockToWin/);
  assert.match(main, /visualizer:geometry-lock/);
  assert.match(main, /window-chrome/);
  assert.match(main, /geometryLock/);
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /sv-win-bar/);
  assert.match(vis, /onWindowChrome/);
  assert.match(vis, /setGeometryLock/);
  const css = read('src/visualizer/visualizer.css');
  assert.match(css, /#sv-win-bar/);
  assert.match(css, /-webkit-app-region:\s*drag/);
  const def = read('src/shared/defaults.js');
  assert.match(def, /geometryLock:\s*false/);
  const pre = read('src/main/preload-visualizer.js');
  assert.match(pre, /setGeometryLock/);
  assert.match(pre, /onWindowChrome/);
});
