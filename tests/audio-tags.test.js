'use strict';
/* Dışa aktarılan videonun parçası, seçilen ses dosyasından gelir.
 * Normal söz kütüphaneye bağlanmaz. İzleme açıksa kütüphane eşleşmesi gelir.
 * Kodlayıcı kareler bitince kapanır. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const tags = require('../src/shared/audio-tags.js');

test('ffmetadata başlık, sanatçı ve albümü ayırır', () => {
  const parsed = tags.parseFfmetadata([
    ';FFMETADATA1',
    'title=Gece\\ Yol',
    'artist=Ayna',
    'album=İkinci',
    '# yorum',
    'album_artist=Yedek',
  ].join('\n'));
  assert.strictEqual(parsed.title, 'Gece Yol');
  assert.strictEqual(parsed.artist, 'Ayna');
  assert.strictEqual(parsed.album, 'İkinci');
});

test('dışa aktarma dosyanın kapağını ve söz kuralını taşır', () => {
  const root = path.join(__dirname, '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const main = read('src/main/main.js');
  const admin = read('src/admin/admin.js');
  const exp = read('src/exporter/exporter.js');
  const text = read('src/visualizer/modes/text.js');
  assert.match(main, /readAudioTags\(ff, audioPath/);
  assert.match(main, /stdio: \['pipe', 'ignore', 'pipe'\]/);
  assert.match(main, /function configFollowsLyrics/);
  assert.match(main, /if \(process\.platform !== 'win32' \|\| !cfg\) return false/);
  assert.match(main, /platform: process\.platform/);
  assert.match(main, /lyricsLibrary: configFollowsLyrics\(currentConfig\) \? lyricsSnapshot\(\) : \[\]/);
  // Windows dışı zorlama platformAdjust(c) içinde: açılışta cfg ile, varsayılanlarda kopyayla
  assert.match(admin, /c\.text\.lyricsFollow = false/);
  assert.match(admin, /if \(platformAdjust\(cfg\)\) push\(true\);/);
  assert.match(admin, /lt\.lyricsFollow = false/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /function endExportStdin/);
  assert.match(main, /if \(code === 0\) finalizeExport\('done'\)/);
  assert.doesNotMatch(main, /45000/);
  assert.doesNotMatch(main, /Kodlayıcı kareyi kabul etmedi/);
  assert.match(admin, /cancelBtn\.style\.display = exporting \? 'inline-flex' : 'none'/);
  assert.match(exp, /window\.SVExportTrack = job\.track/);
  assert.match(exp, /isWindows: os === 'win32'/);
  assert.match(exp, /publishExportTrack\(t\)/);
  assert.match(exp, /playing: false/);
  assert.match(text, /windows: !!\(window\.SV_PLATFORM && window\.SV_PLATFORM\.isWindows\)/);
});
