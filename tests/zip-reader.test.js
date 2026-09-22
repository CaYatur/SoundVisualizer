'use strict';
/* ZIP OKUYUCU (#574). Preset paketleri ZIP olarak dolaşıyor; arşiv
 * kullanıcının indirdiği, güvenilmez bir dosya. Testler arşivleri burada,
 * elle yazıyor: saklanmış ve deflate girdiler, UTF-8 ve CP437 adlar, ZIP64,
 * şifreli girdi, başka sıkıştırma yöntemi, bozuk CRC, başlığı yalan
 * söyleyen girdi, sıkıştırma bombası, bozuk merkezi dizin.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Z = require('../src/main/zip-reader.js');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmpFile(buf) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-zip-'));
  made.push(d);
  const f = path.join(d, 'paket.zip');
  fs.writeFileSync(f, buf);
  return f;
}

/* Elle ZIP. `files`: { name, data, method (0|8|başka), utf8 (varsayılan
   true), flags, crc, size, nameBuf }. `zip64`: sonu ZIP64 kayıtlarıyla ve
   girdilerin boyut/konumu ZIP64 ek alanında. `declaredCount`: sonda
   bildirilen girdi sayısı (yalan söylemek için). */
function makeZip(files, opts) {
  const o = opts || {};
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data == null ? '' : f.data);
    const method = f.method == null ? 8 : f.method;
    const comp = f.comp || (method === 8 ? zlib.deflateRawSync(data) : data);
    const nameBuf = f.nameBuf || Buffer.from(f.name, 'utf8');
    const flags = (f.flags || 0) | (f.utf8 === false ? 0 : 0x800);
    const crc = f.crc != null ? f.crc : Z.crc32(data);
    const size = f.size != null ? f.size : data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const extra = o.zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (o.zip64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(size), 4);
      extra.writeBigUInt64LE(BigInt(comp.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(45, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(o.zip64 ? 0xffffffff : comp.length, 20);
    cd.writeUInt32LE(o.zip64 ? 0xffffffff : size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(extra.length, 30);
    cd.writeUInt32LE(o.zip64 ? 0xffffffff : offset, 42);
    locals.push(lh, nameBuf, comp);
    central.push(cd, nameBuf, extra);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const count = o.declaredCount != null ? o.declaredCount : files.length;
  const tail = [];
  if (o.zip64) {
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(count), 24);
    rec.writeBigUInt64LE(BigInt(count), 32);
    rec.writeBigUInt64LE(BigInt(cdBuf.length), 40);
    rec.writeBigUInt64LE(BigInt(offset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(offset + cdBuf.length), 8);
    loc.writeUInt32LE(1, 16);
    tail.push(rec, loc);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(o.zip64 ? 0xffff : count, 8);
  eocd.writeUInt16LE(o.zip64 ? 0xffff : count, 10);
  eocd.writeUInt32LE(o.zip64 ? 0xffffffff : cdBuf.length, 12);
  eocd.writeUInt32LE(o.zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat(locals.concat([cdBuf], tail, [eocd]));
}

const code = (fn) => { try { fn(); return 'hata yok'; } catch (e) { return e.code || e.message; } };

test('CRC32 standart doğrulama değeri', () => {
  assert.strictEqual(Z.crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
});

test('saklanmış ve deflate girdiler, klasörler, UTF-8 ad', () => {
  const milk = '[preset00]\nfDecay=0.98\nper_frame_1=zoom = 1.01;\n'.repeat(40);
  const f = tmpFile(makeZip([
    { name: 'Paket/', data: '', method: 0 },
    { name: 'Paket/Fraktal/Geiss - Kazan.milk', data: milk },
    { name: 'Paket/doku/ışık.png', data: Buffer.from([1, 2, 3, 4]), method: 0 },
  ]));
  const z = Z.open(f);
  try {
    assert.deepStrictEqual(z.entries.map((e) => [e.name, e.dir, e.method]), [
      ['Paket/', true, 0], ['Paket/Fraktal/Geiss - Kazan.milk', false, 8], ['Paket/doku/ışık.png', false, 0],
    ]);
    assert.strictEqual(z.read(z.entries[1]).toString('utf8'), milk);
    assert.ok(z.entries[1].compSize < milk.length, 'gerçekten sıkışmış');
    assert.deepStrictEqual([...z.read(z.entries[2])], [1, 2, 3, 4]);
    assert.strictEqual(code(() => z.read(z.entries[0])), 'IS_DIR');
    assert.strictEqual(code(() => z.read(z.entries[1], 10)), 'TOO_LARGE', 'çağıranın sınırı');
  } finally {
    z.close();
  }
  assert.strictEqual(code(() => z.read(z.entries[1])), 'CLOSED');
});

test('CP437 ad: UTF-8 bayrağı yokken DOS kod sayfası', () => {
  const f = tmpFile(makeZip([{ name: 'x', nameBuf: Buffer.from([0x80, 0x81, 0x65, 0x2e, 0x6d, 0x69, 0x6c, 0x6b]), utf8: false, data: 'a' }]));
  const z = Z.open(f);
  assert.strictEqual(z.entries[0].name, 'Çüe.milk');
  z.close();
});

test('ZIP64: girdi sayısı, boyut ve konum ZIP64 kayıtlarından', () => {
  const f = tmpFile(makeZip([
    { name: 'a.milk', data: 'birinci' },
    { name: 'b.milk', data: 'ikinci', method: 0 },
  ], { zip64: true }));
  const z = Z.open(f);
  assert.deepStrictEqual(z.entries.map((e) => [e.name, e.size]), [['a.milk', 7], ['b.milk', 6]]);
  assert.strictEqual(z.read(z.entries[0]).toString(), 'birinci');
  assert.strictEqual(z.read(z.entries[1]).toString(), 'ikinci');
  z.close();
  // Çok girdi bildiren arşiv, merkezi dizin okunmadan reddediliyor
  assert.strictEqual(code(() => Z.open(tmpFile(makeZip([], { zip64: true, declaredCount: Z.MAX_ENTRIES + 1 })))), 'TOO_MANY_ENTRIES');
});

test('şifreli girdi ve başka sıkıştırma yöntemi kendi adıyla', () => {
  const f = tmpFile(makeZip([
    { name: 'gizli.milk', data: 'x', flags: 1 },
    { name: 'lzma.milk', data: 'y', method: 14, comp: Buffer.from('y') },
  ]));
  const z = Z.open(f);
  assert.strictEqual(z.entries[0].encrypted, true);
  assert.strictEqual(code(() => z.read(z.entries[0])), 'ENCRYPTED');
  assert.strictEqual(code(() => z.read(z.entries[1])), 'UNSUPPORTED_METHOD');
  z.close();
});

test('bozuk içerik: CRC, yalan söyleyen boyut, bomba', () => {
  const data = Buffer.alloc(3 * 1024 * 1024, 0x41);
  const f = tmpFile(makeZip([
    { name: 'crc.milk', data: 'abc', crc: 12345 },
    // Başlık 10 bayt diyor, içerik 3 MB açılıyor: bildirilenin ötesine açılamıyor
    { name: 'yalan.milk', data, size: 10 },
    // 3 MB, ~3 KB'a sıkışıyor: oran sınırın üstünde
    { name: 'bomba.png', data },
  ]));
  const z = Z.open(f);
  assert.strictEqual(code(() => z.read(z.entries[0])), 'CRC');
  assert.strictEqual(code(() => z.read(z.entries[1])), 'CORRUPT');
  assert.ok(z.entries[2].size / z.entries[2].compSize > Z.MAX_RATIO);
  assert.strictEqual(code(() => z.read(z.entries[2])), 'SUSPICIOUS_RATIO');
  z.close();
});

test('ZIP olmayan ve bozuk arşiv', () => {
  assert.strictEqual(code(() => Z.open(tmpFile(Buffer.from('MILKDROP_PRESET_VERSION=201\n'.repeat(3))))), 'NOT_ZIP');
  assert.strictEqual(code(() => Z.open(tmpFile(Buffer.alloc(5)))), 'NOT_ZIP');
  const good = makeZip([{ name: 'a.milk', data: 'abc' }]);
  // Merkezi dizinin imzası bozuk
  const bad = Buffer.from(good);
  bad.writeUInt32LE(0xdeadbeef, good.length - 22 - 46 - 6);
  assert.strictEqual(code(() => Z.open(tmpFile(bad))), 'CORRUPT');
  // Merkezi dizin dosyanın dışını gösteriyor
  const out = Buffer.from(good);
  out.writeUInt32LE(0x7fffffff, good.length - 22 + 16);
  assert.strictEqual(code(() => Z.open(tmpFile(out))), 'CORRUPT');
});
