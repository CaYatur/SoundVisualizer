/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findMt() {
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const matches = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root)) {
      const candidate = path.join(root, version, 'x64', 'mt.exe');
      if (fs.existsSync(candidate)) matches.push({ version, candidate });
    }
  }
  matches.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!matches.length) throw new Error('mt.exe was not found in the Windows SDK.');
  return matches[0].candidate;
}

/* Paketin çalışma anında ihtiyaç duyduğu ikililer (#777). npm 12 bağımlılık
   kurulum betiklerini `allowScripts` dışında sessizce atlıyor: ffmpeg-static
   ikilisini indirmeyince paket ffmpeg'siz çıkıyor ve dışa aktarma o paketi
   kuran herkeste bozuluyordu. Eksikse paketleme durur. */
function requiredFiles(platform) {
  const nm = path.join('app.asar.unpacked', 'node_modules');
  const list = [
    path.join(nm, 'ffmpeg-static', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(nm, 'audify', 'build', 'Release', 'audify.node'),
    path.join(nm, 'bindings', 'bindings.js'),
    path.join(nm, 'file-uri-to-path', 'index.js'),
  ];
  // Spout (Windows) dokusu; Syphon ve Linux bu modülü kullanmıyor
  if (platform === 'win32') list.push(path.join(nm, '@napolab', 'texture-bridge-win32-x64-msvc'));
  return list;
}

function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

function checkRuntimeFiles(context) {
  const dir = resourcesDir(context);
  const missing = requiredFiles(context.electronPlatformName).filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) {
    throw new Error('Packaged app is missing runtime files (run `npm rebuild` with install scripts allowed): ' + missing.join(', '));
  }
  const ffmpeg = path.join(dir, requiredFiles(context.electronPlatformName)[0]);
  if (fs.statSync(ffmpeg).size < 1024 * 1024) throw new Error(`ffmpeg binary looks truncated: ${ffmpeg}`);
}

module.exports = async function afterPack(context) {
  checkRuntimeFiles(context);
  if (context.electronPlatformName !== 'win32') return;

  const root = context.packager.projectDir;
  const manifest = path.join(root, 'build', 'identity', 'CAYADEV.Visualizer.exe.manifest');
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(manifest)) throw new Error(`Identity manifest is missing: ${manifest}`);
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable is missing: ${executable}`);

  /* Kimlik exe'nin KENDİ bildirimine eklenir (-inputresource ile birleştirme).
     Eskiden yalnız -manifest veriliyordu: Electron'un bildirimi (Common
     Controls v6, Windows 10 supportedOS, dpiAware) tümüyle siliniyordu ve
     paketli Windows sürümünde her dialog.showMessageBox uygulamayı
     0x80000003 ile kapatıyordu (#822, ölçüldü; ikinci kopya uyarısı da). */
  const mt = findMt();
  const result = spawnSync(mt, [
    '-nologo',
    `-inputresource:${executable};#1`,
    '-manifest', manifest,
    `-outputresource:${executable};#1`,
  ], { encoding: 'utf8', windowsHide: true });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`mt.exe failed with exit code ${result.status}.`);
  checkManifest(readManifest(mt, executable));
  console.log(`Sparse identity metadata merged into ${executable}`);
};

function readManifest(mt, executable) {
  const out = path.join(path.dirname(executable), '.manifest-check.xml');
  const r = spawnSync(mt, ['-nologo', `-inputresource:${executable};#1`, `-out:${out}`], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`mt.exe could not read the manifest back (exit ${r.status}).`);
  try { return fs.readFileSync(out, 'utf8'); } finally { fs.rmSync(out, { force: true }); }
}

// Gömülen bildirimde hem Electron'un hem kimliğin parçaları olmalı
function checkManifest(xml) {
  const need = ['Microsoft.Windows.Common-Controls', 'supportedOS', 'dpiAware', 'packageName="CAYADEV.SoundVisualizer.Identity"'];
  const missing = need.filter((s) => !xml.includes(s));
  if (missing.length) throw new Error('Embedded manifest is missing: ' + missing.join(', '));
}

module.exports.requiredFiles = requiredFiles;
module.exports.checkManifest = checkManifest;
