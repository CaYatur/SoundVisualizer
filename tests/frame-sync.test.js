'use strict';
/* KARE EŞLEMESİ (#543): aynı makinedeki çıkış pencereleri aynı dikey
 * senkronda AYNI `t`yi hesaplar. Ölçüm (iki ekran, 4 sn, 241 kare):
 * aynı senkrona düşen karelerde `t` farkı ortanca 0, en çok 0,1 ms;
 * eskiden pencerelerin açılış farkı kadar (49–53 ms).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// visualizer.js'teki formülün aynısı: iki pencere, farklı açılış anı, aynı senkron
function tOf(timeOrigin, rafNow, epoch) { return (timeOrigin + rafNow - epoch) / 1000; }

test('farklı anlarda açılan iki pencere aynı senkronda aynı t\'yi hesaplar', () => {
  const epoch = 1_760_000_000_000;
  const vsync = epoch + 3_600_000.25; // oturumun birinci saati
  const a = { origin: epoch + 1200.4 }; // ilk pencere 1,2 sn sonra açıldı
  const b = { origin: epoch + 1253.1 }; // ikincisi 53 ms sonra
  const ta = tOf(a.origin, vsync - a.origin, epoch);
  const tb = tOf(b.origin, vsync - b.origin, epoch);
  assert.ok(Math.abs(ta - tb) < 1e-6, ta + ' / ' + tb);
  // Eski formül: her pencere kendi açılışından
  assert.ok(Math.abs((vsync - a.origin) / 1000 - (vsync - b.origin) / 1000 - 0.0527) < 1e-6);
});

test('t dikey senkron damgasından (rAF), çağrı anından değil; ortak saat yoksa eski davranış', () => {
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /const t = sharedEpoch != null \? \(performance\.timeOrigin \+ now - sharedEpoch\) \/ 1000 : now \/ 1000;/);
  assert.doesNotMatch(vis, /performance\.timeOrigin \+ performance\.now\(\) - sharedEpoch/, 'modülasyon da aynı t');
});

test('ortak saat her zaman var: yedeklilik kapalıyken bu makinenin oturum başlangıcı', () => {
  const main = read('src/main/main.js');
  const fn = main.slice(main.indexOf('function sharedEpoch()'), main.indexOf('function syncSharedClock('));
  assert.match(fn, /return red\.sessionStart;\n\}/);
  assert.doesNotMatch(fn, /return null;/);
});

test('pencere açılışta saati ister: dinleyiciden önce gelen ileti kaybolmasın', () => {
  const main = read('src/main/main.js');
  assert.match(main, /ipcMain\.handle\('shared-clock:get', \(\) => \(\{ epoch: red\.sharedSent != null \? red\.sharedSent : sharedEpoch\(\) \}\)\);/);
  assert.match(read('src/main/preload-visualizer.js'), /getSharedClock: \(\) => ipcRenderer\.invoke\('shared-clock:get'\)/);
  const vis = read('src/visualizer/visualizer.js');
  const reg = vis.indexOf('window.api.onSharedClock((c)');
  const ask = vis.indexOf('window.api.getSharedClock().then(');
  assert.ok(reg > 0 && ask > reg, 'önce dinleyici, sonra istek');
});

test('ölçüm kancası yalnız açıkça kurulunca yazar ve sınırlı', () => {
  assert.match(read('src/visualizer/visualizer.js'), /if \(window\.__svFrameLog && window\.__svFrameLog\.length < 5000\) window\.__svFrameLog\.push\(\[performance\.timeOrigin \+ now, t\]\);/);
});
