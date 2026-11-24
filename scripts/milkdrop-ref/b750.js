/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// #750 seti: yamalı MilkDrop (istenen) referans; yamasız MilkDrop ve bizim motorun ona uzaklığı.
const fs = require('fs'), path = require('path');
const W = 1440, H = 896, B = 16;
function coarse(a, aBgra, b, bBgra) {
  const gw = Math.floor(W / B), gh = Math.floor(H / B); let sum = 0;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const s = [0, 0, 0, 0, 0, 0];
    for (let y = gy * B; y < gy * B + B; y++) for (let x = gx * B; x < gx * B + B; x++) {
      const i = (y * W + x) * 4;
      s[0] += a[i + (aBgra ? 2 : 0)]; s[1] += a[i + 1]; s[2] += a[i + (aBgra ? 0 : 2)];
      s[3] += b[i + (bBgra ? 2 : 0)]; s[4] += b[i + 1]; s[5] += b[i + (bBgra ? 0 : 2)];
    }
    sum += (Math.abs(s[0] - s[3]) + Math.abs(s[1] - s[4]) + Math.abs(s[2] - s[5])) / (3 * B * B);
  }
  return sum / (gw * gh);
}
const L = require('./out/b750-fix/list.json');
const K = [10, 30, 59, 119];
let ahead = 0, behind = 0, tie = 0;
console.log('preset'.padEnd(44), 'kare', ' yamasızMD', '    biz', ' sonuç');
for (const it of L) {
  let so = 0, sb = 0; const rows = [];
  for (const k of K) {
    const fx = fs.readFileSync(path.join('out/b750-fix', it.id, 'f' + k + '.bgra'));
    const st = fs.readFileSync(path.join('out/b750-stock', it.id, 'f' + k + '.bgra'));
    const ou = fs.readFileSync(path.join(process.env.OURS || 'out/b750-fix', it.id, 'o' + k + '.rgba'));
    const a = coarse(fx, true, st, true), b = coarse(fx, true, ou, false);
    so += a; sb += b; rows.push([k, a, b]);
  }
  so /= K.length; sb /= K.length;
  const r = sb < so - 0.3 ? 'ÖNDE' : sb > so + 0.3 ? 'GERİDE' : 'eşit';
  if (r === 'ÖNDE') ahead++; else if (r === 'GERİDE') behind++; else tie++;
  console.log(path.basename(it.file).slice(0, 44).padEnd(44), 'ort ', so.toFixed(2).padStart(9), sb.toFixed(2).padStart(8), ' ' + r,
    '  [' + rows.map((x) => 'f' + x[0] + ' ' + x[1].toFixed(1) + '/' + x[2].toFixed(1)).join('  ') + ']');
}
console.log('önde', ahead, 'eşit', tie, 'geride', behind);
