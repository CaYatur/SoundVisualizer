/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// Sayfa: MilkDrop 2 | A | B. node sheetx.js <md-dizini> <A> <B> <kare,kare..> <id> [W H]
// Her satır bir kare; sütunlar MD, A, B. Ortalama parlaklık da yazılıyor.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const [MDN, AN, BN, KS, id, Ws, Hs] = process.argv.slice(2);
const W = +(Ws || 960), H = +(Hs || 720), sw = W >> 1, sh = H >> 1;
const K = KS.split(',');
function png(w, h, rgba) {
  const crcT = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c; }
  const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const img = Buffer.alloc(sw * 3 * sh * K.length * 4);
K.forEach((k, ri) => {
  const src = [
    [path.join(__dirname, 'out', MDN, id, 'f' + k + '.bgra'), true],
    [path.join(__dirname, 'out', AN, id, 'o' + k + '.rgba'), false],
    [path.join(__dirname, 'out', BN, id, 'o' + k + '.rgba'), false],
  ];
  const lum = [];
  src.forEach(([f, bgra], ci) => {
    const b = fs.readFileSync(f);
    let s = 0;
    for (let i = 0; i < W * H * 4; i += 4) s += (b[i] + b[i + 1] + b[i + 2]) / 765;
    lum.push((s / (W * H)).toFixed(3));
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const si = ((y * 2) * W + x * 2) * 4;
      const d = (((ri * sh + y) * sw * 3) + ci * sw + x) * 4;
      img[d] = bgra ? b[si + 2] : b[si]; img[d + 1] = b[si + 1]; img[d + 2] = bgra ? b[si] : b[si + 2]; img[d + 3] = 255;
    }
  });
  console.log('f' + k, 'parlaklık MD/A/B', lum.join(' '));
});
const out = path.join(__dirname, 'out', 'x-' + AN + '-' + BN + '-' + id + '.png');
fs.writeFileSync(out, png(sw * 3, sh * K.length, img));
console.log(out);
