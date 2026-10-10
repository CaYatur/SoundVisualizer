'use strict';
/* Kitaplıklara aynı dosya ikinci kez eklenmez (#695).

   Video, logo ve söz kitaplığı aynı dosyayı her seçimde yeniden
   kopyalıyordu; videoda bu her seferinde yüzlerce MB. Yinelenen ya da
   eklenemeyen seçim de panelde sessiz kalıyordu. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const media = require('../src/main/media-library.js');
const lyrics = require('../src/main/lyrics-library.js');

/* Video kitaplığı dosyanın başına bakıyor (ftyp kutusu); sahte içerik
   yerine MP4 başlıklı bir tampon. */
function mp4(size, fill) {
  const buf = Buffer.alloc(size, fill);
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'latin1');
  return buf;
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sv-dupe-'));
}

test('video kitaplığı aynı içeriği ikinci kez kopyalamaz', async () => {
  const dir = tmp();
  const src = tmp();
  try {
    const a = path.join(src, 'klip.mp4');
    fs.writeFileSync(a, mp4(3 * 1024 * 1024, 7));
    const first = await media.importFileAsync(dir, a, 'klip.mp4');
    assert.strictEqual(first.ok, true);
    const again = await media.importFileAsync(dir, a, 'klip.mp4');
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.error, 'DUPLICATE');
    assert.strictEqual(again.item.id, first.item.id);
    // Başka adla da aynı içerik aynıdır
    const b = path.join(src, 'kopya.mp4');
    fs.copyFileSync(a, b);
    assert.strictEqual((await media.importFileAsync(dir, b, 'kopya.mp4')).error, 'DUPLICATE');
    assert.strictEqual(media.list(dir).length, 1);
    assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).length, 1, 'tek kopya');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('aynı boyutta farklı içerik eklenir; parmak izi sonu da kapsar', async () => {
  const dir = tmp();
  const src = tmp();
  try {
    const a = path.join(src, 'a.mp4');
    const b = path.join(src, 'b.mp4');
    const buf = mp4(3 * 1024 * 1024, 1);
    fs.writeFileSync(a, buf);
    buf[buf.length - 10] = 9; // yalnız sonu farklı
    fs.writeFileSync(b, buf);
    assert.strictEqual((await media.importFileAsync(dir, a, 'a.mp4')).ok, true);
    assert.strictEqual((await media.importFileAsync(dir, b, 'b.mp4')).ok, true);
    assert.strictEqual(media.list(dir).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('izi olmayan eski kayıt da yineleme sayılır', async () => {
  const dir = tmp();
  const src = tmp();
  try {
    const a = path.join(src, 'eski.mp4');
    fs.writeFileSync(a, mp4(4096, 3));
    assert.strictEqual((await media.importFileAsync(dir, a, 'eski.mp4')).ok, true);
    const manPath = path.join(dir, 'manifest.json');
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    delete man.items[0].fp;
    fs.writeFileSync(manPath, JSON.stringify(man));
    assert.strictEqual((await media.importFileAsync(dir, a, 'eski.mp4')).error, 'DUPLICATE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('söz kitaplığı aynı metni ikinci kez eklemez, farklısını ekler', () => {
  const dir = tmp();
  const src = tmp();
  try {
    const a = path.join(src, 'A - B.lrc');
    fs.writeFileSync(a, '[00:00.00]bir\n[00:02.00]iki\n');
    const first = lyrics.importFile(dir, a, 'A - B.lrc', { artist: 'A', title: 'B' });
    assert.strictEqual(first.ok, true);
    const again = lyrics.importFile(dir, a, 'A - B.lrc', { artist: 'A', title: 'B' });
    assert.strictEqual(again.error, 'DUPLICATE');
    const c = path.join(src, 'A - C.lrc');
    fs.writeFileSync(c, '[00:00.00]bir\n[00:02.00]üç\n'.replace('üç', 'uc'));
    assert.strictEqual(lyrics.importFile(dir, c, 'A - C.lrc', {}).ok, true);
    assert.strictEqual(lyrics.list(dir).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('içe aktarma sonucu eklenen, yinelenen ve eklenemeyeni sayar; panel söyler', () => {
  const M = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  for (const ch of ['lyrics-lib:import', 'logo-lib:import', 'media-lib:import']) {
    const at = M.indexOf("ipcMain.handle('" + ch + "'");
    const h = M.slice(at, M.indexOf('\n});', at));
    assert.match(h, /tallyImport\(one, added, tally\);/, ch);
    assert.match(h, /return importResult\(added, tally\);/, ch);
  }
  const A = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'admin.js'), 'utf8');
  assert.match(A, /importNote: \(r\) =>/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'lyrics-lib-ui.js'), 'utf8'), /P\(\)\.importNote\(r\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'logo-lib-ui.js'), 'utf8'), /SVPanel\.importNote\(r\)/);
});
