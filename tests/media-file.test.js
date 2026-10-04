'use strict';
/* Video servis yolu — Range davranışı.

   Range şart: <video> öğesi konum değiştirirken parça isteği yapar ve dizini
   (moov atomu) dosyanın sonunda olan MP4'lerde ilk oynatma bile buna bağlıdır.
   Aralık isteğine tam dosya dönen bir kaynakta böyle dosyalar hiç başlamaz. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serveMediaFile, isConfiguredMedia } = require('../src/main/media-file.js');
const mediaUrl = require('../src/shared/media-url.js');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-media-'));
const FILE = path.join(DIR, 'klip.mp4');
const DATA = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
fs.writeFileSync(FILE, DATA);

const bytes = async (res) => Buffer.from(await res.arrayBuffer());

test('aralıksız istek tüm dosyayı ve Accept-Ranges başlığını döner', async () => {
  const res = serveMediaFile(FILE, null);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('Content-Type'), 'video/mp4');
  assert.strictEqual(res.headers.get('Content-Length'), '1000');
  assert.strictEqual(res.headers.get('Accept-Ranges'), 'bytes');
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.ok(String(res.headers.get('Access-Control-Expose-Headers') || '').includes('Content-Range'));
  assert.ok(DATA.equals(await bytes(res)));
});

test('kapalı aralık tam olarak istenen baytları döner', async () => {
  const res = serveMediaFile(FILE, 'bytes=100-199');
  assert.strictEqual(res.status, 206);
  assert.strictEqual(res.headers.get('Content-Range'), 'bytes 100-199/1000');
  assert.strictEqual(res.headers.get('Content-Length'), '100');
  assert.ok(DATA.subarray(100, 200).equals(await bytes(res)));
});

test('açık uçlu aralık sona kadar okur', async () => {
  const res = serveMediaFile(FILE, 'bytes=990-');
  assert.strictEqual(res.status, 206);
  assert.strictEqual(res.headers.get('Content-Range'), 'bytes 990-999/1000');
  assert.ok(DATA.subarray(990).equals(await bytes(res)));
});

test('sondan aralık (bytes=-N) son N baytı döner', async () => {
  // MP4 dizini sondaysa oynatıcının ilk yaptığı istek tam olarak budur
  const res = serveMediaFile(FILE, 'bytes=-50');
  assert.strictEqual(res.status, 206);
  assert.strictEqual(res.headers.get('Content-Range'), 'bytes 950-999/1000');
  assert.ok(DATA.subarray(950).equals(await bytes(res)));
});

test('dosya sonunu aşan aralık kırpılır, hata verilmez', async () => {
  const res = serveMediaFile(FILE, 'bytes=900-99999');
  assert.strictEqual(res.status, 206);
  assert.strictEqual(res.headers.get('Content-Range'), 'bytes 900-999/1000');
});

test('tamamen dosya dışındaki aralık 416 döner', () => {
  const res = serveMediaFile(FILE, 'bytes=5000-6000');
  assert.strictEqual(res.status, 416);
  assert.strictEqual(res.headers.get('Content-Range'), 'bytes */1000');
});

test('olmayan dosya 404 döner, istisna fırlatmaz', () => {
  const res = serveMediaFile(path.join(DIR, 'yok.mp4'), null);
  assert.strictEqual(res.status, 404);
});

test('bilinmeyen uzantı genel ikili tür alır', () => {
  const other = path.join(DIR, 'klip.xyz');
  fs.writeFileSync(other, DATA);
  const res = serveMediaFile(other, null);
  assert.strictEqual(res.headers.get('Content-Type'), 'application/octet-stream');
});

test('katman dosyası seçilmiş sayılır, listede olmayan yol sayılmaz', () => {
  const cfg = {
    media: { file: mediaUrl.toMediaUrl(path.join(DIR, 'klasik.mp4')) },
    layers: [
      { kind: 'media', settings: { media: { file: mediaUrl.toMediaUrl(FILE) } } },
      { kind: 'text', settings: { text: { file: FILE } } },
    ],
  };
  assert.strictEqual(isConfiguredMedia(cfg, FILE, mediaUrl), true);
  assert.strictEqual(isConfiguredMedia(cfg, path.join(DIR, 'klasik.mp4'), mediaUrl), true);
  assert.strictEqual(isConfiguredMedia(cfg, path.join(DIR, 'gizli.mp4'), mediaUrl), false);
  assert.strictEqual(isConfiguredMedia(cfg, '', mediaUrl), false);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /scheme: 'sv-media', privileges: \{[^}]*corsEnabled: true/);
  const mediaJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'visualizer', 'modes', 'media.js'), 'utf8');
  assert.match(mediaJs, /this\.video\.crossOrigin = 'anonymous'/);
});

test('bozuk Range başlığı tüm dosyaya düşer', async () => {
  const res = serveMediaFile(FILE, 'saçmalık');
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await bytes(res)).length, 1000);
});
