/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* gen-mode-thumbs.js'in Electron tarafı: uygulamanın gizli çizim sayfasını
   (src/thumbs/modes.html) aynı önyüklemeyle açıp işleri sırayla çizer. */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const M = require('../src/main/mode-thumbs');
const md = require('../src/main/milkdrop-thumbs');

// Başsız makinede WebGL kara listede: yazılım GL
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

const spec = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: M.RECIPE.renderW, height: M.RECIPE.renderH, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload-thumbs.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  // Önyükleme doku isteklerini soruyor; burada doku yok
  ipcMain.handle('milkdrop:textures', () => ({ names: [] }));
  ipcMain.handle('milkdrop:texture', () => null);
  const ready = new Promise((r) => ipcMain.once('thumbs:ready', r));
  await win.loadFile(path.join(__dirname, '..', M.PAGE));
  await ready;
  let pending = null;
  ipcMain.on('thumbs:done', (e, key, r) => { if (pending && pending.key === key) pending.resolve(r); });
  let ok = 0;
  const failed = [];
  const t0 = Date.now();
  for (const j of spec.jobs) {
    const r = await new Promise((resolve) => {
      pending = { key: j.key, resolve };
      // Yazılım GL'de 6 saniyelik çizim bazı zeminlerde 30 sn'yi aşıyor (Yarım Ton ölçüldü)
      setTimeout(() => resolve({ ok: false, error: 'TIMEOUT' }), 120000);
      win.webContents.send('thumbs:job', { key: j.key, kind: j.kind, type: j.type, recipe: M.RECIPE });
    });
    if (r && r.ok && r.bytes) { md.writeAtomic(path.join(spec.dir, j.key + '.webp'), Buffer.from(r.bytes)); ok++; }
    else failed.push(j.kind + ':' + j.type + ' ' + (r && r.error));
  }
  console.log(JSON.stringify({ ok, failed, ms: Date.now() - t0 }));
  app.exit(failed.length && !ok ? 1 : 0);
});
