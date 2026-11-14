/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Küçük PNG çözücü: DevTools ekran görüntüsünün parlaklığını ölçmek için.
   Yalnız 8 bit RGB/RGBA, iç içe geçmesiz (DevTools'un ürettiği biçim). */
const zlib = require('node:zlib');

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG değil');
  let pos = 8;
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace) throw new Error('desteklenmeyen PNG');
  const bpp = color === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, bpp, data: out };
}

/** Ortalama parlaklık (0..255) ve "siyah değil" piksel oranı (luma > 12).
    `step`: her yönde kaçta bir piksel (tam ekran görüntüsü için 8). */
function luma(buf, step) {
  const img = decode(buf);
  const s = Math.max(1, step | 0);
  let sum = 0, lit = 0, n = 0;
  for (let yy = 0; yy < img.height; yy += s) for (let xx = 0; xx < img.width; xx += s) {
    n++;
    const o = (yy * img.width + xx) * img.bpp;
    const y = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
    sum += y;
    if (y > 12) lit++;
  }
  return { mean: sum / n, lit: lit / n, width: img.width, height: img.height };
}

module.exports = { decode, luma };
