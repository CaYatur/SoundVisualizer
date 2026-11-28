'use strict';
/* Telefondan bilgisayara dosya (src/main/link-upload.js, PC bağlantısı B6): tür ve uzantı izin
 * listesi, boyut sınırı, parçaların sırası, SHA-256 doğrulaması, başka telefonun aktarımına
 * dokunulamaması, boşta kalanın ve oturumu kapananın silinmesi, adın yol taşıyamaması. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const U = require('../src/main/link-upload.js');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-up-'));
  let t = 1000;
  const up = U.createUploads({ dir, now: () => t });
  return { dir, up, tick: (ms) => { t += ms; }, files: () => fs.readdirSync(dir) };
}
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'ok'; };

test('gönderim: parça parça, sırayla; boyut ve özet tutunca dosya hazır, ad temizlenmiş', () => {
  const { dir, up, files } = setup();
  const data = crypto.randomBytes(150 * 1024);
  const b = up.begin('ph1', { kind: 'video', name: '..\\..\\Windows\\gece klip.mp4', size: data.length });
  assert.ok(/^[0-9a-f]{24}$/.test(b.id));
  assert.strictEqual(b.chunk, U.CHUNK_MAX);
  let at = 0;
  while (at < data.length) {
    const part = data.subarray(at, at + U.CHUNK_MAX);
    assert.deepStrictEqual(up.chunk('ph1', { id: b.id, at, data: part.toString('base64') }), { got: at + part.length });
    at += part.length;
  }
  const done = up.end('ph1', { id: b.id, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  assert.strictEqual(done.kind, 'video');
  assert.strictEqual(done.name, 'Windows gece klip.mp4', 'yol ayırıcısı ve üst klasör adda kalmadı');
  assert.strictEqual(done.use, '');
  assert.strictEqual(path.dirname(done.file), dir, 'yalnız kendi klasörüne');
  assert.ok(fs.readFileSync(done.file).equals(data));
  assert.deepStrictEqual(files(), [b.id + '.mp4']);
  const au = up.begin('ph1', { kind: 'audio', name: 'Moment.mp3', size: 3, use: 'timeline' });
  up.chunk('ph1', { id: au.id, at: 0, data: Buffer.from('abc').toString('base64') });
  const ad = up.end('ph1', { id: au.id, sha256: crypto.createHash('sha256').update('abc').digest('hex') });
  assert.strictEqual(ad.use, 'timeline');
});

test('red: tür, uzantı, boyut, sıra dışı parça, fazla bayt, yanlış özet, başka telefon', () => {
  const { up, files } = setup();
  assert.strictEqual(code(() => up.begin('p', { kind: 'exe', name: 'a.exe', size: 10 })), 'bad-kind');
  assert.strictEqual(code(() => up.begin('p', { kind: 'logo', name: 'a.exe', size: 10 })), 'bad-type');
  assert.strictEqual(code(() => up.begin('p', { kind: 'lyrics', name: 'a.lrc', size: 2 * 1024 * 1024 })), 'too-big');
  assert.strictEqual(code(() => up.begin('p', { kind: 'lyrics', name: 'a.lrc', size: 1.5 })), 'bad-args');
  const b = up.begin('p', { kind: 'lyrics', name: 'şarkı.lrc', size: 4 });
  assert.strictEqual(code(() => up.chunk('p', { id: b.id, at: 2, data: 'AAA=' })), 'bad-offset');
  assert.strictEqual(code(() => up.chunk('başka', { id: b.id, at: 0, data: 'AAA=' })), 'unknown-upload');
  assert.strictEqual(code(() => up.chunk('p', { id: b.id, at: 0, data: 'not base64!' })), 'bad-args');
  up.chunk('p', { id: b.id, at: 0, data: Buffer.from('ab').toString('base64') });
  assert.strictEqual(code(() => up.chunk('p', { id: b.id, at: 2, data: Buffer.from('cdef').toString('base64') })), 'too-big');
  assert.strictEqual(code(() => up.end('p', { id: b.id, sha256: 'x' })), 'unknown-upload', 'aşan aktarım silindi');
  const c = up.begin('p', { kind: 'lyrics', name: 'b.lrc', size: 2 });
  up.chunk('p', { id: c.id, at: 0, data: Buffer.from('ab').toString('base64') });
  assert.strictEqual(code(() => up.end('p', { id: c.id, sha256: '00'.repeat(32) })), 'bad-hash');
  assert.deepStrictEqual(files(), [], 'yarım ve hatalı dosya kalmadı');
});

test('sınır ve temizlik: telefon başına iki aktarım, boşta kalan silinir, oturum kapanınca silinir', () => {
  const { up, tick, files } = setup();
  up.begin('a', { kind: 'milk', name: '1.milk', size: 10 });
  const two = up.begin('a', { kind: 'milk', name: '2.milk', size: 10 });
  assert.strictEqual(code(() => up.begin('a', { kind: 'milk', name: '3.milk', size: 10 })), 'busy');
  up.begin('b', { kind: 'milk', name: '4.milk', size: 10 });
  assert.strictEqual(up.active(), 3);
  assert.strictEqual(up.cancel('b', two.id), false, 'başkasının aktarımı iptal edilemez');
  up.dropOwner('b');
  assert.strictEqual(up.active(), 2);
  tick(U.IDLE_MS + 1);
  up.sweep();
  assert.strictEqual(up.active(), 0);
  assert.deepStrictEqual(files(), []);
  assert.strictEqual(U.cleanName('a/b:c*.lrc', 'lrc'), 'a b c .lrc');
  assert.strictEqual(U.cleanName('', 'mp3'), 'telefon.mp3');
});
