/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* #580 tam kare karşılaştırması: MilkDrop 2 (mdref.exe) ↔ bizim motor.
 *
 * node run.js --presets=<klasör | .json liste | tek .milk> [--sample=50] [--seed=1]
 *             [--frames=60] [--cap=59] [--audio=tone|silent] [--name=koşu]
 *             [--w=960 --h=720] [--skip-md] [--skip-ours] [--sheet=12]
 *
 * Çıktı: out/<koşu>/<id>/{f<k>.bgra, o<k>.rgba}, out/<koşu>/report.json,
 *        out/<koşu>/sheet-*.png (yan yana: solda MilkDrop 2, sağda bizimki).
 * Ölçü: md-diff ile aynı — herhangi bir kanalı 2/255'ten fazla ayrışan
 * piksellerin payı; ayrıca ortalama mutlak fark (0..255). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync, spawn } = require('child_process');
const AUD = require('./audio.js');

const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d; };
const has = (n) => argv.includes('--' + n);
const PRESETS = flag('presets', '');
const SAMPLE = +flag('sample', 0);
const SEED = +flag('seed', 1);
const FRAMES = +flag('frames', 60);
const CAP = flag('cap', String(FRAMES - 1)).split(',').map(Number);
const AKIND = flag('audio', 'tone');
const NAME = flag('name', 'run');
const W = +flag('w', 960), H = +flag('h', 720);
const SHEET = +flag('sheet', 12);
const WARM = +flag('warm', 0);
const REPO = flag('repo', process.env.SV_REPO || path.resolve(__dirname, '..', '..'));
const OUT = path.join(__dirname, 'out', NAME);
const EXE = path.join(__dirname, 'bin', 'mdref.exe');
fs.mkdirSync(OUT, { recursive: true });

// Yerleşik örnekleyiciler; bunların dışındaki sampler_* kullanıcı dokusu ister
const BUILTIN = /^(main|fw_main|pw_main|fc_main|pc_main|noise_(lq|mq|hq|lq_lite|point|hq_point)|noisevol_(lq|hq)|blur[123])$/i;
function userTextures(src) {
  const set = new Set();
  const re = /sampler_([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src))) {
    let n = m[1].replace(/^(fw|fc|pw|pc)_/i, '');
    if (!BUILTIN.test(m[1]) && !BUILTIN.test(n)) set.add(n.toLowerCase());
  }
  return [...set];
}

function listFiles() {
  if (PRESETS.endsWith('.json')) return JSON.parse(fs.readFileSync(PRESETS, 'utf-8'));
  if (PRESETS.endsWith('.milk')) return [PRESETS];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.milk$/i.test(e.name)) out.push(p);
    }
  })(PRESETS);
  return out.sort();
}

function pick(files) {
  if (!SAMPLE || SAMPLE >= files.length) return files;
  let s = SEED >>> 0 || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const a = files.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, SAMPLE).sort();
}

// Basit PNG kodlayıcı (RGBA, 8 bit)
function png(w, h, rgba) {
  const crcT = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c; }
  const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { rows[y * (w * 4 + 1)] = 0; rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function compare(md, ours, flipOurs) {
  // md: BGRA, ours: RGBA. flipOurs: bizimkini dikey çevirerek karşılaştır
  let over = 0, sum = 0;
  const px = W * H;
  for (let y = 0; y < H; y++) {
    const yo = flipOurs ? H - 1 - y : y;
    for (let x = 0; x < W; x++) {
      const a = (y * W + x) * 4, b = (yo * W + x) * 4;
      const dr = Math.abs(md[a + 2] - ours[b]), dg = Math.abs(md[a + 1] - ours[b + 1]), db = Math.abs(md[a] - ours[b + 2]);
      if (dr > 2 || dg > 2 || db > 2) over++;
      sum += (dr + dg + db) / 3;
    }
  }
  return { over: over / px, mad: sum / px };
}

// Yapısal fark: 16x16 kutu ortalamasıyla küçültülmüş iki görüntünün ortalama mutlak farkı (0..255).
// Geri beslemenin kaotik büyüttüğü piksel düzeyi ayrışmayı değil, görüntünün yerleşimini ölçer.
function coarse(md, ours, flipOurs) {
  const B = 16, gw = Math.floor(W / B), gh = Math.floor(H / B);
  let sum = 0;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let a0 = 0, a1 = 0, a2 = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let y = gy * B; y < gy * B + B; y++) {
      const yo = flipOurs ? H - 1 - y : y;
      for (let x = gx * B; x < gx * B + B; x++) {
        const a = (y * W + x) * 4, b = (yo * W + x) * 4;
        a0 += md[a + 2]; a1 += md[a + 1]; a2 += md[a];
        b0 += ours[b]; b1 += ours[b + 1]; b2 += ours[b + 2];
      }
    }
    sum += (Math.abs(a0 - b0) + Math.abs(a1 - b1) + Math.abs(a2 - b2)) / (3 * B * B);
  }
  return sum / (gw * gh);
}

function lum(buf, bgra) {
  let s = 0;
  for (let i = 0; i < buf.length; i += 16) s += buf[i] + buf[i + 1] + buf[i + 2];
  return s / (buf.length / 16) / 765;
}

async function main() {
  const files = pick(listFiles());
  const list = files.map((f, i) => ({ id: 'p' + String(i).padStart(4, '0'), file: f }));
  const audioFile = path.join(OUT, 'audio.i8');
  fs.writeFileSync(audioFile, AUD.make(AKIND, FRAMES + WARM));
  const blankFile = path.join(OUT, 'blank.milk');
  fs.writeFileSync(blankFile, ['MILKDROP_PRESET_VERSION=201', '[preset00]', 'fDecay=0', 'fWaveAlpha=0', 'nWaveMode=0', 'zoom=1', 'ob_size=0', 'ib_size=0', 'mv_a=0', ''].join(String.fromCharCode(13,10)));
  fs.writeFileSync(path.join(OUT, 'list.json'), JSON.stringify(list, null, 1));
  console.log(list.length + ' preset, ' + FRAMES + ' kare, ses ' + AKIND);

  /* PARALEL (--jobs=N). Her preset bağımsız: MilkDrop örnekleri kendi
     klasörüne yazıyor, bizim motor listeyi N parçaya bölüp N Electron
     sürecinde koşuyor. Sonuç sıralı koşuyla aynı — motor deterministik. */
  const JOBS = Math.max(1, +flag('jobs', 1));
  const pool = async (items, n, fn) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) { const it = items[next++]; await fn(it); }
    }));
  };
  if (!has('skip-md')) {
    const t0 = Date.now();
    await pool(list, JOBS, (it) => new Promise((res) => {
      const dir = path.join(OUT, it.id);
      fs.mkdirSync(dir, { recursive: true });
      const c = spawn(EXE, ['--preset', it.file, '--out', dir, '--frames', String(FRAMES), '--cap', CAP.join(','),
        '--audio', audioFile, '--w', String(W), '--h', String(H), '--seed', String(SEED), '--warm', String(WARM), '--blank', blankFile], { windowsHide: has('hide') });
      const kill = setTimeout(() => c.kill(), 60000);
      c.on('error', (e) => { clearTimeout(kill); fs.writeFileSync(path.join(dir, 'mdref-exit.txt'), 'error ' + e); process.stdout.write('x'); res(); });
      c.on('close', (code) => {
        clearTimeout(kill);
        if (code !== 0) fs.writeFileSync(path.join(dir, 'mdref-exit.txt'), String(code));
        process.stdout.write(code === 0 ? '.' : 'x');
        res();
      });
    }));
    console.log('\nMilkDrop 2: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' sn (' + JOBS + ' iş)');
  }
  const shards = [];
  for (let k = 0; k < Math.min(JOBS, list.length); k++) shards.push(list.filter((_, i) => i % JOBS === k));
  if (!has('skip-ours')) {
    const t0 = Date.now();
    await Promise.all(shards.map((part, k) => new Promise((res) => {
      const lf = path.join(OUT, 'list-' + k + '.json');
      fs.writeFileSync(lf, JSON.stringify(part));
      const c = spawn(process.execPath, [path.join(__dirname, 'ours.js'), '--list=' + lf, '--meta=ours-meta-' + k + '.json', '--audio=' + audioFile,
        '--frames=' + FRAMES, '--cap=' + CAP.join(','), '--out=' + OUT, '--w=' + W, '--h=' + H, '--repo=' + REPO, '--warm=' + WARM, '--line=' + flag('line', 'milkdrop')].concat(has('mdclock') ? ['--mdclock'] : []).concat(has('mdlag') ? ['--mdlag'] : []), { stdio: 'inherit' });
      c.on('close', res);
    })));
    console.log('Bizim motor: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' sn (' + shards.length + ' süreç)');
  }

  let meta = {};
  for (let k = 0; k < shards.length; k++) {
    try { Object.assign(meta, JSON.parse(fs.readFileSync(path.join(OUT, 'ours-meta-' + k + '.json'), 'utf-8'))); } catch (e) { /* yok */ }
  }
  const rows = [];
  for (const it of list) {
    const dir = path.join(OUT, it.id);
    const src = fs.readFileSync(it.file, 'latin1');
    const row = { id: it.id, file: path.basename(it.file), tex: userTextures(src), rand: /\brand\s*\(|\brand_frame\b|\brand_preset\b/i.test(src), frames: {} };
    const m = meta[it.id] || {};
    if (m.err || m.modeError) row.oursErr = m.err || m.modeError;
    for (const k of CAP) {
      const fm = path.join(dir, 'f' + k + '.bgra'), fo = path.join(dir, 'o' + k + '.rgba');
      if (!fs.existsSync(fm) || !fs.existsSync(fo)) { row.missing = true; continue; }
      const a = fs.readFileSync(fm), b = fs.readFileSync(fo);
      if (a.length !== W * H * 4 || b.length !== W * H * 4) { row.missing = true; continue; }
      const c = compare(a, b);
      row.frames[k] = { over: +c.over.toFixed(4), mad: +c.mad.toFixed(2), coarse: +coarse(a, b).toFixed(2),
        coarseFlip: +coarse(a, b, true).toFixed(2), lumMd: +lum(a).toFixed(3), lumOurs: +lum(b).toFixed(3) };
    }
    const last = row.frames[CAP[CAP.length - 1]] || row.frames[CAP[0]];
    row.over = last ? last.over : null;
    row.mad = last ? last.mad : null;
    row.coarse = last ? last.coarse : null;
    row.coarseFlip = last ? last.coarseFlip : null;
    rows.push(row);
  }
  const ok = rows.filter((r) => r.over != null);
  const clean = ok.filter((r) => !r.tex.length && !r.rand);
  const stats = (rs) => {
    const o = rs.map((r) => r.over).sort((x, y) => x - y);
    const q = (p) => o.length ? o[Math.min(o.length - 1, Math.floor(p * o.length))] : null;
    const c = rs.map((r) => r.coarse).sort((x, y) => x - y);
    const cq = (p) => c.length ? c[Math.min(c.length - 1, Math.floor(p * c.length))] : null;
    return { n: rs.length, median: q(0.5), p25: q(0.25), p75: q(0.75), under5: o.filter((x) => x < 0.05).length, under20: o.filter((x) => x < 0.2).length,
      coarseMedian: cq(0.5), coarseP75: cq(0.75), coarseUnder8: c.filter((x) => x < 8).length,
      flipBetter: rs.filter((r) => r.coarseFlip + 2 < r.coarse).length };
  };
  const summary = { frames: FRAMES, cap: CAP, audio: AKIND, all: stats(ok), noTexNoRand: stats(clean), missing: rows.length - ok.length };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ summary, rows }, null, 1));
  console.log(JSON.stringify(summary));

  // Yan yana sayfalar: en çok ayrışanlar ve en yakınlar
  const k = CAP[CAP.length - 1];
  const sheet = (rs, name) => {
    if (!rs.length) return;
    const sw = W >> 1, sh = H >> 1;
    const cols = 2, rowsN = rs.length;
    const img = Buffer.alloc(sw * cols * sh * rowsN * 4);
    rs.forEach((r, ri) => {
      const a = fs.readFileSync(path.join(OUT, r.id, 'f' + k + '.bgra'));
      const b = fs.readFileSync(path.join(OUT, r.id, 'o' + k + '.rgba'));
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const si = ((y * 2) * W + x * 2) * 4;
        const d1 = (((ri * sh + y) * sw * cols) + x) * 4, d2 = d1 + sw * 4;
        img[d1] = a[si + 2]; img[d1 + 1] = a[si + 1]; img[d1 + 2] = a[si]; img[d1 + 3] = 255;
        img[d2] = b[si]; img[d2 + 1] = b[si + 1]; img[d2 + 2] = b[si + 2]; img[d2 + 3] = 255;
      }
    });
    fs.writeFileSync(path.join(OUT, name), png(sw * cols, sh * rowsN, img));
  };
  const byOver = ok.slice().sort((x, y) => y.over - x.over);
  for (let i = 0; i < Math.min(byOver.length, SHEET * 3); i += 4) sheet(byOver.slice(i, i + 4), 'sheet-worst-' + (i / 4) + '.png');
  sheet(byOver.slice(-4), 'sheet-best.png');
  for (const r of byOver.slice(0, 15)) console.log((r.over * 100).toFixed(1) + '%  mad ' + r.mad + '  kaba ' + r.coarse + ' (çevrik ' + r.coarseFlip + ')  ' + r.id + '  ' + r.file + (r.tex.length ? '  [doku]' : '') + (r.rand ? '  [rand]' : ''));
}
main();
