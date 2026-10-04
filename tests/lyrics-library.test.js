'use strict';
/* Söz kütüphanesi diske yazar; sahne dosyasına LRC koymaz. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../src/main/lyrics-library.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-lyrics-'));
}

test('içe aktarma, güncelleme, okuma ve silme aynı klasörde kalır', () => {
  const dir = tempDir();
  const src = path.join(dir, 'Ada - Gece.lrc');
  fs.writeFileSync(src, '[00:00.00]merhaba\n', 'utf8');
  const added = lib.importFile(dir, src, 'Ada - Gece.lrc', { artist: 'Ada', title: 'Gece' });
  assert.strictEqual(added.ok, true);
  assert.strictEqual(added.item.artist, 'Ada');
  assert.strictEqual(added.item.title, 'Gece');
  const listed = lib.list(dir);
  assert.strictEqual(listed.length, 1);
  const body = lib.read(dir, added.item.id);
  assert.match(body.text, /merhaba/);
  const upd = lib.update(dir, added.item.id, { artist: 'Ada Nur', title: 'Gece' });
  assert.strictEqual(upd.ok, true);
  const shot = lib.snapshot(dir);
  assert.strictEqual(shot[0].artist, 'Ada Nur');
  assert.match(shot[0].text, /merhaba/);
  assert.strictEqual(lib.remove(dir, added.item.id).ok, true);
  assert.strictEqual(lib.list(dir).length, 0);
  assert.strictEqual(lib.read(dir, added.item.id), null);
  assert.ok(!fs.existsSync(path.join(dir, added.item.id + '.lrc')));
});

test('söz olmayan dosya ve üst klasöre çıkan ad reddedilir', () => {
  const dir = tempDir();
  const png = path.join(dir, 'kapak.png');
  fs.writeFileSync(png, 'png', 'utf8');
  assert.strictEqual(lib.importFile(dir, png, 'kapak.png').ok, false);
  const src = path.join(dir, 'soz.lrc');
  fs.writeFileSync(src, '[00:00.00]a\n[00:01.00]b\n', 'utf8');
  const added = lib.importFile(dir, src, '..\\kacak.lrc', { artist: 'A', title: 'B' });
  assert.strictEqual(added.ok, true);
  const file = path.join(dir, added.item.id + '.lrc');
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(path.join(dir, '..', 'kacak.lrc')));
});

test('kayıt dosyasının metni kütüphane kopyasına yazılır', () => {
  const dir = tempDir();
  const src = path.join(dir, 'Ada - Gece.lrc');
  fs.writeFileSync(src, '[00:00.00]eski\n', 'utf8');
  const added = lib.importFile(dir, src, 'Ada - Gece.lrc', { artist: 'Ada', title: 'Gece' });
  const file = path.join(dir, added.item.id + '.lrc');
  const upd = lib.update(dir, added.item.id, {
    artist: 'Ada Nur',
    title: 'Gece',
    text: '[00:00.00]yeni satir\n[00:02.00]ikinci\n',
  });
  assert.strictEqual(upd.ok, true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '[00:00.00]yeni satir\n[00:02.00]ikinci\n');
  assert.strictEqual(fs.readFileSync(src, 'utf8'), '[00:00.00]eski\n');
  assert.match(lib.snapshot(dir)[0].text, /yeni satir/);
  assert.strictEqual(lib.update(dir, added.item.id, { text: '' }).error, 'SIZE');
  assert.strictEqual(lib.update(dir, added.item.id, { text: 'a\0b' }).error, 'TYPE');
  assert.match(fs.readFileSync(file, 'utf8'), /yeni satir/);
});

test('söz renklendirme süre, etiket ve sözü ayırır', () => {
  global.window = global.window || {};
  require('../src/admin/lyrics-lib-ui.js');
  const lines = window.SVLyricsLibUi.highlightParts(
    '[offset:+1500]\n[00:10.00]merhaba <00:10.40>dünya\n1\n00:00:01,000 --> 00:00:04,000\nSatır'
  );
  assert.deepStrictEqual(lines[0].map((p) => p.k + ':' + p.s), ['meta:[offset:', 'meta-val:+1500', 'meta:]']);
  assert.deepStrictEqual(lines[1].map((p) => p.k), ['time', 'lyric', 'word', 'lyric']);
  assert.strictEqual(lines[1][1].s, 'merhaba ');
  assert.strictEqual(lines[1][2].s, '<00:10.40>');
  assert.strictEqual(lines[2][0].k, 'index');
  assert.deepStrictEqual(lines[3].map((p) => p.k), ['time', 'lyric', 'arrow', 'lyric', 'time']);
  assert.strictEqual(lines[4][0].k, 'lyric');
  assert.strictEqual(lines[4][0].s, 'Satır');
});

test('bir megabaytı aşan söz alınmaz', () => {
  const dir = tempDir();
  const src = path.join(dir, 'buyuk.lrc');
  fs.writeFileSync(src, 'x'.repeat(lib.MAX_BYTES + 20));
  const added = lib.importFile(dir, src, 'buyuk.lrc', { title: 'Buyuk' });
  assert.strictEqual(added.ok, false);
  assert.strictEqual(added.error, 'SIZE');
});
