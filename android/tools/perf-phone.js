#!/usr/bin/env node
/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* TELEFON BAŞARIMI (emülatör ya da cihaz): motorun kare hızı ve düşen kareler, sayfanın uzun
   görevleri (>50 ms), ses karesi hızı ve sayfa ↔ uygulama gidiş-dönüşü. Kaynak: mikrofon (izin
   verilir) ya da demo ses. Kullanım:
     node android/tools/perf-phone.js [--secs=10] [--source=mic|none]
   Çıktı tek satır JSON; karşılaştırma için aynı koşulda iki kez koşun. */
const D = require('./lib/device.js');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SECS = Number(arg('secs', '10'));
const SOURCE = arg('source', 'mic');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = (secs) => `(async () => {
  const longs = [];
  let obs = null;
  try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }); obs.observe({ type: 'longtask', buffered: false }); } catch (e) { /* yok */ }
  const a0 = window.__svHost && window.__svHost.audioStats ? window.__svHost.audioStats() : null;
  const t = [];
  const end = performance.now() + ${secs * 1000};
  const rtt = [];
  const pinger = setInterval(async () => { const s = performance.now(); try { await window.SVAndroid.link.status(); } catch (e) { /* */ } rtt.push(performance.now() - s); }, 500);
  await new Promise((r) => { const f = (ts) => { t.push(ts); if (ts < end) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
  clearInterval(pinger);
  if (obs) obs.disconnect();
  const a1 = window.__svHost && window.__svHost.audioStats ? window.__svHost.audioStats() : null;
  const d = []; for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  const s = d.slice().sort((x, y) => x - y);
  const med = s[Math.floor(s.length / 2)] || 16.7;
  const drops = d.reduce((n, x) => n + Math.max(0, Math.round(x / med) - 1), 0);
  const r = rtt.slice().sort((x, y) => x - y);
  const q = (arr, p) => (arr.length ? Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]) : 0);
  const secs = (t[t.length - 1] - t[0]) / 1000;
  return {
    fps: Math.round(((t.length - 1) / secs) * 10) / 10, med: Math.round(med * 10) / 10, drops, maxFrame: Math.round(s[s.length - 1] || 0),
    longTasks: longs.length, longMs: Math.round(longs.reduce((x, y) => x + y, 0)),
    audioFps: a0 && a1 ? Math.round((a1.frames - a0.frames) / secs) : null, pcmPerSec: a0 && a1 ? Math.round((a1.pcm - a0.pcm) / secs) : null,
    rttP50: q(r, 0.5), rttP95: q(r, 0.95),
  };
})()`;

(async () => {
  const page = await D.connect(await D.launch()).catch(async () => { for (let i = 0; i < 60; i++) { await sleep(500); try { return await D.connect(); } catch { /* */ } } throw new Error('no page'); });
  for (let i = 0; i < 100 && !(await page.evaluate('!!(window.SVShell && window.SVShell.state().ready)')); i++) await sleep(200);
  await sleep(1500);
  if (SOURCE === 'mic') {
    D.adb(['shell', 'pm', 'grant', D.PKG, 'android.permission.RECORD_AUDIO']);
    await page.evaluate(`window.SVAndroid.audio.start('mic').then(() => 1, (e) => String(e))`);
  }
  await sleep(3000);
  const out = await page.evaluate(MEASURE(SECS));
  out.source = SOURCE;
  console.log(JSON.stringify(out));
  page.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
