/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// İki koşunun (taban / dal) raporlarını kare kare karşılaştırır: node abcmp.js <ad>
const fs = require('fs');
const path = require('path');
const N = process.argv[2];
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', N + '-base', 'report.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', N + '-fix', 'report.json'), 'utf8'));
const byId = new Map(B.rows.map((r) => [r.id, r]));
const caps = A.summary.cap;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const groups = { hepsi: () => true, 'doku/rand yok': (r) => !r.tex.length && !r.rand };
for (const [g, pred] of Object.entries(groups)) {
  console.log('== ' + g);
  for (const k of caps) {
    const a = [], b = [], ov = [], ovb = [];
    let better = 0, worse = 0, flipA = 0, flipB = 0;
    for (const ra of A.rows) {
      if (!pred(ra)) continue;
      const rb = byId.get(ra.id);
      const fa = ra.frames[k], fb = rb && rb.frames[k];
      if (!fa || !fb) continue;
      a.push(fa.coarse); b.push(fb.coarse); ov.push(fa.over); ovb.push(fb.over);
      if (fb.coarse + 2 < fa.coarse) better++;
      else if (fb.coarse > fa.coarse + 2) worse++;
      if (fa.coarseFlip + 2 < fa.coarse) flipA++;
      if (fb.coarseFlip + 2 < fb.coarse) flipB++;
    }
    console.log('kare ' + k + '  n=' + a.length + '  kaba medyan ' + med(a) + ' -> ' + med(b) + '  p75 ' + q(a, 0.75) + ' -> ' + q(b, 0.75) +
      '  piksel medyan ' + med(ov) + ' -> ' + med(ovb) + '  iyi ' + better + ' kötü ' + worse + '  çevriği daha iyi ' + flipA + ' -> ' + flipB);
  }
}
// En çok kötüleşenler (son kare)
const k = caps[caps.length - 1];
const d = A.rows.map((ra) => { const rb = byId.get(ra.id); return rb && ra.frames[k] && rb.frames[k] ? { id: ra.id, file: ra.file, a: ra.frames[k].coarse, b: rb.frames[k].coarse, f2a: (ra.frames[caps[0]] || {}).coarse, f2b: (rb.frames[caps[0]] || {}).coarse, tex: ra.tex.length, rand: ra.rand } : null; }).filter(Boolean);
console.log('\nkötüleşen (kare ' + k + '):');
for (const r of d.filter((x) => x.b > x.a + 2).sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 12)) console.log('  ' + r.a + ' -> ' + r.b + '  (kare ' + caps[0] + ': ' + r.f2a + ' -> ' + r.f2b + ')  ' + r.id + ' ' + r.file + (r.tex ? ' [doku]' : '') + (r.rand ? ' [rand]' : ''));
console.log('iyileşen (kare ' + k + '):');
for (const r of d.filter((x) => x.b + 2 < x.a).sort((x, y) => (y.a - y.b) - (x.a - x.b)).slice(0, 12)) console.log('  ' + r.a + ' -> ' + r.b + '  (kare ' + caps[0] + ': ' + r.f2a + ' -> ' + r.f2b + ')  ' + r.id + ' ' + r.file + (r.tex ? ' [doku]' : '') + (r.rand ? ' [rand]' : ''));
