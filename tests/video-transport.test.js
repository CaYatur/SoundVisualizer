'use strict';
/* VİDEO TAŞIMA (#905): hız, giriş/çıkış noktası, vuruşa kilitli döngü ve konum sarma.
   Canlı ölçüldü (Electron, 10 sn deneme videosu, çıkış penceresindeki oynatıcının konumu):
   düz 250 ms'de +0,25; hız 2'de +0,51; 2-4 sn bölgesinde 3,73 → 2,04 sarıyor, dışına çıkmıyor;
   120 BPM'de 4 vuruşluk döngü her 2 sn'de başa dönüyor (1,87 → 0,14); %70 sarma → 7,15 sn. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

global.window = global.window || {};
global.document = global.document || { createElement: () => ({}) };
require('../src/visualizer/modes/media.js');
const T = global.window.SVMediaTransport;

test('varsayılanlarla eski formülün aynısı: dışa aktarım ve mevcut sahneler değişmiyor', () => {
  const old = (s, d, loop) => (loop ? s % d : Math.min(s, Math.max(0, d - 0.001)));
  for (const d of [3.2, 10, 61.5]) {
    for (const s of [0, 0.4, 3.19, 3.2, 9.99, 25.3, 130]) {
      for (const loop of [true, false]) {
        assert.ok(Math.abs(T.transportTime(s, d, { loop }, 120) - old(s, d, loop)) < 1e-9, d + '/' + s + '/' + loop);
      }
    }
  }
  assert.strictEqual(T.transportOn({}), false);
  assert.strictEqual(T.transportOn({ speed: 1, inPoint: 0, outPoint: 0, loopBeats: 0 }), false);
});

test('hız, bölge ve döngüsüz bölge', () => {
  assert.strictEqual(T.transportTime(3, 10, { speed: 2 }), 6);
  assert.strictEqual(T.transportTime(5, 10, { inPoint: 2, outPoint: 6 }), 3, '2 + (5 % 4)');
  assert.ok(Math.abs(T.transportTime(50, 10, { inPoint: 2, outPoint: 6, loop: false }) - 5.999) < 1e-9, 'döngü yoksa bölgenin sonunda durur');
  assert.strictEqual(T.transportTime(1, 10, { speed: 9 }), 4, 'hız en çok 4');
  assert.strictEqual(T.transportTime(1, 10, { inPoint: 5, outPoint: 5.01 }), 1, 'boş bölge yok sayılır');
  assert.strictEqual(T.transportTime(1, 10, { outPoint: 40 }), 1, 'çıkış süreyi aşamaz');
  assert.ok(T.transportOn({ speed: 0.5 }) && T.transportOn({ inPoint: 1 }) && T.transportOn({ loopBeats: 4 }));
});

test('vuruşa kilitli döngü: N vuruşta bir baştan, tempo yoksa bölge döngüsü', () => {
  // 120 BPM, 4 vuruş = 2 sn
  assert.deepStrictEqual([0, 1.9, 2, 2.5, 4.25].map((s) => +T.transportTime(s, 30, { loopBeats: 4 }, 120).toFixed(3)), [0, 1.9, 0, 0.5, 0.25]);
  // Bölge vuruş uzunluğundan kısaysa bölgede kalır
  assert.ok(T.transportTime(1.9, 30, { loopBeats: 4, inPoint: 1, outPoint: 2 }, 120) < 2);
  // Hızla birlikte: 2 kat hızda bölüm videonun 4 sn'si, yine 2 sn'de baştan
  assert.strictEqual(+T.transportTime(1.5, 30, { loopBeats: 4, speed: 2 }, 120).toFixed(3), 3);
  assert.strictEqual(+T.transportTime(2.1, 30, { loopBeats: 4, speed: 2 }, 120).toFixed(3), 0.2);
  assert.strictEqual(T.transportTime(5, 30, { loopBeats: 4 }, 0), 5, 'tempo yok: bölge döngüsü');
  assert.strictEqual(T.tempoOf({ modulation: { bpm: 128 } }), 128);
  assert.strictEqual(T.tempoOf({}), 120, "LFO'larla aynı varsayılan");
});

test('canlı oynatıcı, çizelge ve dışa aktarım aynı formülü kullanıyor', () => {
  const m = read('src/visualizer/modes/media.js');
  assert.match(m, /seekTimeline\(sec\) \{[\s\S]{0,200}const target = transportTime\(sec, d, Object\.assign\(\{\}, this\._m, \{ loop: v\.loop \}\), this\._bpm \|\| 0\);/);
  assert.match(m, /async seekTo\(sec\) \{[\s\S]{0,500}const target = transportTime\(sec, d, Object\.assign\(\{\}, this\._m, \{ loop: v\.loop \}\), this\._bpm \|\| 0\);/);
  assert.match(m, /if \(this\._source === 'file' && !this\.offline && !this\._relay && transportOn\(m\)\) this\._steer\(m, t\);/);
  assert.match(m, /if \(Math\.abs\(v\.playbackRate - speed\) > 1e-3\) v\.playbackRate = speed;/);
});

test('konum sarma: panel → ana süreç → her çıkış ve panel önizlemesi; ayara yazılmıyor', () => {
  assert.match(read('src/main/preload-admin.js'), /sendMediaScrub: \(m\) => ipcRenderer\.send\('media-scrub', m\),/);
  assert.match(read('src/main/preload-visualizer.js'), /onMediaScrub: \(cb\) => ipcRenderer\.on\('media-scrub', \(e, m\) => cb\(m\)\),/);
  const main = read('src/main/main.js');
  assert.match(main, /ipcMain\.on\('media-scrub', \(e, m\) => \{[\s\S]{0,300}sendToVisualizers\('media-scrub', \{ layerId, frac \}\);/);
  assert.match(read('src/visualizer/visualizer.js'), /window\.api\.onMediaScrub\(\(m\) => \{ if \(stack && m\) stack\.scrubMedia\(m\.layerId, m\.frac\); \}\);/);
  assert.match(read('src/visualizer/layers.js'), /scrubMedia\(layerId, frac\) \{/);
  const sp = read('src/admin/scene-panels.js');
  assert.match(sp, /window\.api\.sendMediaScrub\(\{ layerId: l\.id \|\| '', frac: v \}\)/);
  assert.match(sp, /if \(st && st\.scrubMedia\) st\.scrubMedia\(l\.id \|\| '', v\);/);
});

test('ayarlar: varsayılanlar, sınırlar ve İngilizce metinler', () => {
  require('../src/shared/defaults.js');
  const d = global.window.SV.DEFAULT_CONFIG.media;
  assert.deepStrictEqual([d.speed, d.inPoint, d.outPoint, d.loopBeats], [1, 0, 0, 0]);
  const sch = read('src/shared/schema.js');
  assert.match(sch, /\{ path: 'media\.speed', min: 0\.25, max: 4, noExtend: true \},/);
  const i18n = read('src/shared/i18n.js');
  for (const k of ['Giriş Noktası', 'Çıkış Noktası', 'sona kadar', 'Vuruşa Kilitli Döngü', '4 vuruş (1 ölçü)', 'Konum']) assert.ok(i18n.includes("'" + k + "':"), k);
});

test('sese göre hız: sessizlikte en düşük, bant en güçlüyken en yüksek hız', () => {
  const m = { speedReact: true, speedBand: 'bass', speedMin: 0.5, speedMax: 2, speedSmooth: 0 };
  assert.strictEqual(T.audioRate(m, { bass: 0 }, 0, 0.016), 0.5);
  assert.strictEqual(T.audioRate(m, { bass: 1 }, 0, 0.016), 2);
  assert.strictEqual(T.audioRate(m, { bass: 0.5 }, 0, 0.016), 1.25);
  assert.strictEqual(T.audioRate(m, { bass: 9 }, 0, 0.016), 2, 'şiddet sınırı aşmaz');
  assert.strictEqual(T.audioRate(m, null, 0, 0.016), 0.5, 'ses yoksa en düşük hız');
});

test('sese göre hız: seçilen bant okunur, sınırlar ters girilse de çalışır', () => {
  const audio = { bass: 0, mid: 1, treble: 0.5, level: 0.25 };
  const at = (speedBand) => T.audioRate({ speedBand, speedMin: 1, speedMax: 3, speedSmooth: 0 }, audio, 0, 0.016);
  assert.strictEqual(at('bass'), 1);
  assert.strictEqual(at('mid'), 3);
  assert.strictEqual(at('treble'), 2);
  assert.strictEqual(at('level'), 1.5);
  assert.strictEqual(T.audioRate({ speedMin: 3, speedMax: 1, speedSmooth: 0 }, { bass: 0 }, 0, 0.016), 1);
});

test('sese göre hız: yumuşatma ani sıçramayı süreye yayar', () => {
  const m = { speedMin: 1, speedMax: 3, speedSmooth: 0.2 };
  const one = T.audioRate(m, { bass: 1 }, 1, 0.016);
  assert.ok(one > 1 && one < 1.3, String(one));
  let r = 1;
  for (let i = 0; i < 120; i++) r = T.audioRate(m, { bass: 1 }, r, 0.016);
  assert.ok(Math.abs(r - 3) < 0.01, String(r));
});

test('sese göre hız varsayılan kapalı; vuruşa kilitli döngü açıkken devreye girmez', () => {
  assert.strictEqual(T.speedReactOn({}), false);
  assert.strictEqual(T.transportOn({ speedReact: false }), false);
  assert.strictEqual(T.speedReactOn({ speedReact: true }), true);
  assert.strictEqual(T.transportOn({ speedReact: true }), true);
  assert.strictEqual(T.speedReactOn({ speedReact: true, loopBeats: 4 }), false);
  const panel = read('src/admin/scene-panels.js');
  for (const k of ['speedReact', 'speedBand', 'speedMin', 'speedMax', 'speedSmooth']) assert.ok(panel.includes(k), k);
});
