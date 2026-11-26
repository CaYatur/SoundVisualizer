'use strict';
/* Telefon ↔ PC video başvurusu (src/main/link-media.js, docs/PHONE-LINK.md "Videos").
   İki makinenin adresi birbirinde açılmıyordu: seçim görünüyor, video çizilmiyordu.
   Ortak dil PC'nin video kitaplığının kimliği. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mediaUrl = require('../src/shared/media-url');
const L = require('../src/main/link-media');

function setup(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-linkmedia-'));
  const file = path.join(dir, 'klip.mp4');
  fs.writeFileSync(file, bytes);
  const library = {
    fileInfo: (d, id) => (id === 'vid_1' ? { file, size: bytes.length, name: 'Klip' } : null),
  };
  const api = L.createLinkMedia({ library, libDir: dir, mediaUrl });
  return { dir, file, api };
}

test('kitaplık kimliğiyle video parça parça okunur ve tamamı birleşir', () => {
  const bytes = Buffer.alloc(L.CHUNK_MAX + 1000, 7);
  bytes[0] = 1; bytes[bytes.length - 1] = 9;
  const h = setup(bytes);
  const a = h.api.fetch({ id: 'vid_1', at: 0 }, {});
  assert.strictEqual(a.size, bytes.length);
  assert.strictEqual(a.done, false);
  const b = h.api.fetch({ id: 'vid_1', at: L.CHUNK_MAX }, {});
  assert.strictEqual(b.done, true);
  const all = Buffer.concat([Buffer.from(a.data, 'base64'), Buffer.from(b.data, 'base64')]);
  assert.ok(all.equals(bytes));
  assert.strictEqual(a.id, 'vid_1');
  assert.strictEqual(a.name, 'Klip');
});

test('yol telefondan gelmez: yalnız ayarda video olarak duran adres okunur', () => {
  const h = setup(Buffer.from('video'));
  const ref = mediaUrl.toMediaUrl(h.file);
  assert.throws(() => h.api.fetch({ file: ref, at: 0 }, {}), /not-allowed/);
  const cfg = { layers: [{ kind: 'media', settings: { media: { source: 'file', file: ref } } }] };
  const r = h.api.fetch({ file: ref, at: 0 }, cfg);
  assert.strictEqual(Buffer.from(r.data, 'base64').toString(), 'video');
  assert.strictEqual(r.done, true);
  // Çizelge klibi de ayardaki başvurudur
  const tl = { timeline: { tracks: [{ clips: [{ type: 'video', ref }] }] } };
  assert.strictEqual(h.api.fetch({ file: ref, at: 0 }, tl).size, 5);
  assert.throws(() => h.api.fetch({ id: 'yok', at: 0 }, {}), /no-file/);
  assert.throws(() => h.api.fetch({}, {}), /bad-args/);
  // Video olmayan dosya ayarda dursa da verilmez
  const txt = path.join(h.dir, 'gizli.txt');
  fs.writeFileSync(txt, 'x');
  const bad = mediaUrl.toMediaUrl(txt);
  assert.throws(() => h.api.fetch({ file: bad, at: 0 }, { media: { source: 'file', file: bad } }), /type/);
});

test('telefonun adresi PC ayarına girmez: kitaplık kimliği PC dosyasına çevrilir', () => {
  const h = setup(Buffer.from('v'));
  const phone = 'https://appassets.androidplatform.net/files/lib-media/klip.mp4';
  const patch = {
    layers: [
      { id: 'a', kind: 'media', settings: { media: { source: 'file', file: phone, libraryId: 'vid_1', fileName: 'Klip' } } },
      { id: 'b', kind: 'media', settings: { media: { source: 'file', file: phone, libraryId: 'yok' } } },
    ],
    timeline: { tracks: [{ clips: [{ type: 'video', ref: phone, libraryId: 'vid_1' }] }] },
  };
  const before = JSON.stringify(patch);
  const r = h.api.rewritePatch(patch);
  assert.strictEqual(JSON.stringify(patch), before, 'yerinde değişmez');
  assert.strictEqual(r.changed, 2);
  assert.strictEqual(r.patch.layers[0].settings.media.file, mediaUrl.toMediaUrl(h.file));
  assert.strictEqual(r.patch.layers[1].settings.media.file, phone, 'PC kitaplığında olmayan kimlik değişmez');
  assert.strictEqual(r.patch.timeline.tracks[0].clips[0].ref, mediaUrl.toMediaUrl(h.file));
  const same = { master: 1 };
  assert.strictEqual(h.api.rewritePatch(same).patch, same);
});

test('bağlantı: media.fetch izle düzeyinde, yamalar kontrolden önce çevrilir', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n'); // Windows'ta satır sonu CRLF
  assert.match(read('src/main/phone-link.js'), /'media\.fetch': 'view'/);
  const main = read('src/main/main.js');
  assert.match(main, /'media\.fetch': \(args\) => linkMediaApi\(\)\.fetch\(args, currentConfig \|\| \{\}\)/);
  assert.match(main, /const patch = linkMediaApi\(\)\.rewritePatch\(args\.patch\)\.patch;\n\s+const g = linkGuard\.check\(patch,/);
  assert.match(read('docs/PHONE-LINK.md'), /`media\.fetch`/);
});
