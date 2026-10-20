'use strict';
/* Ses köprüsü son tur düzeltmeleri (#813): panelin canlı kutuları, tema,
   kısık başlayan çalma ve yankı uyarısı. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const B = require('../src/main/audio-bridge.js');

test('panel: köprünün canlı ölçümü seyrek ve yalnız görünürken gidiyor; yalnız canlı kutular yenileniyor', () => {
  const M = read('src/main/main.js');
  assert.match(M, /if \(!bridge\.sender \|\| !adminWin \|\| adminWin\.isDestroyed\(\) \|\| !adminWin\.isVisible\(\) \|\| adminWin\.isMinimized\(\)\) return;/);
  assert.match(M, /if \(now - adminBridgeLevelAt < 150\) return;/);
  assert.match(M, /if \(a\) pushAdminBridgeLevel\(a\);/);
  assert.ok(read('src/main/preload-admin.js').includes("onBridgeLive: (cb) => ipcRenderer.on('bridge-live'"));
  const P = read('src/admin/bridge-panel.js');
  assert.match(P, /box\.replaceChildren\(\.\.\.liveTiles\(status\.analysis\)\);/);
  assert.match(P, /el\('div', \{ class: 'br-grid br-live' \}, liveTiles\(a\)\)/);
});

test('durum penceresi temayı canlı izliyor', () => {
  const M = read('src/main/main.js');
  assert.match(M, /function syncAdminBackground\(\) \{\n  syncBridgeWinTheme\(\);/);
  assert.match(M, /bridgeWin\.webContents\.send\('bridge-win:theme', \{ id, dark \}\);/);
  assert.match(M, /nativeTheme\.on\('updated', syncAdminBackground\)/);
  assert.ok(read('src/main/preload-bridge-status.js').includes("onTheme: (cb) => ipcRenderer.on('bridge-win:theme'"));
  assert.match(read('src/bridge-status/status.js'), /window\.SVUiThemes\.apply\(document, t\.id, !!t\.dark\)/);
});

test('çalma kısık başlıyor; çıkış yakalanan aygıtsa yankı uyarısı', () => {
  assert.strictEqual(B.normalize({}).playVolume, 0.3);
  assert.strictEqual(B.normalize({}).playVolumeSet, false);
  assert.match(read('src/shared/defaults.js'), /playVolume: 0\.3,\n\s+playVolumeSet: false,/);
  const P = read('src/admin/bridge-panel.js');
  assert.match(P, /if \(v && !b\.playVolumeSet\) \{ b\.playVolume = Math\.min\(b\.playVolume == null \? 0\.3 : b\.playVolume, 0\.3\);/);
  assert.match(P, /if \(!b\.playDevice\) return !!\(status\.rxLocal \|\| status\.send\);/);
  assert.match(read('src/main/main.js'), /rxLocal: !!\(bridge\.receiver && isLocalAddress\(bridge\.receiver\.status\(\)\.host\)\),/);
  assert.ok(read('src/shared/i18n.js').includes("'Bu çıkış, bu makinede yakalanan sesle aynı olabilir: köprünün sesi yeniden yakalanıp yankı yapar. Başka bir çıkış seçin ya da sesi kısık tutun.':"));
});

test('köprü kaynak değiştirirken alıcılara haber veriyor', () => {
  const M = read('src/main/main.js');
  assert.match(M, /if \(bridge\.sender && lastCaptureSource && JSON\.stringify\(sources\) !== JSON\.stringify\(lastCaptureSource\)\) bridge\.sender\.switching\(3000\);/);
  assert.match(M, /onSwitching: \(ms\) => \{ if \(bridge\.input\) bridge\.input\.hold\(Date\.now\(\), ms\); \},/);
});
