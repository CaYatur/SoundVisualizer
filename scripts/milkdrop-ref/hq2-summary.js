/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
const C = (r) => !r.tex.length && !r.rand;
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
for (const s of ['ns', 'rnd', 'mvq', 'i7', 'mvs']) {
  const A = require('./out/h-' + s + '-r3/report.json').rows, B = require('./out/h-' + s + '-hq2/report.json').rows;
  for (const k of Object.keys(A[0].frames)) {
    let be = 0; const wo = [];
    for (const r of A) {
      if (!C(r)) continue;
      const q = B.find((x) => x.id === r.id); const x = (r.frames[k]||{}).coarse, y = ((q&&q.frames[k])||{}).coarse;
      if (x == null || y == null) continue; if (y < x - 1) be++; if (y > x + 1) wo.push(r.file.slice(0, 40) + ' ' + x.toFixed(2) + '->' + y.toFixed(2));
    }
    const ca = A.filter(C), cb = B.filter(C);
    console.log(s.padEnd(4), 'f' + k, 'karş', ca.length, 'medyan', med(ca.map((r) => (r.frames[k]||{}).coarse)), '->', med(cb.map((r) => (r.frames[k]||{}).coarse)),
      '| tümü', med(A.map((r) => (r.frames[k]||{}).coarse)), '->', med(B.map((r) => (r.frames[k]||{}).coarse)), '| iyi', be, 'kötü', wo.length);
    wo.forEach((w) => console.log('      kötü', w));
  }
}
