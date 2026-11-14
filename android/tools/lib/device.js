/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* EMÜLATÖR / TELEFON YARDIMCILARI (Faz 0E ölçüm araçları).

   adb ile uygulamayı başlatır, WebView'in DevTools soketini bir TCP kapısına
   yönlendirir ve sayfaya Chrome DevTools Protocol ile bağlanır. Yalnız
   geliştirme sürümünde çalışır: WebView hata ayıklaması orada açık.

   Node 22+ gerekir (yerleşik WebSocket). */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PKG = 'com.cayadev.visualizer';
const ORIGIN = 'https://appassets.androidplatform.net';

function sdkDir() {
  const cands = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'), path.join(os.homedir(), 'Library', 'Android', 'sdk')];
  for (const c of cands) if (c && fs.existsSync(path.join(c, 'platform-tools'))) return c;
  throw new Error('Android SDK bulunamadı (ANDROID_HOME)');
}

function adbPath() {
  return path.join(sdkDir(), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
}

function adb(args, opts) {
  return execFileSync(adbPath(), args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})).trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uygulamayı (yeniden) başlatır; `page` yalnız geliştirme sürümünde dikkate alınır. */
async function launch(page) {
  /* Android'in tam ekran ilk kullanım uyarısı ekranın üst üçte birini kaplıyor ve
     siyah ekran ölçümünü bozuyordu (her şablon en az %32 aydınlık çıktı). Yalnız
     sınama cihazında: uyarı "görüldü" sayılır. */
  try { adb(['shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed']); } catch { /* eski sürüm */ }
  adb(['shell', 'am', 'force-stop', PKG]);
  const args = ['shell', 'am', 'start', '-W', '-n', PKG + '/.MainActivity'];
  if (page) args.push('-e', 'page', page);
  adb(args);
  for (let i = 0; i < 50; i++) {
    const pid = pidOf();
    if (pid && devtoolsSocket(pid)) return pid;
    await sleep(200);
  }
  throw new Error('uygulama ya da DevTools soketi açılmadı');
}

function pidOf() {
  try { return adb(['shell', 'pidof', PKG]).split(/\s+/)[0] || null; } catch { return null; }
}

function devtoolsSocket(pid) {
  const unix = adb(['shell', 'cat', '/proc/net/unix']);
  const name = 'webview_devtools_remote_' + pid;
  return unix.includes('@' + name) ? name : null;
}

/** Sayfaya CDP bağlantısı; `evaluate`, `screenshot`, `logs` ve `close` döner. */
async function connect(pid) {
  const sock = devtoolsSocket(pid || pidOf());
  if (!sock) throw new Error('DevTools soketi yok (geliştirme sürümü mü?)');
  const port = adb(['forward', 'tcp:0', 'localabstract:' + sock]);
  let page = null;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      page = list.find((p) => p.type === 'page' && String(p.url).startsWith(ORIGIN));
    } catch { /* henüz hazır değil */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('sayfa bulunamadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP bağlanamadı')); });
  let id = 0;
  const waiting = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push(m.params.type + ': ' + m.params.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(' '));
    } else if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) {
      logs.push('browser-' + m.params.entry.level + ': ' + m.params.entry.text);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    }
  };
  const call = (method, params) => new Promise((resolve, reject) => {
    const i = ++id;
    waiting.set(i, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  // Tarayıcının kendi uyarıları (ör. "Too many active WebGL contexts") burada gelir
  await call('Log.enable');
  return {
    port,
    url: page.url,
    logs,
    call,
    async evaluate(expression) {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
      if (r.exceptionDetails) throw new Error('sayfada hata: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      return r.result.value;
    },
    async screenshot(scale) {
      const m = await call('Page.getLayoutMetrics');
      const v = m.cssLayoutViewport || m.layoutViewport;
      const r = await call('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: v.clientWidth, height: v.clientHeight, scale: scale || 0.125 },
      });
      return Buffer.from(r.data, 'base64');
    },
    close() {
      try { ws.close(); } catch { /* kapanıyor */ }
      try { adb(['forward', '--remove', 'tcp:' + port]); } catch { /* yok */ }
    },
  };
}

/** Cihaz ekranının PNG görüntüsü (adb screencap). DevTools ekran görüntüsü WebView'de
    WebGL tuvallerini içermiyor (ölçüldü: her şablon siyah çıktı); bu, kullanıcının
    gördüğünün aynısı. */
function screencap() {
  return execFileSync(adbPath(), ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
}

module.exports = { PKG, ORIGIN, sdkDir, adb, adbPath, launch, pidOf, connect, sleep, screencap };
