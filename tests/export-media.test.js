'use strict';
/* DIŞA AKTARIMDA VİDEO KATMANI (#539): her karesi anahtar kare ara kopya.
 *
 * Sıradan bir videoda (anahtar kare saniyelerce arayla) kare başı sarma
 * ~150 ms sürüyordu: 20 sn'lik dışa aktarım 98 sn. Ara kopyayla 11 sn.
 * Burada dosya listesi, alfa tespiti, argümanlar ve bağlantılar.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const EM = require('../src/main/export-media.js');

const root = path.join(__dirname, '..');
// Windows CI CRLF ile çekiyor: satır sonları birleştirilir
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('dışa aktarıma girecek video dosyaları: yığında açık medya katmanları, katmansız kipte medya bölümü', () => {
  const stack = {
    layerStack: { enabled: true },
    media: { source: 'file' },
    layers: [
      { kind: 'media', settings: { media: { file: 'sv-media://local/a.mp4' } } },
      { kind: 'media', enabled: false, settings: { media: { source: 'file', file: 'b.mp4' } } },
      { kind: 'media', muted: true, settings: { media: { source: 'file', file: 'c.mp4' } } },
      { kind: 'media', settings: { media: { source: 'webcam', deviceId: 'x' } } },
      { kind: 'media', settings: { media: { source: 'file', file: 'sv-media://local/a.mp4' } } },
      { kind: 'visualizer', type: 'bars' },
    ],
  };
  assert.deepStrictEqual(EM.mediaFiles(stack), ['sv-media://local/a.mp4'], 'açık, dosya kaynaklı, tekrarsız');
  assert.deepStrictEqual(EM.mediaFiles({ media: { enabled: true, source: 'file', file: 'd.mp4' } }), ['d.mp4']);
  assert.deepStrictEqual(EM.mediaFiles({ media: { enabled: false, source: 'file', file: 'd.mp4' } }), []);
  // Yığın kapalıyken listedeki katmanlar kullanılmaz (layers.js stackOn)
  assert.deepStrictEqual(EM.mediaFiles(Object.assign({}, stack, { layerStack: { enabled: false } })), []);
  assert.deepStrictEqual(EM.mediaFiles(null), []);
});

test('saydamlıklı kaynak tanınıyor (çevrilmez: H.264 alfa taşımaz)', () => {
  assert.strictEqual(EM.hasAlpha('  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080'), false);
  assert.strictEqual(EM.hasAlpha('  Stream #0:0: Video: prores (4444), yuva444p12le, 1920x1080'), true);
  assert.strictEqual(EM.hasAlpha('  Stream #0:0: Video: vp9, yuv420p(tv), 1280x720\n      alpha_mode      : 1'), true);
  assert.strictEqual(EM.hasAlpha('  Stream #0:0: Video: png, rgba(pc), 640x480'), true);
  // Ses akışındaki kelimeler yanıltmasın
  assert.strictEqual(EM.hasAlpha('  Stream #0:0: Video: h264, yuv420p\n  Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp'), false);
});

test('ara kopya: her karesi anahtar kare, süre kadar, çıktıdan büyükse küçültülmüş, sessiz', () => {
  const a = EM.transcodeArgs('in.mp4', 'out.mp4', { maxSec: 20.2, width: 1920, height: 1080 });
  const at = (k) => a[a.indexOf(k) + 1];
  assert.strictEqual(at('-g'), '1');
  assert.strictEqual(at('-c:v'), 'libx264');
  assert.strictEqual(at('-t'), '22', 'süre + 1 sn, yukarı');
  assert.ok(a.indexOf('-t') < a.indexOf('-i'), 'giriş seçeneği: fazlası okunmaz');
  assert.ok(a.includes('-an'));
  assert.strictEqual(at('-fps_mode'), 'passthrough', 'zaman damgaları korunur');
  assert.match(at('-vf'), /min\(iw,max\(1920,ceil\(1080\*iw\/ih\)\)\)/, 'örtecek kadar, kaynaktan büyük değil');
  assert.strictEqual(a[a.length - 1], 'out.mp4');
  assert.ok(!EM.transcodeArgs('in', 'out', {}).includes('-t'), 'süre bilinmiyorsa kısaltılmaz');
  assert.strictEqual(EM.tempName('/tmp/x', 3), path.join('/tmp/x', 'media-3.mp4'));
});

test('bağlantılar: ana süreç kopyayı hazırlıyor, sunuyor, siliyor; dışa aktarıcı kullanıyor, okunamayan karede duruyor', () => {
  const main = read('src/main/main.js');
  assert.match(main, /const mediaMap = await prepareExportMedia\(ff, jobCfg, durationSec > 0 \? durationSec : \(audioSec \|\| 0\), w, h\);/);
  assert.match(main, /\n    mediaMap,\n/);
  assert.match(main, /exportMediaTemp\.paths\.has\(path\.resolve\(raw\)\)/, 'sv-media kopyayı sunar');
  assert.match(main, /function finalizeExport\(status, message, opts\) \{\n  if \(!exportState\) return; \/\/ tek sefer\n  cleanupExportMedia\(\);/);
  assert.match(main, /if \(exportMedia\.hasAlpha\(probe\.err\)\) continue;/);
  const media = read('src/visualizer/modes/media.js');
  assert.match(media, /if \(map && typeof map\[file\] === 'string' && map\[file\]\) return map\[file\];/);
  assert.match(media, /if \(!this\.offline \|\| this\._source !== 'file' \|\| !this\._loaded\) return null;/, 'kamera: sarılacak bir şey yok, hata değil');
  const ex = read('src/exporter/exporter.js');
  assert.match(ex, /window\.SVExportMediaMap = job\.mediaMap/);
  assert.match(ex, /return res\.every\(\(r\) => r !== false\);/);
  assert.match(ex, /if \(!seekOk\) \{\n\s*window\.exp\.error\(MEDIA_LATE\);/);
  assert.ok(read('src/shared/i18n.js').includes("'Video katmanının karesi okunamadı: dosya açılamadı ya da çözülemedi."), 'İngilizcesi var');
  // Öz test kaynağı varsayılan GOP'la: ara kopya yolu sınanıyor
  assert.match(main, /'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-qp', '0', src\]\);/);
});
