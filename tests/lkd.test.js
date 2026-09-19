'use strict';
/* Pioneer `.lkd` çözücüsü.

   Biçim tersine mühendislikle bulundu (bkz. src/shared/lkd.js). Test hem
   gerçek örnek dosyalarla (assets/lkd/pioneer/samples) hem de elde üretilmiş
   sentetik dosyalarla çalışır: gerçek dosyalar biçimin gerçekten çözüldüğünü,
   sentetikler de bozuk/eksik girdilerin çökme yerine açıklayıcı hata
   verdiğini gösterir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const L = require('../src/shared/lkd.js');

const SAMPLES = path.join(__dirname, '..', 'assets', 'lkd', 'pioneer', 'samples');
const DOLPHINS = path.join(SAMPLES, 'alt_diverdolphins.lkd');

// --- Sentetik yardımcılar -------------------------------------------------

// width x height 24-bit alttan-üste BMP; renk = (x*?,...) yerine sabit palet
function makeBmp(width, height, fill) {
  const rowSize = (width * 3 + 3) & ~3;
  const dataOffset = 54;
  const size = dataOffset + rowSize * height;
  const b = Buffer.alloc(size);
  b[0] = 0x42; b[1] = 0x4d; // 'BM'
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(dataOffset, 10);
  b.writeUInt32LE(40, 14); // header size
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22); // pozitif = alttan-üste
  b.writeUInt16LE(1, 26); // planes
  b.writeUInt16LE(24, 28); // bpp
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = dataOffset + y * rowSize + x * 3;
      const [r, g, bl] = fill(x, y);
      b[o] = bl; b[o + 1] = g; b[o + 2] = r; // BGR
    }
  }
  return b;
}

// Tek dosyalık minimal TAR
function makeTar(name, data) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'ascii');
  header.write('0000644', 100, 'ascii'); // mode
  header.write('0000000', 108, 'ascii');
  header.write('0000000', 116, 'ascii');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii'); // size (octal)
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  header.write('        ', 148, 'ascii'); // checksum boşluk
  header[156] = 0x30; // '0' normal dosya
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(body);
  return Buffer.concat([header, body, Buffer.alloc(1024)]); // sonda iki boş blok
}

function makeLkd(frameCount, width, frameH, version) {
  const strip = makeBmp(width, frameH * frameCount, (x, y) => [(x * 2) & 255, (y * 3) & 255, 128]);
  const tar = makeTar('STRIP', strip);
  const gz = zlib.gzipSync(tar);
  const head = Buffer.alloc(20);
  head.write('zLKD', 0, 'ascii');
  head.writeUInt32LE(version == null ? 3 : version, 4);
  head.writeUInt32LE(1, 8);
  head.writeUInt32LE(7, 12);
  head.writeUInt32LE(frameCount, 16);
  return Buffer.concat([head, gz]);
}

// --- Başlık / sihirli imza ------------------------------------------------

test('geçerli başlık ayrıştırılır', () => {
  const b = makeLkd(4, 16, 8);
  const h = L.parseHeader(b);
  assert.strictEqual(h.version, 3);
  assert.strictEqual(h.frameCount, 4);
  assert.strictEqual(h.payloadOffset, 20);
});

test('yanlış sihirli imza açıklayıcı hata verir', () => {
  const b = Buffer.from('NOPExxxxxxxxxxxxxxxxxxxx');
  assert.throws(() => L.parseHeader(b), /bad magic/);
  assert.strictEqual(L.isLkd(b), false);
});

test('kesik dosya (başlıktan kısa) çökme yerine hata verir', () => {
  assert.throws(() => L.parseHeader(Buffer.from('zLKD\x03')), /too small/);
});

// --- BMP / kare bölme -----------------------------------------------------

test('24-bit alttan-üste BMP doğru okunur (renk ve satır sırası)', () => {
  // Depoda alttan-üste: fill'in y'si depo satırı; parseBmp top-down döndürür,
  // yani çıktı (0,0) = depo son satırı (y=1).
  const bmp = makeBmp(2, 2, (x, y) => [x === 0 ? 255 : 0, y === 1 ? 200 : 0, 0]);
  const img = L.parseBmp(bmp);
  assert.strictEqual(img.width, 2);
  assert.strictEqual(img.height, 2);
  // çıktı üst satırı = depo y=1: R=255 (x=0), G=200
  assert.deepStrictEqual(Array.from(img.rgba.slice(0, 4)), [255, 200, 0, 255]);
});

test('desteklenmeyen BMP derinliği hata verir', () => {
  const bmp = makeBmp(2, 2, () => [0, 0, 0]);
  bmp.writeUInt16LE(8, 28); // 8-bit
  assert.throws(() => L.parseBmp(bmp), /depth/);
});

test('şerit kare sayısına göre bölünür', () => {
  const strip = makeBmp(4, 24, () => [10, 20, 30]);
  const sliced = L.framesFromStrip(strip, 3);
  assert.strictEqual(sliced.frameCount, 3);
  assert.strictEqual(sliced.frameHeight, 8);
  assert.strictEqual(sliced.frames.length, 3);
  assert.strictEqual(sliced.frames[0].width, 4);
  assert.strictEqual(sliced.frames[0].height, 8);
});

// --- Uçtan uca çözme ------------------------------------------------------

test('sentetik .lkd uçtan uca çözülür', async () => {
  const b = makeLkd(6, 32, 16, 5);
  const a = await L.decode(b);
  assert.strictEqual(a.version, 5);
  assert.strictEqual(a.frameCount, 6);
  assert.strictEqual(a.width, 32);
  assert.strictEqual(a.frameHeight, 16);
  assert.strictEqual(a.frames.length, 6);
  assert.strictEqual(a.loop, true);
  assert.strictEqual(a.delayMs, L.DEFAULT_DELAY_MS);
  assert.strictEqual(a.frames[0].rgba.length, 32 * 16 * 4);
});

test('bozuk gzip yükü açıklayıcı hata verir (çökme yok)', async () => {
  const b = makeLkd(4, 16, 8);
  // gzip akışının ortasını boz
  b[40] = b[40] ^ 0xff; b[41] = b[41] ^ 0xff; b[42] = b[42] ^ 0xff;
  await assert.rejects(() => L.decode(b), /gzip|LKD/);
});

test('özel delayMs geçirilebilir', async () => {
  const a = await L.decode(makeLkd(3, 8, 8), { delayMs: 40 });
  assert.strictEqual(a.delayMs, 40);
});

// --- Gerçek Pioneer dosyaları ---------------------------------------------

test('gerçek Pioneer yunus .lkd dosyası çözülür', { skip: !fs.existsSync(DOLPHINS) }, async () => {
  const a = await L.decode(fs.readFileSync(DOLPHINS));
  assert.strictEqual(a.magic, 'zLKD');
  assert.ok(a.frameCount > 1, 'birden çok kare olmalı');
  assert.ok(a.width > 0 && a.frameHeight > 0);
  assert.strictEqual(a.frames.length, a.frameCount);
  // her kare tam RGBA tamponu
  assert.strictEqual(a.frames[0].rgba.length, a.width * a.frameHeight * 4);
  // alfa hep opak (24-bit BMP)
  assert.strictEqual(a.frames[0].rgba[3], 255);
});

// --- Döngü / oynatma zamanlaması ------------------------------------------

test('kare seçimi döngüseldir', () => {
  const dur = [60, 60, 60, 60]; // 4 kare, toplam 240ms
  assert.strictEqual(L.frameIndexAt(dur, 0), 0);
  assert.strictEqual(L.frameIndexAt(dur, 70), 1);
  assert.strictEqual(L.frameIndexAt(dur, 130), 2);
  assert.strictEqual(L.frameIndexAt(dur, 240), 0); // başa sarar
  assert.strictEqual(L.frameIndexAt(dur, 250), 0);
  assert.strictEqual(L.frameIndexAt(dur, 310), 1);
  assert.strictEqual(L.frameIndexAt(dur, -10), 3); // negatif -> son kare
});
