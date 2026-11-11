/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Altın ölçünün saf kısmı (#905): kare özetlerini karşılaştırma ve rapor.
   Elektron ve dosya gerektirmiyor. Betik: scripts/golden.js */

// Kaç kare farklı; uzunluk farkı da fark sayılır
function diffFrames(a, b) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  const n = Math.max(x.length, y.length);
  let diff = 0;
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) {
      diff++;
      if (first < 0) first = i;
    }
  }
  return { frames: n, diff, first };
}

/* İki koşunun karşılaştırması. run: { cases: { ad: { frames: [...] } } }
   Biri yoksa `missing`: yeni şablon eklenmesi ya da silinmesi fark olarak görünsün. */
function compareRuns(base, next) {
  const out = { same: 0, changed: [], missing: [] };
  const names = new Set(Object.keys((base && base.cases) || {}).concat(Object.keys((next && next.cases) || {})));
  for (const name of names) {
    const a = (base && base.cases && base.cases[name]) || null;
    const b = (next && next.cases && next.cases[name]) || null;
    if (!a || !b) {
      out.missing.push({ name, in: a ? 'yalnız önceki' : 'yalnız yeni' });
      continue;
    }
    const d = diffFrames(a.frames, b.frames);
    if (d.diff) out.changed.push(Object.assign({ name }, d));
    else out.same++;
  }
  return out;
}

/* Aynı durumun iki dışa aktarımı (#467, --repeat): kare sayısı ve her karenin özeti aynı mı. */
function repeatCheck(first, second) {
  const d = diffFrames(first, second);
  return { same: !d.diff, diff: d.diff, frames: d.frames };
}

module.exports = { diffFrames, compareRuns, repeatCheck };
