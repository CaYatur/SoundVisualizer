/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* FAZ 0 ÖLÇÜM TAKIMI: bir sanal cihazı açar, uygulamayı ve sınama yardımcısını
   kurar, probe.js komutlarını sırayla koşar ve sonuçları bir klasöre yazar.

     node android/tools/suite.js --avd=sv-api31 --out=<klasör> [--song=<.m4a>] [--templates]

   Emülatör başsız açılır (-no-window), kendi kapısında çalışır ve bütün adb
   komutları yalnız ona gider (ANDROID_SERIAL); iş bitince — hata olsa da —
   kapatılır. Telefon için --avd verilmez: bağlı cihazda koşar. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const D = require('./lib/device');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const AVD = arg('avd');
const OUT = arg('out');
const SONG = arg('song');
if (!OUT) { console.error('--out=<klasör> gerekli'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..');

function probe(args, file) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, 'probe.js'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60 * 1000 });
  } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status || 1; }
  fs.writeFileSync(path.join(OUT, file), out);
  console.log((code ? 'HATA  ' : 'tamam ') + args.join(' '));
  return code ? 1 : 0;
}

function webviewVersion() {
  try {
    const m = /Current WebView package \(name, version\): \(([^,]+), ([^)]+)\)/.exec(D.adb(['shell', 'dumpsys', 'webviewupdate']));
    return m ? m[1] + ' ' + m[2] : null;
  } catch { return null; }
}

async function boot() {
  const port = 5580 + Math.floor(Math.random() * 20) * 2;
  process.env.ANDROID_SERIAL = 'emulator-' + port;
  const exe = path.join(D.sdkDir(), 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
  const emu = spawn(exe, ['-avd', AVD, '-port', String(port), '-no-window', '-no-boot-anim', '-no-snapshot-save', '-gpu', 'host'], { stdio: 'ignore' });
  D.adb(['wait-for-device']);
  for (let i = 0; i < 150; i++) {
    try { if (D.adb(['shell', 'getprop', 'sys.boot_completed']) === '1') break; } catch { /* açılıyor */ }
    await D.sleep(2000);
  }
  // Açıldı dendikten sonra paket yöneticisi bir süre daha hazır olmayabiliyor (API 37'de ölçüldü)
  for (let i = 0; i < 60; i++) {
    try { if (D.adb(['shell', 'pm', 'path', 'android']).startsWith('package:')) break; } catch { /* hazır değil */ }
    await D.sleep(2000);
  }
  await D.sleep(5000);
  return emu;
}

async function run() {
  const info = {
    avd: AVD || null,
    release: D.adb(['shell', 'getprop', 'ro.build.version.release']),
    sdk: D.adb(['shell', 'getprop', 'ro.build.version.sdk']),
    model: D.adb(['shell', 'getprop', 'ro.product.model']),
    webview: webviewVersion(),
  };
  fs.writeFileSync(path.join(OUT, 'device.json'), JSON.stringify(info, null, 1));
  console.log(JSON.stringify(info));
  for (const apk of ['app/build/outputs/apk/debug/app-debug.apk', 'tonegen/build/outputs/apk/debug/tonegen-debug.apk']) {
    for (let i = 0; ; i++) {
      try { D.adb(['install', '-r', '-g', path.join(ROOT, apk)]); break; } catch (e) {
        if (i >= 10) throw e;
        await D.sleep(3000);
      }
    }
  }
  let fails = 0;
  fails += probe(['caps', '--out=' + path.join(OUT, 'caps.json')], 'caps.log');
  fails += probe(['audio', '--source=capture', '--mode=allow', '--seconds=6'], 'audio-capture-allow.json');
  fails += probe(['audio', '--source=capture', '--mode=deny', '--seconds=5'], 'audio-capture-deny.json');
  fails += probe(['audio', '--source=visualizer', '--mode=deny', '--seconds=5'], 'audio-visualizer-deny.json');
  fails += probe(['audio', '--source=mic', '--mode=none', '--seconds=4'], 'audio-mic.json');
  if (SONG) fails += probe(['export', '--song=' + SONG, '--template=fireworks', '--seconds=5'], 'export.json');
  fails += probe(['floating'], 'floating.json');
  if (argv.includes('--templates')) fails += probe(['templates', '--out=' + path.join(OUT, 'templates.json')], 'templates.log');
  return fails;
}

async function main() {
  let emu = null;
  let fails = 1;
  try {
    if (AVD) emu = await boot();
    fails = await run();
  } finally {
    if (emu) {
      try { D.adb(['emu', 'kill']); } catch { /* kapanıyor */ }
      await D.sleep(3000);
      try { emu.kill(); } catch { /* yok */ }
    }
  }
  console.log(fails ? fails + ' komut başarısız' : 'hepsi tamam');
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
