'use strict';
/* assets/icon.svg -> build/icon.png (1024), build/icon.ico, build/icon.icns
   Ayrıca admin arayüzü için assets/logo-256.png üretir. */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'icon.svg');
const BUILD = path.join(ROOT, 'build');
const ASSETS = path.join(ROOT, 'assets');

async function main() {
  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });
  const svg = fs.readFileSync(SVG);

  // 1024 PNG (ana)
  const png1024 = await sharp(svg, { density: 384 }).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync(path.join(BUILD, 'icon.png'), png1024);

  // 256 PNG (admin arayüzü)
  const png256 = await sharp(svg, { density: 384 }).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(ASSETS, 'logo-256.png'), png256);

  // ICO (Windows)
  const ico = png2icons.createICO(png1024, png2icons.BILINEAR, 0, true);
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
