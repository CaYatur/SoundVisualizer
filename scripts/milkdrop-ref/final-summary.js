/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// main -> nihai (blur + sarma + 8 bit yuvarlama). MD gürültüsü koşudan koşuya değiştiği için gürültülü presetler ayrı.
const fs = require('fs');
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const noise = {};
const isNoise = (f) => (f in noise) ? noise[f] : (noise[f] = /sampler_noise/i.test(fs.readFileSync(f, 'latin1')));
const C = (r) => !r.tex.length && !r.rand;
const sets = [['MV-120', 'mvq-fin3-smooth', 'h-mvq-hq2'], ['RND-150', 'rnd-fin3-smooth', 'h-rnd-hq2'], ['WRAP-150', 'wr-main', 'h-wr-hq'], ['Incubo', 'i7-fin3-smooth', 'h-i7-hq2']];
for (const [t, a, b] of sets) {
  const A = require('./out/' + a + '/report.json').rows, B = require('./out/' + b + '/report.json').rows;
  const LA = require('./out/' + a + '/list.json');
  const fileOf = (id) => LA.find((x) => x.id === id).file;
  for (const k of Object.keys(A[0].frames)) {
    const xs = [], ys = []; let be = 0; const wo = [];
    for (const r of A) {
      if (!C(r) || isNoise(fileOf(r.id))) continue;
      const s = B.find((x) => x.file === r.file); if (!s || !s.frames[k] || !r.frames[k]) continue;
      const x = r.frames[k].coarse, y = s.frames[k].coarse; xs.push(x); ys.push(y);
      if (y < x - 1) be++; if (y > x + 1) wo.push(r.file.slice(0, 38) + ' ' + x.toFixed(2) + '->' + y.toFixed(2));
    }
    console.log(t.padEnd(8), 'f' + k, 'n', xs.length, 'medyan', med(xs), '->', med(ys), '| iyi', be, 'kötü', wo.length);
    wo.forEach((w) => console.log('      kötü', w));
  }
}
