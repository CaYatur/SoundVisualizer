'use strict';
/* v3.1.5 öncesi genel kontrolde bulunan hatalar (#695). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/* Pencere çubuğundaki kilit ayarı değiştiriyor ama kaydetmiyordu; panel
   dış ayarı geri göndermediği için kilit sonraki açılışta kayboluyordu. */
test('pencere çubuğundaki konum kilidi kaydediliyor', () => {
  const M = read('src/main/main.js');
  const at = M.indexOf("ipcMain.on('visualizer:geometry-lock'");
  assert.ok(at > 0);
  const h = M.slice(at, M.indexOf('\n});', at));
  assert.match(h, /if \(!currentConfig\) return;/);
  assert.match(h, /geometryLock: !!locked/);
  assert.match(h, /saveSettings\(currentConfig\);/);
  assert.match(h, /notifyAdmin\('external-config', currentConfig\);/);
});

/* Işık kategorisinin açıklaması her platformda yalnız Windows Dynamic
   Lighting'i anıyordu; kategoride OpenRGB ve Art-Net de var, macOS ve
   Linux'ta Dynamic Lighting kartı hiç yok. */
test('ışık kategorisinin açıklaması platforma bağlı değil ve çevrili', () => {
  const A = read('src/admin/admin.js');
  const m = A.match(/id: 'lighting', icon: 'bulb', title: 'Işık',\s*desc: '((?:[^'\\]|\\.)*)'/);
  assert.ok(m, 'ışık kategorisi');
  const desc = m[1].replace(/\\'/g, "'");
  assert.ok(!desc.startsWith('Windows'), desc);
  assert.match(desc, /OpenRGB/);
  assert.match(desc, /Art-Net/);
  const I = read('src/shared/i18n.js');
  assert.ok(I.includes("'" + m[1] + "': 'Drive RGB devices"), 'İngilizcesi yok');
});
