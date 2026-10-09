/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Performans ölçümünün (scripts/bench.js) saf parçaları: kare istatistiği,
   senaryo listesi, örnek ses karesi ve rapor biçimi. Electron'a ihtiyaç
   duymuyor; testler doğrudan buradan sınıyor. */

/* Kare aralıkları (ms) → özet. fps ortalama aralıktan değil, toplam
   süreden: tek bir uzun kare ortalamayı değil süreyi uzatır. */
function frameStats(intervals) {
  const f = (intervals || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!f.length) return { n: 0, fps: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, over33: 0 };
  const s = f.slice().sort((a, b) => a - b);
  const sum = f.reduce((a, b) => a + b, 0);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    n: f.length,
    fps: r2(f.length / (sum / 1000)),
    avg: r2(sum / f.length),
    p50: r2(q(0.5)),
    p95: r2(q(0.95)),
    p99: r2(q(0.99)),
    max: r2(s[s.length - 1]),
    // 30 fps'in altına düşen karelerin oranı (%)
    over33: r2((f.filter((x) => x > 33.4).length / f.length) * 100),
  };
}

/* Ölçülecek sahneler. Her biri tam bir yapılandırma yaması; ölçüm
   betiği bunu varsayılan ayarların üstüne koyuyor.
   - visualizer: katalogdaki her görselleştirici, sabit arkaplanla
   - background: her arkaplan, sabit görselleştiriciyle (bars)
   - postfx: her efekt tek başına, aynı taban sahnede (bars) */
function scenarios(catalog, effectIds, opts) {
  const o = opts || {};
  const only = String(o.only || '').toLowerCase();
  const out = [];
  const add = (group, id, label, patch) => {
    const key = group + ':' + id;
    if (only && key.toLowerCase().indexOf(only) < 0) return;
    out.push({ group, id, label: label || id, patch });
  };
  const vis = (catalog && catalog.VISUALIZERS) || [];
  const bgs = (catalog && catalog.BACKGROUNDS) || [];
  for (const m of vis) {
    add('visualizer', m.id, m.label, { layers: [], postfx: [], visualizer: { type: m.id } });
  }
  for (const b of bgs) {
    add('background', b.id, b.label, { layers: [], postfx: [], visualizer: { type: 'bars' }, background: { type: b.id } });
  }
  for (const id of effectIds || []) {
    add('postfx', id, id, { layers: [], visualizer: { type: 'bars' }, postfxType: id });
  }
  return out;
}

/* Panel önizlemesi ve ekran görüntüsü üreticisiyle aynı örnek ses
   (src/main/main.js içindeki SHOTS kare üreticisinin kopyası): 120 BPM
   vuruş, bas ağırlıklı taban, gezinen tayf tepeleri; zaman verisi ve iki
   kanal src/shared/demo-audio.js'ten. Deterministik: aynı t aynı kare. */
function demoFrame(t, DEMO) {
  const freq = new Uint8Array(1024);
  const beatPhase = (t * 2) % 1;
  const beat = Math.pow(Math.max(0, 1 - beatPhase * 2.2), 2);
  const bar = Math.floor(t * 2 / 4) % 4;
  for (let k = 0; k < 1024; k++) {
    const decay = Math.pow(1 - k / 1024, 2.6);
    const kick = 1.15 * beat * Math.exp(-Math.pow((k - 8) / 12, 2));
    const bass = 0.75 * Math.exp(-Math.pow((k - 26 - 10 * Math.sin(t * 1.1)) / 14, 2));
    const mid1 = 0.62 * Math.exp(-Math.pow((k - 110 - 46 * Math.sin(t * 0.7 + bar)) / 26, 2));
    const mid2 = 0.5 * Math.exp(-Math.pow((k - 260 - 110 * Math.sin(t * 0.9)) / 34, 2));
    const air = 0.42 * Math.exp(-Math.pow((k - 560 - 190 * Math.sin(t * 0.53 + 1)) / 60, 2));
    const hat = 0.35 * (((t * 4) % 1) < 0.32 ? 1 : 0) * Math.exp(-Math.pow((k - 780) / 160, 2));
    const ripple = 0.1 * (0.5 + 0.5 * Math.sin(k * 0.55 + t * 6));
    const v = decay * (0.26 + 0.34 * beat) + kick + bass + mid1 + mid2 + air + hat + ripple * decay;
    freq[k] = Math.max(0, Math.min(255, v * 148));
  }
  const time = new Uint8Array(2048);
  const left = new Uint8Array(2048);
  const right = new Uint8Array(2048);
  DEMO.fill(Math.floor(t * DEMO.SR), time, left, right);
  return { freq, time, left, right, sampleRate: DEMO.SR };
}

/* Yama birleştirme: düz nesneler iç içe birleşir, diziler ve diğer
   değerler değiştirilir. Görselleştirici gelen yapılandırmayı kendisi
   varsayılanlarla birleştirdiği için ölçüm yalnız yama yolluyor. */
function mergePatch(a, b) {
  const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!plain(a) || !plain(b)) return b === undefined ? a : b;
  const out = Object.assign({}, a);
  for (const k of Object.keys(b)) out[k] = plain(out[k]) && plain(b[k]) ? mergePatch(out[k], b[k]) : b[k];
  return out;
}

/* Kullanıcı içeriği olmadan hiçbir şey çizmeyen sahneler: Şimdi Çalıyor
   çalan parça ister, özel görselleştirici ve arkaplan kullanıcının
   shader'ını. Boş sahne yenileme hızını okur; özette sayılmamalı. */
const NO_CONTENT = new Set(['visualizer:nowplaying', 'visualizer:custom', 'background:custom']);

const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d == null ? 1 : d) : '–');

/* Bir grup sonucu Markdown tablosu olarak. En pahalı (p95 en yüksek)
   üstte; okuyucu neyin yük getirdiğini ilk satırlarda görsün. */
function table(rows) {
  const head = '| Scene | fps | avg ms | p95 ms | max ms | > 33 ms |\n|---|---:|---:|---:|---:|---:|';
  const body = rows
    .slice()
    .sort((a, b) => (b.stats.p95 - a.stats.p95) || (a.id < b.id ? -1 : 1))
    .map((r) => {
      const s = r.stats;
      const name = r.label && r.label !== r.id ? r.label + ' (`' + r.id + '`)' : '`' + r.id + '`';
      let note = r.error ? ' ⚠ ' + String(r.error).replace(/\|/g, '/').slice(0, 80) : '';
      if (NO_CONTENT.has(r.group + ':' + r.id)) note += ' — draws nothing without user content';
      return '| ' + name + note + ' | ' + fmt(s.fps) + ' | ' + fmt(s.avg, 2) + ' | ' + fmt(s.p95, 2) + ' | ' +
        fmt(s.max, 1) + ' | ' + fmt(s.over33, 1) + '% |';
    });
  return head + '\n' + body.join('\n');
}

const GROUP_TITLE = {
  visualizer: 'Visualizers (over the default background)',
  background: 'Backgrounds (with the Bars visualizer)',
  postfx: 'Post effects (one at a time, over Bars)',
};

/* Raporun Markdown bölümü. Makine ve koşu bilgisi her sonuçla birlikte
   yazılıyor: sayılar yalnız bu makineye ait, başka makineyle kıyaslanmaz. */
function markdown(report) {
  const r = report || {};
  const m = r.machine || {};
  const lines = [];
  lines.push('### ' + (r.title || 'Run') + ' — ' + (r.date || ''));
  lines.push('');
  lines.push('- Commit: `' + (r.commit || '?') + '`, Electron ' + (m.electron || '?') + ', ' + (m.os || '?'));
  lines.push('- CPU: ' + (m.cpu || '?') + ' (' + (m.cores || '?') + ' threads), RAM ' + (m.ramGb || '?') + ' GB');
  lines.push('- GPU: ' + (m.gpu || '?') + (m.driver ? ', driver ' + m.driver : ''));
  lines.push('- Display: ' + (m.display || '?'));
  lines.push(r.uncapped
    ? '- Frame-rate limit **off** (`--uncapped`): figures show headroom; a GPU-heavy scene can leave queued work that slows the start of the next one'
    : '- Vsync **on**: a scene that keeps up reads the refresh rate (' + (r.hz || '?') + ' Hz); a lower figure means dropped frames');
  lines.push('- Each scene: ' + (r.warm || '?') + ' s warm-up, ' + (r.seconds || '?') + ' s measured, synthetic 120 BPM audio');
  for (const res of r.resolutions || []) {
    lines.push('');
    lines.push('#### ' + res.name + ' (canvas ' + res.canvas + ')');
    if (res.note) lines.push('', '_' + res.note + '._');
    for (const g of ['visualizer', 'background', 'postfx']) {
      const rows = (res.results || []).filter((x) => x.group === g);
      if (!rows.length) continue;
      lines.push('');
      lines.push('**' + GROUP_TITLE[g] + '**');
      lines.push('');
      lines.push(table(rows));
    }
  }
  if (r.soak) {
    const s = r.soak;
    lines.push('');
    lines.push('#### Long run: ' + s.minutes + ' min, ' + s.what);
    lines.push('');
    lines.push('| Minute | fps | p95 ms | JS heap after GC (MB) |\n|---:|---:|---:|---:|');
    for (const p of s.samples || []) {
      lines.push('| ' + p.minute + ' | ' + fmt(p.stats.fps) + ' | ' + fmt(p.stats.p95, 2) + ' | ' + fmt(p.heapMb, 0) + ' |');
    }
  }
  return lines.join('\n');
}

module.exports = { NO_CONTENT, frameStats, scenarios, demoFrame, mergePatch, table, markdown };
