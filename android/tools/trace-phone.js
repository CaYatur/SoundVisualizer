#!/usr/bin/env node
/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SAYFANIN UZUN GÖREVLERİ (takılma kaynağı): CDP zaman çizelgesi izi N saniye; 50 ms'yi aşan her
   ana iş parçacığı görevi için içindeki en pahalı alt olaylar (işlev çağrısı ve dosyası, düzen,
   stil, çöp toplama, zamanlayıcı, ileti). Kullanım: node android/tools/trace-phone.js [--secs=10] */
const D = require('./lib/device.js');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SECS = Number(arg('secs', '10'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const page = await D.connect();
  const events = [];
  let handle = null;
  page.on('Tracing.tracingComplete', (p) => { handle = p.stream; });
  // device.js çağrı yolunu kullanır; olayları ham soketten toplamak için Tracing'i "ReturnAsStream" ile al
  await page.call('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: ['devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8'], recordMode: 'recordAsMuchAsPossible' } });
  await sleep(SECS * 1000);
  await page.call('Tracing.end');
  for (let i = 0; i < 200 && !handle; i++) await sleep(100);
  if (!handle) { console.error('iz akışı alınamadı'); process.exit(2); }
  let data = '';
  for (;;) {
    const r = await page.call('IO.read', { handle, size: 1 << 20 });
    data += r.base64Encoded ? Buffer.from(r.data, 'base64').toString('utf8') : r.data;
    if (r.eof) break;
  }
  await page.call('IO.close', { handle });
  const parsed = JSON.parse(data);
  const ev = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  for (const e of ev) events.push(e);
  // Ana iş parçacığı: en çok RunTask olan iş parçacığı
  const tasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X');
  const byTid = new Map();
  for (const t of tasks) byTid.set(t.tid, (byTid.get(t.tid) || 0) + (t.dur || 0));
  // Sayfanın ana iş parçacığı (CrRendererMain); bulunamazsa en yoğun iş parçacığı (GPU olabilir)
  const named = events.find((e) => e.ph === 'M' && e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain');
  const mainTid = named ? named.tid : Array.from(byTid.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const gpuMs = Array.from(byTid.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tid, us]) => {
    const n = events.find((e) => e.ph === 'M' && e.name === 'thread_name' && e.tid === tid);
    return (n ? n.args.name : tid) + ' ' + Math.round(us / 1000 / SECS) + ' ms/sn';
  });
  console.log('en yoğun iş parçacıkları: ' + gpuMs.join(', '));
  const mine = events.filter((e) => e.tid === mainTid && e.ph === 'X');
  const longs = mine.filter((e) => e.name === 'RunTask' && e.dur > 50000);
  const label = (e) => {
    const d = e.args && e.args.data;
    if (e.name === 'FunctionCall' && d) return 'FunctionCall ' + String(d.url || '').split('/').slice(-2).join('/') + ':' + (d.lineNumber || 0) + ' ' + (d.functionName || '');
    if (e.name === 'TimerFire' && d) return 'TimerFire';
    if (e.name === 'EventDispatch' && d) return 'Event ' + d.type;
    return e.name;
  };
  console.log('ana iş parçacığı ' + mainTid + ', ' + SECS + ' sn, uzun görev ' + longs.length + ', toplam ' + Math.round(longs.reduce((x, y) => x + y.dur, 0) / 1000) + ' ms');
  for (const t of longs.slice(0, 15)) {
    const inner = mine.filter((e) => e !== t && e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && e.name !== 'RunTask');
    const agg = new Map();
    for (const e of inner) { const k = label(e); agg.set(k, Math.max(agg.get(k) || 0, e.dur || 0)); }
    const top = Array.from(agg.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => Math.round(v / 1000) + 'ms ' + k);
    console.log('  ' + Math.round(t.dur / 1000) + ' ms  ←  ' + top.join(' | '));
  }
  page.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
