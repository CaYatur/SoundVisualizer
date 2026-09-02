'use strict';
/* assets/icon.svg -> build/icon.png (1024), build/icon.ico, build/icon.icns
   Ayrıca admin arayüzü için assets/logo-256.png üretir. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'icon.svg');
/* Küçük boylarda ayrıntılı glif okunmuyor (bkz. assets/icon-small.svg).
   SMALL_MAX ve altındaki her boy sadeleştirilmiş çizimden üretilir. */
const SVG_SMALL = path.join(ROOT, 'assets', 'icon-small.svg');
const SMALL_MAX = 48;
const BUILD = path.join(ROOT, 'build');
const ASSETS = path.join(ROOT, 'assets');

/* Windows ICO üreticisi.
   png2icons tüm boyutları PNG olarak gömüyordu. PNG sıkıştırması ICO içinde
   yalnızca 256x256 için güvenilir biçimde destekleniyor; daha küçük girdileri
   Windows kabuğu (görev çubuğu, alt-tab, kısayollar) DIB sanıp saydamlığı
   kaybediyor ve simge siyah zeminli görünüyordu.

   Doğrusu: <=128 boyutlar 32-bit BGRA DIB (BMP) olarak, 256 PNG olarak yazılır. */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

function bmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight = XOR + AND
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB

  // XOR düzlemi: alttan üste, BGRA
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    const dst = y * size * 4;
    for (let x = 0; x < size; x++) {
      xor[dst + x * 4 + 0] = rgba[src + x * 4 + 2]; // B
      xor[dst + x * 4 + 1] = rgba[src + x * 4 + 1]; // G
      xor[dst + x * 4 + 2] = rgba[src + x * 4 + 0]; // R
      xor[dst + x * 4 + 3] = rgba[src + x * 4 + 3]; // A
    }
  }
  // AND maskesi: 32-bit alfa kullanıldığı için tamamen sıfır (satırlar 4 bayta hizalı)
  const andStride = (((size + 31) >> 5) << 2);
  const and = Buffer.alloc(andStride * size, 0);

  return Buffer.concat([header, xor, and]);
}

async function buildIco(svg, svgSmall) {
  const images = [];
  for (const size of ICO_SIZES) {
    const src = size <= SMALL_MAX ? svgSmall : svg;
    const png = sharp(src, { density: 384 }).resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    if (size === 256) {
      images.push({ size, data: await png.png().toBuffer() });
    } else {
      const { data } = await png.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
      images.push({ size, data: bmpEntry(data, size) });
    }
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir[o] = img.size >= 256 ? 0 : img.size; // 0 = 256
    dir[o + 1] = img.size >= 256 ? 0 : img.size;
    dir[o + 2] = 0; // palet rengi yok
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bit count
    dir.writeUInt32LE(img.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

async function main() {
  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });
  const svg = fs.readFileSync(SVG);

  // 1024 PNG (ana)
  const png1024 = await sharp(svg, { density: 384 }).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(BUILD, 'icon.png'), png1024);

  // 256 PNG (admin arayüzü)
  const png256 = await sharp(svg, { density: 384 }).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(ASSETS, 'logo-256.png'), png256);

  // ICO (Windows) — her boyut SVG'den ayrı ayrı üretilir; küçükler DIB olur
  const ico = await buildIco(svg, fs.readFileSync(SVG_SMALL));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);

  // ICNS (macOS)
  const icns = png2icons.createICNS(png1024, png2icons.BILINEAR, 0);
  fs.writeFileSync(path.join(BUILD, 'icon.icns'), icns);

  console.log('Ikonlar uretildi: build/icon.png, build/icon.ico, build/icon.icns, assets/logo-256.png');
}

main().catch((e) => {
  console.error('Ikon uretimi basarisiz:', e.message);
  process.exit(1);
});
