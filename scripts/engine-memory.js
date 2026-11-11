/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* MOTOR WORKER'I BAŞINA BEDEL (#905). Aşama 2'de katman başına Worker açılacak; her biri
   kendi kodunu ve preset verisini tutuyor. Açılış süresi ve sayfa sürecinin belleği: tam
   motor, yalnız MilkDrop, gerçek preset çizen MilkDrop. Her satır yeni bir sayfada, böylece
   önceki Worker'ın belleği sonucu kirletmiyor. Kullanıcı verisine dokunmaz.

     npm run engine-memory -- --json=<dosya> */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const REPO = path.join(__dirname, '..');
const PORT = +arg('port', 9751);
const INSPECT = PORT + 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app = null;

function electronPath() {
  const dir = path.join(REPO, 'node_modules/electron/dist');
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  return path.join(dir, name);
}
const cdp = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  ws.onerror = reject;
  ws.onopen = () => {
    const call = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => {
      const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails).slice(0, 900));
      return r.result && r.result.result && r.result.result.value;
    };
    resolve({ ws, call, ev });
  };
});
async function waitTarget(match, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((x) => x.url.includes(match));
      if (t) return t;
    } catch { /* henüz yok */ }
    await sleep(100);
  }
  throw new Error('hedef yok: ' + match);
}

// MilkDrop katmanının Worker'da gerçekten ihtiyaç duyduğu betikler
const MILKDROP_ONLY = /\/shared\/(defaults|gl-link|low-power|milkdrop|milkdrop-sprites|milkdrop-audio|milkdrop-hlsl|milkdrop-shader|tempo|milkdrop-cycle|milkdrop-library|presets-milkdrop-pack|presets-milkdrop|presets)\.js$|\/visualizer\/(audio|modes\/glow|modes\/milkdrop)\.js$/;

// Her satır yeni bir sayfada: bir önceki Worker'ın belleği sonucu kirletmesin
async function freshPage(mainP) {
  const before = new Set((await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).map((t) => t.id));
  await mainP.ev(`(() => { const { BrowserWindow } = process.mainModule.require('electron');
    if (global.__eng) global.__eng.destroy();
    global.__eng = new BrowserWindow({ width: 320, height: 200, show: false, webPreferences: { preload: ${JSON.stringify(path.join(REPO, 'src/main/preload-exporter.js'))}, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    global.__eng.loadFile(${JSON.stringify(path.join(REPO, 'src/exporter/index.html'))}); return 1; })()`);
  let t = null;
  for (let i = 0; i < 300 && !t; i++) {
    await sleep(100);
    t = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find((x) => x.url.includes('exporter/index.html') && !before.has(x.id));
  }
  const e = await cdp(t.webSocketDebuggerUrl);
  await e.call('Runtime.enable');
  for (let i = 0; i < 600; i++) {
    if (await e.ev('document.readyState === "complete" && !!window.SVLayers') === true) break;
    await sleep(50);
  }
  await e.ev(fs.readFileSync(path.join(REPO, 'src/visualizer/engine-bridge.js'), 'utf8'));
  return e;
}
const memOf = async (mainP) => {
  await sleep(2000);
  return JSON.parse(await mainP.ev(`(() => {
    const { app } = process.mainModule.require('electron');
    const pid = global.__eng.webContents.getOSProcessId();
    const p = app.getAppMetrics().find((x) => x.pid === pid);
    return JSON.stringify({ ws: Math.round(p.memory.workingSetSize / 1024), priv: Math.round(p.memory.privateBytes / 1024) });
  })()`));
};

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-engmem-'));
  const ud = path.join(work, 'ud');
  fs.mkdirSync(ud);
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ updates: { auto: false } }));
  app = spawn(electronPath(), [REPO, '--user-data-dir=' + ud, '--remote-debugging-port=' + PORT, '--inspect=' + INSPECT], { stdio: 'ignore' });
  await waitTarget('admin/index.html', 120000);
  let mainT = null;
  for (let i = 0; i < 300 && !mainT; i++) {
    try { mainT = (await (await fetch('http://127.0.0.1:' + INSPECT + '/json/list')).json())[0]; } catch { /* henüz yok */ }
    if (!mainT) await sleep(100);
  }
  const mainP = await cdp(mainT.webSocketDebuggerUrl);
  await mainP.call('Runtime.enable');
  const driverUrl = 'file:///' + path.join(__dirname, 'engine-memory-driver.js').split(path.sep).join('/');
  const out = { when: new Date().toISOString(), rows: [] };
  const measure = async (name, only, n, run) => {
    const e = await freshPage(mainP);
    const base = await memOf(mainP);
    const info = JSON.parse(await e.ev(`(async () => {
      const all = window.SVEngineBridge.engineScripts(document);
      const scripts = ${only ? `all.filter((s) => ${only}.test(s))` : 'all'}.concat([${JSON.stringify(driverUrl)}]);
      window.__ws = [];
      let bootMs = 0, built = null;
      const preset = window.SVPresets.get('md_caya_constellations');
      for (let i = 0; i < ${n}; i++) {
        const b = await window.SVEngineBridge.boot({ scripts });
        window.__ws.push(b.worker);
        bootMs = b.bootMs;
        if (${run ? 'true' : 'false'}) {
          built = await new Promise((resolve) => {
            const on = (ev) => { const m = ev.data; if (m && m.__sv === 'mem-done') { b.worker.removeEventListener('message', on); resolve(m); } };
            b.worker.addEventListener('message', on);
            b.worker.postMessage({ __sv: 'mem-run', source: preset && preset.source, frames: 90, index: i });
          });
        }
      }
      return JSON.stringify({ bootMs: Math.round(bootMs), scripts: scripts.length, built: built });
    })()`));
    const m = await memOf(mainP);
    const r = { name, workers: n, bootMs: info.bootMs, scripts: info.scripts, basePrivMB: base.priv, privMB: m.priv, wsMB: m.ws, perWorkerPrivMB: +((m.priv - base.priv) / n).toFixed(1), built: info.built };
    out.rows.push(r);
    console.log(JSON.stringify(r));
    await e.ev('(() => { for (const w of window.__ws) w.terminate(); return 1; })()');
    try { e.ws.close(); } catch { /* kapanıyor */ }
  };
  const MD = MILKDROP_ONLY.toString();
  for (const n of [1, 3, 6]) await measure('tam motor, boşta', null, n, false);
  for (const n of [1, 3, 6]) await measure('yalnız MilkDrop, boşta', MD, n, false);
  for (const n of [1, 3, 6]) await measure('yalnız MilkDrop, preset çiziyor', MD, n, true);
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 1));
  try { mainP.ws.close(); } catch { /* kapanıyor */ }
  app.kill();
  await sleep(1000);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* süreç hâlâ tutuyor olabilir */ }
}

main().catch((err) => { console.error(err); try { if (app) app.kill(); } catch { /* yok */ } process.exit(1); });
