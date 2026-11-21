/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* BeatDrop'u sabit bir commit'ten indirir, yalnız vis_milk2 ve ns-eel2'yi
   src/ altına kopyalar, bizim yamaları uygular, Microsoft D3DX NuGet
   paketini alır ve (Windows'ta) build.bat ile mdref.exe derler.

   Kullanım:
     node scripts/milkdrop-ref/setup.js
     node scripts/milkdrop-ref/setup.js --skip-build
     npm run milkdrop-ref:setup

   Ortam: VCVARS (vcvars32.bat yolu), DXSDK (D3DX build\native kökü). */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const CACHE = path.join(ROOT, '.cache');
const SKIP_BUILD = process.argv.includes('--skip-build');

// Yerel çalışmada kullanılan kesin commit (build.bat / patch-mvfix.js / mdref.cpp).
const BEATDROP_COMMIT = '53d83ee29841e0ae11bc4bd85f67cb09594762a2';
const BEATDROP_ZIP = 'https://github.com/mvsoft74/BeatDrop/archive/' + BEATDROP_COMMIT + '.zip';
const D3DX_ID = 'Microsoft.DXSDK.D3DX';
const D3DX_VER = '9.29.952.8';
const D3DX_URL = 'https://www.nuget.org/api/v2/package/' + D3DX_ID + '/' + D3DX_VER;

function log(m) { console.log(m); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u, n) => {
      https.get(u, { headers: { 'User-Agent': 'SoundVisualizer-milkdrop-ref' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n < 8) {
          res.resume();
          go(res.headers.location, n + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('indirme ' + res.statusCode + ': ' + u));
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync('tar', ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('zip açılamadı: ' + zip + ' (tar çıkış ' + r.status + ')');
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function cptree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function findDir(root, name) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === name) return p;
        stack.push(p);
      }
    }
  }
  return null;
}

function nodeRun(file) {
  const r = spawnSync(process.execPath, [path.join(ROOT, file)], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(file + ' başarısız');
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });

  log('BeatDrop ' + BEATDROP_COMMIT.slice(0, 7) + ' indiriliyor…');
  const bdZip = path.join(CACHE, 'BeatDrop-' + BEATDROP_COMMIT + '.zip');
  if (!fs.existsSync(bdZip) || fs.statSync(bdZip).size < 1000) await download(BEATDROP_ZIP, bdZip);
  const bdUnpack = path.join(CACHE, 'BeatDrop-' + BEATDROP_COMMIT);
  rmrf(bdUnpack);
  extractZip(bdZip, bdUnpack);
  const vis = findDir(bdUnpack, 'vis_milk2');
  const eel = findDir(bdUnpack, 'ns-eel2');
  if (!vis || !eel) throw new Error('BeatDrop arşivinde vis_milk2 / ns-eel2 yok');
  rmrf(path.join(ROOT, 'src', 'vis_milk2'));
  rmrf(path.join(ROOT, 'src', 'ns-eel2'));
  cptree(vis, path.join(ROOT, 'src', 'vis_milk2'));
  cptree(eel, path.join(ROOT, 'src', 'ns-eel2'));
  log('kaynak kopyalandı (yalnız vis_milk2 ve ns-eel2)');

  log('yamalar uygulanıyor…');
  nodeRun('patch.js');
  nodeRun('patch-mvfix.js');
  nodeRun('patch-errlog.js');

  log('Microsoft D3DX ' + D3DX_VER + ' indiriliyor…');
  const dxNupkg = path.join(CACHE, D3DX_ID + '.' + D3DX_VER + '.nupkg');
  if (!fs.existsSync(dxNupkg) || fs.statSync(dxNupkg).size < 1000) await download(D3DX_URL, dxNupkg);
  const dxDir = path.join(ROOT, 'd3dx');
  rmrf(dxDir);
  extractZip(dxNupkg, dxDir);
  const inc = path.join(dxDir, 'build', 'native', 'include');
  if (!fs.existsSync(inc)) throw new Error('D3DX yerleşimi beklenmedik: ' + inc);
  log('D3DX hazır: ' + inc);

  if (SKIP_BUILD) {
    log('--skip-build: derleme atlandı. Windows\'ta build.bat çalıştırın.');
    return;
  }
  if (process.platform !== 'win32') {
    log('kaynaklar hazır. mdref.exe yalnız Windows\'ta derlenir; orada build.bat veya bu betiği tekrar çalıştırın.');
    return;
  }
  log('derleniyor (build.bat)…');
  const bat = path.join(ROOT, 'build.bat');
  const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', bat], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('build.bat başarısız (çıkış ' + r.status + ')');
  const exe = path.join(ROOT, 'bin', 'mdref.exe');
  if (!fs.existsSync(exe)) throw new Error('mdref.exe oluşmadı');
  log('tamam: ' + exe);
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
