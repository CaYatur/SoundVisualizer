/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* gen-previews.js'in Electron tarafı: masaüstünün mod resmi sayfasını (src/thumbs/modes.html)
   aynı önyüklemeyle açar, çiziciyi (preview-runner.js) yükler ve işleri sırayla çizer. */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = require('./previews');
const spec = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));

// Başsız makinede WebGL kara listede: yazılım GL (gen-mode-thumbs-electron.js ile aynı)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

function writeAtomic(file, buf) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: P.RECIPE.renderW, height: P.RECIPE.renderH, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'main', 'preload-thumbs.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  // Doku yok: dokulu presetler dokusuz çizilir (telefonda da yerleşik doku yok)
  ipcMain.handle('milkdrop:textures', () => ({ names: [] }));
  ipcMain.handle('milkdrop:texture', () => null);
  const ready = new Promise((r) => ipcMain.once('thumbs:ready', r));
  await win.loadFile(path.join(ROOT, 'src', 'thumbs', 'modes.html'));
  await ready;
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'preview-runner.js'), 'utf8'));
  const idxFile = path.join(ROOT, P.DIR, 'index.json');
  const index = P.readIndex(ROOT);
  for (const k of P.KINDS) index[k] = index[k] || {};
  let ok = 0;
  const failed = [];
  const dim = [];
  const t0 = Date.now();
  for (const j of spec.jobs) {
    const r = await win.webContents.executeJavaScript('window.__svPreview(' + JSON.stringify(Object.assign({}, j, { recipe: P.RECIPE })) + ')');
    if (r && r.ok && r.data) {
      writeAtomic(path.join(ROOT, P.DIR, j.kind, j.id + '.webp'), Buffer.from(r.data, 'base64'));
      index[j.kind][j.id] = j.key;
      ok++;
      if (r.fullness < 0.05) dim.push(j.kind + ':' + j.id + ' ' + r.fullness);
    } else {
      failed.push(j.kind + ':' + j.id + ' ' + (r && r.error));
    }
    if ((ok + failed.length) % 10 === 0) console.log('[previews] ' + (ok + failed.length) + '/' + spec.jobs.length);
  }
  // Artık olmayan şablon/presetlerin kaydı düşer (dosyaları gen-previews.js siler)
  const live = new Set(spec.all.map((w) => w.kind + ':' + w.id));
  for (const k of P.KINDS) for (const id of Object.keys(index[k])) if (!live.has(k + ':' + id)) delete index[k][id];
  const sorted = {};
  for (const k of P.KINDS) sorted[k] = Object.fromEntries(Object.entries(index[k]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeAtomic(idxFile, Buffer.from(JSON.stringify(sorted, null, 1) + '\n'));
  console.log(JSON.stringify({ ok, failed, dim, ms: Date.now() - t0 }));
  app.exit(failed.length && !ok ? 1 : 0);
});
