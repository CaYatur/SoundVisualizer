/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// #752 hareket vektörü sentetik presetleri (kendi yazdıklarımız)
const fs = require('fs'), path = require('path');
const base = fs.readFileSync(path.join(__dirname, '..', 'synth', 'm7-mv.milk'), 'utf-8').replace(/\r\n/g, '\n').trim().split('\n');
function make(name, over, pp) {
  const lines = base.map((l) => {
    const k = l.split('=')[0];
    if (k in over) { const v = over[k]; delete over[k]; return k + '=' + v; }
    return l;
  });
  for (const k of Object.keys(over)) lines.push(k + '=' + over[k]);
  (pp || []).forEach((c, i) => lines.push('per_pixel_' + (i + 1) + '=' + c));
  fs.writeFileSync(path.join(__dirname, name + '.milk'), lines.join('\r\n') + '\r\n');
}
const quad = ['dx = if(below(x,0.5),0.01,0);', 'dy = if(below(y,0.5),0.01,0);'];
make('a-quad', { fDecay: 0.9, rot: 0, dy: 0, nMotionVectorsX: 12, nMotionVectorsY: 9, mv_l: 5, mv_b: 1 }, quad);
make('b-quad-off', { fDecay: 0.9, rot: 0, dy: 0, nMotionVectorsX: 12, nMotionVectorsY: 9.5, mv_dx: 0.03, mv_dy: 0.08, mv_l: 5, mv_b: 1 }, quad);
make('c-still', { fDecay: 0.5, rot: 0, dy: 0, nMotionVectorsX: 16, nMotionVectorsY: 12, mv_dy: 0.03, mv_l: 0, mv_b: 1 });
make('d-shift-neg', { fDecay: 0.9, rot: 0, dy: 0.01, nMotionVectorsX: 8, nMotionVectorsY: 6, mv_dy: -0.3, mv_l: 3, mv_b: 1 });
make('e-rot', { fDecay: 0.9, nMotionVectorsX: 8, nMotionVectorsY: 6, mv_l: 5, mv_b: 1 });
make('f-decay0', { fDecay: 0, rot: 0, dy: 0, nMotionVectorsX: 12, nMotionVectorsY: 9, mv_l: 5, mv_b: 1 }, quad);
make('g-bias', { fDecay: 0.5, rot: 0, dy: 0, warp: 0, nMotionVectorsX: 12, nMotionVectorsY: 9, mv_l: 200, mv_b: 1 });
make('h-still5', { fDecay: 0.5, rot: 0, dy: 0, warp: 0, nMotionVectorsX: 16, nMotionVectorsY: 12, mv_l: 5, mv_b: 1 });
