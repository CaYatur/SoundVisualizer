/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* CANLI / DIŞA AKTARIM EŞLİĞİ (#539) — aynı düzen canlıda ve videoda aynı
   görünmeli.

   İki yol katmanları FARKLI birleştiriyor: canlı pencere her katmanın
   tuvalini CSS ile (opacity, transform, mix-blend-mode, clip-path)
   tarayıcının GPU kompozitörüne bırakıyor; dışa aktarıcı aynı katmanları
   tek tuvale canvas 2D ile (globalAlpha, ctx dönüşümleri,
   globalCompositeOperation, clip) basıyor. Katmanların kendisi iki yolda
   aynı kod; fark birleştirmede çıkar.

   Betik uygulamanın gerçek görselleştirici sayfasını kendi köprüsüyle açar
   (bench.js gibi; main.js yüklenmez, kullanıcı verisi geçici klasörde).
   Sayfanın kendi döngüsü durdurulur (sessizlikte duraklat, ses yok). Her
   durum için katmanlar SABİT bir ses ve saatle bir kez çizilir: canlı CSS
   yolu ekranda birleşir, aynı tuvaller dışa aktarıcının yolundan
   (`drawTo(..., reuse)`) ikinci bir tuvale birleşir. Pencerenin ekran
   görüntüsü ile o tuval piksel piksel karşılaştırılır.

   Kullanım:
     npm run parity
     npm run parity -- --only=blend        (adı içeren durumlar)
     npm run parity -- --shots=<klasör>    (canlı, dışa aktarım ve fark görüntüleri)
     npm run parity -- --json=sonuc.json

   Çıkış kodu: bir durum eşiği aşarsa 1. */

const path = require('path');
const fs = require('fs');
const os = require('os');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const a = argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : d;
};

if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const electronPath = require('electron');
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [__filename].concat(argv), { stdio: 'inherit', cwd: path.join(__dirname, '..'), env });
  child.on('close', (code) => process.exit(code));
  return;
}

const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const P = require('./parity-lib.js');

const ROOT = path.join(__dirname, '..');
const ONLY = arg('only', '');
const SHOTS = arg('shots', '');
const JSON_OUT = arg('json', '');
const W = 960;
const H = 540;
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sv-parity-')));

const say = (s) => { try { process.stdout.write(s + '\n'); } catch (e) { /* boru kapalı */ } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let currentCfg = null;
function wireIpc(errors) {
  const empty = {
    'presets:list': [], 'presets:head': { gen: 0 }, 'presets:since': { gen: 0, upsert: [], remove: [] },
    'nowplaying:current': null, 'milkdrop:textures': [], 'milkdrop:texture': null, 'logo-lib:read': null,
    'lyrics-lib:snapshot': [], 'lyrics-lib:read': null, 'visualizer:geometry-lock-get': false,
    'cam-relay-claim': false, 'milkdrop:sprite-image': null, 'milkdrop:sprite': null,
  };
  ipcMain.handle('request-config', () => currentCfg);
  for (const ch of Object.keys(empty)) ipcMain.handle(ch, () => empty[ch]);
  ipcMain.on('visualizer-message', (e, msg) => {
    if (msg && (msg.type === 'error' || msg.error)) errors.push(String(msg.error || msg.message || JSON.stringify(msg)).slice(0, 200));
  });
}

/* Sayfada: katmanları sabit ses ve saatle çiz (canlı yol), aynı tuvalleri
   dışa aktarım yolundan birleştir, RGBA'yı döndür. Isınma kareleri açılış
   animasyonunun saatini kurar. */
const RENDER = (T, warm) => `(async () => {
  const st = window.SVStage && window.SVStage.stack();
  if (!st || !st.prevCfg) return { error: 'no stack' };
  const cfg = st.prevCfg;
  const bars = (n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.2 + 0.7 * Math.abs(Math.sin(i * 0.37 + 0.5)) * (1 - 0.5 * i / n); return a; };
  const A = { ready: true, level: 0.5, bass: 0.6, mid: 0.45, treble: 0.3, analysis: { hits: { kick: 0 } }, getBars: bars };
  const warm = ${JSON.stringify(warm)};
  /* Görseller (logo, kapak) ilk çizimde istenip eşzamansız yükleniyor;
     sayfanın döngüsü durduğu için birkaç kare t = 0'da çizilip beklenir. */
  for (let i = 0; i < 12; i++) { st.draw(A, cfg, 0, 1 / 30); await new Promise((r) => setTimeout(r, 50)); }
  for (const w of warm) st.draw(A, cfg, w, 1 / 30);
  st.draw(A, cfg, ${T}, 1 / 30);
  /* Dışa aktarım birleştirmesi AYNI görevde: WebGL katmanının çizim
     tamponu kompozitörden sonra silinebilir (dışa aktarıcı da çizdiği
     görevde okuyor). */
  const tmp = document.createElement('canvas');
  tmp.width = st.width; tmp.height = st.height;
  st.drawTo(tmp.getContext('2d'), A, cfg, ${T}, 1 / 30, null, true);
  // Kompozitör canlı yolu bir sonraki karede birleştirir
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = document.createElement('canvas');
  out.width = st.width; out.height = st.height;
  const o = out.getContext('2d');
  // Pencerenin zemini siyah: dışa aktarım da siyah zemine
  o.fillStyle = '#000'; o.fillRect(0, 0, out.width, out.height);
  o.drawImage(tmp, 0, 0);
  const d = o.getImageData(0, 0, out.width, out.height).data;
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
  // Canlı yol gerçekten CSS birleştirmesi mi (tek yüzeye inmediyse)
  return { w: out.width, h: out.height, rgba: btoa(s), single: !!st._surface };
})()`;

/* Kanıt görüntüleri: canlı, dışa aktarım ve 8 kat büyütülmüş fark. */
function writeShots(dir, name, live, lw, lh, exp, ew, eh) {
  const png = (bgra, w, h) => nativeImage.createFromBitmap(bgra, { width: w, height: h }).toPNG();
  const e = Buffer.alloc(ew * eh * 4);
  for (let i = 0; i < e.length; i += 4) { e[i] = exp[i + 2]; e[i + 1] = exp[i + 1]; e[i + 2] = exp[i]; e[i + 3] = 255; }
  const w = Math.min(lw, ew);
  const h = Math.min(lh, eh);
  const d = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * lw + x) * 4;
      const j = (y * ew + x) * 4;
      const k = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[k + c] = Math.min(255, Math.abs(live[i + c] - e[j + c]) * 8);
      d[k + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(dir, name + '-live.png'), png(live, lw, lh));
  fs.writeFileSync(path.join(dir, name + '-export.png'), png(e, ew, eh));
  fs.writeFileSync(path.join(dir, name + '-diff.png'), png(d, w, h));
}

async function run() {
  const errors = [];
  wireIpc(errors);
  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  currentCfg = P.baseConfig();
  const win = new BrowserWindow({
    x: display.workArea.x, y: display.workArea.y,
    width: Math.round(W / sf), height: Math.round(H / sf), useContentSize: true,
    frame: false, show: true, backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(ROOT, 'src/main/preload-visualizer.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      additionalArguments: ['--sv-display-id=' + display.id],
    },
  });
  win.webContents.on('console-message', (e) => {
    const level = e.level != null ? e.level : e.params && e.params.level;
    const msg = e.message != null ? e.message : e.params && e.params.message;
    if (level === 'error' || level === 3) errors.push(String(msg).slice(0, 200));
  });
  await win.loadFile(path.join(ROOT, 'src/visualizer/index.html'));
  await wait(1200);
  const logo = await win.webContents.executeJavaScript(P.LOGO_SCRIPT);

  const results = [];
  const cases = P.cases(logo).filter((c) => !ONLY || c.name.indexOf(ONLY) >= 0);
  for (const c of cases) {
    currentCfg = P.mergeCase(P.baseConfig(), c);
    win.webContents.send('config', currentCfg);
    await wait(700);
    const before = errors.length;
    const off = await win.webContents.executeJavaScript(RENDER(c.t, c.warm || []));
    if (!off || off.error) { results.push({ name: c.name, error: (off && off.error) || 'render failed' }); continue; }
    if (off.single) { results.push({ name: c.name, error: 'live path fell back to a single surface (not CSS compositing)' }); say('FAIL ' + c.name + ': single surface'); continue; }
    const img = await win.webContents.capturePage();
    const size = img.getSize();
    const live = img.toBitmap(); // BGRA
    const exp = Buffer.from(off.rgba, 'base64');
    const res = Object.assign({ name: c.name, note: c.note || '' }, P.compare(live, size.width, size.height, exp, off.w, off.h, true));
    if (errors.length > before) res.error = errors[errors.length - 1];
    res.pass = !res.error && P.passes(res, c.limit);
    results.push(res);
    say((res.pass ? 'ok   ' : 'FAIL ') + c.name + ': mean ' + res.mean.toFixed(3) + ', p99 ' + res.p99 + ', max ' + res.max +
      ', >8: ' + (res.over8 * 100).toFixed(3) + '%' + (res.error ? ' — ' + res.error : '') + (res.sizeNote ? ' (' + res.sizeNote + ')' : ''));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      writeShots(SHOTS, c.name, live, size.width, size.height, exp, off.w, off.h);
    }
  }
  win.destroy();
  const failed = results.filter((r) => !r.pass);
  say(results.length + ' cases, ' + failed.length + ' failed');
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ date: new Date().toISOString(), electron: process.versions.electron, size: W + 'x' + H, results }, null, 1));
  return failed.length ? 1 : 0;
}

app.whenReady().then(run).then((code) => app.exit(code), (e) => {
  say('parity: ' + (e && e.stack ? e.stack : e));
  app.exit(2);
});
