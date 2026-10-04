'use strict';
/* Windows söz takibi: eşleme, oynatıcı metni ve medya saati.
 *
 * macOS ve Linux takibi yok sayar. Elle yüklenen dosya ekran saatinde kalır. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const sync = require('../src/shared/lyrics-sync.js');
const np = require('../src/shared/nowplaying.js');

const LRC = [
  '[ar:The Weeknd]',
  '[ti:Blinding Lights]',
  '[00:00.00]START',
  '[00:10.00]MID',
  '[00:20.00]LATE',
].join('\n');

function item(title, artist, text) {
  return { id: title + '/' + artist, title, artist, text: text || LRC };
}

test('tam eşleme büyük harfi, noktalamayı ve the önekini yok sayar', () => {
  const hit = sync.matchTrack(
    { title: 'Blinding Lights!', artist: 'The Weeknd' },
    [item('blinding lights', 'weeknd')],
    'exact'
  );
  assert.ok(hit);
  assert.strictEqual(hit.how, 'exact');
});

test('tam eşleme başka sanatçıyı kabul etmez', () => {
  const hit = sync.matchTrack(
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    [item('Blinding Lights', 'Someone Else')],
    'exact'
  );
  assert.strictEqual(hit, null);
});

test('sanatçı boşsa tam eşleme yalnız parçaya bakar', () => {
  const hit = sync.matchTrack(
    { title: 'Blinding Lights', artist: '' },
    [item('Blinding Lights', '')],
    'exact'
  );
  assert.ok(hit);
  assert.strictEqual(hit.how, 'exact');
});

test('kısmi eşleme yazım farkını ve içermeyi yakalar', () => {
  const spell = sync.matchTrack(
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    [item('Blindin Lights', 'Weeknd')],
    'partial'
  );
  assert.ok(spell, 'yazım farkı');
  assert.strictEqual(spell.how, 'partial');
  const inside = sync.matchTrack(
    { title: 'Blinding Lights (Official Video)', artist: 'Weeknd' },
    [item('Blinding Lights', 'The Weeknd')],
    'partial'
  );
  assert.ok(inside, 'içerme');
});

test('kısmi eşleme ilgisiz parçayı ve başka sanatçıyı reddeder', () => {
  assert.strictEqual(sync.matchTrack(
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    [item('Yellow Submarine', 'The Beatles')],
    'partial'
  ), null);
  assert.strictEqual(sync.matchTrack(
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    [item('Blindin Lights', 'Another Artist')],
    'partial'
  ), null);
});

test('boş parça adı eşleşmez', () => {
  assert.strictEqual(sync.matchTrack({ title: '', artist: 'A' }, [item('A', 'A')], 'partial'), null);
});

test('tam eşleşen öğe kısmi adayın önüne geçer', () => {
  const hit = sync.matchTrack(
    { title: 'Blinding Lights', artist: 'Weeknd' },
    [item('Blindin Lights', 'Weeknd'), item('Blinding Lights', 'The Weeknd')],
    'partial'
  );
  assert.strictEqual(hit.how, 'exact');
  assert.strictEqual(hit.item.title, 'Blinding Lights');
});

test('oynatıcı altyazısı zamanlı sözü alır, albümü ve video satırını almaz', () => {
  const timed = sync.systemLyrics('[00:01.00]Birinci\n[00:02.00]Ikinci', { title: 'Sarki', artist: 'Sanatci', album: 'Album' });
  assert.strictEqual(timed.kind, 'timed');
  const album = sync.systemLyrics('After Hours', { title: 'Blinding Lights', artist: 'Weeknd', album: 'After Hours' });
  assert.strictEqual(album, null);
  const video = sync.systemLyrics('Official Video', { title: 'Blinding Lights', artist: 'Weeknd', album: 'After Hours' });
  assert.strictEqual(video, null);
  const line = sync.systemLyrics('I said I been on my own', { title: 'Blinding Lights', artist: 'Weeknd', album: 'After Hours' });
  assert.strictEqual(line.kind, 'line');
});

test('takip kapalıyken ve Windows dışında saat değişmez', () => {
  const live = { has: true, playing: true, title: 'Blinding Lights', artist: 'Weeknd', position: 12, updated: 1000 };
  assert.strictEqual(sync.playback({ windows: true, follow: false, live, manualText: 'ELLE' }), null);
  assert.strictEqual(sync.playback({ windows: false, follow: true, live, manualText: 'ELLE' }), null);
});

test('canlı oturum yokken elle yüklenen dosya duvar saatinde kalır', () => {
  const use = sync.playback({ windows: true, follow: true, live: { has: false }, manualText: 'ELLE' });
  assert.strictEqual(use.source, 'manual');
  assert.strictEqual(use.text, 'ELLE');
  assert.strictEqual(use.time, null);
});

test('takip medya konumunu kullanır; sarma ve duraklama yansır', () => {
  const now = 1_700_000_000_000;
  const lib = [item('Blinding Lights', 'The Weeknd')];
  const at = (position, playing, updated) => sync.playback({
    windows: true,
    follow: true,
    match: 'exact',
    library: lib,
    live: {
      has: true, playing, title: 'Blinding Lights', artist: 'The Weeknd',
      position, updated, duration: 200,
    },
    manualText: '[00:00.00]MANUAL',
    nowMs: now,
    positionAt: np.positionAt,
  });
  assert.strictEqual(at(12, true, now).time, 12);
  assert.strictEqual(at(1, true, now).time, 1);
  assert.strictEqual(at(12, false, now - 60000).time, 12);
});

test('eşleşen kütüphane sözü oynatıcı sözünden önce gelir', () => {
  const live = {
    has: true, playing: true, title: 'Blinding Lights', artist: 'Weeknd',
    subtitle: '[00:12.00]OYNATICI\n[00:13.00]SONRA',
    position: 12, updated: 5, duration: 200,
  };
  const both = sync.playback({
    windows: true,
    follow: true,
    library: [item('Blinding Lights', 'Weeknd', LRC)],
    live,
    nowMs: 5,
    positionAt: np.positionAt,
  });
  assert.strictEqual(both.source, 'library');
  assert.match(both.text, /MID/);
  const onlyPlayer = sync.playback({
    windows: true,
    follow: true,
    library: [item('Baska', 'Biri')],
    live,
    nowMs: 5,
    positionAt: np.positionAt,
  });
  assert.strictEqual(onlyPlayer.source, 'system');
  assert.match(onlyPlayer.text, /OYNATICI/);
});

test('eşleşme yoksa elle yüklenen dosya çalmaz', () => {
  const use = sync.playback({
    windows: true,
    follow: true,
    match: 'exact',
    library: [item('Baska', 'Biri')],
    live: { has: true, title: 'Blinding Lights', artist: 'Weeknd', subtitle: 'Official Video' },
    manualText: '[00:00.00]MANUAL',
  });
  assert.strictEqual(use.source, 'none');
  assert.strictEqual(use.text, '');
});

test('etiket ve dosya adı sanatçı ile parçayı doldurur', () => {
  const fromTags = sync.guessMeta('[ar:Ada]\n[ti:Gece]\n[00:00.00]x', 'baska.lrc');
  assert.strictEqual(fromTags.artist, 'Ada');
  assert.strictEqual(fromTags.title, 'Gece');
  const fromName = sync.guessMeta('satir', 'Ada - Gece.lrc');
  assert.strictEqual(fromName.artist, 'Ada');
  assert.strictEqual(fromName.title, 'Gece');
});

test('çizim takip açıkken medya saatini, kapalıyken ekran saatini kullanır', () => {
  global.window = global.window || {};
  require('../src/shared/defaults.js');
  global.window.SVLyrics = require('../src/shared/lyrics.js');
  global.window.SVNowPlaying = np;
  global.window.SVLyricsSync = sync;
  require('../src/visualizer/modes/text.js');
  const TextMode = global.window.SVModes.text;
  const prevPlat = global.window.SV_PLATFORM;
  const prevLive = global.window.SVNowLive;
  const prevLib = global.window.SVLyricsLib;
  const now = 1_700_000_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  function draw(text) {
    const texts = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      clearRect() {}, scale() {}, translate() {}, strokeText() {}, fillRect() {},
      fillText(txt) { texts.push(txt); },
      measureText() { return { width: 20 }; },
    };
    const canvas = { width: 800, height: 600, getContext: () => ctx };
    new TextMode(canvas).draw({ level: 0, bass: 0 }, {
      visualizer: { type: 'text', colorMode: 'custom' },
      text,
    }, 0, 0.016);
    return texts.join(' ');
  }
  try {
    global.window.SV_PLATFORM = { isWindows: true };
    global.window.SVLyricsLib = { items: [item('Blinding Lights', 'The Weeknd')] };
    global.window.SVNowLive = {
      state: {
        has: true, playing: true, title: 'Blinding Lights', artist: 'The Weeknd',
        position: 12, updated: now, duration: 200,
      },
    };
    const followed = draw({
      enabled: true, source: 'lyrics', lyricsFollow: true, lyricsMatch: 'exact',
      lyricsSource: '[00:00.00]MANUAL', animation: 'none', useCustomColor: true, color: '#fff',
    });
    assert.match(followed, /MID/);
    assert.doesNotMatch(followed, /MANUAL/);
    global.window.SVNowLive.state.position = 1;
    const seek = draw({
      enabled: true, source: 'lyrics', lyricsFollow: true, lyricsMatch: 'exact',
      lyricsSource: '[00:00.00]MANUAL', animation: 'none', useCustomColor: true, color: '#fff',
    });
    assert.match(seek, /START/);
    global.window.SV_PLATFORM = { isWindows: false };
    global.window.SVExportTrack = { title: 'Blinding Lights', artist: 'The Weeknd' };
    const manual = draw({
      enabled: true, source: 'lyrics', lyricsFollow: true,
      lyricsSource: '[00:00.00]MANUAL', animation: 'none', useCustomColor: true, color: '#fff',
    });
    assert.match(manual, /MANUAL/);
    assert.doesNotMatch(manual, /MID/);
  } finally {
    Date.now = realNow;
    global.window.SV_PLATFORM = prevPlat;
    global.window.SVExportTrack = undefined;
    global.window.SVNowLive = prevLive;
    global.window.SVLyricsLib = prevLib;
  }
});

test('medya oturumu altyazıyı ve takip isteğini bağlar', () => {
  const root = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const session = read('src/main/media-session.js');
  assert.match(session, /\$p\.Subtitle/);
  assert.match(session, /a\.subtitle !== b\.subtitle/);
  assert.match(read('native/smtc-helper/Program.cs'), /props\?\.Subtitle/);
  const main = read('src/main/main.js');
  const fn = main.slice(main.indexOf('function wantsNowPlaying'), main.indexOf('function syncNowPlaying'));
  assert.match(fn, /lyricsFollow/);
  for (const file of ['src/visualizer/index.html', 'src/admin/index.html', 'src/exporter/index.html', 'src/web/overlay.html']) {
    assert.match(read(file), /lyrics-sync\.js/);
  }
});
