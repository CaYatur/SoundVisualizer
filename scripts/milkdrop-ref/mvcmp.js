/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* #752 hareket vektörü katmanı karşılaştırması.
 * node mvcmp.js --a=out/mv-stock --b=out/mv-fix --o=out/mv-stock [--o2=out/x] --w=1440 --h=900 --png=out/mvcmp
 * a, b: MilkDrop kareleri (f59.bgra); o: bizim kareler (o59.rgba).
 * Ölçü: yanan piksellerin (parlaklık > 20) IoU'su, yanan alanların ağırlık
 * merkezleri ve 16 piksel kaba fark. */
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const W = +flag('w', 1440), H = +flag('h', 900);
const A = flag('a'), B = flag('b'), O = flag('o'), O2 = flag('o2', ''), PNG = flag('png', '');
const CAP = flag('cap', '59');
const sharp = require('sharp');

function lumOf(buf, bgra) {
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = buf[i * 4 + (bgra ? 2 : 0)], g = buf[i * 4 + 1], b = buf[i * 4 + (bgra ? 0 : 2)];
    L[i] = (r + g + b) / 3;
  }
  return L;
}
function iou(p, q, t) {
  let i = 0, u = 0;
  for (let k = 0; k < p.length; k++) { const a = p[k] > t, b = q[k] > t; if (a && b) i++; if (a || b) u++; }
  return u ? i / u : 1;
}
function coarse(p, q) {
  const S = 16, gw = Math.floor(W / S), gh = Math.floor(H / S);
  let s = 0;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let a = 0, b = 0;
    for (let y = gy * S; y < gy * S + S; y++) for (let x = gx * S; x < gx * S + S; x++) { a += p[y * W + x]; b += q[y * W + x]; }
    s += Math.abs(a - b) / (S * S);
  }
  return s / (gw * gh);
}
function stats(p) {
  let n = 0, sx = 0, sy = 0, sum = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = p[y * W + x]; sum += v; if (v > 20) { n++; sx += x; sy += y; } }
  return { lit: n, cx: n ? +(sx / n / W).toFixed(3) : null, cy: n ? +(sy / n / H).toFixed(3) : null, mean: +(sum / (W * H)).toFixed(2) };
}
(async () => {
  const ids = fs.readdirSync(O).filter((d) => /^p\d+$/.test(d)).sort();
  const list = JSON.parse(fs.readFileSync(path.join(O, 'list.json'), 'utf-8'));
  for (const id of ids) {
    const name = path.basename(list.find((e) => e.id === id).file);
    const rd = (dir, f) => { const p = path.join(dir, id, f); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
    const fa = rd(A, 'f' + CAP + '.bgra'), fb = B ? rd(B, 'f' + CAP + '.bgra') : null, fo = rd(O, 'o' + CAP + '.rgba');
    const fo2 = O2 ? rd(O2, 'o' + CAP + '.rgba') : null;
    if (!fa || !fo) { console.log(id, name, 'eksik'); continue; }
    const la = lumOf(fa, true), lo = lumOf(fo, false);
    const lb = fb ? lumOf(fb, true) : null, lo2 = fo2 ? lumOf(fo2, false) : null;
    const row = { name, stock: stats(la), ours: stats(lo) };
    row.iouStock = +iou(la, lo, 20).toFixed(3); row.coarseStock = +coarse(la, lo).toFixed(2);
    if (lb) { row.fix = stats(lb); row.iouFix = +iou(lb, lo, 20).toFixed(3); row.coarseFix = +coarse(lb, lo).toFixed(2); }
    if (lo2) {
      row.ours2 = stats(lo2);
      row.iouStock2 = +iou(la, lo2, 20).toFixed(3); row.coarseStock2 = +coarse(la, lo2).toFixed(2);
      if (lb) { row.iouFix2 = +iou(lb, lo2, 20).toFixed(3); row.coarseFix2 = +coarse(lb, lo2).toFixed(2); }
    }
    console.log(JSON.stringify(row));
    if (PNG) {
      fs.mkdirSync(PNG, { recursive: true });
      const panels = [fa, fb, fo, fo2].filter(Boolean);
      const bgr = [true, !!fb, false, false].filter((_, i) => [fa, fb, fo, fo2][i]);
      const s = 0.5, w = Math.round(W * s), h = Math.round(H * s);
      const imgs = await Promise.all(panels.map((buf, i) => {
        const rgba = Buffer.from(buf);
        if (bgr[i]) for (let k = 0; k < rgba.length; k += 4) { const t = rgba[k]; rgba[k] = rgba[k + 2]; rgba[k + 2] = t; rgba[k + 3] = 255; }
        else for (let k = 3; k < rgba.length; k += 4) rgba[k] = 255;
        return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).resize(w, h).png().toBuffer();
      }));
      await sharp({ create: { width: w * imgs.length + 8 * (imgs.length - 1), height: h, channels: 4, background: '#404040' } })
        .composite(imgs.map((im, i) => ({ input: im, left: i * (w + 8), top: 0 }))).png()
        .toFile(path.join(PNG, name.replace('.milk', '') + '.png'));
    }
  }
})();
