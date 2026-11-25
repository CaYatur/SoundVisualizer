#!/usr/bin/env node
/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* SAYFANIN İŞLEMCİ PROFİLİ (emülatör ya da cihaz). CDP örnekleyicisiyle N saniye; işlevlere göre
   "kendi süresi" en yüksek 25 satır ve dosyalara göre toplam. Başarım işinde nereye bakılacağını
   ölçmek için (tahmin değil):  node android/tools/profile-phone.js [--secs=8] [--source=mic|none] */
const D = require('./lib/device.js');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const SECS = Number(arg('secs', '8'));
const SOURCE = arg('source', 'mic');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const page = await D.connect();
  if (SOURCE === 'mic') await page.evaluate(`window.SVAndroid.audio.start('mic').then(() => 1, (e) => String(e))`);
  else await page.evaluate(`window.SVAndroid.audio.stop().then(() => 1, () => 0)`);
  await sleep(2500);
  await page.call('Profiler.enable');
  await page.call('Profiler.setSamplingInterval', { interval: 500 });
  await page.call('Profiler.start');
  await sleep(SECS * 1000);
  const { profile } = await page.call('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas || [];
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) || 0) + (dt[i] || 0));
  const fn = new Map();
  const file = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const f = (cf.url || '').split('/').slice(-2).join('/') || '(' + cf.functionName + ')';
    const key = (cf.functionName || '(anon)') + ' ' + f + ':' + (cf.lineNumber + 1);
    fn.set(key, (fn.get(key) || 0) + us);
    file.set(f, (file.get(f) || 0) + us);
    total += us;
  }
  const top = (m, n) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => (Math.round((v / total) * 1000) / 10 + '%').padStart(7) + '  ' + k);
  console.log('toplam ' + Math.round(total / 1000) + ' ms, kaynak ' + SOURCE);
  console.log('--- işlevler (kendi süresi)');
  console.log(top(fn, 25).join('\n'));
  // Yerleşik işlevleri (performance.now gibi) kimin çağırdığı: ebeveyn düğüm
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n);
  const callers = new Map();
  for (const [id, us] of self) {
    const n = byId.get(id);
    if (n.callFrame.url) continue;
    const name = n.callFrame.functionName;
    if (!name || name.startsWith('(')) continue;
    const pn = parent.get(id);
    if (!pn) continue;
    const cf = pn.callFrame;
    const key = name + ' ← ' + (cf.functionName || '(anon)') + ' ' + (cf.url || '').split('/').slice(-2).join('/') + ':' + (cf.lineNumber + 1);
    callers.set(key, (callers.get(key) || 0) + us);
  }
  console.log('--- yerleşik işlevleri çağıranlar');
  console.log(top(callers, 12).join('\n'));
  console.log('--- dosyalar');
  console.log(top(file, 15).join('\n'));
  page.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
