'use strict';
/* YEDEKLİLİK — AYNI ZAMAN (#544): saat farkı kestirimi, gösteri saati
 * çıpasının çevrilmesi ve ortak oturum saati. İki makineli ölçüm
 * `npm run failover` (zaman çizelgesi birincilde oynarken yedeğin paneli:
 * ortanca 0 ms, p95 1 ms, aynı bilgisayarda).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const R = require('../src/main/redundancy.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function follower() {
  const f = R.createFollower({ role: 'backup', heartbeatMs: 100, timeoutMs: 1500 }, 0);
  f.connected();
  return f;
}

test('saat farkı: son 10 sn\'nin en küçük örneği; yedeğin duraklaması örneği büyütür, elenir', () => {
  const f = follower();
  // Yedeğin saati birincilden 5000 ms ileri, gecikme 2 ms
  f.beat({ at: 1000 }, 6002);
  assert.strictEqual(f.status.offsetMs, 5002, 'ilk örnek doğrudan');
  f.beat({ at: 1100 }, 6400); // yedek duraksadı: örnek 5300
  assert.strictEqual(f.status.offsetMs, 5002, 'büyük örnek en küçüğü değiştirmez');
  assert.strictEqual(f.toLocal(1234), 6236);
});

test('düzeltme sıçramaz: atış başına en çok 1 ms', () => {
  const f = follower();
  f.beat({ at: 0 }, 100); // fark 100
  // Birincilin saati 40 ms ileri alındı (NTP): yeni örnekler 60, en küçük hemen 60
  for (let i = 1; i <= 10; i++) f.beat({ at: i * 100 + 40 }, i * 100 + 100);
  assert.strictEqual(f.status.offsetMs, 90, 'atış başına 1 ms iniyor, sıçramıyor');
  for (let i = 11; i <= 60; i++) f.beat({ at: i * 100 + 40 }, i * 100 + 100);
  assert.strictEqual(f.status.offsetMs, 60);
  // Ters yön: saat geri alındı (örnekler 80). Eski en küçük (60) 10 sn
  // pencerede kalır; sonra fark atış başına 1 ms çıkar.
  for (let i = 61; i <= 150; i++) f.beat({ at: i * 100 - 20 }, i * 100 + 60);
  assert.strictEqual(f.status.offsetMs, 60, 'pencerede eski en küçük var');
  for (let i = 151; i <= 260; i++) f.beat({ at: i * 100 - 20 }, i * 100 + 60);
  assert.strictEqual(f.status.offsetMs, 80);
});

test('fark yokken çeviri olduğu gibi; sayı değilse dokunulmaz', () => {
  const f = follower();
  assert.strictEqual(f.toLocal(500), 500);
  assert.strictEqual(f.toLocal(undefined), undefined);
});

test('bağlantılar: birincil çıpayı ve oturum başlangıcını yollar; yedek çevirir, pencerelere ve panele verir', () => {
  const main = read('src/main/main.js');
  assert.match(main, /if \(red\.role === 'primary' && streamServer\.peerCount\(\)\) streamServer\.sendPeers\(\{ type: 'show-clock', anchor: showClockAnchor \}\);/);
  assert.match(main, /type: 'hello', version: app\.getVersion\(\), role: 'primary', start: red\.sessionStart/);
  assert.match(main, /\{ gap, start: red\.sessionStart \}/);
  assert.match(main, /if \(a && Number\.isFinite\(a\.epoch\)\) a\.epoch = f\.toLocal\(a\.epoch\);/);
  assert.match(main, /notifyAdmin\('show-clock-follow', showClockAnchor\);/);
  assert.match(main, /sendToVisualizers\('shared-clock', \{ epoch: e \}\);/);
  // Sonradan açılan ekran da ortak saati alır (iki yerde)
  assert.strictEqual((main.match(/win\.webContents\.send\('shared-clock', \{ epoch: red\.sharedSent \}\)/g) || []).length, 2);
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /const ts = \(performance\.timeOrigin \+ performance\.now\(\) - sharedEpoch\) \/ 1000;/);
  assert.match(vis, /modulator\.update\(base, audio, ts, dt, \{ bpm, beatPhase:/);
  assert.match(vis, /modulator\.update\(base, audio, t, dt\);/, 'rol kapalıyken eski davranış');
  assert.match(read('src/main/preload-visualizer.js'), /onSharedClock: \(cb\) => ipcRenderer\.on\('shared-clock'/);
  const tl = read('src/admin/timeline-panel.js');
  assert.match(tl, /function followAnchor\(a\) \{/);
  assert.match(tl, /\n    followAnchor,\n/);
  assert.match(read('src/admin/redundancy-panel.js'), /window\.SVTimelinePanel\.followAnchor\(a\)/);
});

test('ortak saat Unix zamanı değil, oturum başlangıcından: shader float32 zamanı adım adım ilerlemesin', () => {
  const main = read('src/main/main.js');
  assert.match(main, /sessionStart: Date\.now\(\),/);
  // float32 ile 1e9 saniyede adım 64 sn; oturum başından birkaç saatte milisaniye altı
  assert.ok(Math.fround(1.7e9 + 0.016) - Math.fround(1.7e9) !== 0.016);
  assert.ok(Math.abs(Math.fround(3600.016) - Math.fround(3600) - 0.016) < 0.001);
});
