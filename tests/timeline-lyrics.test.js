'use strict';
/* Zaman çizelgesi klibinin sözü (#1213 ek kapsam): söz katmanı Çalan Parça
 * gibi en üstteki duyulur klibi izler, klibin yerel zamanında çalar ve
 * çizelge susunca sistemin parçasına döner. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TLL = require('../src/shared/timeline-lyrics.js');
const sync = require('../src/shared/lyrics-sync.js');
const A = require('../src/shared/timeline-audio.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LRC = '[00:01.00]Bir\n[00:05.00]Iki\n[00:09.00]Uc';

test('lookupConfig: kapalıyken yalnız yerel (yan dosya, gömülü), açıkken kullanıcınınki', () => {
  const off = TLL.lookupConfig({ enabled: false, providers: [{ url: 'x', enabled: true }] });
  assert.deepStrictEqual(off, { enabled: true, sidecar: true, embedded: true, cache: false, providers: [] });
  assert.strictEqual(TLL.lookupConfig({ enabled: false, sidecar: false }).sidecar, false);
  assert.strictEqual(TLL.lookupConfig(null).providers.length, 0);
  const on = { enabled: true, providers: [{ url: 'x' }] };
  assert.strictEqual(TLL.lookupConfig(on), on);
});

test('itemFor ve mergeLibrary: klibin sözü kitaplığın başında, tekrarsız', () => {
  const np = { has: true, title: 'Şarkı', artist: 'Sanatçı', src: 'sv-media://a.mp3', clipId: 'c1' };
  const it = TLL.itemFor(np, { text: LRC, source: 'sidecar' });
  assert.deepStrictEqual(it, { id: 'timeline:sv-media://a.mp3', name: 'Şarkı', title: 'Şarkı', artist: 'Sanatçı', text: LRC, auto: 'sidecar', timeline: true });
  assert.strictEqual(TLL.itemFor(np, null), null);
  assert.strictEqual(TLL.itemFor(np, { text: '' }), null);
  const lib = [{ id: 'lib1', title: 'Şarkı', artist: 'Sanatçı', text: 'BAŞKA' }];
  const merged = TLL.mergeLibrary([it, it], lib);
  assert.deepStrictEqual(merged.map((x) => x.id), ['timeline:sv-media://a.mp3', 'lib1']);
});

test('lyrics-sync: çizelge klibi her platformda izlenir, klibin sözü kitaplıktan önce', () => {
  const np = { has: true, playing: false, title: 'Şarkı', artist: 'Sanatçı', src: 's', clipId: 'c1', position: 6, updated: 0 };
  const lib = TLL.mergeLibrary([TLL.itemFor(np, { text: LRC, source: 'embedded' })], [{ id: 'l', title: 'Şarkı', artist: 'Sanatçı', text: 'BAŞKA' }]);
  const at = (o) => sync.playback(Object.assign({ library: lib, live: np, nowMs: 0, positionAt: (l) => l.position }, o));
  // Windows değil, takip açık: yine izlenir (oturum izleme gerekmiyor)
  const use = at({ windows: false, follow: true });
  assert.strictEqual(use.source, 'library');
  assert.strictEqual(use.text, LRC);
  assert.strictEqual(use.time, 6);
  // Takip kapalı ve elle söz yok: klibin sözü çalar
  assert.strictEqual(at({ windows: false, follow: false, manualText: '' }).text, LRC);
  // Takip kapalı, elle yüklenmiş söz var: elle söz korunur
  assert.strictEqual(at({ windows: true, follow: false, manualText: 'ELLE' }), null);
  // Takip kapalı ve klibin sözü yok: eski yol (elle/otomatik söz)
  assert.strictEqual(sync.playback({ windows: true, follow: false, live: np, library: [], manualText: '' }), null);
  // Sistem parçası (clipId yok): eski kural aynen
  const sys = Object.assign({}, np, { clipId: undefined });
  assert.strictEqual(sync.playback({ windows: false, follow: true, live: sys, library: lib }), null);
  assert.strictEqual(sync.playback({ windows: true, follow: false, live: sys, library: lib }), null);
});

test('klibin yerel zamanı: çizelge zamanı - klip başı + giriş noktası (kırpma)', () => {
  const tracks = A.normalize([{ id: 't1', clips: [{ id: 'c1', src: 'sv-media://a.mp3', start: 10, in: 4, dur: 30, name: 'a.mp3' }] }]);
  const np = A.nowPlayingAt(tracks, 13, () => ({ title: 'Şarkı', artist: 'Sanatçı' }));
  assert.strictEqual(np.clipId, 'c1');
  assert.strictEqual(np.position, 7); // 13 - 10 + 4
  assert.strictEqual(TLL.isTimelineLive(np), true);
  assert.strictEqual(TLL.isTimelineLive({ has: true, title: 'x' }), false);
  // Klip dışında: Çalan Parça yok, söz sistemin parçasına döner
  assert.strictEqual(A.nowPlayingAt(tracks, 50, () => ({})), null);
});

test('bağlantılar: canlı ve dışa aktarma aynı aramayı kullanır', () => {
  const main = read('src/main/main.js');
  assert.match(main, /if \(timelineNow\) lookupTimelineLyrics\(raw, timelineNow, tag\)/);
  assert.match(main, /timelineLyrics\.mergeLibrary\(Array\.from\(lyricsTimelineItems\.values\(\)\), items\)/);
  assert.match(main, /lyricsLibrary: timelineLyrics\.mergeLibrary\(tlLyricsForJob,/);
  assert.match(main, /audioPath: raw, meta, tags: tag \|\| null, config: timelineLyrics\.lookupConfig/);
});
