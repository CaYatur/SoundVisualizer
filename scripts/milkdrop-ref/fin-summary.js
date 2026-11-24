/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* #752 son tur özeti: v3.1.5 (base) -> dal (fin3), düzeltilmiş MilkDrop'a göre. */
const fs = require('fs');
const cmpable = (r) => !r.tex.length && !r.rand;
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const fr = (r, k) => (r.frames && r.frames[k] ? r.frames[k].coarse : r.coarse != null && k === '59' ? r.coarse : null);
const load = (n) => { try { return require('./out/' + n + '/report.json').rows; } catch (e) { return null; } };
function cmp(title, A, B, frames) {
  const a = load(A), b = load(B);
  if (!a || !b) { console.log(title, 'eksik', A, B); return; }
  console.log('== ' + title + ' (' + A + ' -> ' + B + '), karşılaştırılabilir ' + a.filter(cmpable).length + '/' + a.length);
  for (const k of frames) {
    let be = 0; const wo = [];
    for (const r of a) {
      const s = b.find((x) => x.id === r.id); if (!s) continue;
      const x = fr(r, k), y = fr(s, k); if (x == null || y == null) continue;
      if (y < x - 2) be++;
      if (y > x + 2) wo.push([r.file.slice(0, 44), x, y, cmpable(r) ? 'C' : 'T']);
    }
    console.log('  f' + k, 'tümü', med(a.map((r) => fr(r, k))), '->', med(b.map((r) => fr(r, k))),
      '| karş.', med(a.filter(cmpable).map((r) => fr(r, k))), '->', med(b.filter(cmpable).map((r) => fr(r, k))),
      '| iyi', be, 'kötü', wo.length, 'kötü(karş.):', JSON.stringify(wo.filter((w) => w[3] === 'C')));
  }
}
const F4 = ['2', '10', '30', '59'];
for (const L of ['smooth', 'thin', 'milkdrop']) {
  cmp('MV-120 ' + L, 'mvq-base-' + L, 'mvq-fin3-' + L, F4);
  cmp('RND-150 ' + L, 'rnd-base-' + L, 'rnd-fin3-' + L, F4);
  cmp('Incubo-21 ' + L, 'i7-base-' + L, 'i7-fin3-' + L, ['59']);
}
cmp('1920 görsel', 'v19-base', 'v19-fin3', ['59']);
