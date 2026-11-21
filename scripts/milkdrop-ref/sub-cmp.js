/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Alt küme: aynı MilkDrop karelerine karşı main / yalnız blur / blur+MV kazancı. */
const P = process.argv[2] || 'sub';
const runs = (process.argv[3] || 'main,blur,r2').split(',');
const load = (n) => { try { return require('./out/' + P + '-' + n + '/report.json').rows; } catch (e) { return null; } };
const R = runs.map(load);
if (R.some((x) => !x)) { console.log('eksik rapor', runs.filter((n, i) => !R[i])); process.exit(1); }
const frames = Object.keys(R[0][0].frames);
console.log('preset'.padEnd(46), 'kare', runs.map((n) => n.padStart(8)).join(''));
for (const r of R[0]) {
  const tag = (!r.tex.length && !r.rand) ? 'C' : 'T';
  for (const k of frames) {
    const v = R.map((rows) => { const s = rows.find((x) => x.id === r.id); return s && s.frames[k] ? s.frames[k].coarse : null; });
    console.log((tag + ' ' + r.file).slice(0, 46).padEnd(46), ('f' + k).padEnd(4), v.map((x) => (x == null ? '-' : x.toFixed(2)).padStart(8)).join(''));
  }
}
