/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Arayüz araçlarının ortak başlangıcı (ui-walk, ui-audit): uygulamayı geçici profille açar, panele
   Chrome DevTools ile bağlanır. Kullanıcı verisine dokunmaz. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const L = require('./perf-lib');

const REPO = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EV_LIMIT = 90000; // tek çağrı bundan uzun sürerse araç takılmış sayılır

function electronPath() {
  const dir = path.join(REPO, 'node_modules/electron/dist');
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return path.join(dir, name);
}

const cdp = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  let id = 0;
  const pend = new Map();
  const on = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else on.forEach((f) => f(d));
  };
  ws.onerror = reject;
  ws.onopen = () => {
    const call = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => {
      const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails).slice(0, 500));
      return r.result && r.result.result && r.result.result.value;
    };
    resolve({ ws, call, ev, on });
  };
});

const panelReady = '!!(window.SVPanel && window.SVPanel.cfg && window.SVPanel.cfg() && document.querySelector(".sv-content .card"))';

/* opts: settings, presets, port. Dönen: { a, app, work, errors, ready } */
async function startPanel(opts) {
  // Önceki koşudan kalan uygulama bu kapıyı tutuyorsa yeni koşu farkında olmadan ona bağlanırdı
  if (await fetch('http://127.0.0.1:' + opts.port + '/json/version').then(() => true, () => false)) {
    throw new Error('Kapı ' + opts.port + ' dolu: açık kalan uygulamayı kapatın ya da --port= verin');
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-walk-'));
  const ud = path.join(work, 'ud');
  fs.mkdirSync(path.join(ud, 'presets'), { recursive: true });
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(L.sanitizeSettings(opts.settings ? L.readSettingsFile(opts.settings) : {})));
  if (opts.presets) {
    let n = 0;
    for (const f of fs.readdirSync(opts.presets)) { if (n++ > 300) break; fs.copyFileSync(path.join(opts.presets, f), path.join(ud, 'presets', f)); }
  }
  const app = spawn(electronPath(), [REPO, '--user-data-dir=' + ud, '--remote-debugging-port=' + opts.port], { stdio: 'ignore', env: opts.asWindows ? { ...process.env, SV_UI_AS_WINDOWS: '1' } : process.env });
  process.on('exit', () => { try { app.kill(); } catch { /* kapalı */ } });
  let t = null;
  for (let i = 0; i < 1200 && !t; i++) {
    await sleep(50);
    try { t = (await (await fetch('http://127.0.0.1:' + opts.port + '/json/list')).json()).find((x) => x.url.includes('admin/index.html')); } catch { /* henüz açılmadı */ }
  }
  if (!t) throw new Error('panel açılmadı');
  const a = await cdp(t.webSocketDebuggerUrl);
  // Yanıtsız çağrı aracı sessizce bekletmesin: hangi adımda durduğu yazılsın
  const rawEv = a.ev;
  a.ev = (e) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Panel ' + EV_LIMIT / 1000 + ' sn yanıt vermedi: ' + e.slice(0, 160))), EV_LIMIT);
    rawEv(e).then((v) => { clearTimeout(timer); resolve(v); }, (err) => { clearTimeout(timer); reject(err); });
  });
  await a.call('Runtime.enable');
  await a.call('Page.enable');
  const errors = [];
  a.on.push((d) => {
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((x) => x.value || x.description || '').join(' ').slice(0, 300));
  });
  const ready = async () => {
    for (let i = 0; i < 1200; i++) {
      try { if (await a.ev(panelReady) === true) return; } catch { /* sayfa yeniden yükleniyor */ }
      await sleep(50);
    }
    throw new Error('panel hazır olmadı');
  };
  await ready();
  const stop = async () => {
    try { a.ws.close(); } catch { /* kapalı */ }
    app.kill();
    await sleep(800);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç tutuyor olabilir */ }
  };
  return { a, app, work, errors, ready, stop };
}

module.exports = { REPO, sleep, electronPath, cdp, startPanel };
