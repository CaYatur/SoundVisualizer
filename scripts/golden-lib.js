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

/* İki koşunun karşılaştırması. run: { cases: { ad: { asis|toggled: { frames: [...] } } } }
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
    for (const mode of new Set(Object.keys(a).concat(Object.keys(b)))) {
      if (mode === 'nativeStack') continue;
      if (!a[mode] || !b[mode]) {
        out.missing.push({ name, mode, in: a[mode] ? 'yalnız önceki' : 'yalnız yeni' });
        continue;
      }
      const d = diffFrames(a[mode].frames, b[mode].frames);
      if (d.diff) out.changed.push(Object.assign({ name, mode }, d));
      else out.same++;
    }
  }
  return out;
}

/* Katman anahtarı çevrilince görüntü değişiyor mu, yöne göre. Klasikten katmana
   geçiş v4 göçünün aynısı: fark varsa göç o sahneyi bozar. Asıl şikâyet de buydu:
   basit mod ile katmanlar arasındaki tutarsızlık artık bir liste. */
function modePairs(run) {
  const out = { classicToStack: { same: [], different: [] }, stackToClassic: { same: [], different: [] } };
  for (const [name, c] of Object.entries((run && run.cases) || {})) {
    if (!c.asis || !c.toggled) continue;
    const side = c.nativeStack ? out.stackToClassic : out.classicToStack;
    const d = diffFrames(c.asis.frames, c.toggled.frames);
    if (d.diff) side.different.push({ name, diff: d.diff, frames: d.frames, psnr: c.toggled.psnr == null ? null : c.toggled.psnr });
    else side.same.push(name);
  }
  return out;
}

module.exports = { diffFrames, compareRuns, modePairs };
