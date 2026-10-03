'use strict';
/* Görselleştirici, müzik zaten çalarken açılınca oynatıcı boş kalıyordu.
 *
 * Ana süreç pencere yüklenir yüklenmez 'now-playing' yolluyor. Sayfa ise
 * dinleyiciyi yapılandırmayı istedikten sonra kuruyor. Electron aradaki
 * mesajı tutmuyor. Kaynak aynı parçayı tekrar bildirmiyor; duraklatıp
 * devam etmek yeni bir fark olduğu için oynatıcı ancak o zaman çıkıyordu. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createLateEvent, catchUp } = require('../src/shared/late-event.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('çalan parça dinleyiciden önce gelirse abone olunca verilir', () => {
  const slot = createLateEvent();
  const playing = { has: true, playing: true, title: 'Nibbana' };
  slot.push(playing);
  let got = null;
  slot.subscribe((st) => { got = st; });
  assert.strictEqual(got, playing);
});

test('abone olduktan sonra duraklatma da iletilir', () => {
  const slot = createLateEvent();
  const got = [];
  slot.subscribe((st) => got.push(st.playing));
  slot.push({ has: true, playing: true });
  slot.push({ has: true, playing: false });
  assert.deepStrictEqual(got, [true, false]);
});

test('geç abone ilk değil son örneği alır', () => {
  const slot = createLateEvent();
  slot.push({ has: true, title: 'A' });
  slot.push({ has: true, title: 'B' });
  let title = '';
  slot.subscribe((st) => { title = st.title; });
  assert.strictEqual(title, 'B');
});

test('açılışta güncel parça istenir ama arada gelen canlı örnek ezilmez', async () => {
  const live = { state: null };
  let listener = null;
  const api = {
    onNowPlaying(cb) { listener = cb; },
    nowPlayingCurrent() {
      listener({ has: true, playing: false, title: 'canlı' });
      return Promise.resolve({ has: true, playing: true, title: 'eski' });
    },
  };
  await catchUp(live, api);
  assert.strictEqual(live.state.title, 'canlı');
  assert.strictEqual(live.state.playing, false);
});

test('hiç iletilmeyen çalan parça açılışta alınır', async () => {
  const live = { state: null };
  const api = {
    onNowPlaying() {},
    nowPlayingCurrent() {
      return Promise.resolve({ has: true, playing: true, title: 'Nibbana' });
    },
  };
  await catchUp(live, api);
  assert.strictEqual(live.state.title, 'Nibbana');
  assert.strictEqual(live.state.playing, true);
});

test('parça yokken boş durum oynatıcıyı açmaz', async () => {
  const live = { state: null };
  const api = {
    onNowPlaying() {},
    nowPlayingCurrent() {
      return Promise.resolve({ has: false, playing: false, title: '' });
    },
  };
  await catchUp(live, api);
  assert.strictEqual(live.state, null);
});

test('preload çalan parçayı sayfa abone olmadan dinler', () => {
  const pre = read('src/main/preload-visualizer.js');
  const onAt = pre.indexOf("ipcRenderer.on('now-playing'");
  const exposeAt = pre.indexOf('exposeInMainWorld');
  assert.ok(onAt > 0 && exposeAt > onAt, 'dinleyici sayfa abone olmadan kurulmalı');
  assert.match(pre, /onNowPlaying: \(cb\) => nowPlayingEvents\.subscribe\(cb\)/);
  assert.match(pre, /nowPlayingCurrent: \(\) => ipcRenderer\.invoke\('nowplaying:current'\)/);
  assert.equal((pre.match(/ipcRenderer\.on\('now-playing'/g) || []).length, 1);
  assert.doesNotMatch(pre, /require\(\s*['"]\.\./, 'preload kum havuzunda yerel require çöker ve api hiç kurulmaz');
  assert.equal((pre.match(/require\(/g) || []).length, 1, 'yalnızca electron require edilebilir');
});

/* Electron preload kum havuzu yerel dosyayı require edemez. O satır
   betiği düşürünce window.api kurulmaz ve görselleştirici
   `api.onPresetsDelta` okurken "Başlatılamadı" der. */
function loadPreload() {
  const exposed = {};
  const listeners = {};
  const Module = require('module');
  const orig = Module.prototype.require;
  const preload = require.resolve('../src/main/preload-visualizer.js');
  Module.prototype.require = function (id) {
    if (id === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name, value) { exposed[name] = value; },
        },
        ipcRenderer: {
          on(channel, cb) {
            (listeners[channel] = listeners[channel] || []).push(cb);
          },
          invoke() { return Promise.resolve(null); },
          send() {},
        },
      };
    }
    if (typeof id === 'string' && (id.startsWith('.') || id.includes('late-event'))) {
      throw new Error('module not found: ' + id);
    }
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[preload];
    require(preload);
  } finally {
    Module.prototype.require = orig;
    delete require.cache[preload];
  }
  return { exposed, listeners };
}

test('kum havuzu preload api kurar; geç abone çalan parçayı alır', () => {
  const { exposed, listeners } = loadPreload();
  assert.equal(typeof exposed.api.onPresetsDelta, 'function');
  assert.equal(listeners['now-playing'].length, 1);
  const playing = { has: true, playing: true, title: 'Nibbana' };
  listeners['now-playing'][0]({}, playing);
  let got = null;
  exposed.api.onNowPlaying((st) => { got = st; });
  assert.strictEqual(got, playing);
  got = null;
  listeners['now-playing'][0]({}, { has: true, playing: false, title: 'Nibbana' });
  assert.strictEqual(got.playing, false);
});

test('köprü yokken görselleştirici onPresetsDelta okumaz', () => {
  const vis = read('src/visualizer/visualizer.js');
  const guard = vis.indexOf('if (!window.api)');
  const delta = vis.indexOf('onPresetsDelta');
  assert.ok(guard > 0 && guard < delta, 'köprü denetimi onPresetsDelta’dan önce');
  assert.match(vis, /pencere köprüsü yok/);
  assert.match(vis, /if \(window\.api && window\.api\.onPresetsDelta\)/);
});

test('görselleştirici açılışta güncel parçayı ister', () => {
  const vis = read('src/visualizer/visualizer.js');
  assert.match(vis, /SVLateEvent\.catchUp\(window\.SVNowLive, window\.api\)/);
  for (const rel of ['src/visualizer/index.html', 'src/web/overlay.html']) {
    const html = read(rel);
    const late = html.indexOf('late-event.js');
    const boot = html.lastIndexOf('visualizer.js');
    assert.ok(late > 0 && boot > late, rel + ': yardımcı görselleştiriciden önce yüklenmeli');
  }
});

test('açılan pencere eldeki çalan parçayı yine yollar', () => {
  const main = read('src/main/main.js');
  const sends = main.match(/mediaSession\.current\(\)\.has\)[^\n]*send\('now-playing'/g) || [];
  assert.ok(sends.length >= 2, 'ekran ve yüzen pencere açılışta durumu yollamalı');
});
