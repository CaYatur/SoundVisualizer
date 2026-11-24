/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Kalite turu 2 özeti: main (fin3) -> r3 ve v3.1.5 (base) -> r3, düzeltilmiş MilkDrop'a göre. */
const fs = require('fs');
const cmpable = (r) => !r.tex.length && !r.rand;
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const fr = (r, k) => (r.frames && r.frames[k] ? r.frames[k].coarse : r.coarse != null && k === '59' ? r.coarse : null);
const load = (n) => { try { return require('./out/' + n + '/report.json').rows; } catch (e) { return null; } };
const TH = +(process.env.TH || 1);
function cmp(title, A, B, frames) {
  const a = load(A), b = load(B);
  if (!a || !b) { console.log(title, 'eksik', A, B); return; }
  console.log('== ' + title + ' (' + A + ' -> ' + B + '), karşılaştırılabilir ' + a.filter(cmpable).length + '/' + a.length);
  for (const k of frames) {
    let be = 0; const wo = [];
    for (const r of a) {
      const s = b.find((x) => x.id === r.id); if (!s) continue;
      const x = fr(r, k), y = fr(s, k); if (x == null || y == null) continue;
      if (y < x - TH) be++;
      if (y > x + TH) wo.push([r.file.slice(0, 40), +x.toFixed(2), +y.toFixed(2), cmpable(r) ? 'C' : 'T']);
    }
    console.log('  f' + k, 'tümü', med(a.map((r) => fr(r, k))), '->', med(b.map((r) => fr(r, k))),
      '| karş.', med(a.filter(cmpable).map((r) => fr(r, k))), '->', med(b.filter(cmpable).map((r) => fr(r, k))),
      '| iyi', be, 'kötü', wo.length);
    for (const w of wo) console.log('     kötü', w[3], w[0], w[1], '->', w[2]);
  }
}
const F4 = ['2', '10', '30', '59'];
cmp('MV-120 r3->8b', 'mvq-r3-smooth', 'mvq-8b-smooth', F4);
cmp('RND-150 r3->8b', 'rnd-r3-smooth', 'rnd-8b-smooth', F4);
cmp('Incubo r3->8b', 'i7-r3-smooth', 'i7-8b-smooth', ['59']);
cmp('MV sentetik r3->8b', 'mvs-r3', 'mvs-8b', ['59']);
cmp('WRAP-150 r3->8b', 'wr-r3', 'wr-8b', F4);
if (process.env.BASE) {
  cmp('MV-120 base->r3', 'mvq-base-smooth', 'mvq-8b-smooth', F4);
  cmp('RND-150 base->r3', 'rnd-base-smooth', 'rnd-8b-smooth', F4);
  cmp('Incubo base->r3', 'i7-base-smooth', 'i7-8b-smooth', ['59']);
}
