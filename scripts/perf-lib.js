/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Gerçek sahne ölçümünün (scripts/perf.js) saf parçaları: ayar arındırma,
   kare özeti, iki koşunun karşılaştırması. Electron'a ihtiyaç duymuyor. */

/* Ölçüm, kullanıcının ayarlarının KOPYASINDA koşuyor. Bu bloklar dışarıya bir
   şey yolluyor ya da gerçek bir aygıtı sürüyor: ışıklar, ağ, kayıt, MCP. */
/* dynamicTheme: çalan parça değişince paleti değiştiriyor; yalıtılmış profil işletim sisteminin
   parça bilgisini yine alıyor. Altın ölçüde müzik dinlerken rastgele bir durum farklı çıkıyordu. */
const OUTSIDE = ['lighting', 'openrgb', 'artnet', 'oscOut', 'osc', 'stream', 'mcp', 'bridge', 'redundancy', 'textureShare', 'recording', 'dynamicTheme'];

// Gerçek ayar klasöründen: sahneler ve kütüphane yanındaki dosyalarda olabilir (#905)
function readSettingsFile(file) {
  const fs = require('fs');
  const path = require('path');
  return require('../src/main/settings-store').create(path.dirname(file)).merge(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}

function sanitizeSettings(settings, opts) {
  const o = opts || {};
  const s = Object.assign({}, settings);
  for (const k of OUTSIDE) if (s[k] && typeof s[k] === 'object') s[k] = Object.assign({}, s[k], { enabled: false });
  /* Üstte kalsın, yoksa başka pencerenin arkasında kalır ve rAF durur.
     Kapatma sorusu betiği bekletirdi. */
  s.power = Object.assign({}, s.power, { alwaysOnTop: true, keepAwake: false, confirmClose: false });
  if (o.spout && s.textureShare) s.textureShare = Object.assign({}, s.textureShare, { enabled: true });
  return s;
}

/* Kare aralıkları (ms) → özet. fps toplam süreden: tek uzun kare ortalamayı
   değil süreyi uzatır. */
function frameSummary(intervals) {
  const f = (intervals || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!f.length) return { frames: 0, fps: 0, p50: 0, p99: 0, max: 0, over33: 0, over50: 0, over100: 0 };
  const s = f.slice().sort((a, b) => a - b);
  const sum = f.reduce((a, b) => a + b, 0);
  const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  const over = (ms) => f.filter((x) => x > ms).length;
  return {
    frames: f.length,
    fps: Math.round((f.length / (sum / 1000)) * 10) / 10,
    p50: q(0.5),
    p99: q(0.99),
    max: Math.round(s[s.length - 1] * 10) / 10,
    over33: over(33.4),
    over50: over(50),
    over100: over(100),
  };
}

/* Bir değer dizisinin medyanı ve en büyüğü; preset değişimi özeti için */
function medMax(values) {
  const v = (values || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, med: 0, max: 0 };
  return { n: v.length, med: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
}

/* Süreç listesini topla. `cpu` bütün çekirdeklere bölünmüş yüzdedir
   (app.getAppMetrics); bir çekirdeğin yüzdesine çevrilir. */
function processTotals(procs, cores) {
  const list = Array.isArray(procs) ? procs : [];
  const out = { cpuCore: 0, wsMB: 0, privMB: 0 };
  for (const p of list) {
    out.cpuCore += (p.cpu || 0) * (cores || 1);
    out.wsMB += p.wsMB || 0;
    out.privMB += p.privMB || 0;
  }
  out.cpuCore = Math.round(out.cpuCore);
  return out;
}

/* Bir sayı yolu → satır: ad, küçükse iyi mi. Rapor ve karşılaştırma aynı
   listeden çalışıyor; ölçüt eklemek tek satır. */
const METRICS = [
  ['Panel açılışı (ms)', 'startup.panelMs', true],
  ['Pencere açılışı (ms)', 'open.visibleMs', true],
  ['Görünür kareye kadar uzun görev (ms)', 'open.longSum', true],
  ['Toplam bellek (MB)', 'steady.totals.wsMB', true],
  ['Görselleştirici belleği (MB)', 'steady.visWsMB', true],
  ['Panel belleği (MB)', 'steady.adminWsMB', true],
  ['Toplam CPU (çekirdek %)', 'steady.totals.cpuCore', true],
  ['Kare hızı (fps)', 'steady.frames.fps', false],
  ['100 ms üstü kare boşluğu', 'steady.frames.over100', true],
  ['En uzun kare (ms)', 'steady.frames.max', true],
  ['MilkDrop değişimi, medyan en uzun kare (ms)', 'milkdrop.gap.med', true],
  ['MilkDrop değişimi, en uzun kare (ms)', 'milkdrop.gap.max', true],
  ['MilkDrop değişimi, medyan ilk kare (ms)', 'milkdrop.ready.med', true],
  ['Studio değişimi, medyan en uzun kare (ms)', 'studio.gap.med', true],
  ['Studio değişimi, en uzun kare (ms)', 'studio.gap.max', true],
];

const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/* Rapor satırları. `base` verilirse fark ve yön de: + kötü demek değil, ölçüte
   göre `better` söyler. */
function compareRuns(cur, base) {
  return METRICS.map(([label, path, lowerIsBetter]) => {
    const now = pick(cur, path);
    const was = base ? pick(base, path) : undefined;
    const row = { label, path, now, was };
    if (Number.isFinite(now) && Number.isFinite(was) && was !== 0) {
      row.deltaPct = Math.round(((now - was) / Math.abs(was)) * 100);
      row.better = now === was ? null : (now < was) === lowerIsBetter;
    }
    return row;
  });
}

function formatReport(rows) {
  const lines = [];
  for (const r of rows) {
    const now = r.now === undefined ? '-' : r.now;
    const tail = r.was === undefined ? '' : `  önce ${r.was}` + (r.deltaPct === undefined ? '' : ` (${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%${r.better === true ? ', iyi' : r.better === false ? ', KÖTÜ' : ''})`);
    lines.push(r.label.padEnd(46) + String(now).padStart(9) + tail);
  }
  return lines.join('\n');
}

module.exports = { OUTSIDE, readSettingsFile, sanitizeSettings, frameSummary, medMax, processTotals, METRICS, compareRuns, formatReport };
