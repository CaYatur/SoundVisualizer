/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Zaman çizelgesi sesi — ana süreç tarafı (#1171, #1172).
   Tepe değerleri (dalga biçimi ve kısma anahtarı) ve dışa aktarma karışımı
   paketlenmiş ffmpeg ile burada üretilir; arayüz donmaz. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const A = require('../shared/timeline-audio.js');

const PEAK_RATE = 100; // saniyede tepe sayısı
const DECODE_RATE = 8000;
const cache = new Map(); // anahtar: yol|boyut|değişme → { rate, data, dur }
const pending = new Map();

function keyOf(file) {
  const st = fs.statSync(file);
  return file + '|' + st.size + '|' + st.mtimeMs;
}

/* Dosyanın tepe zarfı (0..1, mono, PEAK_RATE Hz). Akış hâlinde okunur: 2 saatlik
   dosya da belleği şişirmez (8 kHz s16 → saniyede 16 KB işlenir, 100 değer kalır). */
function peaks(ff, file) {
  let key;
  try { key = keyOf(file); } catch { return Promise.resolve(null); }
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);
  const job = new Promise((resolve) => {
    const per = DECODE_RATE / PEAK_RATE;
    const out = [];
    let cur = 0;
    let n = 0;
    let carry = null;
    let p;
    try {
      p = spawn(ff, ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(DECODE_RATE), '-f', 's16le', '-'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return resolve(null); }
    p.stdout.on('data', (buf) => {
      let b = buf;
      if (carry) { b = Buffer.concat([carry, buf]); carry = null; }
      const len = b.length - (b.length % 2);
      if (len < b.length) carry = b.subarray(len);
      for (let i = 0; i < len; i += 2) {
        const v = Math.abs(b.readInt16LE(i)) / 32768;
        if (v > cur) cur = v;
        if (++n >= per) { out.push(cur); cur = 0; n = 0; }
      }
    });
    p.on('error', () => resolve(null));
    p.on('close', (code) => {
      if (n > 0) out.push(cur);
      if (code !== 0 && !out.length) return resolve(null);
      const res = { rate: PEAK_RATE, data: Float32Array.from(out), dur: out.length / PEAK_RATE };
      if (cache.size > 24) cache.delete(cache.keys().next().value);
      cache.set(key, res);
      resolve(res);
    });
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

let tempDir = null;
function cleanup() {
  const d = tempDir;
  tempDir = null;
  if (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* kilitli: sistem temizler */ } }
}

/* Karışımı geçici, kayıpsız bir WAV'a yazar. srcPath: sv-media adresinden yol.
   Dönen: { ok, file, sources, duration } ya da { ok:false, error } */
async function mixdown(ff, tracks, opts) {
  const o = opts || {};
  const srcPath = o.srcPath || ((s) => s);
  const list = A.normalize(tracks);
  const files = new Map();
  for (const t of list) for (const c of t.clips) {
    if (!c.src || c.mute) continue;
    const f = srcPath(c.src);
    files.set(c.src, f);
  }
  const missing = Array.from(files.values()).filter((f) => !f || !fs.existsSync(f));
  if (missing.length) return { ok: false, error: 'missing', missing };
  const pk = new Map();
  for (const [src, f] of files) pk.set(src, await peaks(ff, f));
  const desc = A.mixDescription(list, { from: 0, to: o.to, peaksOf: (s) => pk.get(s) });
  if (!desc.sources.length) return { ok: false, error: 'empty' };
  const inputs = Array.from(new Set(desc.sources.map((s) => s.src)));
  const filter = A.ffmpegFilter(desc, (s) => inputs.indexOf(s));
  cleanup();
  try { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-tl-mix-')); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  const out = path.join(tempDir, 'timeline-mix.wav');
  // Uzun süzgeç komut satırına sığmayabilir: dosyadan okunur
  const script = path.join(tempDir, 'mix.txt');
  fs.writeFileSync(script, filter);
  const args = ['-hide_banner', '-v', 'error', '-y'];
  for (const s of inputs) args.push('-i', files.get(s));
  args.push('-filter_complex_script', script, '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s16le', out);
  const res = await new Promise((resolve) => {
    let err = '';
    let p;
    try { p = spawn(ff, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }); } catch { return resolve({ code: -1, err: 'spawn failed' }); }
    p.stderr.on('data', (d) => { if (err.length < 8000) err += d.toString(); });
    p.on('error', () => resolve({ code: -1, err }));
    p.on('close', (code) => resolve({ code, err }));
  });
  if (res.code !== 0 || !fs.existsSync(out)) { cleanup(); return { ok: false, error: (res.err || 'ffmpeg').slice(-400) }; }
  return { ok: true, file: out, sources: desc.sources.length, duration: desc.duration };
}

module.exports = { peaks, mixdown, cleanup, PEAK_RATE, isTemp: (f) => !!(tempDir && f && path.resolve(f).startsWith(path.resolve(tempDir))) };
