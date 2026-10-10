'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/main/logo-library.js');

const DIR = path.join(os.tmpdir(), 'sv-logo-lib-' + process.pid);

function pngBytes() {
  // 1x1 PNG
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300000002000100' +
    '05fe03fe0000000049454e44ae426082',
    'hex'
  );
}

test('kitaplık: görsel kopyalanır, listelenir, okunur, silinir', () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const src = path.join(DIR, 'in.png');
  fs.writeFileSync(src, pngBytes());
  const r = L.importFile(DIR, src, 'Logo Test.png');
  assert.strictEqual(r.ok, true);
  assert.ok(r.item.id);
  assert.strictEqual(r.item.kind, 'image');
  assert.strictEqual(r.item.name, 'Logo Test');
  const list = L.list(DIR);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, r.item.id);
  const rec = L.read(DIR, r.item.id);
  assert.ok(rec && rec.b64);
  assert.strictEqual(rec.mime, 'image/png');
  const info = L.fileInfo(DIR, r.item.id);
  assert.ok(info && fs.existsSync(info.file));
  L.remove(DIR, r.item.id);
  assert.strictEqual(L.list(DIR).length, 0);
  assert.strictEqual(L.resolveId(DIR, r.item.id), null);
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('kitaplık: GIF türü tanınır', () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const src = path.join(DIR, 'a.gif');
  fs.writeFileSync(src, Buffer.from('GIF89a'));
  const r = L.importFile(DIR, src, 'loop.gif');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.item.kind, 'gif');
  assert.strictEqual(r.item.mime, 'image/gif');
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('kitaplık: görsel olmayan uzantı reddedilir', () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const src = path.join(DIR, 'x.exe');
  fs.writeFileSync(src, Buffer.from([0]));
  const r = L.importFile(DIR, src, 'x.exe');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'TYPE');
  fs.rmSync(DIR, { recursive: true, force: true });
});

test('video kitaplığı aynı motoru kullanır ve yabancı yolu açmaz', async () => {
  const M = require('../src/main/media-library.js');
  const dir = path.join(os.tmpdir(), 'sv-media-lib-' + process.pid);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'in.mp4');
  // Dosya başı bakılıyor: MP4 ftyp kutusu (sahte içerik artık reddedilir)
  fs.writeFileSync(src, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]));
  const png = path.join(dir, 'in.png');
  fs.writeFileSync(png, Buffer.from([0]));
  assert.strictEqual(M.importFile(dir, png, 'in.png').error, 'TYPE');
  const r = await M.importFileAsync(dir, src, 'Klip 01.mp4');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.item.kind, 'video');
  assert.strictEqual(r.item.mime, 'video/mp4');
  assert.strictEqual(r.item.name, 'Klip 01');
  const info = M.fileInfo(dir, r.item.id);
  assert.strictEqual(M.ownsPath(dir, info.file), true);
  assert.strictEqual(M.ownsPath(dir, png), false);
  assert.strictEqual(M.ownsPath(dir, path.join(dir, '..', 'secret.mp4')), false);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /mediaLibrary\.ownsPath\(mediaLibDir\(\), raw\)/);
  assert.match(main, /ipcMain\.handle\('media-lib:list'/);
  const pre = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload-admin.js'), 'utf8');
  assert.match(pre, /mediaLibList: \(\) => ipcRenderer\.invoke\('media-lib:list'\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('kitaplık: yol kaçışı reddedilir', () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  assert.strictEqual(L.resolveId(DIR, '../secret'), null);
  assert.strictEqual(L.resolveId(DIR, 'a/b'), null);
  assert.strictEqual(L.resolveId(DIR, ''), null);
  fs.rmSync(DIR, { recursive: true, force: true });
});
