'use strict';
/* Elle yüklenen sözün ortak saati. Çıpa durunca süre donar, durunca başa
 * döner, oynayınca bütün pencereler aynı Date.now() hesabını kullanır. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const clock = require('../src/shared/lyrics-clock.js');

test('söz saati oynatır, duraklatır ve başa alır', () => {
  clock.apply(null);
  const started = clock.command('play', 1000);
  assert.strictEqual(started.run, 'play');
  assert.strictEqual(started.time, 0);
  assert.strictEqual(clock.resolve(started, 3500), 2.5);
  const held = clock.command('pause', 3500);
  assert.strictEqual(held.run, 'pause');
  assert.strictEqual(held.time, 2.5);
  assert.strictEqual(clock.resolve(held, 9000), 2.5);
  const again = clock.command('play', 9000);
  assert.strictEqual(again.time, 2.5);
  assert.strictEqual(clock.resolve(again, 10000), 3.5);
  const stopped = clock.command('stop', 10000);
  assert.strictEqual(clock.resolve(stopped, 20000), 0);
  const fromStart = clock.command('play', 20000);
  assert.strictEqual(fromStart.time, 0);
  assert.strictEqual(clock.resolve(fromStart, 21000), 1);
});

test('çizim çıpa varken ekran açılış saatini bırakır', () => {
  global.window = global.window || {};
  global.window.SVLyricsClock = clock;
  require('../src/shared/defaults.js');
  global.window.SVLyrics = require('../src/shared/lyrics.js');
  delete global.window.SVLyricsSync;
  require('../src/visualizer/modes/text.js');
  const TextMode = global.window.SVModes.text;
  const lrc = '[00:00.00]START\n[00:10.00]MID\n[00:20.00]LATE\n';
  function draw() {
    const texts = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      clearRect() {}, scale() {}, translate() {}, strokeText() {}, fillRect() {},
      fillText(txt) { texts.push(txt); },
      measureText() { return { width: 20 }; },
    };
    new TextMode({ width: 800, height: 600, getContext: () => ctx }).draw(
      { level: 0, bass: 0 },
      { visualizer: { type: 'text', colorMode: 'custom' }, text: {
        enabled: true, source: 'lyrics', lyricsFollow: false, lyricsSource: lrc,
        animation: 'none', useCustomColor: true, color: '#fff',
      } },
      0,
      0.016
    );
    return texts.join(' ');
  }
  clock.apply({ run: 'pause', time: 20, epoch: 0 });
  assert.match(draw(), /LATE/);
  clock.apply(null);
  assert.match(draw(), /START/);
});

test('ekranlara uygulayınca durmuş söz hemen oynar', () => {
  assert.strictEqual(clock.startsOnOutput(null), true);
  assert.strictEqual(clock.startsOnOutput({ run: 'stop', time: 0, epoch: 1 }), true);
  assert.strictEqual(clock.startsOnOutput({ run: 'pause', time: 4, epoch: 1 }), false);
  assert.strictEqual(clock.startsOnOutput({ run: 'play', time: 0, epoch: 1 }), false);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const openAt = main.indexOf('function openVisualizer');
  const open = main.slice(openAt, main.indexOf('function configuredSources', openAt));
  assert.match(open, /armLyricsOnOutput\(\)/);
  const armAt = main.indexOf('function armLyricsOnOutput');
  const arm = main.slice(armAt, main.indexOf('function noteLyricsFile', armAt));
  assert.match(arm, /startsOnOutput\(lyricsClockAnchor\)/);
  assert.match(arm, /publishLyricsClock\(\{ run: 'play', time: 0, epoch: Date\.now\(\) \}\)/);
  const applyAt = main.indexOf('function applyIncomingConfig');
  const apply = main.slice(applyAt, applyAt + 500);
  const noteAt = apply.indexOf('noteLyricsFile(config)');
  const saveAt = apply.indexOf('saveSettings(config)');
  assert.ok(noteAt >= 0 && saveAt >= 0 && noteAt < saveAt);
});

test('web çıkışı sunucu saatiyle aynı sözü görür', () => {
  const root = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const server = read('src/main/stream-server.js');
  const shim = read('src/web/web-shim.js');
  assert.match(server, /platform: process\.platform/);
  assert.match(server, /serverNow: Date\.now\(\)/);
  assert.match(shim, /isWindows: os === 'win32'/);
  assert.match(shim, /window\.SVServerNow = \{ offset: msg\.serverNow - Date\.now\(\) \}/);
  assert.match(shim, /onLyricsLib:/);
  assert.match(shim, /onLyricsClock:/);
  assert.match(read('src/visualizer/modes/text.js'), /nowMs: wallNow\(\)/);
  const main = read('src/main/main.js');
  assert.match(main, /ensureLyricsClock\(\); \/\/ OBS/);
  assert.match(main, /anyVisualizerOpen\(\) \|\| streamOutputOpen\(\) \|\| lyricsClockAnchor/);
});

test('söz saati açık ekranlara çıpa olarak bağlanır', () => {
  const root = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const main = read('src/main/main.js');
  assert.match(main, /function ensureLyricsClock\(/);
  assert.match(main, /ipcMain\.on\('lyrics-clock'/);
  assert.match(read('src/main/preload-admin.js'), /sendLyricsClock:/);
  assert.match(read('src/main/preload-visualizer.js'), /onLyricsClock:/);
  assert.match(read('src/visualizer/modes/text.js'), /manualLyricTime\(t\)/);
  assert.match(read('src/admin/scene-panels.js'), /SVLyricsClock\.controls/);
  assert.match(read('src/web/web-shim.js'), /msg\.type === 'lyrics-clock'/);
  for (const file of ['src/visualizer/index.html', 'src/admin/index.html', 'src/web/overlay.html']) {
    assert.match(read(file), /lyrics-clock\.js/);
  }
});
