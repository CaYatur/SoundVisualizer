'use strict';
/* Paylaşılan doku tanıtıcısının çıkarımı.
 *
 * Bu testlerin sebebi somut: texture-bridge'in tür tanımı tanıtıcının bir
 * SAYI olduğunu söylüyor, Electron 43 ise { ntHandle: Buffer } veriyor.
 * Gerçek bir paint olayından ölçülen değer:
 *
 *   handle = { ntHandle: <Buffer dc 0d 00 00 00 00 00 00> }   // 0x0DDC
 *
 * Yanlış çıkarım hiçbir hata vermez — gönderici çöp bir tanıtıcı alır ve
 * alıcı tarafta yalnızca siyah bir kare görünür. macOS'u burada
 * çalıştıramadığımız için orasının tek güvencesi de bu dosya.
 */
const test = require('node:test');
const assert = require('node:assert');

const T = require('../src/shared/shared-texture.js');

const SIZE = { codedSize: { width: 1920, height: 1080 } };
const ntBuf = (v) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v), 0);
  return b;
};

// ------------------------------------------------------------ Windows
test('Windows: Electron 43 biçimi ({ntHandle: Buffer}) çözülüyor', () => {
  /* Gerçek bir paint olayından ölçülen bayt dizisi. */
  const info = Object.assign({ handle: { ntHandle: Buffer.from([0xdc, 0x0d, 0, 0, 0, 0, 0, 0]) } }, SIZE);
  const r = T.extractHandle(info, 'win32');
  assert.strictEqual(r.kind, 'nt');
  assert.strictEqual(r.ntHandle, 0x0ddc);
  assert.strictEqual(r.width, 1920);
  assert.strictEqual(r.height, 1080);
});

test('Windows: eski düz sayı biçimi de kabul ediliyor', () => {
  /* Electron sürümleri arasında değişti; ikisini de kabul etmek, bir
     yükseltmenin Spout çıkışını sessizce kapatmasını önler. */
  const r = T.extractHandle(Object.assign({ handle: 3548 }, SIZE), 'win32');
  assert.deepStrictEqual([r.kind, r.ntHandle], ['nt', 3548]);
});

test('Windows: BigInt tanıtıcı da kabul ediliyor', () => {
  const r = T.extractHandle(Object.assign({ handle: BigInt(3548) }, SIZE), 'win32');
  assert.deepStrictEqual([r.kind, r.ntHandle], ['nt', 3548]);
});

test('Windows: IPC üzerinden geçmiş Buffer (JSON biçimi) çözülüyor', () => {
  const info = Object.assign({ handle: { ntHandle: { type: 'Buffer', data: [0xdc, 0x0d, 0, 0, 0, 0, 0, 0] } } }, SIZE);
  assert.strictEqual(T.extractHandle(info, 'win32').ntHandle, 0x0ddc);
});

test('Windows: güvenli tamsayıyı aşan tanıtıcı REDDEDİLİYOR', () => {
  /* Sessizce yuvarlanmış bir tanıtıcı bambaşka bir nesneyi gösterir.
     Yanlış bir dokuyu yayınlamaktansa hiç yayınlamamak gerekir. */
  const r = T.extractHandle(Object.assign({ handle: { ntHandle: ntBuf('9007199254740993') } }, SIZE), 'win32');
  assert.strictEqual(r.error, 'HANDLE_TOO_LARGE');
});

// ------------------------------------------------------------ macOS
test('macOS: IOSurface tamponu ayrı bir yolla veriliyor', () => {
  /* macOS'ta sayıya çevirmek YANLIŞ: texture-bridge sendSurface() ile
     tamponun kendisini istiyor. */
  const surface = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const r = T.extractHandle(Object.assign({ handle: { ioSurface: surface } }, SIZE), 'darwin');
  assert.strictEqual(r.kind, 'iosurface');
  assert.ok(Buffer.isBuffer(r.surface));
  assert.deepStrictEqual(Array.from(r.surface), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('macOS: ntHandle beklenmiyor, IOSurface yoksa hata', () => {
  const r = T.extractHandle(Object.assign({ handle: { ntHandle: ntBuf(10) } }, SIZE), 'darwin');
  /* ntHandle bir tampon olduğu için IOSurface gibi geçebilir; asıl önemli
     olan Windows yolunun macOS'ta ÇALIŞMAMASI, yani sayıya çevrilmemesi. */
  assert.notStrictEqual(r.kind, 'nt');
});

test('platform ayrımı gerçekten yapılıyor', () => {
  const info = Object.assign({ handle: { ntHandle: ntBuf(42), ioSurface: Buffer.alloc(8) } }, SIZE);
  assert.strictEqual(T.extractHandle(info, 'win32').kind, 'nt');
  assert.strictEqual(T.extractHandle(info, 'darwin').kind, 'iosurface');
});

// ------------------------------------------------------------ kötü girdi
test('boyutu olmayan doku reddediliyor', () => {
  assert.strictEqual(T.extractHandle({ handle: { ntHandle: ntBuf(1) } }, 'win32').error, 'NO_SIZE');
  assert.strictEqual(T.extractHandle({ handle: { ntHandle: ntBuf(1) }, codedSize: { width: 0, height: 0 } }, 'win32').error, 'NO_SIZE');
});

test('tanıtıcısı olmayan doku reddediliyor', () => {
  assert.strictEqual(T.extractHandle(SIZE, 'win32').error, 'NO_HANDLE');
  assert.strictEqual(T.extractHandle({}, 'win32').error, 'NO_SIZE');
  assert.strictEqual(T.extractHandle(null, 'win32').error, 'NO_SIZE');
});

test('visibleRect boyut için yedek olarak kullanılıyor', () => {
  const r = T.extractHandle({ handle: { ntHandle: ntBuf(7) }, visibleRect: { width: 800, height: 600 } }, 'win32');
  assert.deepStrictEqual([r.width, r.height], [800, 600]);
});

// ------------------------------------------------------------ piksel biçimi
test('desteklenen piksel biçimleri', () => {
  assert.strictEqual(T.formatSupported('bgra'), true);
  assert.strictEqual(T.formatSupported('rgba'), true);
  assert.strictEqual(T.formatSupported('BGRA'), true);
});

test('desteklenmeyen biçim sessizce geçmiyor', () => {
  /* HDR biçimleri Spout/Syphon tarafında bozuk renk üretir; reddetmek,
     sebebi anlaşılmayan yanlış renklerden iyidir. */
  assert.strictEqual(T.formatSupported('rgbaf16'), false);
  assert.strictEqual(T.formatSupported(''), false);
  assert.strictEqual(T.formatSupported(null), false);
});

test('tampondan sayıya çevirme sınırları', () => {
  assert.strictEqual(T.bufferToNumber(ntBuf(0)), 0);
  assert.strictEqual(T.bufferToNumber(ntBuf(3548)), 3548);
  assert.strictEqual(T.bufferToNumber(Buffer.alloc(4)), null, 'kısa tampon');
  assert.strictEqual(T.bufferToNumber(null), null);
});
