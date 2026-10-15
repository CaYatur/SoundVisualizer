/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Uygulama başına ses yakalama yardımcısını derler (yalnızca macOS).
 *
 * ScreenCaptureKit Node'dan çağrılamıyor; Windows'taki .NET yardımcısıyla
 * aynı desende tek dosyalık bir Swift ikilisi. Yerel bir node eklentisi
 * Electron'un ABI'sine bağlanır ve her sürüm yükseltmesinde yeniden
 * derlenmesi gerekirdi; bu ikili Electron'dan bağımsız.
 *
 * Varsayılan: swiftc yoksa ya da derleme başarısız olursa SESSİZCE geçilir
 * (Windows betiğiyle aynı): özellik "yardımcı bulunamadı" der, uygulama
 * yine derlenir. --strict ile (CI) derleme hatası işi düşürür; yoksa bozuk
 * bir Swift dosyası hiç fark edilmeden yayına giderdi.
 *
 * Hedef macOS 13: ScreenCaptureKit'in ses yakalaması orada geldi.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const strict = process.argv.includes('--strict');

if (process.platform !== 'darwin') {
  console.log('macOS app audio helper is built only on macOS.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const dir = path.join(root, 'native', 'app-audio-helper-mac');
const src = path.join(dir, 'AppAudioHelper.swift');
const outDir = path.join(dir, 'build');
const out = path.join(outDir, 'app-audio-helper');

const archArg = process.argv.find((a) => a.startsWith('--arch='));
const arch = archArg ? archArg.slice(7) : (process.arch === 'x64' ? 'x86_64' : 'arm64');

function fail(msg) {
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg + ' (per-application capture will report as unavailable)');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const args = [
  'swiftc', '-O', '-parse-as-library',
  '-target', arch + '-apple-macos13.0',
  src, '-o', out,
];
console.log('Building macOS app audio helper: xcrun ' + args.join(' '));
const r = spawnSync('xcrun', args, { stdio: 'inherit' });
if (r.error) fail('xcrun/swiftc not found: ' + r.error.message);
if (r.status !== 0) fail('swiftc exited with code ' + r.status);
if (!fs.existsSync(out)) fail('helper binary missing after swiftc');

const kib = fs.statSync(out).size / 1024;
console.log(`macOS app audio helper prepared: ${out} (${kib.toFixed(0)} KiB, ${arch})`);
